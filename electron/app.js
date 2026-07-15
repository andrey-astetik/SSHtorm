const {
    app,
    BrowserWindow,
    ipcMain,
    shell,
    protocol,
    net,
    session: electronSession,
    webContents
} = require('electron');
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { encrypt, decrypt, hashPassword, generateSalt } = require('./modules/crypto');
const { createSocksServer } = require('./modules/socksProxy');
const { createForward } = require('./modules/portForward');
const docker = require('./modules/docker');
const { createVault } = require('./modules/vault');

// ─── State ───────────────────────────────────────────────
const sessions = {};          // { sessionId: { conn, shells: { shellId: stream }, sftp, host, user } }
let sessionCounter = 0;

const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const masterPath = path.join(app.getPath('userData'), 'master.key');
const vaultPath = path.join(app.getPath('userData'), 'vault.json');

// ─── Encrypted vault (single source of truth, owned by main) ──────
// See modules/vault.js. master.key (salt + password hash) stays separate because
// its salt is needed to derive the key that decrypts the vault, so we inject it.
const vault = createVault({ vaultPath, getSalt: () => getMasterSalt() });

// Host-key-change prompts awaiting a user decision, keyed by requestId.
// Holds what's needed to reconnect if the user accepts the new key.
const pendingHostKey = {};

function makeHostVerifier(host, port, session) {
    const id = `${host}:${port || 22}`;
    return (key) => {
        const fp = crypto.createHash('sha256').update(key).digest('base64');
        const stored = vault.getKey(id);
        if (!stored) {                          // first sight → trust + remember (TOFU)
            vault.setKey(id, fp);
            session.hostKeyFingerprint = fp;
            return true;
        }
        if (stored === fp) { session.hostKeyFingerprint = fp; return true; }
        // Key changed → drop the connection now; the user is prompted (see the
        // 'error' handler) and, if they accept, we update the key and reconnect.
        session.hostKeyMismatch = { id, oldFp: stored, newFp: fp };
        return false;
    };
}

// ─── Master Password ───────────────────────────────────
function getMasterState() {
    try {
        if (fs.existsSync(masterPath)) {
            return JSON.parse(fs.readFileSync(masterPath).toString());
        }
    } catch (e) {}
    return null;
}

function saveMasterState(state) {
    fs.writeFileSync(masterPath, JSON.stringify(state));
}

function getMasterSalt() {
    const ms = getMasterState();
    if (ms && ms.salt) return ms.salt;
    const salt = generateSalt();
    saveMasterState({ salt, hash: null });
    return salt;
}

// ─── Helpers ─────────────────────────────────────────────
function sendToRenderer(win, channel, data) {
    try {
        win.webContents.send('sender', { method: channel, data });
    } catch (e) { /* window may be closed */ }
}

function notifyAll(data) {
    BrowserWindow.getAllWindows().forEach(w => {
        try { w.webContents.send('sender', data); } catch (e) {}
    });
}

// ─── SSH Connection Manager ──────────────────────────────
function createSSHConnection(sessionId) {
    const conn = new Client();
    const session = {
        conn,
        shells: {},
        sftp: null,
        host: '',
        user: '',
        connected: false,
        forwards: {}    // local port forwards: id → { server, localPort, remoteHost, remotePort }
    };
    sessions[sessionId] = session;
    return session;
}

function destroySession(sessionId) {
    const s = sessions[sessionId];
    if (!s) return;
    // Close all shell streams
    if (s.shells) {
        Object.values(s.shells).forEach(stream => {
            try { stream.close(); } catch (e) {}
        });
    }
    // Tear down the per-session SOCKS proxy so the browser fails closed:
    // once SSH is gone there is no path to the network at all.
    if (s.socks?.server) {
        try { s.socks.server.close(); } catch (e) {}
    }
    // Close any local port forwards bound for this session.
    if (s.forwards) {
        Object.values(s.forwards).forEach(f => { try { f.server.close(); } catch (e) {} });
    }
    try { s.conn?.end(); } catch (e) {}
    delete sessions[sessionId];
}

// ─── Browser tunnel (SOCKS5 over SSH) ─────────────────────
// Each SSH session gets its own loopback SOCKS5 server (lazily started) and a
// dedicated Electron session partition whose only proxy is that SOCKS server.
// The browser <webview> uses this partition, so every request it makes can only
// leave the machine through this session's SSH connection.
const browserPartition = (sessionId) => `ssh-browser-${sessionId}`;

async function ensureBrowserProxy(sessionId) {
    const s = sessions[sessionId];
    if (!s || !s.connected) return { error: 'Not connected' };

    const partition = browserPartition(sessionId);

    if (!s.socks?.server) {
        const server = createSocksServer(() => {
            const cur = sessions[sessionId];
            return cur && cur.connected ? cur.conn : null;
        });
        try {
            await new Promise((res, rej) => {
                server.once('error', rej);
                server.listen(0, '127.0.0.1', res);
            });
        } catch (e) {
            return { error: 'Failed to start tunnel proxy: ' + e.message };
        }
        s.socks = { server, port: server.address().port };

        const ses = electronSession.fromPartition(partition);
        // fixed_servers + a single socks5 rule: no DIRECT fallback, so a dead
        // tunnel fails closed instead of silently going direct. `<-loopback>`
        // removes Chromium's implicit localhost bypass, forcing even loopback
        // (and DNS) through the proxy.
        await ses.setProxy({
            mode: 'fixed_servers',
            proxyRules: `socks5://127.0.0.1:${s.socks.port}`,
            proxyBypassRules: '<-loopback>'
        });

        // Only allow web/page schemes out. Everything else (file:, chrome:,
        // devtools:, chrome-extension:, filesystem:, …) is cancelled so a page
        // can neither read local files nor reach anything off the tunnel.
        ses.webRequest.onBeforeRequest((details, cb) => {
            cb({ cancel: !/^(https?|wss?|about|blob|data):/i.test(details.url) });
        });

        // Deny every permission request/check (geolocation, camera, mic,
        // clipboard, notifications, …) — no side channel around the disguise.
        ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
        ses.setPermissionCheckHandler(() => false);
    }

    return { partition, port: s.socks.port };
}

// Probe whether the server permits TCP forwarding at all. A direct-tcpip channel
// rejected with reason 1 (ADMINISTRATIVELY_PROHIBITED) means AllowTcpForwarding
// is off → the browser can't reach anything, so we warn upfront. Reason 2
// (connect failed, e.g. our throwaway target port) means forwarding works fine.
function probeForwarding(conn) {
    return new Promise((resolve) => {
        if (!conn) return resolve(false);
        // Time-box it: if the server's connect to the throwaway port hangs (e.g.
        // a DROP firewall, no RST), the callback may never fire — never block on it.
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        const timer = setTimeout(() => finish(false), 4000);
        try {
            conn.forwardOut('127.0.0.1', 0, '127.0.0.1', 9, (err, stream) => {
                clearTimeout(timer);
                if (stream) { try { stream.close(); } catch (e) {} }
                finish(!!(err && err.reason === 1));
            });
        } catch (e) { clearTimeout(timer); finish(false); }
    });
}

// Run a command on the SSH connection and resolve with its stdout.
function execCollect(conn, cmd) {
    return new Promise((resolve) => {
        try {
            conn.exec(cmd, (err, stream) => {
                if (err) return resolve('');
                let out = '';
                stream.on('data', (d) => { out += d.toString(); });
                stream.stderr.on('data', () => {});
                stream.on('close', () => resolve(out));
            });
        } catch (e) { resolve(''); }
    });
}

// Build a plausible desktop-Chrome UA for the *remote* machine's OS, with no
// Electron/app tokens — websites should see a fingerprint consistent with the
// SSH exit host, not with this app.
function buildUserAgent(osName, arch) {
    const chrome = process.versions.chrome || '124.0.0.0';
    const a = (arch || '').toLowerCase();
    let platform;
    if (osName === 'Darwin') {
        platform = 'Macintosh; Intel Mac OS X 10_15_7';
    } else if (/bsd/i.test(osName)) {
        platform = `X11; ${osName} ${arch || 'amd64'}`;
    } else if (osName === 'SunOS') {
        platform = 'X11; Solaris i86pc';
    } else { // Linux and unknown unixes
        const cpu = (a.includes('aarch64') || a.includes('arm')) ? 'Linux aarch64' : 'Linux x86_64';
        platform = `X11; ${cpu}`;
    }
    return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
}

// Detect (and cache) the remote machine's OS/arch/timezone so the browser can
// impersonate it (user-agent + clock).
async function getBrowserProfile(sessionId) {
    const s = sessions[sessionId];
    if (!s || !s.connected) return { error: 'Not connected' };
    if (s.browserProfile) return s.browserProfile;

    const raw = await execCollect(s.conn,
        'uname -s; uname -m; ' +
        '(timedatectl show -p Timezone --value 2>/dev/null || ' +
        'cat /etc/timezone 2>/dev/null || ' +
        'readlink /etc/localtime 2>/dev/null | sed "s#.*/zoneinfo/##")'
    );
    const lines = raw.split('\n').map(l => l.trim());
    const osName = lines[0] || 'Linux';
    const arch = lines[1] || 'x86_64';
    const tz = lines[2] || '';
    // Accept only IANA-looking ids (Region/City); otherwise leave the clock alone.
    const timezoneId = /^[A-Za-z]+\/[A-Za-z0-9_+\-/]+$/.test(tz) ? tz : null;

    s.browserProfile = { userAgent: buildUserAgent(osName, arch), timezoneId, osName, arch };
    return s.browserProfile;
}

// Apply the remote profile to a specific <webview> via the DevTools protocol:
// UA + timezone overrides take effect for all subsequent navigations.
async function applyBrowserProfile(sessionId, webContentsId) {
    const prof = sessions[sessionId]?.browserProfile;
    if (!prof) return { error: 'No profile' };
    const wc = webContents.fromId(webContentsId);
    if (!wc || wc.isDestroyed()) return { error: 'No webContents' };
    try {
        if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
        await wc.debugger.sendCommand('Emulation.setUserAgentOverride', { userAgent: prof.userAgent });
        if (prof.timezoneId) {
            await wc.debugger.sendCommand('Emulation.setTimezoneOverride', { timezoneId: prof.timezoneId });
        }
        return { ok: true, ...prof };
    } catch (e) {
        return { error: e.message };
    }
}

// ─── IPC: SSH Connect ────────────────────────────────────
function startConnection(win, opts) {
    const { sessionId: requestedId, host, port, username, password, privateKey } = opts;
    // Use sessionId from renderer (Date.now()), or generate one. Reused as-is on
    // a reconnect after the user accepts a changed host key.
    const sessionId = requestedId || ++sessionCounter;
    const session = createSSHConnection(sessionId);
    session.host = host;
    session.user = username;
    session.connectOpts = { ...opts, sessionId };   // kept for host-key reconnect

    const connOptions = {
        host: host,
        port: port || 22,
        username: username,
        readyTimeout: 20000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
        hostVerifier: makeHostVerifier(host, port, session)
    };

    if (privateKey) {
        connOptions.privateKey = privateKey;
        if (password) connOptions.passphrase = password;
    } else if (password) {
        connOptions.password = password;
    }

    connOptions.tryKeyboard = true;

    // Servers that only offer keyboard-interactive auth need this handler to
    // actually use the password (tryKeyboard alone does nothing without it).
    session.conn.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
        finish(prompts.map(() => password || ''));
    });

    session.conn.on('ready', () => {
        session.connected = true;
        // Disable Nagle for low-latency terminal I/O
        try { session.conn._sock?.setNoDelay?.(true); } catch (e) {}
        session.conn.sftp((err, sftp) => {
            if (!err) {
                session.sftp = sftp;
            }
        });
        sendToRenderer(win, 'ssh.connected', { sessionId, host, username });
    });

    session.conn.on('error', (err) => {
        console.error('SSH Error:', err.message);
        if (session.hostKeyMismatch) {
            // Connection was dropped because the key changed → ask the user
            // instead of surfacing a raw error. Stash what we need to reconnect.
            const { id, oldFp, newFp } = session.hostKeyMismatch;
            const requestId = `${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            pendingHostKey[requestId] = { opts: session.connectOpts, sessionId, id, newFp };
            sendToRenderer(win, 'ssh.hostkey.changed', { sessionId, id, oldFp, newFp, requestId });
            destroySession(sessionId);
            return;
        }
        sendToRenderer(win, 'ssh.error', { sessionId, error: err.message });
        destroySession(sessionId);
    });

    session.conn.on('close', () => {
        session.connected = false;
        // Suppress the disconnect signal when we dropped for a key change — the
        // host-key prompt is in flight and a reconnect may follow.
        if (!session.hostKeyMismatch) sendToRenderer(win, 'ssh.disconnected', { sessionId });
        destroySession(sessionId);
    });

    session.conn.on('banner', (msg) => {
        sendToRenderer(win, 'ssh.banner', { sessionId, banner: msg });
    });

    try {
        session.conn.connect(connOptions);
        sendToRenderer(win, 'ssh.connecting', { sessionId, host, username });
    } catch (err) {
        sendToRenderer(win, 'ssh.error', { sessionId, error: err.message });
        destroySession(sessionId);
    }
}

function handleConnect(event, opts) {
    startConnection(BrowserWindow.fromWebContents(event.sender), opts);
}

// ─── IPC: SSH Disconnect ─────────────────────────────────
function handleDisconnect(event, { sessionId }) {
    destroySession(sessionId);
}

// ─── IPC: SSH Exec ───────────────────────────────────────
function handleExec(event, { sessionId, command }) {
    const session = sessions[sessionId];
    if (!session || !session.connected) {
        const win = BrowserWindow.fromWebContents(event.sender);
        sendToRenderer(win, 'ssh.error', { sessionId, error: 'Not connected' });
        return;
    }

    session.conn.exec(command, (err, stream) => {
        if (err) {
            const win = BrowserWindow.fromWebContents(event.sender);
            sendToRenderer(win, 'ssh.exec.error', { sessionId, error: err.message });
            return;
        }
        let output = '';
        stream.on('data', (data) => {
            const s = data.toString();
            output += s;
        });
        stream.stderr.on('data', (data) => {
            output += data.toString();
        });
        stream.on('close', (code) => {
            const win = BrowserWindow.fromWebContents(event.sender);
            sendToRenderer(win, 'ssh.exec.result', { sessionId, output, exitCode: code });
        });
    });
}

// ─── IPC: SSH Shell (interactive terminal) ──────────────
function handleShellStart(event, { sessionId, shellId, cols, rows }) {
    const session = sessions[sessionId];
    if (!session || !session.connected) {
        const win = BrowserWindow.fromWebContents(event.sender);
        sendToRenderer(win, 'ssh.error', { sessionId, error: 'Not connected' });
        return;
    }
    const win = BrowserWindow.fromWebContents(event.sender);

    // Close existing shell with same shellId if any
    if (session.shells[shellId]) {
        try { session.shells[shellId].close(); } catch (e) {}
    }

    session.conn.shell({ term: 'xterm-256color', cols: cols || 80, rows: rows || 24 }, (err, stream) => {
        if (err) {
            sendToRenderer(win, 'ssh.error', { sessionId, shellId, error: 'Shell error: ' + err.message });
            return;
        }
        session.shells[shellId] = stream;

        // Disable Nagle on the shell stream for responsive terminal
        try { stream._sock?.setNoDelay?.(true); } catch (e) {}

        stream.on('data', (data) => {
            sendToRenderer(win, 'ssh.shell.output', {
                sessionId,
                shellId,
                data: data.toString('utf-8')
            });
        });

        stream.stderr.on('data', (data) => {
            sendToRenderer(win, 'ssh.shell.output', {
                sessionId,
                shellId,
                data: data.toString('utf-8')
            });
        });

        stream.on('close', () => {
            delete session.shells[shellId];
            sendToRenderer(win, 'ssh.shell.closed', { sessionId, shellId });
        });

        sendToRenderer(win, 'ssh.shell.started', { sessionId, shellId });
    });
}

// ─── IPC: SFTP Operations ────────────────────────────────
function handleSftpList(event, { sessionId, path: dirPath }) {
    const session = sessions[sessionId];
    if (!session?.sftp) {
        const win = BrowserWindow.fromWebContents(event.sender);
        sendToRenderer(win, 'ssh.error', { sessionId, error: 'SFTP not available' });
        return;
    }
    const win = BrowserWindow.fromWebContents(event.sender);

    session.sftp.readdir(dirPath || '/', (err, list) => {
        if (err) {
            sendToRenderer(win, 'ssh.sftp.listResult', { sessionId, path: dirPath, error: err.message });
            return;
        }
        const files = list.map(f => ({
            name: f.filename,
            longname: f.longname,
            isDirectory: f.attrs.isDirectory(),
            isFile: f.attrs.isFile(),
            isSymlink: f.attrs.isSymbolicLink(),
            size: f.attrs.size,
            mode: f.attrs.mode,
            uid: f.attrs.uid,
            gid: f.attrs.gid,
            mtime: f.attrs.mtime,
            atime: f.attrs.atime
        }));
        sendToRenderer(win, 'ssh.sftp.listResult', { sessionId, path: dirPath, files });
    });
}

function handleSftpRead(event, { sessionId, path: filePath }) {
    const session = sessions[sessionId];
    if (!session?.sftp) {
        const win = BrowserWindow.fromWebContents(event.sender);
        sendToRenderer(win, 'ssh.error', { sessionId, error: 'SFTP not available' });
        return;
    }
    const win = BrowserWindow.fromWebContents(event.sender);

    session.sftp.open(filePath, 'r', (err, handle) => {
        if (err) {
            sendToRenderer(win, 'ssh.sftp.readResult', { sessionId, path: filePath, error: err.message });
            return;
        }
        let buffer = Buffer.alloc(0);
        function readMore() {
            const chunk = Buffer.alloc(65536);
            session.sftp.read(handle, chunk, 0, chunk.length, buffer.length, (err, bytesRead, data) => {
                if (err) {
                    session.sftp.close(handle, () => {});
                    sendToRenderer(win, 'ssh.sftp.readResult', { sessionId, path: filePath, error: err.message });
                    return;
                }
                if (bytesRead > 0) {
                    buffer = Buffer.concat([buffer, data.slice(0, bytesRead)]);
                    readMore();
                } else {
                    session.sftp.close(handle, () => {});
                    const content = buffer.toString('utf-8');
                    sendToRenderer(win, 'ssh.sftp.readResult', {
                        sessionId, path: filePath,
                        content: content.length > 512000 ? content.slice(0, 512000) + '\n...truncated' : content
                    });
                }
            });
        }
        readMore();
    });
}

function handleSftpWrite(event, { sessionId, path: filePath, content, base64 }) {
    const session = sessions[sessionId];
    if (!session?.sftp) {
        const win = BrowserWindow.fromWebContents(event.sender);
        sendToRenderer(win, 'ssh.error', { sessionId, error: 'SFTP not available' });
        return;
    }
    const win = BrowserWindow.fromWebContents(event.sender);

    const buf = base64 ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf-8');
    session.sftp.open(filePath, 'w', (err, handle) => {
        if (err) {
            sendToRenderer(win, 'ssh.sftp.writeResult', { sessionId, path: filePath, error: err.message });
            return;
        }
        session.sftp.write(handle, buf, 0, buf.length, 0, (err) => {
            session.sftp.close(handle, () => {});
            sendToRenderer(win, 'ssh.sftp.writeResult', {
                sessionId, path: filePath,
                error: err ? err.message : null,
                success: !err
            });
        });
    });
}

function handleSftpMkdir(event, { sessionId, path: dirPath }) {
    const session = sessions[sessionId];
    if (!session?.sftp) {
        const win = BrowserWindow.fromWebContents(event.sender);
        sendToRenderer(win, 'ssh.error', { sessionId, error: 'SFTP not available' });
        return;
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    session.sftp.mkdir(dirPath, (err) => {
        sendToRenderer(win, 'ssh.sftp.mkdirResult', {
            sessionId, path: dirPath,
            error: err ? err.message : null, success: !err
        });
    });
}

function handleSftpDelete(event, { sessionId, path: filePath, isDir }) {
    const session = sessions[sessionId];
    if (!session?.sftp) {
        const win = BrowserWindow.fromWebContents(event.sender);
        sendToRenderer(win, 'ssh.error', { sessionId, error: 'SFTP not available' });
        return;
    }
    const win = BrowserWindow.fromWebContents(event.sender);

    if (isDir) {
        session.sftp.rmdir(filePath, (err) => {
            sendToRenderer(win, 'ssh.sftp.deleteResult', {
                sessionId, path: filePath,
                error: err ? err.message : null, success: !err
            });
        });
    } else {
        session.sftp.unlink(filePath, (err) => {
            sendToRenderer(win, 'ssh.sftp.deleteResult', {
                sessionId, path: filePath,
                error: err ? err.message : null, success: !err
            });
        });
    }
}

function handleSftpStat(event, { sessionId, path: filePath }) {
    const session = sessions[sessionId];
    if (!session?.sftp) {
        const win = BrowserWindow.fromWebContents(event.sender);
        sendToRenderer(win, 'ssh.error', { sessionId, error: 'SFTP not available' });
        return;
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    session.sftp.stat(filePath, (err, attrs) => {
        if (err) {
            sendToRenderer(win, 'ssh.sftp.statResult', { sessionId, path: filePath, error: err.message });
            return;
        }
        sendToRenderer(win, 'ssh.sftp.statResult', {
            sessionId, path: filePath,
            stat: {
                size: attrs.size,
                mode: attrs.mode,
                uid: attrs.uid,
                gid: attrs.gid,
                mtime: attrs.mtime,
                atime: attrs.atime,
                isDirectory: attrs.isDirectory(),
                isFile: attrs.isFile()
            }
        });
    });
}

// Binary read for images and other binary files → base64
function handleSftpReadBinary(event, { sessionId, path: filePath }) {
    const session = sessions[sessionId];
    if (!session?.sftp) {
        const win = BrowserWindow.fromWebContents(event.sender);
        sendToRenderer(win, 'ssh.error', { sessionId, error: 'SFTP not available' });
        return;
    }
    const win = BrowserWindow.fromWebContents(event.sender);

    // Limit to 5MB for images
    const MAX_SIZE = 5 * 1024 * 1024;
    session.sftp.open(filePath, 'r', (err, handle) => {
        if (err) {
            sendToRenderer(win, 'ssh.sftp.binaryResult', { sessionId, path: filePath, error: err.message });
            return;
        }
        let buffer = Buffer.alloc(0);
        function readMore() {
            const chunk = Buffer.alloc(65536);
            session.sftp.read(handle, chunk, 0, chunk.length, buffer.length, (err, bytesRead, data) => {
                if (err) {
                    session.sftp.close(handle, () => {});
                    sendToRenderer(win, 'ssh.sftp.binaryResult', { sessionId, path: filePath, error: err.message });
                    return;
                }
                if (bytesRead > 0) {
                    buffer = Buffer.concat([buffer, data.slice(0, bytesRead)]);
                    if (buffer.length > MAX_SIZE) {
                        session.sftp.close(handle, () => {});
                        sendToRenderer(win, 'ssh.sftp.binaryResult', { sessionId, path: filePath, error: 'File too large (>5MB)' });
                        return;
                    }
                    readMore();
                } else {
                    session.sftp.close(handle, () => {});
                    const mime = guessMime(filePath);
                    const base64 = buffer.toString('base64');
                    sendToRenderer(win, 'ssh.sftp.binaryResult', {
                        sessionId,
                        path: filePath,
                        base64,
                        mime,
                        size: buffer.length
                    });
                }
            });
        }
        readMore();
    });
}

function guessMime(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const map = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.ico': 'image/x-icon'
    };
    return map[ext] || 'application/octet-stream';
}

// ─── Window Creation ─────────────────────────────────────
let mainWindow = null;

function createWindow() {
    // Only enable DevTools in dev — production builds must not expose the
    // inspector (via shortcut, menu, or right-click) on the app or any webview.
    const isDev = process.argv.includes('--dev');

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        title: 'SSHtorm',
        frame: true,
        titleBarStyle: 'hiddenInset',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            webviewTag: true,
            devTools: isDev
        }
    });

    // In dev mode load from Vite dev server, otherwise load built files
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    } else {
        // Try packaged resources first, then development path
        let distDir = path.join(process.resourcesPath || '', 'web-dist');
        if (!fs.existsSync(path.join(distDir, 'index.html'))) {
            distDir = path.join(__dirname, '..', 'web-app', 'dist');
        }
        if (fs.existsSync(path.join(distDir, 'index.html'))) {
            mainWindow.loadURL(`app://dist/index.html`);
        } else {
            mainWindow.loadFile(path.join(__dirname, 'web', 'index.html'));
        }
    }

    // Strip preload/node access from any <webview> before it is created, and
    // disable its DevTools in production builds.
    mainWindow.webContents.on('will-attach-webview', (_evt, webPreferences) => {
        delete webPreferences.preload;
        webPreferences.nodeIntegration = false;
        webPreferences.contextIsolation = true;
        webPreferences.devTools = isDev;
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Fullscreen (macOS green button) — hide traffic lights, collapse spacer
    function notifyNativeMax(v) {
        if (mainWindow) mainWindow.webContents.executeJavaScript(
            `window.__nativeMaximized = ${v}; window.dispatchEvent(new Event('native-max-changed'))`
        ).catch(()=>{});
    }
    mainWindow.on('enter-full-screen', () => notifyNativeMax(true));
    mainWindow.on('leave-full-screen', () => notifyNativeMax(false));

mainWindow.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url);
        return { action: 'deny' };
    });
}

// ─── App Lifecycle ───────────────────────────────────────
app.whenReady().then(() => {
    // Renderer can query native maximize state on demand — no timers
    ipcMain.handle('get-native-max-state', () => {
        return mainWindow?.isFullScreen?.() || false;
    });

    // File save dialog
    ipcMain.handle('dialog.saveFile', async (event, { fileName, base64 }) => {
        const { dialog } = require('electron');
        const fs = require('fs');
        const result = await dialog.showSaveDialog(mainWindow, {
            defaultPath: fileName,
            title: 'Save file'
        });
        if (result.canceled || !result.filePath) return { success: false, canceled: true };
        try {
            fs.writeFileSync(result.filePath, Buffer.from(base64, 'base64'));
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // Run a command and return its captured output as a promise. Unlike the
    // fire-and-forget ssh.exec (whose ssh.exec.result is a broadcast with no
    // command correlation), this is request/response — used for one-off probes
    // like `id` where the renderer needs *this* command's output.
    ipcMain.handle('ssh.execCapture', async (event, { sessionId, command }) => {
        const session = sessions[sessionId];
        if (!session || !session.connected) return { error: 'Not connected' };
        return new Promise((resolve) => {
            session.conn.exec(command, (err, stream) => {
                if (err) { resolve({ error: err.message }); return; }
                let output = '';
                stream.on('data', (d) => { output += d.toString(); });
                stream.stderr.on('data', (d) => { output += d.toString(); });
                stream.on('close', (code) => resolve({ output, exitCode: code }));
            });
        });
    });

    // Prepare (or reuse) the SOCKS-over-SSH tunnel for a session's browser and
    // return the partition the <webview> must use.
    ipcMain.handle('browser.prepare', async (event, { sessionId }) => {
        // Return the tunnel info immediately; the forwarding probe is a separate
        // call so a slow/hanging probe can never block the browser from opening.
        return ensureBrowserProxy(sessionId);
    });

    // Separate, time-boxed check for AllowTcpForwarding (drives the warning banner).
    ipcMain.handle('browser.checkForwarding', async (event, { sessionId }) => {
        return { forwardingBlocked: await probeForwarding(sessions[sessionId]?.conn) };
    });

    // Detect the remote machine's UA/timezone profile for the browser.
    ipcMain.handle('browser.profile', async (event, { sessionId }) => {
        return getBrowserProfile(sessionId);
    });

    // Apply that profile (UA + clock) to a specific webview by its webContents id.
    ipcMain.handle('browser.applyProfile', async (event, { sessionId, webContentsId }) => {
        return applyBrowserProfile(sessionId, webContentsId);
    });

    // ─── Local port forwarding (ssh -L) ──────────────────
    // Bind 127.0.0.1:<localPort> (0 = auto) and tunnel it to remoteHost:remotePort
    // through this session's SSH connection.
    ipcMain.handle('forward.add', async (event, { sessionId, localPort, remoteHost, remotePort }) => {
        const s = sessions[sessionId];
        if (!s || !s.connected) return { error: 'Not connected' };
        const rport = parseInt(remotePort, 10);
        if (!rport || rport < 1 || rport > 65535) return { error: 'Invalid remote port' };
        const rhost = (remoteHost || 'localhost').trim() || 'localhost';

        const server = createForward(() => {
            const cur = sessions[sessionId];
            return cur && cur.connected ? cur.conn : null;
        }, rhost, rport);

        try {
            await new Promise((res, rej) => {
                server.once('error', rej);
                server.listen(parseInt(localPort, 10) || 0, '127.0.0.1', res);
            });
        } catch (e) {
            return { error: 'Failed to bind local port: ' + e.message };
        }
        const port = server.address().port;
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        s.forwards[id] = { server, localPort: port, remoteHost: rhost, remotePort: rport };
        return { id, localPort: port, remoteHost: rhost, remotePort: rport };
    });

    ipcMain.handle('forward.remove', (event, { sessionId, id }) => {
        const s = sessions[sessionId];
        const f = s?.forwards?.[id];
        if (f) { try { f.server.close(); } catch (e) {} delete s.forwards[id]; }
        return { ok: true };
    });

    ipcMain.handle('forward.list', (event, { sessionId }) => {
        const s = sessions[sessionId];
        if (!s) return [];
        return Object.entries(s.forwards || {}).map(([id, f]) => ({
            id, localPort: f.localPort, remoteHost: f.remoteHost, remotePort: f.remotePort
        }));
    });

    // ─── Docker management (over the SSH exec channel) ───
    const dockerCall = (sessionId, fn) => {
        const s = sessions[sessionId];
        if (!s || !s.connected) return Promise.resolve({ error: 'Not connected' });
        return fn(s.conn);
    };
    ipcMain.handle('docker.available', (e, { sessionId }) => dockerCall(sessionId, docker.available));
    ipcMain.handle('docker.ps', (e, { sessionId }) => dockerCall(sessionId, docker.ps));
    ipcMain.handle('docker.images', (e, { sessionId }) => dockerCall(sessionId, docker.images));
    ipcMain.handle('docker.stats', (e, { sessionId }) => dockerCall(sessionId, docker.stats));
    ipcMain.handle('docker.action', (e, { sessionId, action, id }) => dockerCall(sessionId, (conn) => docker.action(conn, action, id)));

    // Harden every browser <webview> the renderer attaches: keep it sandboxed,
    // strip preload/node access, and block WebRTC's non-proxied UDP so it cannot
    // leak the real IP around the SOCKS tunnel.
    app.on('web-contents-created', (_e, contents) => {
        if (contents.getType() === 'webview') {
            try { contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp'); } catch (e) {}
            // Dark default background so about:blank / the pre-paint flash don't
            // blind the user on the dark UI (sites with their own bg are unaffected).
            try { contents.setBackgroundColor('#1e1e2e'); } catch (e) {}
            contents.setWindowOpenHandler(({ url }) => {
                // Popups would escape the partition's proxy → keep navigation
                // inside the tunnelled webview instead, and only for web URLs.
                if (/^https?:\/\//i.test(url)) { try { contents.loadURL(url); } catch (e) {} }
                return { action: 'deny' };
            });
            // Block top-level navigation to non-web schemes (file:, chrome:, …).
            contents.on('will-navigate', (e, url) => {
                if (!/^(https?|about):/i.test(url)) e.preventDefault();
            });
        }
    });

    // Register custom app:// protocol to serve static files
    // Try packaged resources first, then development path
    let distDir = path.join(process.resourcesPath || '', 'web-dist');
    if (!fs.existsSync(path.join(distDir, 'index.html'))) {
        distDir = path.join(__dirname, '..', 'web-app', 'dist');
    }
    protocol.handle('app', (request) => {
        const urlPath = request.url.replace('app://', '');
        let filePath;
        if (urlPath.startsWith('dist/')) {
            filePath = path.join(distDir, urlPath.replace('dist/', ''));
        } else if (urlPath.startsWith('/')) {
            filePath = path.join(distDir, urlPath);
        } else {
            filePath = path.join(distDir, urlPath);
        }
        filePath = path.normalize(filePath);
        const fileUrl = require('url').pathToFileURL(filePath).href;
        return net.fetch(fileUrl);
    });

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    // ─── Fast-path IPC for high-frequency shell I/O ──────
    ipcMain.on('ssh-shell', (event, { method, sessionId, shellId, data, cols, rows }) => {
        if (method === 'input') {
            const stream = sessions[sessionId]?.shells?.[shellId];
            if (stream) stream.write(data);
        } else if (method === 'start') {
            handleShellStart(event, { sessionId, shellId, cols, rows });
        } else if (method === 'resize') {
            const stream = sessions[sessionId]?.shells?.[shellId];
            // ssh2 signature is setWindow(rows, cols, height, width) — rows FIRST.
            // Passing (cols, rows) swaps them and pins the remote pty width to the
            // row count (24), so anything that queries TIOCGWINSZ (readline/zle/vi)
            // wraps at 24 cols while raw output (cat) still fills the real width.
            if (stream) stream.setWindow(rows, cols, 0, 0);
        }
    });

    // ─── IPC Router ──────────────────────────────────
    ipcMain.on('reciever', async (event, data) => {
        const { method, data: payload } = data || {};

        switch (method) {
            // SSH Connect / Disconnect
            case 'ssh.connect':
                handleConnect(event, payload);
                break;
            case 'ssh.disconnect':
                handleDisconnect(event, payload);
                break;
            case 'ssh.hostkey.decision':
                {
                    const { requestId, trust } = payload || {};
                    const pend = pendingHostKey[requestId];
                    if (!pend) break;
                    delete pendingHostKey[requestId];
                    const win = BrowserWindow.fromWebContents(event.sender);
                    if (trust) {
                        // Accept the new key, then reconnect with the same sessionId.
                        vault.setKey(pend.id, pend.newFp);
                        startConnection(win, pend.opts);
                    } else {
                        sendToRenderer(win, 'ssh.error', {
                            sessionId: pend.sessionId,
                            error: `Host key for ${pend.id} changed and was not trusted — connection refused.`
                        });
                    }
                }
                break;
            case 'ssh.exec':
                handleExec(event, payload);
                break;

            // SFTP
            case 'ssh.sftp.list':
                handleSftpList(event, payload);
                break;
            case 'ssh.sftp.read':
                handleSftpRead(event, payload);
                break;
            case 'ssh.sftp.write':
                handleSftpWrite(event, payload);
                break;
            case 'ssh.sftp.mkdir':
                handleSftpMkdir(event, payload);
                break;
            case 'ssh.sftp.delete':
                handleSftpDelete(event, payload);
                break;
            case 'ssh.sftp.stat':
                handleSftpStat(event, payload);
                break;
            case 'ssh.sftp.readBinary':
                handleSftpReadBinary(event, payload);
                break;

            // Hosts persistence
            case 'hosts.save':
                vault.setHosts(payload);
                break;
            case 'hosts.load':
                event.sender.send('sender', { method: 'hosts.loaded', data: vault.getHosts() });
                break;
            case 'knownhosts.remove':
                {
                    const { host, port } = payload || {};
                    vault.removeKey(`${host}:${port || 22}`);
                }
                break;

            // Master password
            case 'master.status':
                event.sender.send('sender', { method: 'master.status', data: { hasPassword: !!getMasterState()?.hash } });
                break;
            case 'master.set':
                {
                    const { password } = payload;
                    const salt = getMasterSalt();
                    const hash = hashPassword(password, salt);
                    saveMasterState({ salt, hash });
                    vault.unlock(password);   // init empty vault for the new password
                    vault.persist();          // ensure vault.json exists
                    event.sender.send('sender', { method: 'master.set', data: { success: true } });
                }
                break;
            case 'master.verify':
                {
                    const { password } = payload;
                    const ms = getMasterState();
                    if (!ms?.hash) {
                        event.sender.send('sender', { method: 'master.verify', data: { success: false, error: 'No master password set' } });
                        break;
                    }
                    const hash = hashPassword(password, ms.salt || getMasterSalt());
                    if (hash === ms.hash) {
                        vault.unlock(password);
                        event.sender.send('sender', { method: 'master.verify', data: { success: true, hosts: vault.getHosts() } });
                    } else {
                        event.sender.send('sender', { method: 'master.verify', data: { success: false, error: 'Wrong password' } });
                    }
                }
                break;

            case 'master.reset':
                try {
                    [masterPath, vaultPath].forEach(p => {
                        if (fs.existsSync(p)) fs.unlinkSync(p);
                    });
                    vault.lock();
                    event.sender.send('sender', { method: 'master.reset', data: { success: true } });
                } catch (e) {
                    event.sender.send('sender', { method: 'master.reset', data: { success: false, error: e.message } });
                }
                break;

            // App quit
            case 'appQuit':
                app.quit();
                break;

            default:
                console.log('Unknown IPC method:', method, payload);
                break;
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
    // Clean up all SSH sessions
    Object.keys(sessions).forEach(id => destroySession(id));
});

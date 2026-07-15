// Tests local port forwarding (electron/modules/portForward.js) against the
// docker sshd container: forward a local port to the container-internal HTTP
// server (127.0.0.1:8000, NOT published to the host) and fetch through it.
//
//   node docker/sshd-test/forward.test.js

const net = require('net');
const http = require('http');
const { Client } = require('../../electron/node_modules/ssh2');
const { createForward } = require('../../electron/modules/portForward');

const CFG = { host: '127.0.0.1', port: 2222, username: 'root', password: 'testpass123' };

let failures = 0;
const log = (ok, msg) => { console.log(`${ok ? '✅' : '❌'} ${msg}`); if (!ok) failures++; };

function get(port) {
    return new Promise((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 4000 }, (res) => {
            let body = ''; res.on('data', (d) => body += d); res.on('close', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(new Error('timeout')); });
    });
}

const conn = new Client();
conn.on('ready', async () => {
    let connected = true;
    const server = createForward(() => (connected ? conn : null), '127.0.0.1', 8000);
    await new Promise((res) => server.listen(0, '127.0.0.1', res));
    const localPort = server.address().port;

    try {
        const r = await get(localPort);
        log(r.status === 200, `forward reaches container-internal :8000 via localhost:${localPort} (status ${r.status})`);
    } catch (e) {
        log(false, 'forward reaches container-internal :8000 — ' + e.message);
    }

    // Fail-closed: drop the connection, the forward should refuse new sockets.
    connected = false;
    let refused = false;
    try { await get(localPort); } catch (e) { refused = true; }
    log(refused, 'forward fails closed once the SSH connection is gone');

    server.close();
    conn.end();
    console.log(failures ? `\n${failures} test(s) failed` : '\nForward tests passed');
    process.exit(failures ? 1 : 0);
});
conn.on('error', (e) => { console.error('SSH error:', e.message); process.exit(1); });
conn.connect(CFG);

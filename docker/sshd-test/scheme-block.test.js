// Verifies the browser partition blocks non-web schemes (file://) while still
// allowing http(s) through the tunnel — i.e. a page can't read local files or
// escape the SSH path.
//
//   electron/node_modules/.bin/electron docker/sshd-test/scheme-block.test.js

const { app, BrowserWindow, session: electronSession } = require('electron');
const { Client } = require('../../electron/node_modules/ssh2');
const { createSocksServer } = require('../../electron/modules/socksProxy.js');

const SSH = { host: '127.0.0.1', port: 2222, username: 'root', password: 'testpass123' };

function tryLoad(win, url) {
    return new Promise((resolve) => {
        const wc = win.webContents;
        const onOk = () => { cleanup(); resolve({ ok: true }); };
        const onFail = (_e, code, desc) => { cleanup(); resolve({ ok: false, code, desc }); };
        const cleanup = () => { wc.removeListener('did-finish-load', onOk); wc.removeListener('did-fail-load', onFail); };
        wc.once('did-finish-load', onOk);
        wc.once('did-fail-load', onFail);
        wc.loadURL(url).catch(() => {});
        setTimeout(() => { cleanup(); resolve({ ok: false, code: 'timeout' }); }, 8000);
    });
}

async function main() {
    let failures = 0;
    const log = (ok, msg) => { console.log(`${ok ? '✅' : '❌'} ${msg}`); if (!ok) failures++; };

    const conn = new Client();
    await new Promise((res, rej) => conn.on('ready', res).on('error', rej).connect(SSH));
    const server = createSocksServer(() => conn);
    await new Promise((res) => server.listen(0, '127.0.0.1', res));
    const ses = electronSession.fromPartition('scheme-test');
    await ses.setProxy({ mode: 'fixed_servers', proxyRules: `socks5://127.0.0.1:${server.address().port}`, proxyBypassRules: '<-loopback>' });
    ses.webRequest.onBeforeRequest((details, cb) => {
        cb({ cancel: !/^(https?|wss?|about|blob|data):/i.test(details.url) });
    });

    const win = new BrowserWindow({ show: false, webPreferences: { partition: 'scheme-test' } });

    const http = await tryLoad(win, 'http://localhost:8000/');
    log(http.ok, `http through tunnel loads (${http.ok ? 'ok' : http.code + ' ' + http.desc})`);

    const file = await tryLoad(win, 'file:///etc/hosts');
    log(!file.ok, `file:// blocked (${file.ok ? 'LOADED — bad!' : file.code + ' ' + (file.desc || '')})`);

    win.destroy(); server.close(); conn.end();
    console.log(failures ? `\n${failures} test(s) failed` : '\nScheme-blocking verified');
    app.exit(failures ? 1 : 0);
}

app.whenReady().then(main).catch((e) => { console.error('FATAL', e); app.exit(2); });

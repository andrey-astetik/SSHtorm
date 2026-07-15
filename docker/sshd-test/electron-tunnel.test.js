// Electron-level E2E for the browser tunnel. Exercises the exact path a
// <webview> uses: an Electron `session` partition whose only proxy is the
// per-session SOCKS5-over-SSH server.
//
//   electron/node_modules/.bin/electron docker/sshd-test/electron-tunnel.test.js
//
// Asserts:
//  1. A request from the TUNNELLED session reaches the container-internal
//     127.0.0.1:8000 service (not published to the host) → traffic goes via SSH.
//  2. A request from the DEFAULT (un-proxied) session to the same address is
//     refused → that service is genuinely unreachable without the tunnel.
//  3. After SSH disconnects, the tunnelled session can no longer connect
//     (fail-closed).

const { app, session: electronSession, net } = require('electron');
const { Client } = require('../../electron/node_modules/ssh2');
const { createSocksServer } = require('../../electron/modules/socksProxy.js');

const SSH = { host: '127.0.0.1', port: 2222, username: 'root', password: 'testpass123' };
const TARGET = 'http://localhost:8000/';

function fetchWith(ses, url) {
    // Cache-buster: a fresh URL each call so a prior 200 can't be served from
    // the session HTTP cache (which would mask a fail-closed tunnel).
    url += (url.includes('?') ? '&' : '?') + 't=' + Date.now() + Math.random();
    return new Promise((resolve, reject) => {
        const req = net.request({ url, session: ses, useSessionCookies: false });
        let body = '';
        req.on('response', (res) => {
            res.on('data', (d) => (body += d));
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject);
        setTimeout(() => reject(new Error('timeout')), 8000);
        req.end();
    });
}

async function main() {
    let failures = 0;
    const log = (ok, msg) => { console.log(`${ok ? '✅' : '❌'} ${msg}`); if (!ok) failures++; };

    const conn = new Client();
    await new Promise((res, rej) => conn.on('ready', res).on('error', rej).connect(SSH));
    console.log('• SSH connected');

    let connAlive = true;
    const server = createSocksServer(() => (connAlive ? conn : null));
    await new Promise((res) => server.listen(0, '127.0.0.1', res));
    const port = server.address().port;

    const tunnelSes = electronSession.fromPartition('test-tunnel');
    await tunnelSes.setProxy({
        mode: 'fixed_servers',
        proxyRules: `socks5://127.0.0.1:${port}`,
        proxyBypassRules: '<-loopback>'
    });

    // 1. Tunnelled session reaches the internal-only service.
    try {
        const r = await fetchWith(tunnelSes, TARGET);
        log(r.status === 200 && /Tunnel OK/.test(r.body), `tunnelled session reached internal service (status ${r.status})`);
    } catch (e) {
        log(false, `tunnelled session failed: ${e.message}`);
    }

    // 2. Default session cannot reach it (no tunnel, port not published).
    try {
        await fetchWith(electronSession.defaultSession, TARGET);
        log(false, 'default session reached internal service — should be impossible');
    } catch (e) {
        log(true, `default (un-proxied) session cannot reach it (${e.message})`);
    }

    // 3. Fail-closed after disconnect.
    connAlive = false;
    conn.end();
    try {
        await fetchWith(tunnelSes, TARGET);
        log(false, 'tunnelled session still worked after SSH down — not fail-closed');
    } catch (e) {
        log(true, `fail-closed after SSH disconnect (${e.message})`);
    }

    server.close();
    console.log(failures ? `\n${failures} test(s) failed` : '\nAll Electron tunnel tests passed');
    app.exit(failures ? 1 : 0);
}

app.whenReady().then(main).catch((e) => { console.error('FATAL', e); app.exit(2); });

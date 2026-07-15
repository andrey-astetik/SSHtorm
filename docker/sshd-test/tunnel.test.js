// Headless integration test for the SOCKS-over-SSH tunnel (socksProxy.js).
// Requires the sshtorm-sshd container running on localhost:2222.
//
//   node docker/sshd-test/tunnel.test.js
//
// Verifies:
//  1. An HTTP request through the SOCKS proxy reaches a service that is bound to
//     127.0.0.1 *inside the container* and NOT published to the host — provable
//     only if traffic really goes through the SSH tunnel.
//  2. Domain-name (ATYP=0x03) requests are resolved on the SSH server side.
//  3. Fail-closed: when there is no SSH connection, requests are refused.

const net = require('net');
const { Client } = require('../../electron/node_modules/ssh2');
const { createSocksServer } = require('../../electron/modules/socksProxy.js');

const SSH = { host: '127.0.0.1', port: 2222, username: 'root', password: 'testpass123' };

function listen(server) {
    return new Promise((res, rej) => {
        server.once('error', rej);
        server.listen(0, '127.0.0.1', () => res(server.address().port));
    });
}

// Minimal SOCKS5 client: open `target` through the proxy, send `payload`,
// resolve with the full response buffer (or reject on SOCKS error).
function socksRequest(proxyPort, host, port, payload) {
    return new Promise((resolve, reject) => {
        const sock = net.connect(proxyPort, '127.0.0.1');
        let stage = 'greet';
        let chunks = [];
        sock.on('error', reject);
        sock.on('connect', () => sock.write(Buffer.from([0x05, 0x01, 0x00]))); // VER, 1 method, no-auth
        sock.on('data', (d) => {
            if (stage === 'greet') {
                if (d[0] !== 0x05 || d[1] !== 0x00) return reject(new Error('no-auth rejected'));
                const hostBuf = Buffer.from(host, 'utf8');
                const req = Buffer.concat([
                    Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
                    hostBuf,
                    Buffer.from([(port >> 8) & 0xff, port & 0xff]),
                ]);
                sock.write(req);
                stage = 'reply';
            } else if (stage === 'reply') {
                if (d[1] !== 0x00) { sock.destroy(); return reject(new Error('SOCKS reply code ' + d[1])); }
                stage = 'data';
                sock.write(payload);
            } else {
                chunks.push(d);
            }
        });
        sock.on('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
        setTimeout(() => { sock.destroy(); reject(new Error('timeout')); }, 8000);
    });
}

const HTTP_GET = 'GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n';

async function main() {
    let failures = 0;
    const log = (ok, msg) => { console.log(`${ok ? '✅' : '❌'} ${msg}`); if (!ok) failures++; };

    // ── Test 3 first (no connection → fail closed) ───────────────────
    const closedServer = createSocksServer(() => null);
    const closedPort = await listen(closedServer);
    try {
        await socksRequest(closedPort, 'localhost', 8000, HTTP_GET);
        log(false, 'fail-closed: request should have been refused but succeeded');
    } catch (e) {
        log(/reply code 5/.test(e.message), `fail-closed: no SSH connection → refused (${e.message})`);
    }
    closedServer.close();

    // ── Connect SSH for the positive tests ───────────────────────────
    const conn = new Client();
    await new Promise((res, rej) => {
        conn.on('ready', res).on('error', rej).connect(SSH);
    });
    console.log('• SSH connected');

    const server = createSocksServer(() => conn);
    const port = await listen(server);

    // Test 1 + 2: reach the container-internal, non-published web server by name
    const body = await socksRequest(port, 'localhost', 8000, HTTP_GET);
    log(/Tunnel OK/.test(body), 'tunnel: reached 127.0.0.1:8000 inside container via SSH (remote DNS for "localhost")');

    // Sanity: a bogus host must fail through the tunnel (resolved remotely)
    try {
        await socksRequest(port, 'no-such-host.invalid', 80, HTTP_GET);
        log(false, 'bogus host should fail');
    } catch (e) {
        log(true, `bogus host fails through tunnel (${e.message})`);
    }

    server.close();
    conn.end();

    console.log(failures ? `\n${failures} test(s) failed` : '\nAll tests passed');
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });

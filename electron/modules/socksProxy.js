// Minimal SOCKS5 server that tunnels every CONNECT request through an SSH
// connection via ssh2's `forwardOut` (direct-tcpip channel).
//
// This is the enforcement point for "the browser may only reach the network
// through the SSH tunnel": the server listens on 127.0.0.1 and the ONLY way it
// can reach a destination is by asking the SSH connection to open the channel.
// If the SSH connection is gone, every request is refused (fail-closed).
//
// Notes:
//  - Only CMD=CONNECT (0x01) is supported. UDP ASSOCIATE / BIND are rejected,
//    which also means WebRTC/UDP cannot be tunnelled (no silent leak path).
//  - DNS is resolved on the SSH server side: Chromium's `socks5://` scheme
//    sends the hostname (ATYP=domain) to the proxy, and we hand that hostname
//    straight to forwardOut, so the SSH server does the lookup. No local DNS.

const net = require('net');

const SOCKS_VERSION = 0x05;
const REP_SUCCESS = 0x00;
const REP_GENERAL_FAILURE = 0x01;
const REP_NOT_ALLOWED = 0x02;
const REP_HOST_UNREACHABLE = 0x04;
const REP_CONN_REFUSED = 0x05;
const REP_CMD_NOT_SUPPORTED = 0x07;
const REP_ATYP_NOT_SUPPORTED = 0x08;

// Reply with a SOCKS5 status code (BND.ADDR/PORT are zeroed — clients ignore
// them for CONNECT errors and we never bind).
function reply(socket, code) {
    try {
        socket.write(Buffer.from([SOCKS_VERSION, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
    } catch (e) { /* socket already gone */ }
}

// `getConn()` must return the live ssh2 Client for this session, or null/false
// when there is no usable connection (→ requests are refused).
function createSocksServer(getConn) {
    const server = net.createServer((socket) => {
        socket.on('error', () => { try { socket.destroy(); } catch (e) {} });

        let stage = 'greeting';
        let buf = Buffer.alloc(0);

        function onData(chunk) {
            buf = Buffer.concat([buf, chunk]);

            // ── Stage 1: method negotiation ──────────────────────────
            if (stage === 'greeting') {
                if (buf.length < 2) return;
                if (buf[0] !== SOCKS_VERSION) { socket.destroy(); return; }
                const nmethods = buf[1];
                if (buf.length < 2 + nmethods) return;
                // We require no authentication (method 0x00).
                socket.write(Buffer.from([SOCKS_VERSION, 0x00]));
                buf = buf.subarray(2 + nmethods);
                stage = 'request';
            }

            // ── Stage 2: connection request ──────────────────────────
            if (stage === 'request') {
                if (buf.length < 4) return;
                const ver = buf[0];
                const cmd = buf[1];
                const atyp = buf[3];
                if (ver !== SOCKS_VERSION) { socket.destroy(); return; }

                let host, port, headerLen;
                if (atyp === 0x01) {            // IPv4
                    if (buf.length < 10) return;
                    host = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`;
                    port = buf.readUInt16BE(8);
                    headerLen = 10;
                } else if (atyp === 0x03) {     // domain name (preferred path)
                    const len = buf[4];
                    if (buf.length < 5 + len + 2) return;
                    host = buf.subarray(5, 5 + len).toString('utf8');
                    port = buf.readUInt16BE(5 + len);
                    headerLen = 5 + len + 2;
                } else if (atyp === 0x04) {     // IPv6
                    if (buf.length < 22) return;
                    const parts = [];
                    for (let i = 0; i < 8; i++) parts.push(buf.readUInt16BE(4 + i * 2).toString(16));
                    host = parts.join(':');
                    port = buf.readUInt16BE(20);
                    headerLen = 22;
                } else {
                    reply(socket, REP_ATYP_NOT_SUPPORTED);
                    socket.end();
                    return;
                }

                if (cmd !== 0x01) {            // only CONNECT
                    reply(socket, REP_CMD_NOT_SUPPORTED);
                    socket.end();
                    return;
                }

                // Any extra bytes after the request header are early payload
                // (e.g. a TLS ClientHello) — forward them once the tunnel opens.
                const earlyData = buf.subarray(headerLen);
                stage = 'connecting';
                socket.removeListener('data', onData);

                const conn = getConn();
                if (!conn) {
                    // No SSH connection → fail closed, never fall back to direct.
                    reply(socket, REP_CONN_REFUSED);
                    socket.end();
                    return;
                }

                conn.forwardOut('127.0.0.1', 0, host, port, (err, stream) => {
                    if (err) {
                        reply(socket, REP_HOST_UNREACHABLE);
                        socket.end();
                        return;
                    }
                    reply(socket, REP_SUCCESS);
                    if (earlyData.length) stream.write(earlyData);
                    socket.pipe(stream);
                    stream.pipe(socket);
                    const cleanup = () => { try { socket.destroy(); } catch (e) {} try { stream.destroy(); } catch (e) {} };
                    stream.on('error', cleanup);
                    stream.on('close', cleanup);
                    socket.on('close', cleanup);
                });
            }
        }

        socket.on('data', onData);
    });

    return server;
}

module.exports = { createSocksServer };

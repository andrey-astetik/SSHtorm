// Local port forwarding (ssh -L) over an existing ssh2 connection.
//
// Listens on 127.0.0.1:<localPort> and, for every accepted connection, opens a
// direct-tcpip channel to <remoteHost>:<remotePort> through the SSH connection
// and pipes the two together. Same enforcement idea as the SOCKS proxy: the
// only way out is the SSH connection, so a dead tunnel just drops the socket.

const net = require('net');

// `getConn()` must return the live ssh2 Client for the session, or null when
// there is no usable connection (→ the incoming socket is dropped).
function createForward(getConn, remoteHost, remotePort) {
    const server = net.createServer((socket) => {
        socket.on('error', () => { try { socket.destroy(); } catch (e) {} });

        const conn = getConn();
        if (!conn) { try { socket.destroy(); } catch (e) {} return; }

        conn.forwardOut('127.0.0.1', 0, remoteHost, remotePort, (err, stream) => {
            if (err) { try { socket.destroy(); } catch (e) {} return; }
            socket.pipe(stream);
            stream.pipe(socket);
            const cleanup = () => { try { socket.destroy(); } catch (e) {} try { stream.destroy(); } catch (e) {} };
            stream.on('error', cleanup);
            stream.on('close', cleanup);
            socket.on('close', cleanup);
        });
    });

    return server;
}

module.exports = { createForward };

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('app', {
    // Send message to main process
    send: (method, data) => {
        ipcRenderer.send('reciever', { method, data });
    },

    // Listen for messages from main process
    recieve: (cb) => {
        const handler = (_event, data) => cb(data);
        ipcRenderer.on('sender', handler);
        // Return unsubscribe function
        return () => ipcRenderer.removeListener('sender', handler);
    },

    // Convenience methods for common SSH operations
    ssh: {
        connect: (opts) => ipcRenderer.send('reciever', { method: 'ssh.connect', data: opts }),
        disconnect: (sessionId) => ipcRenderer.send('reciever', { method: 'ssh.disconnect', data: { sessionId } }),
        exec: (sessionId, command) => ipcRenderer.send('reciever', { method: 'ssh.exec', data: { sessionId, command } }),
        execCapture: (sessionId, command) => ipcRenderer.invoke('ssh.execCapture', { sessionId, command }),
        shell: {
            start: (sessionId, shellId, cols, rows) => ipcRenderer.send('ssh-shell', { method: 'start', sessionId, shellId, cols, rows }),
            input: (sessionId, shellId, data) => ipcRenderer.send('ssh-shell', { method: 'input', sessionId, shellId, data }),
            resize: (sessionId, shellId, cols, rows) => ipcRenderer.send('ssh-shell', { method: 'resize', sessionId, shellId, cols, rows })
        },
        sftp: {
            list: (sessionId, path) => ipcRenderer.send('reciever', { method: 'ssh.sftp.list', data: { sessionId, path } }),
            read: (sessionId, path) => ipcRenderer.send('reciever', { method: 'ssh.sftp.read', data: { sessionId, path } }),
            write: (sessionId, path, content, base64) => ipcRenderer.send('reciever', { method: 'ssh.sftp.write', data: { sessionId, path, content, base64 } }),
            mkdir: (sessionId, path) => ipcRenderer.send('reciever', { method: 'ssh.sftp.mkdir', data: { sessionId, path } }),
            delete: (sessionId, path, isDir) => ipcRenderer.send('reciever', { method: 'ssh.sftp.delete', data: { sessionId, path, isDir } }),
            stat: (sessionId, path) => ipcRenderer.send('reciever', { method: 'ssh.sftp.stat', data: { sessionId, path } }),
            readBinary: (sessionId, path) => ipcRenderer.send('reciever', { method: 'ssh.sftp.readBinary', data: { sessionId, path } })
        }
    },

    hosts: {
        save: (hosts) => ipcRenderer.send('reciever', { method: 'hosts.save', data: hosts }),
        load: () => ipcRenderer.send('reciever', { method: 'hosts.load' }),
        // Forget the stored host-key fingerprint for a host (on host delete).
        forgetKey: (host, port) => ipcRenderer.send('reciever', { method: 'knownhosts.remove', data: { host, port } })
    },

    browser: {
        // Returns { partition, port } for the session's SSH-tunnelled webview,
        // or { error } if the session is not connected.
        prepare: (sessionId) => ipcRenderer.invoke('browser.prepare', { sessionId }),
        // Time-boxed AllowTcpForwarding probe → { forwardingBlocked }.
        checkForwarding: (sessionId) => ipcRenderer.invoke('browser.checkForwarding', { sessionId }),
        // Remote machine's UA/timezone profile: { userAgent, timezoneId, osName }.
        profile: (sessionId) => ipcRenderer.invoke('browser.profile', { sessionId }),
        // Apply UA + clock override to a webview (by getWebContentsId()).
        applyProfile: (sessionId, webContentsId) => ipcRenderer.invoke('browser.applyProfile', { sessionId, webContentsId })
    },

    // Local port forwarding (ssh -L) over the session's SSH connection.
    forward: {
        // Bind 127.0.0.1:localPort (0 = auto) → remoteHost:remotePort. Resolves
        // { id, localPort, remoteHost, remotePort } or { error }.
        add: (sessionId, localPort, remoteHost, remotePort) =>
            ipcRenderer.invoke('forward.add', { sessionId, localPort, remoteHost, remotePort }),
        remove: (sessionId, id) => ipcRenderer.invoke('forward.remove', { sessionId, id }),
        list: (sessionId) => ipcRenderer.invoke('forward.list', { sessionId })
    },

    // Docker management over the SSH exec channel (nothing installed on the server).
    docker: {
        available: (sessionId) => ipcRenderer.invoke('docker.available', { sessionId }),
        ps: (sessionId) => ipcRenderer.invoke('docker.ps', { sessionId }),
        images: (sessionId) => ipcRenderer.invoke('docker.images', { sessionId }),
        stats: (sessionId) => ipcRenderer.invoke('docker.stats', { sessionId }),
        // action ∈ start|stop|restart|pause|unpause|remove|image-remove
        action: (sessionId, action, id) => ipcRenderer.invoke('docker.action', { sessionId, action, id })
    },

    getNativeMaxState: () => ipcRenderer.invoke('get-native-max-state'),

    saveFile: (fileName, base64) => ipcRenderer.invoke('dialog.saveFile', { fileName, base64 }),

    master: {
        status: () => ipcRenderer.send('reciever', { method: 'master.status' }),
        set: (password) => ipcRenderer.send('reciever', { method: 'master.set', data: { password } }),
        verify: (password) => ipcRenderer.send('reciever', { method: 'master.verify', data: { password } }),
        reset: () => ipcRenderer.send('reciever', { method: 'master.reset' })
    },

    quit: () => ipcRenderer.send('reciever', { method: 'appQuit' })
});

// SSH Connection Store — singleton (globalThis avoids Vite chunk duplication)
import { reactive } from 'vue';
import { windowManager } from './windows.js';

const _store = (() => {
    if (globalThis.__sshStore) return globalThis.__sshStore;

    const state = reactive({
        sessions: {},
        activeSessionId: null,
        listeners: {},
        _initialized: false,
        showConnectDialog: false,
        lastConnectedSessionId: null,
        showConnectionPanel: false,
        hostKeyPrompt: null   // { sessionId, id, oldFp, newFp, requestId } when a host key changed
    });

    let _globalUnsub = null;

    function initIPCListener() {
        if (state._initialized) return;
        if (typeof window === 'undefined' || !window.app) return;
        state._initialized = true;
        _globalUnsub = window.app.recieve((msg) => {
            const { method, data } = msg;
            const sid = data?.sessionId;
            if (!sid) return;
            const s = state.sessions[sid];
            if (!s && method !== 'ssh.connected' && method !== 'ssh.connecting') return;
            switch (method) {
                case 'ssh.connecting': if (s) s.status = 'connecting'; break;
                case 'ssh.connected':
                    if (s) { s.status = 'connected'; s.connected = true; s.host = data.host; s.user = data.username; }
                    state.activeSessionId = sid;
                    break;
                case 'ssh.disconnected':
                    if (s) { s.status = 'disconnected'; s.connected = false; }
                    if (state.hostKeyPrompt?.sessionId === sid) state.hostKeyPrompt = null;
                    // Deferred so this event's own listeners still run first — the
                    // connect dialog reads them to report why the attempt failed.
                    setTimeout(() => removeSession(sid), 0);
                    break;
                case 'ssh.error': if (s) s.error = data.error; break;
                case 'ssh.hostkey.changed': state.hostKeyPrompt = { ...data }; break;
                case 'ssh.shell.started': if (s) s.shellActive = true; break;
                case 'ssh.shell.closed': if (s) s.shellActive = false; break;
            }
            // Copy: a callback may unsubscribe itself mid-iteration, which would
            // otherwise skip the next listener.
            const cbs = state.listeners[sid]?.[method];
            if (cbs) cbs.slice().forEach(cb => cb(data));
        });
    }

    function connect(opts) {
        initIPCListener();
        if (!state._initialized && typeof window !== 'undefined') setTimeout(initIPCListener, 100);
        const sid = Date.now();
        state.sessions[sid] = { id: sid, host: opts.host, user: opts.username, label: opts.label || '', connected: false, shellActive: false, status: 'connecting', error: null };
        state.listeners[sid] = {};
        if (window.app) window.app.ssh.connect({ ...opts, sessionId: sid });
        else {
            state.sessions[sid].status = 'connected'; state.sessions[sid].connected = true; state.activeSessionId = sid;
            setTimeout(() => { const cbs = state.listeners[sid]?.['ssh.connected']; if (cbs) cbs.forEach(cb => cb({ sessionId: sid, host: opts.host, username: opts.username })); }, 500);
        }
        return sid;
    }

    // Drops the session's windows, listeners and sidebar row.
    function removeSession(sid) {
        if (!state.sessions[sid] && !state.listeners[sid]) return;
        windowManager.state.windows
            .filter(w => w.sessionId === sid)
            // force: the connection is gone, so an unsaved-changes prompt would
            // offer a save that cannot succeed.
            .forEach(w => windowManager.closeWindow(w.id, { force: true }));
        delete state.sessions[sid];
        delete state.listeners[sid];
        if (state.lastConnectedSessionId === sid) state.lastConnectedSessionId = null;
        if (state.hostKeyPrompt?.sessionId === sid) state.hostKeyPrompt = null;
        if (state.activeSessionId === sid) {
            // Fall back to another live session rather than a blank desktop.
            const next = Object.values(state.sessions).find(x => x.connected)
                || Object.values(state.sessions)[0];
            state.activeSessionId = next ? next.id : null;
        }
    }

    function disconnect(sid) {
        if (window.app) window.app.ssh.disconnect(sid);
        removeSession(sid);
    }

    function on(sid, event, cb) {
        if (!state.listeners[sid]) state.listeners[sid] = {};
        if (!state.listeners[sid][event]) state.listeners[sid][event] = [];
        state.listeners[sid][event].push(cb);
        return () => { const a = state.listeners[sid]?.[event]; if (a) { const i = a.indexOf(cb); if (i !== -1) a.splice(i, 1); } };
    }

    function init() {
        initIPCListener();
        if (!state._initialized) { let n = 0; const t = setInterval(() => { initIPCListener(); if (state._initialized || ++n > 10) clearInterval(t); }, 200); }
    }

    // Answer a host-key-change prompt: trust=true → connect & update stored key,
    // false → refuse and keep the old key.
    function respondHostKey(trust) {
        const p = state.hostKeyPrompt;
        if (!p) return;
        if (window.app) window.app.send('ssh.hostkey.decision', { requestId: p.requestId, trust });
        state.hostKeyPrompt = null;
    }

    return globalThis.__sshStore = { state, connect, disconnect, removeSession, on, init, respondHostKey };
})();

export const ssh = _store;
export const useSSH = () => _store;
export default _store;
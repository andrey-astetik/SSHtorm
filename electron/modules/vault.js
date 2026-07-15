// Encrypted vault — single source of truth for everything secret about the
// user's servers, owned by the main process:
//   { hosts: [{host,port,username,password,label,...}], keys: {"host:port": fp},
//     notes: {"host:port": "per-host notes"},
//     history: {"host:port": [{url,title,ts}, …]} }
//
// One encrypted file (AES-256-GCM). The renderer never writes it directly; main
// mutates the in-memory state and persists. Only the KDF salt lives outside the
// vault (in master.key); the master password itself is never stored, and there
// is deliberately no password hash — the password is verified by decrypting the
// vault (the GCM tag authenticates it), so nothing on disk can reveal the key.

const fs = require('fs');
const { encrypt, decrypt } = require('./crypto');

const EMPTY = () => ({ hosts: [], keys: {}, notes: {}, history: {} });
const HISTORY_CAP = 500;

function createVault({ vaultPath, getSalt }) {
    let password = null;
    let data = EMPTY();

    const normalize = (d) => ({
        hosts: (d && d.hosts) || [],
        keys: (d && d.keys) || {},
        notes: (d && d.notes && typeof d.notes === 'object') ? d.notes : {},
        history: (d && d.history && typeof d.history === 'object') ? d.history : {}
    });

    function persist() {
        if (password == null) { console.error('vault.persist without password — skipped'); return; }
        try {
            fs.writeFileSync(vaultPath, JSON.stringify(encrypt(JSON.stringify(data), password, getSalt())));
        } catch (e) { console.error('vault.persist failed:', e.message); }
    }

    return {
        // Try to unlock with `pw`. If no vault exists yet, this establishes one.
        // Otherwise it decrypts the vault: success means the password is correct
        // (GCM auth), failure means it's wrong. Returns true/false accordingly.
        unlock(pw) {
            if (!fs.existsSync(vaultPath)) {          // first use → this pw owns the vault
                password = pw; data = EMPTY();
                return true;
            }
            try {
                const enc = JSON.parse(fs.readFileSync(vaultPath).toString());
                data = normalize(JSON.parse(decrypt(enc, pw, getSalt())));   // throws on wrong pw
                password = pw;
                return true;
            } catch (e) {
                password = null; data = EMPTY();       // wrong password / corrupted
                return false;
            }
        },
        lock() { password = null; data = EMPTY(); },
        persist,
        isUnlocked: () => password != null,
        // Hosts (connection profiles)
        getHosts: () => data.hosts,
        setHosts(hosts) { data.hosts = hosts || []; persist(); },
        // Host-key fingerprints, keyed by "host:port"
        getKeys: () => data.keys,
        getKey: (id) => data.keys[id],
        setKey(id, fp) { data.keys[id] = fp; persist(); },
        removeKey(id) { if (data.keys[id]) { delete data.keys[id]; persist(); } },
        // Per-host notes (creds, port maps, commands…), keyed by "host:port"
        getNote: (id) => data.notes[id] || '',
        setNote(id, text) {
            if (text) data.notes[id] = text;
            else delete data.notes[id];
            persist();
        },
        // Per-host browser history, keyed by "host:port" — newest last.
        getHistory: (id) => data.history[id] || [],
        addHistory(id, entry) {
            const list = data.history[id] || (data.history[id] = []);
            const last = list[list.length - 1];
            if (last && last.url === entry.url) {          // merge consecutive same-url visits
                last.ts = entry.ts;
                if (entry.title) last.title = entry.title;
            } else {
                list.push(entry);
                if (list.length > HISTORY_CAP) list.splice(0, list.length - HISTORY_CAP);
            }
            persist();
        },
        clearHistory(id) { if (data.history[id]) { delete data.history[id]; persist(); } }
    };
}

module.exports = { createVault };

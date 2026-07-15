// Encrypted vault — single source of truth for everything secret about the
// user's servers, owned by the main process:
//   { hosts: [{host,port,username,password,...}], keys: {"host:port": sha256fp} }
//
// One encrypted file. The renderer never writes it directly; main mutates the
// in-memory state and persists. The master-password salt lives elsewhere
// (master.key) because it's needed to derive the key that decrypts this vault,
// so it's injected via getSalt().

const fs = require('fs');
const { encrypt, decrypt } = require('./crypto');

function createVault({ vaultPath, getSalt }) {
    let password = null;
    let data = { hosts: [], keys: {} };

    const normalize = (d) => ({ hosts: (d && d.hosts) || [], keys: (d && d.keys) || {} });

    function persist() {
        if (!password) { console.error('vault.persist without password — skipped'); return; }
        try {
            fs.writeFileSync(vaultPath, JSON.stringify(encrypt(JSON.stringify(data), password, getSalt())));
        } catch (e) { console.error('vault.persist failed:', e.message); }
    }

    function load() {
        data = { hosts: [], keys: {} };
        if (!password) return;
        try {
            if (fs.existsSync(vaultPath)) {
                const enc = JSON.parse(fs.readFileSync(vaultPath).toString());
                data = normalize(JSON.parse(decrypt(enc, password, getSalt())));
            }
        } catch (e) { data = { hosts: [], keys: {} }; }   // corrupted / wrong password → empty
    }

    return {
        // Lifecycle
        unlock(pw) { password = pw; load(); },     // set password + load
        lock() { password = null; data = { hosts: [], keys: {} }; },
        persist,
        isUnlocked: () => !!password,
        // Hosts (connection profiles)
        getHosts: () => data.hosts,
        setHosts(hosts) { data.hosts = hosts || []; persist(); },
        // Host-key fingerprints, keyed by "host:port"
        getKeys: () => data.keys,
        getKey: (id) => data.keys[id],
        setKey(id, fp) { data.keys[id] = fp; persist(); },
        removeKey(id) { if (data.keys[id]) { delete data.keys[id]; persist(); } }
    };
}

module.exports = { createVault };

// App-level master-password flow (replicates electron/app.js helpers) — proves
// the key-leak is closed: master.key now stores ONLY the KDF salt, and the
// password is verified by decrypting the vault (GCM), not by a stored hash.
//
//   node docker/sshd-test/master-flow.test.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createVault } = require('../../electron/modules/vault.js');
const { generateSalt } = require('../../electron/modules/crypto.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'master-flow-'));
const masterPath = path.join(dir, 'master.key');
const vaultPath = path.join(dir, 'vault.json');

// --- mirrors electron/app.js ---
const getMasterState = () => { try { return JSON.parse(fs.readFileSync(masterPath).toString()); } catch (e) { return null; } };
const saveMasterState = (s) => fs.writeFileSync(masterPath, JSON.stringify(s));
const getMasterSalt = () => { const ms = getMasterState(); if (ms && ms.salt) return ms.salt; const salt = generateSalt(); saveMasterState({ salt }); return salt; };
const vault = createVault({ vaultPath, getSalt: getMasterSalt });

let fail = 0;
const log = (ok, m) => { console.log(`${ok ? '✅' : '❌'} ${m}`); if (!ok) fail++; };

const PW = 'hunter2';

// master.set
getMasterSalt();
vault.unlock(PW);
vault.setHosts([{ host: 'h', username: 'u', password: 'secret-pw' }]);
vault.persist();
log(fs.existsSync(vaultPath), 'master.set creates the encrypted vault');

// master.key holds ONLY the salt — no password hash whose prefix is the AES key.
const mk = getMasterState();
log(Object.keys(mk).length === 1 && typeof mk.salt === 'string' && mk.hash === undefined,
    'master.key stores only the KDF salt (no hash → key cannot be recovered from it)');

// master.verify(correct)
vault.lock();
log(vault.unlock(PW) === true && vault.getHosts()[0]?.password === 'secret-pw', 'verify(correct password) → unlock + data');

// master.verify(wrong)
vault.lock();
log(vault.unlock('wrong') === false && vault.getHosts().length === 0, 'verify(wrong password) → rejected, no data');

// Attacker with both files but no password gets nothing in clear.
log(!fs.readFileSync(vaultPath, 'utf8').includes('secret-pw'), 'vault.json contains no plaintext secret');

fs.rmSync(dir, { recursive: true, force: true });
console.log(fail ? `\n${fail} test(s) failed` : '\nMaster-flow tests passed');
process.exit(fail ? 1 : 0);

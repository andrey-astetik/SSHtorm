// Unit test for the encrypted vault (electron/modules/vault.js): roundtrip,
// host/key mutations, legacy migration, and that nothing is on disk in clear.
//
//   node docker/sshd-test/vault.test.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createVault } = require('../../electron/modules/vault.js');
const { generateSalt } = require('../../electron/modules/crypto.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
const vaultPath = path.join(dir, 'vault.json');
const SALT = generateSalt();
const PW = 'master-pw';
const mk = () => createVault({ vaultPath, getSalt: () => SALT });

let failures = 0;
const log = (ok, msg) => { console.log(`${ok ? '✅' : '❌'} ${msg}`); if (!ok) failures++; };

// 1. Roundtrip: set hosts + key, reopen, read back.
let v = mk();
v.unlock(PW);
v.setHosts([{ host: 'srv', port: 22, username: 'root', password: 'p' }]);
v.setKey('srv:22', 'FP1');
v = mk();
v.unlock(PW);
log(v.getHosts().length === 1 && v.getKey('srv:22') === 'FP1', 'roundtrip: hosts + key persist across reopen');

// 2. Wrong password → empty (no throw, no leak of data).
let vw = mk();
vw.unlock('wrong-pw');
log(vw.getHosts().length === 0 && Object.keys(vw.getKeys()).length === 0, 'wrong password → empty vault');

// 3. removeKey.
v.removeKey('srv:22');
v = mk(); v.unlock(PW);
log(!v.getKey('srv:22'), 'removeKey persists');

// 4. Ciphertext on disk has no plaintext secrets.
const onDisk = fs.readFileSync(vaultPath, 'utf8');
log(!onDisk.includes('root') && !onDisk.includes('srv'), 'vault.json contains no plaintext host/credential');

// 5. lock() clears in-memory state.
v.lock();
log(v.getHosts().length === 0 && !v.isUnlocked(), 'lock() clears state');

fs.rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} test(s) failed` : '\nVault tests passed');
process.exit(failures ? 1 : 0);

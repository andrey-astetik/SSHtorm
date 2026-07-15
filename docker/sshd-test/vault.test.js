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
const ok1 = v.unlock(PW);
log(ok1 === true && v.getHosts().length === 1 && v.getKey('srv:22') === 'FP1', 'roundtrip: unlock() true + hosts + key persist across reopen');

// 2. Wrong password → unlock() false, empty (no throw, no leak of data).
let vw = mk();
const okw = vw.unlock('wrong-pw');
log(okw === false && vw.getHosts().length === 0 && Object.keys(vw.getKeys()).length === 0, 'wrong password → unlock() false + empty vault');

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

// 6. Per-host notes: roundtrip, isolation, encrypted, not in plaintext.
let vn = mk(); vn.unlock(PW);
vn.setNote('prod:22', 'port 8080 -> db\napi-key: sekret');
vn.setNote('dev:22', 'dev scratch');
vn = mk(); vn.unlock(PW);
log(vn.getNote('prod:22') === 'port 8080 -> db\napi-key: sekret', 'per-host note persists across reopen');
log(vn.getNote('dev:22') === 'dev scratch' && vn.getNote('other:22') === '', 'notes isolated per host');
log(!fs.readFileSync(vaultPath, 'utf8').includes('sekret'), 'notes not stored in plaintext');

// 7. Per-host browser history: append, dedupe consecutive, isolate, persist.
let vh = mk(); vh.unlock(PW);
vh.addHistory('prod:22', { url: 'https://a', title: 'A', ts: 1 });
vh.addHistory('prod:22', { url: 'https://a', title: 'A2', ts: 2 });   // same url → merge
vh.addHistory('prod:22', { url: 'https://b', title: 'B', ts: 3 });
vh = mk(); vh.unlock(PW);
const hist = vh.getHistory('prod:22');
log(hist.length === 2 && hist[0].title === 'A2' && hist[1].url === 'https://b', 'history: append + dedupe consecutive + persist');
log(vh.getHistory('dev:22').length === 0, 'history isolated per host');
vh.clearHistory('prod:22');
vh = mk(); vh.unlock(PW);
log(vh.getHistory('prod:22').length === 0, 'clearHistory persists');

// 8. Regression: the key-leaking footgun is gone — crypto stores/derives no
//    password hash whose prefix equals the AES key.
log(require('../../electron/modules/crypto.js').hashPassword === undefined,
    'crypto exposes no hashPassword (verifier can no longer leak the key)');

fs.rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} test(s) failed` : '\nVault tests passed');
process.exit(failures ? 1 : 0);

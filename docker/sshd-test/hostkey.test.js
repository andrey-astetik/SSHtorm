// Tests host-key verification (TOFU) semantics and encrypted known-hosts storage.
//
//   node docker/sshd-test/hostkey.test.js
//
// 1. First connect with a recording verifier → accepted, fingerprint captured.
// 2. Connect with a verifier that has a *different* stored fingerprint → rejected
//    (simulates a changed key / MITM).
// 3. The known-hosts map round-trips through encryption and the ciphertext on
//    "disk" contains no plaintext host identifiers.

const crypto = require('crypto');
const { Client } = require('../../electron/node_modules/ssh2');
const { encrypt, decrypt, generateSalt } = require('../../electron/modules/crypto');

const SSH = { host: '127.0.0.1', port: 2222, username: 'root', password: 'testpass123' };

function connect(hostVerifier) {
    return new Promise((resolve) => {
        const c = new Client();
        c.on('ready', () => { c.end(); resolve({ ok: true }); })
         .on('error', (e) => resolve({ ok: false, error: e.message }))
         .connect({ ...SSH, hostVerifier });
    });
}

async function main() {
    let failures = 0;
    const log = (ok, msg) => { console.log(`${ok ? '✅' : '❌'} ${msg}`); if (!ok) failures++; };

    // 1. TOFU accept + capture fingerprint
    let fp = null;
    const r1 = await connect((key) => { fp = crypto.createHash('sha256').update(key).digest('base64'); return true; });
    log(r1.ok && !!fp, `first connect accepted, fingerprint captured (${fp ? fp.slice(0, 16) + '…' : 'none'})`);

    // 2. Reject when stored fingerprint differs
    const r2 = await connect((key) => {
        const cur = crypto.createHash('sha256').update(key).digest('base64');
        return cur === 'DIFFERENT_STORED_FP';   // never matches → reject
    });
    log(!r2.ok, `changed-key connection rejected (${r2.error || 'no error?!'})`);

    // 3. Encrypted known-hosts round-trip + no plaintext leakage
    const salt = generateSalt();
    const pw = 'master-pw';
    const map = { '127.0.0.1:2222': fp, 'secret.internal.example:22': 'abc123' };
    const enc = encrypt(JSON.stringify(map), pw, salt);
    const onDisk = JSON.stringify(enc);
    const back = JSON.parse(decrypt(enc, pw, salt));
    log(JSON.stringify(back) === JSON.stringify(map), 'known-hosts map round-trips through encryption');
    log(!onDisk.includes('secret.internal.example') && !onDisk.includes('2222'),
        'ciphertext contains no plaintext host identifiers');

    console.log(failures ? `\n${failures} test(s) failed` : '\nAll host-key tests passed');
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });

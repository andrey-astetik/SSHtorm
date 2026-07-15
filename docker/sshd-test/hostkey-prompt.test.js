// Tests the host-key-change flow against the real server, mirroring the app:
// the verifier is synchronous and REJECTS on a changed key (dropping the
// connection); the captured new fingerprint is then either discarded ("no") or
// written and used for a fresh reconnect ("yes"). First use is silent TOFU.
//
//   node docker/sshd-test/hostkey-prompt.test.js

const crypto = require('crypto');
const { Client } = require('../../electron/node_modules/ssh2');

const SSH = { host: '127.0.0.1', port: 2222, username: 'root', password: 'testpass123' };
const id = `${SSH.host}:${SSH.port}`;

// One connection attempt with a synchronous verifier (matches makeHostVerifier):
// TOFU on first sight, reject on mismatch while capturing the presented fp.
function connectOnce(known) {
    return new Promise((resolve) => {
        let mismatch = null;
        const verifier = (key) => {
            const fp = crypto.createHash('sha256').update(key).digest('base64');
            if (!known[id]) { known[id] = fp; return true; }
            if (known[id] === fp) return true;
            mismatch = { oldFp: known[id], newFp: fp };
            return false;
        };
        const c = new Client();
        c.on('ready', () => { c.end(); resolve({ ok: true }); })
         .on('error', (e) => resolve({ ok: false, error: e.message, mismatch }))
         .connect({ ...SSH, hostVerifier: verifier });
    });
}

async function main() {
    let failures = 0;
    const log = (ok, msg) => { console.log(`${ok ? '✅' : '❌'} ${msg}`); if (!ok) failures++; };

    // 1. First use → TOFU accept, key stored silently.
    const known = {};
    const r1 = await connectOnce(known);
    const realFp = known[id];
    log(r1.ok && !!realFp, 'first connect: TOFU accept, key stored without prompt');

    // 2. Changed key → connection dropped, new fp captured for the prompt.
    known[id] = 'STALE_FAKE_FP';
    const r2 = await connectOnce(known);
    log(!r2.ok && r2.mismatch && r2.mismatch.newFp === realFp,
        `changed key → connection dropped, new fp captured (${r2.error || ''})`);

    // 2a. User says NO → we don't touch the stored key; reconnect still fails.
    log(known[id] === 'STALE_FAKE_FP', '"no": stored key left unchanged');
    const r2b = await connectOnce(known);
    log(!r2b.ok, '"no": subsequent connect still refused');

    // 3. User says YES → update stored key, then reconnect succeeds.
    known[id] = r2.mismatch.newFp;
    const r3 = await connectOnce(known);
    log(r3.ok && known[id] === realFp, '"yes": key updated → reconnect succeeds');

    console.log(failures ? `\n${failures} test(s) failed` : '\nHost-key change flow verified');
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });

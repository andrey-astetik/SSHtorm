// Tests electron/modules/docker.js. The parsing/validation paths run against a
// fake ssh2 connection with canned `docker ... --format {{json .}}` output (no
// Docker needed, deterministic). One live check confirms available() reports
// "not installed" against the real sshd container.
//
//   node docker/sshd-test/docker.test.js

const { EventEmitter } = require('events');
const { Client } = require('../../electron/node_modules/ssh2');
const docker = require('../../electron/modules/docker');

let failures = 0;
const log = (ok, msg) => { console.log(`${ok ? '✅' : '❌'} ${msg}`); if (!ok) failures++; };

// Fake conn: routes a command (matched by substring) to a { code, out, err }.
function fakeConn(routes) {
    return {
        lastCmd: null,
        exec(cmd, cb) {
            this.lastCmd = cmd;
            const key = Object.keys(routes).find(k => cmd.includes(k));
            const r = key ? routes[key] : { code: 127, out: '', err: 'not found' };
            const stream = new EventEmitter();
            stream.stderr = new EventEmitter();
            cb(null, stream);
            setImmediate(() => {
                if (r.out) stream.emit('data', Buffer.from(r.out));
                if (r.err) stream.stderr.emit('data', Buffer.from(r.err));
                stream.emit('close', r.code);
            });
        }
    };
}

(async () => {
    // ── parseJsonLines ──
    log(docker.parseJsonLines('{"a":1}\n  \n{"a":2}\nbad\n').length === 2, 'parseJsonLines skips blanks/garbage');

    // ── available: happy ──
    let c = fakeConn({ 'docker version': { code: 0, out: '24.0.7\n', err: '' } });
    let a = await docker.available(c);
    log(a.available && a.version === '24.0.7', 'available: reports version');

    // ── available: not installed / no perm / no daemon ──
    a = await docker.available(fakeConn({ 'docker version': { code: 127, out: '', err: 'sh: docker: command not found' } }));
    log(!a.available && /not installed/i.test(a.error), 'available: detects not-installed');
    a = await docker.available(fakeConn({ 'docker version': { code: 1, out: '', err: 'permission denied while trying to connect' } }));
    log(!a.available && /permission/i.test(a.error), 'available: detects permission problem');
    a = await docker.available(fakeConn({ 'docker version': { code: 1, out: '', err: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?' } }));
    log(!a.available && /daemon is not running/i.test(a.error), 'available: detects daemon down');

    // ── ps ──
    const psOut = [
        JSON.stringify({ ID: 'abc123', Names: 'web', Image: 'nginx', Status: 'Up 3 minutes', State: 'running' }),
        JSON.stringify({ ID: 'def456', Names: 'db', Image: 'postgres', Status: 'Exited (0) 1 hour ago', State: 'exited' })
    ].join('\n') + '\n';
    let p = await docker.ps(fakeConn({ 'docker ps': { code: 0, out: psOut, err: '' } }));
    log(p.containers?.length === 2 && p.containers[0].Names === 'web', 'ps: parses containers');
    p = await docker.ps(fakeConn({ 'docker ps': { code: 1, out: '', err: 'boom' } }));
    log(!!p.error, 'ps: surfaces error on failure');

    // ── images ──
    const imOut = JSON.stringify({ Repository: 'nginx', Tag: 'latest', ID: 'aabbcc', Size: '142MB' }) + '\n';
    let im = await docker.images(fakeConn({ 'docker images': { code: 0, out: imOut, err: '' } }));
    log(im.images?.length === 1 && im.images[0].Repository === 'nginx', 'images: parses images');

    // ── stats: keyed by Name ──
    const stOut = JSON.stringify({ Name: 'web', CPUPerc: '0.5%', MemPerc: '2.1%' }) + '\n';
    let st = await docker.stats(fakeConn({ 'docker stats': { code: 0, out: stOut, err: '' } }));
    log(st.stats?.web?.CPUPerc === '0.5%', 'stats: keyed by container name');

    // ── action: builds verb, validates id ──
    c = fakeConn({ 'docker restart': { code: 0, out: 'web\n', err: '' } });
    let r = await docker.action(c, 'restart', 'web');
    log(r.ok && c.lastCmd === 'docker restart web', 'action: restart builds correct command');
    c = fakeConn({ 'docker rm': { code: 0, out: '', err: '' } });
    r = await docker.action(c, 'remove', 'abc123');
    log(c.lastCmd === 'docker rm -f abc123', 'action: remove maps to rm -f');
    r = await docker.action(fakeConn({}), 'remove', 'evil; rm -rf /');
    log(r.error === 'Invalid id', 'action: rejects shell-injection id');
    r = await docker.action(fakeConn({}), 'nuke', 'web');
    log(r.error === 'Unknown action', 'action: rejects unknown action');

    // ── live: real container has no docker → "not installed" ──
    await new Promise((resolve) => {
        const conn = new Client();
        conn.on('ready', async () => {
            const live = await docker.available(conn);
            log(!live.available && /not installed/i.test(live.error), 'live: container without docker → not installed');
            conn.end(); resolve();
        });
        conn.on('error', (e) => { log(false, 'live ssh: ' + e.message); resolve(); });
        conn.connect({ host: '127.0.0.1', port: 2222, username: 'root', password: 'testpass123' });
    });

    console.log(failures ? `\n${failures} test(s) failed` : '\nDocker tests passed');
    process.exit(failures ? 1 : 0);
})();

// Docker management over an ssh2 connection — everything runs through the SSH
// exec channel, so nothing is installed on the server (vs Portainer's agent).
//
// Output is read from `--format '{{json .}}'` (line-delimited JSON) rather than
// scraped column-by-column, so it stays stable across Docker versions.

// container ids/names and image refs: letters/digits then the safe id charset.
const VALID_DOCKER_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.\-:@/]*$/;

// Run a command and resolve { code, stdout, stderr }.
function execFull(conn, cmd) {
    return new Promise((resolve) => {
        try {
            conn.exec(cmd, (err, stream) => {
                if (err) return resolve({ code: -1, stdout: '', stderr: err.message });
                let out = '', errout = '';
                stream.on('data', (d) => { out += d.toString(); });
                stream.stderr.on('data', (d) => { errout += d.toString(); });
                stream.on('close', (code) => resolve({ code: code == null ? 0 : code, stdout: out, stderr: errout }));
            });
        } catch (e) { resolve({ code: -1, stdout: '', stderr: e.message }); }
    });
}

function parseJsonLines(s) {
    return (s || '').split('\n').map(l => l.trim()).filter(Boolean)
        .map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
        .filter(Boolean);
}

async function available(conn) {
    const r = await execFull(conn, 'docker version --format "{{.Server.Version}}"');
    if (r.code === 0 && r.stdout.trim()) return { available: true, version: r.stdout.trim() };
    const e = `${r.stderr} ${r.stdout}`;
    const reason =
        /command not found|not found|No such file/i.test(e) ? 'Docker is not installed on this host' :
        /permission denied/i.test(e) ? 'No permission for the Docker daemon (add your user to the docker group, or use sudo)' :
        /Cannot connect to the Docker daemon|Is the docker daemon running/i.test(e) ? 'The Docker daemon is not running' :
        (r.stderr.trim() || r.stdout.trim() || 'Docker is not available');
    return { available: false, error: reason };
}

async function ps(conn) {
    const r = await execFull(conn, 'docker ps -a --format "{{json .}}"');
    if (r.code !== 0) return { error: (r.stderr || r.stdout).trim() || 'docker ps failed' };
    return { containers: parseJsonLines(r.stdout) };
}

async function images(conn) {
    const r = await execFull(conn, 'docker images --format "{{json .}}"');
    if (r.code !== 0) return { error: (r.stderr || r.stdout).trim() || 'docker images failed' };
    return { images: parseJsonLines(r.stdout) };
}

async function stats(conn) {
    const r = await execFull(conn, 'docker stats --no-stream --format "{{json .}}"');
    if (r.code !== 0) return { stats: {} };   // non-fatal: just no live metrics
    const map = {};
    parseJsonLines(r.stdout).forEach(s => { if (s.Name) map[s.Name] = s; });
    return { stats: map };
}

async function action(conn, act, id) {
    const verbs = { start: 'start', stop: 'stop', restart: 'restart', pause: 'pause', unpause: 'unpause', remove: 'rm -f', 'image-remove': 'rmi' };
    const verb = verbs[act];
    if (!verb) return { error: 'Unknown action' };
    if (!VALID_DOCKER_ID.test(id || '')) return { error: 'Invalid id' };
    const r = await execFull(conn, `docker ${verb} ${id}`);
    return r.code === 0 ? { ok: true, output: r.stdout.trim() } : { error: (r.stderr || r.stdout).trim() || 'command failed' };
}

module.exports = { available, ps, images, stats, action, parseJsonLines, execFull, VALID_DOCKER_ID };

// Verifies the UA + clock spoofing mechanism (DevTools Emulation overrides)
// works in this Electron build — the same calls applyBrowserProfile() makes.
//
//   electron/node_modules/.bin/electron docker/sshd-test/emulation.test.js

const { app, BrowserWindow } = require('electron');

const UA = `Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
const TZ = 'Asia/Tokyo';

const PAGE = 'data:text/html,' + encodeURIComponent(
    '<script>console.log("RESULT " + JSON.stringify({' +
    'ua: navigator.userAgent,' +
    'tz: Intl.DateTimeFormat().resolvedOptions().timeZone,' +
    'clock: new Date().toString()' +
    '}))</script>'
);

async function main() {
    const win = new BrowserWindow({ show: false });
    const wc = win.webContents;

    // Mirror production timing: blank load → attach+override on dom-ready → navigate.
    wc.once('dom-ready', async () => {
        wc.debugger.attach('1.3');
        await wc.debugger.sendCommand('Emulation.setUserAgentOverride', { userAgent: UA });
        await wc.debugger.sendCommand('Emulation.setTimezoneOverride', { timezoneId: TZ });
        wc.loadURL(PAGE);
    });

    wc.on('console-message', (_e, _level, message) => {
        if (!message.startsWith('RESULT ')) return;
        let failures = 0;
        const log = (ok, m) => { console.log(`${ok ? '✅' : '❌'} ${m}`); if (!ok) failures++; };
        const r = JSON.parse(message.slice('RESULT '.length));
        log(r.ua === UA && !/Electron/i.test(r.ua), `user-agent overridden, no Electron token: ${r.ua}`);
        log(r.tz === TZ, `timezone overridden → ${r.tz}`);
        console.log(`   clock seen by page: ${r.clock}`);
        win.destroy();
        console.log(failures ? `\n${failures} test(s) failed` : '\nEmulation overrides verified');
        app.exit(failures ? 1 : 0);
    });

    wc.loadURL('about:blank');
    setTimeout(() => { console.error('FATAL timeout'); app.exit(2); }, 15000);
}

app.whenReady().then(main).catch((e) => { console.error('FATAL', e); app.exit(2); });

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { ssh } from '../../stores/ssh.js';

const props = defineProps({
    sessionId: Number,
    cwd: { type: String, default: null },     // start the shell in this directory
    initCmd: { type: String, default: null }  // run this command once the shell is ready (e.g. docker exec/logs)
});

const terminalEl = ref(null);
let term = null;
let fitAddon = null;
let webglAddon = null;

// Unique shell identifier (enables multiple independent terminals)
const shellId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Debounced resize
let resizeTimer = null;
let resizeObserver = null;
let unsubIpc = null;
let unsubClosed = null;
let unsubStarted = null;

// Shell-quote a path for a single-quoted argument: ' → '\''
function shQuote(p) { return `'${String(p).replace(/'/g, "'\\''")}'`; }

function initTerminal() {
    if (!terminalEl.value) return;

    term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'SF Mono', monospace",
        theme: {
            background: '#1e1e2e',
            foreground: '#cdd6f4',
            cursor: '#f5e0dc',
            selectionBackground: '#585b70',
            black: '#45475a',
            red: '#f38ba8',
            green: '#a6e3a1',
            yellow: '#f9e2af',
            blue: '#89b4fa',
            magenta: '#f5c2e7',
            cyan: '#94e2d5',
            white: '#bac2de',
            brightBlack: '#585b70',
            brightRed: '#f38ba8',
            brightGreen: '#a6e3a1',
            brightYellow: '#f9e2af',
            brightBlue: '#89b4fa',
            brightMagenta: '#f5c2e7',
            brightCyan: '#94e2d5',
            brightWhite: '#a6adc8'
        },
        allowProposedApi: true,
        scrollback: 5000
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalEl.value);

    // Prefer the GPU renderer — the default DOM renderer garbles glyphs on
    // reflow/resize. Fall back silently to DOM if WebGL is unavailable.
    try {
        webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => { try { webglAddon.dispose(); } catch (e) {} webglAddon = null; });
        term.loadAddon(webglAddon);
    } catch (e) { webglAddon = null; }

    nextTick(() => {
        try { fitAddon.fit(); } catch (e) {}
    });

    // User input → SSH shell
    term.onData((data) => {
        if (window.app) {
            window.app.ssh.shell.input(props.sessionId, shellId, data);
        }
    });

    // SSH shell output → terminal (via shared store listener)
    unsubIpc = ssh.on(props.sessionId, 'ssh.shell.output', (data) => {
        if (data.shellId !== shellId) return;
        term.write(data.data);
    });
    unsubClosed = ssh.on(props.sessionId, 'ssh.shell.closed', (data) => {
        if (data.shellId !== shellId) return;
        term.write('\r\n\x1b[31m[Shell closed]\x1b[0m\r\n');
    });
    // Once the remote shell is ready, cd into the requested directory and/or run
    // an init command (leading space keeps it out of history when
    // HISTCONTROL=ignorespace).
    if (props.cwd || props.initCmd) {
        unsubStarted = ssh.on(props.sessionId, 'ssh.shell.started', (data) => {
            if (data.shellId !== shellId) return;
            if (window.app) {
                if (props.cwd) window.app.ssh.shell.input(props.sessionId, shellId, ` cd ${shQuote(props.cwd)} && clear\n`);
                if (props.initCmd) window.app.ssh.shell.input(props.sessionId, shellId, ` ${props.initCmd}\n`);
            }
            if (unsubStarted) { unsubStarted(); unsubStarted = null; }
        });
    }

    // Fit to the container, tell the remote pty, then force a redraw. The extra
    // rAF re-fit catches sizes that are only correct after layout settles
    // (e.g. window maximize), which is where xterm tends to render garbage.
    function doFit() {
        try {
            fitAddon.fit();
            if (window.app) window.app.ssh.shell.resize(props.sessionId, shellId, term.cols, term.rows);
            term.refresh(0, term.rows - 1);
        } catch (e) {}
    }

    // Resize observer
    resizeObserver = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            doFit();
            requestAnimationFrame(doFit);
        }, 50);
    });
    resizeObserver.observe(terminalEl.value);

    // Start the SSH shell
    if (window.app) {
        window.app.ssh.shell.start(props.sessionId, shellId, term.cols, term.rows);
    }
}

onMounted(() => {
    initTerminal();
});

onBeforeUnmount(() => {
    if (resizeTimer) clearTimeout(resizeTimer);
    if (resizeObserver) resizeObserver.disconnect();
    if (unsubIpc) unsubIpc();
    if (unsubClosed) unsubClosed();
    if (unsubStarted) unsubStarted();
    if (webglAddon) { try { webglAddon.dispose(); } catch (e) {} webglAddon = null; }
    if (term) {
        term.dispose();
        term = null;
    }
});
</script>

<template>
    <div ref="terminalEl" class="terminal-container"></div>
</template>

<style scoped>
.terminal-container {
    width: 100%;
    height: 100%;
    padding: 4px;
}
</style>

<script setup>
import { ref, onMounted, onBeforeUnmount, provide, watch, computed } from 'vue';
import { windowManager } from '../stores/windows.js';
import { ssh } from '../stores/ssh.js';
import WindowFrame from '../components/desktop/WindowFrame.vue';
import Taskbar from '../components/desktop/Taskbar.vue';
import TerminalWindow from '../components/desktop/TerminalWindow.vue';
import FileExplorer from '../components/desktop/FileExplorer.vue';
import TextEditor from '../components/desktop/TextEditor.vue';
import ImageViewer from '../components/desktop/ImageViewer.vue';
import SystemMonitor from '../components/desktop/SystemMonitor.vue';
import WebBrowser from '../components/desktop/WebBrowser.vue';
import DockerManager from '../components/desktop/DockerManager.vue';
import NotesApp from '../components/desktop/NotesApp.vue';
import ConnectionPanel from '../components/desktop/ConnectionPanel.vue';
import ConnectionDialog from '../components/desktop/ConnectionDialog.vue';
import SpotlightLauncher from '../components/desktop/SpotlightLauncher.vue';
import MasterPasswordDialog from '../components/desktop/MasterPasswordDialog.vue';
import HostKeyDialog from '../components/desktop/HostKeyDialog.vue';

onMounted(() => {
    ssh.init();
    // Show master password dialog on start
    showMasterPassword.value = true;
});

const connectedSessionId = computed(() => ssh.state.activeSessionId);
const launcherRef = ref(null);
const showMasterPassword = ref(false);

function loadHostsAfterUnlock() {
    // Reload hosts now that master password is set
    if (window.app) {
        window.app.hosts.load();
    }
}

// Every window stays mounted; windows of other sessions are hidden. Filtering the
// v-for instead unmounts them, and an unmounted TerminalWindow takes its shell,
// scrollback and running program with it on every session switch.
const allWindows = computed(() => windowManager.state.windows);
const isForActiveSession = (w) => w.sessionId === ssh.state.activeSessionId;

watch(() => ssh.state.lastConnectedSessionId, (sid) => {
    if (sid) setTimeout(() => openTerminal(), 200);
});

// ─── File → Editor bridge ───────────────────────────
function openInEditor(filePath, fileName, sessionId) {
    const sid = sessionId || connectedSessionId.value;
    const id = windowManager.openWindow({
        title: fileName || filePath.split('/').pop(),
        type: 'editor',
        component: 'TextEditor',
        props: { filePath, fileName: fileName || filePath.split('/').pop(), sessionId: sid },
        x: 180,
        y: 70,
        w: 680,
        h: 500,
        minW: 400,
        minH: 250
    });
    windowManager.updateWindow(id, { sessionId: sid, filePath, fileName });
}

provide('openInEditor', openInEditor);

// ─── Image Viewer ──────────────────────────────────
function openImageViewer(filePath, fileName, sessionId) {
    const sid = sessionId || connectedSessionId.value;
    const id = windowManager.openWindow({
        title: `🖼 ${fileName || filePath.split('/').pop()}`,
        type: 'image',
        component: 'ImageViewer',
        props: { filePath, fileName: fileName || filePath.split('/').pop(), sessionId: sid },
        x: 200,
        y: 80,
        w: 640,
        h: 500,
        minW: 300,
        minH: 200
    });
    windowManager.updateWindow(id, { sessionId: sid, filePath, fileName });
}

provide('openImageViewer', openImageViewer);

// ─── App launchers ──────────────────────────────────
function openTerminal(cwd = null, sessionId = null, initCmd = null, title = null) {
    const sid = sessionId || connectedSessionId.value;
    const host = sid ? (ssh.state.sessions[sid]?.label || ssh.state.sessions[sid]?.host || 'SSH') : 'SSH';
    const id = windowManager.openWindow({
        title: title || `Terminal — ${host}`,
        type: 'terminal',
        component: 'TerminalWindow',
        x: 100,
        y: 60,
        w: 700,
        h: 420,
        minW: 400,
        minH: 250
    });
    // cwd/initCmd may arrive as strings only from the bridges; the launcher and
    // the post-connect watcher call this with no args (cwd ends up an Event).
    windowManager.updateWindow(id, {
        sessionId: sid,
        cwd: typeof cwd === 'string' ? cwd : null,
        initCmd: typeof initCmd === 'string' ? initCmd : null
    });
}

// File Explorer → "Open terminal here"
provide('openTerminalAt', (cwd, sessionId) => openTerminal(cwd, sessionId));
// Docker → open a terminal running a command (logs -f / exec into container)
provide('openTerminalCmd', (initCmd, title, sessionId) => openTerminal(null, sessionId, initCmd, title));

function openFileExplorer() {
    const id = windowManager.openWindow({
        title: 'File Explorer',
        type: 'files',
        component: 'FileExplorer',
        x: 250,
        y: 80,
        w: 750,
        h: 480,
        minW: 450,
        minH: 300
    });
    windowManager.updateWindow(id, { sessionId: connectedSessionId.value });
}

function openSystemMonitor() {
    const id = windowManager.openWindow({
        title: 'System Monitor',
        type: 'monitor',
        component: 'SystemMonitor',
        x: 200, y: 100, w: 700, h: 500, minW: 500, minH: 350
    });
    windowManager.updateWindow(id, { sessionId: connectedSessionId.value });
}

function openBrowser() {
    const id = windowManager.openWindow({
        title: 'Browser',
        type: 'browser',
        component: 'WebBrowser',
        x: 160, y: 70, w: 900, h: 600, minW: 480, minH: 320
    });
    // Browser renders its tab strip into the titlebar (Chrome-style).
    windowManager.updateWindow(id, { sessionId: connectedSessionId.value, customTitlebar: true });
}

function openDocker() {
    const id = windowManager.openWindow({
        title: 'Docker',
        type: 'docker',
        component: 'DockerManager',
        x: 200, y: 80, w: 840, h: 560, minW: 560, minH: 360
    });
    windowManager.updateWindow(id, { sessionId: connectedSessionId.value });
}

// Notes are per-host — bound to the active session, one window per host.
function openNotes() {
    const sid = connectedSessionId.value;
    if (!sid) return;
    const existing = windowManager.state.windows.find(w => w.type === 'notes' && w.sessionId === sid);
    if (existing) { windowManager.focusWindow(existing.id); return; }
    const s = ssh.state.sessions[sid];
    const id = windowManager.openWindow({
        title: 'Notes — ' + (s?.label || s?.host || 'host'),
        type: 'notes',
        component: 'NotesApp',
        x: 220, y: 90, w: 620, h: 460, minW: 360, minH: 240
    });
    windowManager.updateWindow(id, { sessionId: sid });
}

function onDisconnect() {
    if (connectedSessionId.value) {
        ssh.disconnect(connectedSessionId.value);
    }
}

// ─── Window shortcuts ───────────────────────────────────
// activeWindowId is global and can still point at a hidden window after a session
// switch, so act only on something actually on screen.
function shortcutTarget() {
    const onScreen = windowManager.state.windows.filter(w => isForActiveSession(w) && !w.minimized);
    const active = onScreen.find(w => w.id === windowManager.state.activeWindowId);
    if (active) return active.id;
    const front = onScreen.reduce((a, b) => (!a || b.z > a.z ? b : a), null);
    return front ? front.id : null;
}

function onShortcut(e) {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key !== 'w' && key !== 'm') return;

    e.preventDefault();
    const id = shortcutTarget();
    if (id == null) return;
    // Via the close guard, so an editor with unsaved edits still gets to prompt.
    if (key === 'w') windowManager.closeWindow(id);
    else windowManager.minimizeWindow(id);
}

// Capture phase: xterm and the editor's textarea see keydown first and could
// otherwise swallow these.
onMounted(() => window.addEventListener('keydown', onShortcut, true));
onBeforeUnmount(() => window.removeEventListener('keydown', onShortcut, true));
</script>

<template>
    <div class="desktop" @contextmenu.self.prevent="launcherRef?.open()">
        <div class="desktop-bg"></div>

        <!-- Master password -->
        <MasterPasswordDialog v-if="showMasterPassword" @unlocked="showMasterPassword = false; loadHostsAfterUnlock()" />

        <!-- Host key change confirmation -->
        <HostKeyDialog />

        <!-- Connection sidebar -->
        <div v-if="ssh.state.showConnectionPanel" class="desktop-sidebar-overlay" @mousedown.self="ssh.state.showConnectionPanel = false">
            <ConnectionPanel @close="ssh.state.showConnectionPanel = false" />
        </div>

        <SpotlightLauncher
            ref="launcherRef"
            :connected-session-id="connectedSessionId"
            @open-terminal="openTerminal"
            @open-files="openFileExplorer"
            @open-monitor="openSystemMonitor"
            @open-browser="openBrowser"
            @open-docker="openDocker"
            @open-notes="openNotes"
            @open-connect="ssh.state.showConnectDialog = true"
            @disconnect="onDisconnect"
        />

        <WindowFrame
            v-for="win in allWindows"
            :key="win.id"
            :window-id="win.id"
            :hidden="!isForActiveSession(win)"
        >
            <TerminalWindow
                v-if="win.component === 'TerminalWindow'"
                :session-id="win.sessionId || connectedSessionId"
                :cwd="win.cwd"
                :init-cmd="win.initCmd"
                @close="windowManager.closeWindow(win.id)"
            />
            <FileExplorer
                v-else-if="win.component === 'FileExplorer'"
                :session-id="win.sessionId || connectedSessionId"
            />
            <TextEditor
                v-else-if="win.component === 'TextEditor'"
                :session-id="win.sessionId || connectedSessionId"
                :file-path="win.filePath"
                :file-name="win.fileName"
            />
            <ImageViewer
                v-else-if="win.component === 'ImageViewer'"
                :session-id="win.sessionId || connectedSessionId"
                :file-path="win.filePath"
                :file-name="win.fileName"
            />
            <SystemMonitor
                v-else-if="win.component === 'SystemMonitor'"
                :session-id="win.sessionId || connectedSessionId"
            />
            <WebBrowser
                v-else-if="win.component === 'WebBrowser'"
                :session-id="win.sessionId || connectedSessionId"
            />
            <DockerManager
                v-else-if="win.component === 'DockerManager'"
                :session-id="win.sessionId || connectedSessionId"
            />
            <NotesApp
                v-else-if="win.component === 'NotesApp'"
                :session-id="win.sessionId || connectedSessionId"
            />
            <div v-else class="window-placeholder">
                {{ win.title }}
            </div>
        </WindowFrame>

        <div v-if="ssh.state.showConnectDialog" class="desktop-modal-overlay" @mousedown.self="ssh.state.showConnectDialog = false">
            <div class="desktop-modal">
                <ConnectionDialog
                    @close="ssh.state.showConnectDialog = false"
                />
            </div>
        </div>

        <!-- Drag/resize shield — keeps the pointer out of any <webview>. -->
        <div
            v-if="windowManager.state.interacting"
            class="desktop-drag-shield"
            :style="{ cursor: windowManager.state.interactCursor }"
        ></div>

        <Taskbar />
    </div>
</template>

<style scoped>
.desktop {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #11111b;
}
.desktop-bg {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
        radial-gradient(ellipse at 20% 50%, rgba(137, 180, 250, 0.08) 0%, transparent 60%),
        radial-gradient(ellipse at 80% 30%, rgba(245, 194, 231, 0.06) 0%, transparent 60%),
        radial-gradient(ellipse at 50% 80%, rgba(166, 227, 161, 0.05) 0%, transparent 60%),
        linear-gradient(180deg, #1e1e2e 0%, #11111b 100%);
    z-index: 0;
}
/* Invisible, and above every window — those top out well below 15000. */
.desktop-drag-shield {
    position: fixed;
    inset: 0;
    z-index: 14000;
}
.desktop-sidebar-overlay {
    position: fixed;
    inset: 38px 0 0 0;
    z-index: 15000;
    display: flex;
}
.desktop-sidebar-overlay::after {
    content: '';
    flex: 1;
    background: rgba(0,0,0,0.3);
}
.desktop-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 20000;
}
.desktop-modal {
    background: #1e1e2e;
    border: 1px solid #45475a;
    border-radius: 12px;
    box-shadow: 0 16px 48px rgba(0,0,0,0.5);
    max-width: 680px;
    width: 92%;
}
.window-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #a6adc8;
    font-size: 14px;
}
</style>

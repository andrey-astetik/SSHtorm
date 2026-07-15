<script setup>
import { ref, reactive, computed, onMounted, nextTick, inject } from 'vue';
import { ssh } from '../../stores/ssh.js';
import ChevronRight from '../../compAst/icons/ChevronRight.vue';
import Repeat from '../../compAst/icons/Repeat.vue';
import Plus from '../../compAst/icons/Plus.vue';
import Clock from '../../compAst/icons/Clock.vue';

const props = defineProps({
    sessionId: Number
});

// When inside a WindowFrame, render our own titlebar (tabs + window controls)
// using the frame's chrome, so the window stays draggable/closeable.
const chrome = inject('windowChrome', null);

const partition = ref(null);        // set once the tunnel proxy is ready
const profile = ref(null);          // { userAgent, timezoneId, osName }
const error = ref('');              // setup-level error
const forwardingBlocked = ref(false); // server has AllowTcpForwarding off

const tabs = reactive([]);
const activeId = ref(null);
const editing = ref(false);         // address bar focused → don't auto-overwrite
let tabCounter = 0;

const menuOpen = ref(false);        // history / data menu
const historyList = ref([]);

const viewEls = {};                 // tab id → <webview> element
const attached = new Set();         // tab ids whose listeners are wired

const HOME = 'https://duckduckgo.com/';

const activeTab = computed(() => tabs.find(t => t.id === activeId.value) || null);
const byId = (id) => tabs.find(t => t.id === id);

function normalizeUrl(input) {
    let s = (input || '').trim();
    if (!s) return '';
    if (s === 'about:blank') return s;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
    const looksLikeHost = /^[^\s/]+\.[^\s/]/.test(s) || s.startsWith('localhost') || /^[0-9.:]+(:\d+)?(\/.*)?$/.test(s);
    if (looksLikeHost) return 'http://' + s;
    return 'https://duckduckgo.com/?q=' + encodeURIComponent(s);
}

// ─── Tabs ───────────────────────────────────────────────
function newTab(url) {
    const id = ++tabCounter;
    tabs.push({ id, address: url || '', url: '', title: 'New Tab', loading: false, canBack: false, canFwd: false });
    activeId.value = id;
    if (url) nextTick(() => navigate(url, id));
    return id;
}

function activateTab(id) {
    activeId.value = id;
    editing.value = false;
}

function closeTab(id) {
    const i = tabs.findIndex(t => t.id === id);
    if (i === -1) return;
    tabs.splice(i, 1);
    attached.delete(id);
    delete viewEls[id];
    if (activeId.value === id) {
        const next = tabs[i] || tabs[i - 1] || null;
        if (next) activateTab(next.id);
        else newTab();
    }
}

// ─── Navigation (acts on the active tab) ────────────────
function navigate(input, id) {
    const tid = id ?? activeId.value;
    const t = byId(tid);
    const el = viewEls[tid];
    if (!t || !el) return;
    const url = normalizeUrl(input ?? t.address);
    if (!url) return;
    t.address = url;
    editing.value = false;
    try { el.loadURL(url); } catch (e) { error.value = e.message; }
}

function goBack() { try { viewEls[activeId.value]?.goBack(); } catch (e) {} }
function goForward() { try { viewEls[activeId.value]?.goForward(); } catch (e) {} }
function reload() { try { viewEls[activeId.value]?.reload(); } catch (e) {} }
function stop() { try { viewEls[activeId.value]?.stop(); } catch (e) {} }

// ─── History + data menu ────────────────────────────────
function recordHistory(id) {
    const el = viewEls[id]; const t = byId(id);
    if (!el || !t) return;
    let u = ''; try { u = el.getURL(); } catch (e) {}
    if (!u || u === 'about:blank') return;
    try { window.app?.history?.add(props.sessionId, u, t.title); } catch (e) {}
}
async function loadHistory() {
    try { historyList.value = (await window.app?.history?.list(props.sessionId)) || []; }
    catch (e) { historyList.value = []; }
}
async function toggleMenu() {
    menuOpen.value = !menuOpen.value;
    if (menuOpen.value) await loadHistory();
}
function openFromHistory(url) { menuOpen.value = false; newTab(url); }
async function clearData() {
    try { await window.app?.browser?.clearData(props.sessionId); } catch (e) {}
    historyList.value = [];
    menuOpen.value = false;
    reload();   // reload the active tab so cleared cookies take effect
}

function onAddressBlur() {
    editing.value = false;
    const t = activeTab.value;
    if (t && t.url && t.url !== 'about:blank') t.address = t.url; // discard unsubmitted edit
}

// ─── webview wiring ─────────────────────────────────────
function updateNav(id) {
    const el = viewEls[id];
    const t = byId(id);
    if (!el || !t) return;
    try {
        t.canBack = el.canGoBack();
        t.canFwd = el.canGoForward();
        const u = el.getURL();
        t.url = u;
        // Don't fight the user while they're typing in the address bar.
        if (!(id === activeId.value && editing.value) && u && u !== 'about:blank') {
            t.address = u;
        }
    } catch (e) {}
}

function attachListeners(id, el) {
    const t = byId(id);
    el.addEventListener('did-start-loading', () => { if (byId(id)) byId(id).loading = true; });
    el.addEventListener('did-stop-loading', () => { if (byId(id)) byId(id).loading = false; updateNav(id); });
    el.addEventListener('did-navigate', () => { updateNav(id); recordHistory(id); });
    el.addEventListener('did-navigate-in-page', () => updateNav(id));
    el.addEventListener('page-title-updated', (e) => {
        const tt = byId(id);
        if (tt) tt.title = e.title || tt.url || 'Tab';
        recordHistory(id);
    });
    el.addEventListener('did-fail-load', (e) => {
        if (e.errorCode === -3) return; // ABORTED
        const tt = byId(id);
        if (tt) { tt.loading = false; tt.title = 'Failed to load'; }
    });
    // Apply the remote UA/clock profile + inject a click reporter once the guest
    // has a process. Clicks inside the guest don't bubble to the host DOM, so the
    // window can't tell it was clicked; we inject a pointerdown listener that logs
    // a marker, which the <webview> surfaces via console-message → raise the window.
    el.addEventListener('dom-ready', async () => {
        try {
            el.executeJavaScript("if(!window.__wvClickHook){window.__wvClickHook=1;var f=function(){console.log('__WV_CLICK__')};addEventListener('pointerdown',f,true);addEventListener('mousedown',f,true);}");
        } catch (e) {}
        if (el._profileApplied || !window.app?.browser) return;
        el._profileApplied = true;
        try { await window.app.browser.applyProfile(props.sessionId, el.getWebContentsId()); } catch (e) {}
    });
    // Bring this window to the front when the guest is interacted with. Guest
    // clicks don't bubble to the host DOM, so we use two independent signals: the
    // injected pointerdown marker (surfaced via console-message) and the webview
    // element's own focus event.
    el.addEventListener('console-message', (e) => { if (e.message === '__WV_CLICK__') chrome?.focus(); });
    el.addEventListener('focus', () => chrome?.focus());
}

function setRef(id, el) {
    if (el) {
        viewEls[id] = el;
        if (!attached.has(id)) { attached.add(id); attachListeners(id, el); }
    } else {
        delete viewEls[id];
    }
}

onMounted(async () => {
    try {
        if (!window.app?.browser) { error.value = 'Browser tunnel API unavailable'; return; }
        const sid = props.sessionId;
        if (!sid || !ssh.state.sessions[sid]?.connected) { error.value = 'No active SSH session — connect first'; return; }

        const res = await window.app.browser.prepare(sid);
        if (!res || res.error) { error.value = res?.error || 'Failed to prepare tunnel'; return; }
        partition.value = res.partition;

        // Non-blocking: warn if TCP forwarding is off, but never gate opening on it.
        window.app.browser.checkForwarding(sid)
            .then(r => { forwardingBlocked.value = !!r?.forwardingBlocked; })
            .catch(() => {});

        const prof = await window.app.browser.profile(sid);
        if (prof && !prof.error) profile.value = prof;

        await nextTick();
        newTab();
    } catch (e) {
        error.value = 'Browser failed to start: ' + (e?.message || e);
    }
});
</script>

<template>
    <div class="browser">
        <!-- Titlebar: tabs live here (Chrome-style). The bar itself is the window
             drag handle; tabs/buttons stop propagation. Controls are always
             present so the window stays closeable even before the tunnel is up. -->
        <div class="bw-titlebar" @mousedown="chrome?.startDrag($event)" @dblclick="chrome?.toggleMaximize()">
            <div v-show="partition" class="browser-tabs tabs-in-titlebar" @mousedown.stop @dblclick.stop>
                <div
                    v-for="t in tabs"
                    :key="t.id"
                    class="tab"
                    :class="{ 'tab-active': t.id === activeId }"
                    @click="activateTab(t.id)"
                    :title="t.url || t.title"
                >
                    <span v-if="t.loading" class="tab-spinner"></span>
                    <span class="tab-title">{{ t.title }}</span>
                    <button class="tab-close" @click.stop="closeTab(t.id)" title="Close tab">×</button>
                </div>
                <button class="tab-new" @click="newTab()" title="New tab"><Plus size="1.1em" /></button>
            </div>
            <div v-if="chrome" class="bw-winctl">
                <button class="bw-win-btn" @click.stop="chrome.minimize()" title="Minimize">&#x2014;</button>
                <button class="bw-win-btn" @click.stop="chrome.toggleMaximize()" :title="chrome.maximized.value ? 'Restore' : 'Maximize'">{{ chrome.maximized.value ? '❐' : '□' }}</button>
                <button class="bw-win-btn bw-win-close" @click.stop="chrome.close()" title="Close">✕</button>
            </div>
        </div>

        <!-- Toolbar -->
        <div v-if="partition" class="browser-toolbar">
            <button class="bb" :disabled="!activeTab?.canBack" @click="goBack" title="Back">
                <ChevronRight size="1.2em" class="flip" />
            </button>
            <button class="bb" :disabled="!activeTab?.canFwd" @click="goForward" title="Forward">
                <ChevronRight size="1.2em" />
            </button>
            <button class="bb" v-if="!activeTab?.loading" @click="reload" title="Reload">
                <Repeat size="1.15em" />
            </button>
            <button class="bb" v-else @click="stop" title="Stop">×</button>

            <input
                v-if="activeTab"
                class="browser-address"
                v-model="activeTab.address"
                spellcheck="false"
                placeholder="Search or enter address — all traffic via SSH"
                @focus="editing = true"
                @blur="onAddressBlur"
                @keydown.enter="navigate()"
            />

            <span class="browser-lock" :title="profile ? `UA: ${profile.userAgent}\nTimezone: ${profile.timezoneId || 'host default'}` : 'Tunnelled through SSH'">🔒 SSH</span>

            <button class="bb" :class="{ 'bb-active': menuOpen }" @click="toggleMenu" title="History &amp; data"><Clock size="1.1em" /></button>
        </div>

        <!-- History / data menu -->
        <div v-if="menuOpen" class="bw-menu-backdrop" @mousedown="menuOpen = false"></div>
        <div v-if="menuOpen" class="bw-menu" @mousedown.stop>
            <div class="bw-menu-head">
                <span class="bw-menu-title-h">History</span>
                <button class="bw-menu-clear" @click="clearData" title="Cookies, cache &amp; history for this host">Clear browsing data</button>
            </div>
            <div class="bw-menu-list">
                <div v-if="!historyList.length" class="bw-menu-empty">No history yet</div>
                <button v-for="(h, i) in historyList.slice().reverse()" :key="i" class="bw-menu-item" @click="openFromHistory(h.url)" :title="h.url">
                    <span class="bw-menu-item-title">{{ h.title || h.url }}</span>
                    <span class="bw-menu-item-url">{{ h.url }}</span>
                </button>
            </div>
        </div>

        <!-- TCP forwarding disabled on the server → nothing will load -->
        <div v-if="forwardingBlocked" class="browser-warn">
            ⚠ На сервере выключен <b>TCP forwarding</b> (<code>AllowTcpForwarding</code> в sshd_config).
            Браузер не сможет ходить в сеть через эту сессию. Включи его и перезагрузи sshd.
        </div>

        <!-- Stage: all webviews stay alive; only the active one is shown -->
        <div class="browser-stage">
            <template v-if="partition">
                <webview
                    v-for="t in tabs"
                    :key="t.id"
                    :ref="el => setRef(t.id, el)"
                    v-show="t.id === activeId"
                    :partition="partition"
                    :src="HOME"
                    :useragent="profile?.userAgent || undefined"
                    class="browser-view"
                ></webview>
            </template>

            <div v-else-if="!error" class="browser-status">Establishing SSH tunnel…</div>
            <div v-if="error" class="browser-error">⚠ {{ error }}</div>
        </div>
    </div>
</template>

<style scoped>
.browser { display: flex; flex-direction: column; height: 100%; background: #1e1e2e; position: relative; }

/* History / data menu */
.bb-active { background: rgba(137,180,250,0.25); }
.bw-menu-backdrop { position: absolute; inset: 0; z-index: 40; }
.bw-menu {
    position: absolute; top: 66px; right: 8px; z-index: 50;
    width: 340px; max-width: calc(100% - 16px); max-height: 62%;
    display: flex; flex-direction: column;
    background: #181825; border: 1px solid #313244; border-radius: 10px;
    box-shadow: 0 12px 32px rgba(0,0,0,0.5); overflow: hidden;
}
.bw-menu-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-bottom: 1px solid #313244; }
.bw-menu-title-h { font-size: 12px; font-weight: 600; color: #cdd6f4; }
.bw-menu-clear { font-size: 11px; padding: 3px 8px; border: none; border-radius: 6px; cursor: pointer; background: rgba(243,139,168,0.15); color: #f38ba8; }
.bw-menu-clear:hover { background: rgba(243,139,168,0.28); }
.bw-menu-list { overflow-y: auto; overflow-x: hidden; padding: 4px; }
.bw-menu-empty { padding: 16px; text-align: center; color: #6c7086; font-size: 12px; }
.bw-menu-item { display: flex; flex-direction: column; gap: 1px; width: 100%; min-width: 0; box-sizing: border-box; text-align: left; padding: 6px 8px; border: none; border-radius: 6px; background: transparent; cursor: pointer; }
.bw-menu-item:hover { background: rgba(255,255,255,0.05); }
.bw-menu-item-title { font-size: 12px; color: #cdd6f4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bw-menu-item-url { font-size: 10px; color: #6c7086; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Tabs */
.browser-tabs {
    display: flex; align-items: stretch; gap: 2px;
    padding: 4px 4px 0; background: #11111b; overflow-x: auto;
    flex-shrink: 0; scrollbar-width: thin;
}
.tab {
    display: flex; align-items: center; gap: 6px;
    max-width: 200px; min-width: 90px; padding: 6px 8px 6px 12px;
    background: #181825; color: #a6adc8; cursor: pointer;
    border-radius: 8px 8px 0 0; font-size: 12px; user-select: none;
    border: 1px solid transparent; border-bottom: none;
}
.tab-active { background: #1e1e2e; color: #cdd6f4; border-color: #313244; }

/* Window titlebar holding the tabs (Chrome-style) */
.bw-titlebar {
    display: flex; align-items: flex-end; gap: 6px;
    height: 32px; padding: 0 6px 0 4px; background: #11111b;
    flex-shrink: 0; cursor: grab;
}
.bw-winctl { display: flex; gap: 4px; align-items: center; align-self: center; margin-left: auto; }
.bw-win-btn {
    width: 20px; height: 20px; border: none; border-radius: 4px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; color: #cdd6f4; background: transparent; transition: background 0.15s;
}
.bw-win-btn:hover { background: rgba(255,255,255,0.1); }
.bw-win-close:hover { background: #f38ba8; color: #11111b; }

/* Tabs living in the titlebar */
.tabs-in-titlebar { background: transparent; padding: 0; flex: 0 1 auto; min-width: 0; align-items: flex-end; }
.tabs-in-titlebar .tab { padding: 4px 8px 5px 12px; max-width: 180px; }
.tabs-in-titlebar .tab-new { width: 26px; height: 26px; align-self: center; }
.tab-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tab-close {
    flex-shrink: 0; width: 16px; height: 16px; line-height: 1;
    border: none; border-radius: 4px; background: transparent; color: inherit;
    cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center;
}
.tab-close:hover { background: rgba(243,139,168,0.25); color: #f38ba8; }
.tab-new {
    flex-shrink: 0; width: 28px; border: none; background: transparent; color: #a6adc8;
    cursor: pointer; border-radius: 6px; display: flex; align-items: center; justify-content: center;
}
.tab-new:hover { background: rgba(255,255,255,0.06); color: #cdd6f4; }
.tab-spinner {
    flex-shrink: 0; width: 10px; height: 10px; border-radius: 50%;
    border: 2px solid rgba(137,180,250,0.3); border-top-color: #89b4fa;
    animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* Toolbar */
.browser-toolbar {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 8px; background: #181825; border-bottom: 1px solid #313244;
    flex-shrink: 0;
}
.bb {
    width: 28px; height: 28px; flex-shrink: 0; padding: 0;
    border: none; border-radius: 6px; cursor: pointer;
    background: rgba(255,255,255,0.06); color: #cdd6f4;
    display: flex; align-items: center; justify-content: center; line-height: 1;
    transition: background 0.12s;
}
.bb :deep(svg) { display: block; }
.bb .flip { transform: rotate(180deg); }
.bb:hover:not(:disabled) { background: rgba(137,180,250,0.18); }
.bb:disabled { opacity: 0.35; cursor: default; }
.browser-address {
    flex: 1; min-width: 0; height: 28px;
    padding: 0 12px; border: 1px solid #45475a; border-radius: 14px;
    background: #11111b; color: #cdd6f4; font-size: 13px; outline: none;
    transition: border-color 0.12s;
}
.browser-address:focus { border-color: #89b4fa; }
.browser-lock {
    flex-shrink: 0; font-size: 11px; font-weight: 600; color: #a6e3a1;
    padding: 0 8px; user-select: none; cursor: default;
}
.browser-warn {
    flex-shrink: 0; padding: 8px 12px; font-size: 12px; line-height: 1.45;
    background: rgba(249,226,175,0.12); border-bottom: 1px solid rgba(249,226,175,0.3);
    color: #f9e2af;
}
.browser-warn code { background: rgba(0,0,0,0.25); padding: 0 4px; border-radius: 3px; }

/* Stage */
.browser-stage { position: relative; flex: 1; overflow: hidden; background: #1e1e2e; }
.browser-view { width: 100%; height: 100%; border: none; display: inline-flex; background: #1e1e2e; }
.browser-status {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    color: #a6adc8; font-size: 14px; background: #1e1e2e;
}
.browser-error {
    position: absolute; top: 0; left: 0; right: 0;
    padding: 10px 14px; background: rgba(243,139,168,0.15);
    border-bottom: 1px solid rgba(243,139,168,0.3);
    color: #f38ba8; font-size: 13px; z-index: 5;
}
</style>

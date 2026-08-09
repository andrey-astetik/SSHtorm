<script setup>
import { ref, onMounted, onBeforeUnmount, computed, inject, nextTick } from 'vue';
import { windowManager } from '../../stores/windows.js';
import WarningIcon from '../../compAst/icons/Warning.vue';
import Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.css';
// Prism's entry point ships only markup/css/clike/javascript; without these the
// grammar lookup below misses and the file renders as plain text. Order matters —
// each component registers itself against its base grammar.
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-swift';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-markup-templating';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-less';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-ini';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-nginx';
import 'prismjs/components/prism-docker';

const props = defineProps({
    sessionId: Number,
    filePath: String,
    fileName: String
});

const emit = defineEmits(['saved']);

const content = ref('');
const originalContent = ref('');
const loading = ref(true);
// A load error replaces the editor; there is nothing to edit. A save error must not,
// or the buffer holding the user's edits becomes unreachable behind it.
const error = ref('');
const saveError = ref('');
const saving = ref(false);
const savedMsg = ref('');
// Fetched only in part; saving would write the visible slice over the whole file.
const truncated = ref(false);
// Backend refused the read: doesn't look like text. Nothing loaded until confirmed.
const binaryGate = ref(false);
// Confirmed anyway. A lossy UTF-8 decode: viewable, never writable.
const binaryConfirmed = ref(false);
const textareaRef = ref(null);
const preRef = ref(null);
const lineNumbersRef = ref(null);

const dirty = computed(() => content.value !== originalContent.value);

// Anything that would make a save destructive.
const readOnly = computed(() => truncated.value || binaryConfirmed.value);
const readOnlyReason = computed(() => {
    if (binaryConfirmed.value) return 'Binary file — saving would corrupt it.';
    if (truncated.value) return 'File was truncated at 512 KB on load — saving would discard the rest.';
    return '';
});

const language = computed(() => {
    const ext = (props.fileName || props.filePath || '').split('.').pop()?.toLowerCase();
    const map = {
        js: 'javascript', ts: 'typescript', jsx: 'jsx', tsx: 'tsx',
        py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java',
        c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp',
        html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
        json: 'json', xml: 'xml', yml: 'yaml', yaml: 'yaml', toml: 'toml',
        md: 'markdown', sh: 'bash', bash: 'bash', zsh: 'bash',
        sql: 'sql', php: 'php', swift: 'swift', kt: 'kotlin',
        dockerfile: 'docker', vue: 'markup', svelte: 'markup',
        conf: 'nginx', ini: 'ini', cfg: 'ini', env: 'bash',
        txt: 'plain', log: 'plain'
    };
    return map[ext] || 'plain';
});

// Prism re-tokenises the whole buffer per keystroke. It can't be debounced — the
// textarea's glyphs are transparent, so this layer is the visible text and any lag
// shows up as lag while typing. Past this size the highlight is dropped instead.
const HIGHLIGHT_MAX_CHARS = 100000;
const highlightTooBig = computed(() => content.value.length > HIGHLIGHT_MAX_CHARS);

const highlightedHtml = computed(() => {
    if (!content.value) return '';
    try {
        const grammar = Prism.languages[language.value];
        if (language.value === 'plain' || !grammar || highlightTooBig.value) {
            return escapeHtml(content.value);
        }
        return Prism.highlight(content.value, grammar, language.value);
    } catch (e) {
        return escapeHtml(content.value);
    }
});

const lineCount = computed(() => {
    return content.value ? content.value.split('\n').length : 1;
});

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// One subscription for the component's lifetime: a handler per load and per save
// would stack up, so the nth save runs n handlers and all of them outlive the window.
let unsubIpc = null;
let savedTimer = null;

function onIpcMessage(msg) {
    const d = msg?.data;
    if (!d || d.sessionId !== props.sessionId || d.path !== props.filePath) return;

    if (msg.method === 'ssh.sftp.readResult') {
        loading.value = false;
        if (d.error) { error.value = d.error; return; }
        // Backend stopped after the first chunk — ask before pulling the rest.
        if (d.binary) { binaryGate.value = true; return; }
        truncated.value = !!d.truncated;
        binaryConfirmed.value = !!d.binaryConfirmed;
        content.value = d.content || '';
        originalContent.value = content.value;
        nextTick(syncScroll);
        return;
    }

    if (msg.method === 'ssh.sftp.writeResult') {
        saving.value = false;
        if (d.error) {
            saveError.value = d.error;
            // Still unsaved; leaving this set would close the window on a later save.
            closeAfterSave.value = false;
            return;
        }
        saveError.value = '';
        originalContent.value = content.value;
        savedMsg.value = 'Saved ✓';
        clearTimeout(savedTimer);
        savedTimer = setTimeout(() => { savedMsg.value = ''; }, 2000);
        emit('saved', props.filePath);
        // "Save & close" held the window open until this landed.
        if (closeAfterSave.value) { closeAfterSave.value = false; forceClose(); }
    }
}

function loadFile(force = false) {
    loading.value = true;
    error.value = '';
    binaryGate.value = false;
    if (window.app) window.app.ssh.sftp.read(props.sessionId, props.filePath, force);
}

function readAnyway() { loadFile(true); }

// Returns whether a write was dispatched, so "save & close" only arms itself when
// there is something to wait for.
function saveFile() {
    if (readOnly.value) { saveError.value = readOnlyReason.value; return false; }
    if (!dirty.value || saving.value) return false;
    saving.value = true;
    savedMsg.value = '';
    saveError.value = '';
    if (window.app) window.app.ssh.sftp.write(props.sessionId, props.filePath, content.value);
    return true;
}

function onInput() {
    nextTick(syncScroll);
}

function onScroll() {
    syncScroll();
}

function syncScroll() {
    if (preRef.value && textareaRef.value) {
        preRef.value.scrollTop = textareaRef.value.scrollTop;
        preRef.value.scrollLeft = textareaRef.value.scrollLeft;
    }
    if (lineNumbersRef.value && textareaRef.value) {
        lineNumbersRef.value.scrollTop = textareaRef.value.scrollTop;
    }
}

const INDENT = '  ';

// v-model rewrites textarea.value on flush and parks the caret at the end, so every
// programmatic edit restores the selection after the patch lands.
function setSelection(start, end) {
    nextTick(() => {
        const ta = textareaRef.value;
        if (!ta) return;
        ta.selectionStart = start;
        ta.selectionEnd = end;
    });
}

// Tab indents, Shift+Tab outdents; across a multi-line selection both work on whole
// lines rather than replacing the selection.
function indentSelection(outdent) {
    const ta = textareaRef.value;
    if (!ta || readOnly.value) return;
    const value = content.value;
    const selStart = ta.selectionStart;
    const selEnd = ta.selectionEnd;
    const multiline = value.slice(selStart, selEnd).includes('\n');

    if (!outdent && !multiline) {
        content.value = value.slice(0, selStart) + INDENT + value.slice(selEnd);
        setSelection(selStart + INDENT.length, selStart + INDENT.length);
        return;
    }

    // Grow the range to whole lines.
    const blockStart = value.lastIndexOf('\n', selStart - 1) + 1;
    let blockEnd = value.indexOf('\n', selEnd);
    if (blockEnd === -1) blockEnd = value.length;
    // A selection ending exactly at a line start shouldn't drag in the next line.
    if (selEnd > selStart && selEnd === blockStart) blockEnd = selEnd;

    let firstDelta = 0;
    let totalDelta = 0;
    const lines = value.slice(blockStart, blockEnd).split('\n').map((line, i) => {
        let delta = 0;
        let out = line;
        if (outdent) {
            // One tab, or up to INDENT worth of spaces, whichever the line uses.
            const lead = /^(\t| {1,2})/.exec(line);
            if (lead) { delta = -lead[0].length; out = line.slice(lead[0].length); }
        } else if (line.length > 0) {
            // Blank lines stay blank rather than collect trailing whitespace.
            delta = INDENT.length;
            out = INDENT + line;
        }
        if (i === 0) firstDelta = delta;
        totalDelta += delta;
        return out;
    });

    content.value = value.slice(0, blockStart) + lines.join('\n') + value.slice(blockEnd);
    setSelection(
        Math.max(blockStart, selStart + firstDelta),
        Math.max(blockStart, selEnd + totalDelta)
    );
}

function onKeydown(e) {
    // `readonly` stops typing but not this, which writes `content` directly;
    // indentSelection bails on its own.
    if (e.key === 'Tab') {
        e.preventDefault();
        indentSelection(e.shiftKey);
    }
    // Lowercased: Caps Lock or a held Shift turn e.key into 'S'.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveFile();
    }
}

// ─── Unsaved-changes guard ───────────────────────────────
// The window manager asks before removing this window; unsaved edits veto the close
// and raise the prompt instead.
const chrome = inject('windowChrome', null);
const confirmClose = ref(false);
const closeAfterSave = ref(false);

function forceClose() {
    confirmClose.value = false;
    if (chrome) windowManager.closeWindow(chrome.windowId, { force: true });
}

function discardAndClose() { forceClose(); }

function saveAndClose() {
    closeAfterSave.value = saveFile();
}

onMounted(() => {
    if (window.app) unsubIpc = window.app.recieve(onIpcMessage);
    if (chrome) {
        windowManager.registerCloseGuard(chrome.windowId, () => {
            if (!dirty.value) return true;
            confirmClose.value = true;
            return false;
        });
    }
    if (props.filePath) loadFile();
    else { loading.value = false; error.value = 'No file path'; }
});

onBeforeUnmount(() => {
    if (chrome) windowManager.unregisterCloseGuard(chrome.windowId);
    if (unsubIpc) unsubIpc();
    clearTimeout(savedTimer);
});
</script>

<template>
    <div class="editor">
        <!-- Status bar -->
        <div class="editor-status">
            <span class="editor-file">{{ fileName || filePath }}</span>
            <span class="editor-lang">{{ language }}</span>
            <span v-if="binaryConfirmed" class="editor-savefail" title="Binary file — read only">binary · read only</span>
            <span v-else-if="truncated" class="editor-savefail" title="Only the first 512 KB was loaded — read only">truncated · read only</span>
            <span v-if="highlightTooBig" class="editor-hint" title="File too large to colourise without making typing lag">no highlight</span>
            <span v-if="saving" class="editor-dirty">saving…</span>
            <span v-else-if="dirty" class="editor-dirty">● modified</span>
            <span v-if="savedMsg" class="editor-saved">{{ savedMsg }}</span>
            <!-- Save failures stay here: the buffer is still editable behind them. -->
            <span v-if="saveError" class="editor-savefail" :title="saveError">Save failed: {{ saveError }}</span>
            <span class="editor-hint">Ctrl+S to save</span>
        </div>

        <!-- Loading -->
        <div v-if="loading" class="editor-loading">Loading {{ fileName }}...</div>

        <!-- Load error — nothing to edit -->
        <div v-else-if="error" class="editor-error">{{ error }}</div>

        <!-- Binary gate: nothing has been transferred past the first chunk yet -->
        <div v-else-if="binaryGate" class="editor-gate">
            <WarningIcon class="editor-gate-icon" size="2em" />
            <div class="editor-gate-title">This looks like a binary file</div>
            <p class="editor-gate-text">
                <code>{{ fileName || filePath }}</code> isn't text. Opening it decodes the bytes
                as UTF-8, which shows garbage and loses data — so it will be opened read-only
                and cannot be saved back.
            </p>
            <button class="editor-gate-btn" @click="readAnyway">Read anyway</button>
        </div>

        <!-- Editor area -->
        <div v-else class="editor-area">
            <!-- Line numbers -->
            <div ref="lineNumbersRef" class="editor-linenums">
                <div v-for="i in lineCount" :key="i" class="editor-linenum">{{ i }}</div>
            </div>

            <!-- Editor container -->
            <div class="editor-container">
                <!-- Highlighted overlay -->
                <pre
                    ref="preRef"
                    class="editor-highlight"
                    aria-hidden="true"
                ><code :class="'language-' + language" v-html="highlightedHtml + '\n'"></code></pre>

                <!-- Textarea -->
                <textarea
                    ref="textareaRef"
                    v-model="content"
                    class="editor-textarea"
                    spellcheck="false"
                    :readonly="readOnly"
                    @input="onInput"
                    @scroll="onScroll"
                    @keydown="onKeydown"
                ></textarea>
            </div>
        </div>

        <!-- Unsaved changes — the window manager is waiting on this answer -->
        <div v-if="confirmClose" class="editor-confirm-overlay">
            <div class="editor-confirm">
                <div class="editor-confirm-title">Unsaved changes</div>
                <p class="editor-confirm-text">
                    <code>{{ fileName || filePath }}</code> has edits that haven't been written to the server.
                </p>
                <div class="editor-confirm-actions">
                    <button v-if="!readOnly" class="editor-confirm-btn editor-confirm-save" :disabled="saving" @click="saveAndClose">
                        {{ saving ? 'Saving…' : 'Save & close' }}
                    </button>
                    <button class="editor-confirm-btn editor-confirm-discard" @click="discardAndClose">Discard</button>
                    <button class="editor-confirm-btn editor-confirm-cancel" @click="confirmClose = false">Cancel</button>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    /* Anchors the unsaved-changes overlay. */
    position: relative;
    font-family: var(--ed-font);
    font-size: var(--ed-size);

    /* One glyph grid for all three layers. The caret is painted by the textarea from
       its own layout while the visible text is the highlight layer underneath, so any
       difference leaves the caret where the text isn't and clicks landing on the wrong
       character. */
    --ed-font: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', monospace;
    --ed-size: 13px;
    --ed-line: 1.55;
    --ed-tab: 2;
}

.editor-status {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 10px;
    background: #181825;
    border-bottom: 1px solid #313244;
    font-size: 11px;
    flex-shrink: 0;
    user-select: none;
}
.editor-file {
    color: #cdd6f4;
    font-weight: 500;
}
.editor-lang {
    color: #89b4fa;
    text-transform: uppercase;
    font-size: 10px;
    padding: 1px 6px;
    background: rgba(137, 180, 250, 0.1);
    border-radius: 3px;
}
.editor-dirty {
    color: #f9e2af;
}
.editor-saved {
    color: #a6e3a1;
}
.editor-savefail {
    color: #f38ba8;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.editor-hint {
    margin-left: auto;
    color: #585b70;
    font-size: 10px;
}
.editor-loading, .editor-error {
    padding: 20px;
    text-align: center;
    color: #a6adc8;
}
.editor-error {
    color: #f38ba8;
}

.editor-area {
    flex: 1;
    display: flex;
    overflow: hidden;
    position: relative;
}

/* Binary gate */
.editor-gate {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 24px;
    text-align: center;
}
.editor-gate-icon { color: #f9e2af; }
.editor-gate-title { color: #f9e2af; font-size: 14px; font-weight: 600; }
.editor-gate-text { margin: 0; max-width: 420px; color: #a6adc8; font-size: 12px; line-height: 1.6; }
.editor-gate-text code { color: #cdd6f4; }
.editor-gate-btn {
    margin-top: 6px;
    padding: 8px 22px;
    border: none;
    border-radius: 6px;
    background: #89b4fa;
    color: #11111b;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
}
.editor-gate-btn:hover { background: #74a8f5; }

/* Unsaved-changes prompt */
.editor-confirm-overlay {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(17, 17, 27, 0.72);
}
.editor-confirm {
    max-width: 420px;
    padding: 18px 20px;
    border: 1px solid #45475a;
    border-radius: 10px;
    background: #1e1e2e;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
}
.editor-confirm-title { color: #f9e2af; font-size: 14px; font-weight: 600; margin-bottom: 8px; }
.editor-confirm-text { margin: 0 0 16px; color: #a6adc8; font-size: 12px; line-height: 1.6; }
.editor-confirm-text code { color: #cdd6f4; }
.editor-confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }
.editor-confirm-btn {
    padding: 7px 14px;
    border: none;
    border-radius: 6px;
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
}
.editor-confirm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.editor-confirm-save { background: #89b4fa; color: #11111b; }
.editor-confirm-save:hover:not(:disabled) { background: #74a8f5; }
.editor-confirm-discard { background: rgba(243, 139, 168, 0.15); color: #f38ba8; }
.editor-confirm-discard:hover { background: rgba(243, 139, 168, 0.28); }
.editor-confirm-cancel { background: rgba(255, 255, 255, 0.08); color: #cdd6f4; }
.editor-confirm-cancel:hover { background: rgba(255, 255, 255, 0.15); }

.editor-linenums {
    flex-shrink: 0;
    width: 44px;
    overflow: hidden;
    background: #181825;
    border-right: 1px solid #313244;
    text-align: right;
    padding: 0 8px;
    user-select: none;
}
.editor-linenum {
    color: #585b70;
    /* Same grid as the text layers. */
    font-size: var(--ed-size);
    line-height: var(--ed-line);
}

.editor-container {
    flex: 1;
    position: relative;
    overflow: hidden;
}

.editor-highlight,
.editor-textarea {
    position: absolute;
    inset: 0;
    margin: 0;
    padding: 0 8px;
    font-family: var(--ed-font);
    font-size: var(--ed-size);
    line-height: var(--ed-line);
    tab-size: var(--ed-tab);
    -moz-tab-size: var(--ed-tab);
    letter-spacing: normal;
    word-spacing: normal;
    white-space: pre;
    overflow: auto;
    word-wrap: normal;
}

.editor-highlight {
    pointer-events: none;
    z-index: 1;
    color: #cdd6f4;
    background: transparent;
    border: none;
    /* Scrolled from syncScroll, which still works on a hidden overflow. With `auto`
       this layer grew its own scrollbars, and a scrollbar on one layer but not the
       other shifts its content out of step. */
    overflow: hidden;
}

.editor-textarea {
    z-index: 2;
    color: transparent;
    caret-color: #f5e0dc;
    background: transparent;
    border: none;
    outline: none;
    resize: none;
    -webkit-text-fill-color: transparent;
}

/* Override Prism theme for our dark background */
:deep(.editor-highlight) {
    background: #1e1e2e !important;
}

/* The theme targets `code[class*="language-"]` directly, so the rules on
   .editor-highlight never reach the <code> inside it and Prism's own font-family,
   line-height 1.5 and tab-size 4 win. Pin them to the textarea's values. */
:deep(.editor-highlight code) {
    font-family: var(--ed-font);
    font-size: var(--ed-size);
    line-height: var(--ed-line);
    tab-size: var(--ed-tab);
    -moz-tab-size: var(--ed-tab);
    letter-spacing: normal;
    word-spacing: normal;
    white-space: pre;
    padding: 0;
    text-shadow: none;
    background: transparent !important;
}
</style>

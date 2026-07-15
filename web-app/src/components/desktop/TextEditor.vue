<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch, nextTick } from 'vue';
import Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.css';

const props = defineProps({
    sessionId: Number,
    filePath: String,
    fileName: String
});

const emit = defineEmits(['saved']);

const content = ref('');
const originalContent = ref('');
const loading = ref(true);
const error = ref('');
const saving = ref(false);
const savedMsg = ref('');
const textareaRef = ref(null);
const preRef = ref(null);
const lineNumbersRef = ref(null);

const dirty = computed(() => content.value !== originalContent.value);

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

const highlightedHtml = computed(() => {
    if (!content.value) return '';
    try {
        if (language.value === 'plain' || !Prism.languages[language.value]) {
            return escapeHtml(content.value);
        }
        return Prism.highlight(content.value, Prism.languages[language.value], language.value);
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

function loadFile() {
    loading.value = true;
    error.value = '';

    if (window.app) {
        window.app.ssh.sftp.read(props.sessionId, props.filePath);
    }

    const handler = (msg) => {
        if (msg.method === 'ssh.sftp.readResult' &&
            msg.data.sessionId === props.sessionId &&
            msg.data.path === props.filePath) {
            if (msg.data.error) {
                error.value = msg.data.error;
                loading.value = false;
            } else {
                content.value = msg.data.content || '';
                originalContent.value = content.value;
                loading.value = false;
                nextTick(() => {
                    syncScroll();
                    updateLineNumbers();
                });
            }
        }
    };

    if (window.app) {
        window.app.recieve(handler);
    }
}

function saveFile() {
    if (!dirty.value) return;
    saving.value = true;
    savedMsg.value = '';

    if (window.app) {
        window.app.ssh.sftp.write(props.sessionId, props.filePath, content.value);
    }

    const handler = (msg) => {
        if (msg.method === 'ssh.sftp.writeResult' &&
            msg.data.sessionId === props.sessionId &&
            msg.data.path === props.filePath) {
            saving.value = false;
            if (msg.data.error) {
                error.value = msg.data.error;
            } else {
                originalContent.value = content.value;
                savedMsg.value = 'Saved ✓';
                setTimeout(() => { savedMsg.value = ''; }, 2000);
                emit('saved', props.filePath);
            }
        }
    };

    if (window.app) {
        window.app.recieve(handler);
    }
}

function onInput() {
    nextTick(() => {
        syncScroll();
        updateLineNumbers();
    });
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

function updateLineNumbers() {
    // Line numbers are computed from lineCount
}

function onKeydown(e) {
    // Tab key
    if (e.key === 'Tab') {
        e.preventDefault();
        const ta = textareaRef.value;
        if (!ta) return;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        content.value = content.value.substring(0, start) + '  ' + content.value.substring(end);
        nextTick(() => {
            ta.selectionStart = ta.selectionEnd = start + 2;
        });
    }
    // Ctrl+S / Cmd+S
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveFile();
    }
}

onMounted(() => {
    if (props.filePath) {
        loadFile();
    }
});
</script>

<template>
    <div class="editor">
        <!-- Status bar -->
        <div class="editor-status">
            <span class="editor-file">{{ fileName || filePath }}</span>
            <span class="editor-lang">{{ language }}</span>
            <span v-if="dirty" class="editor-dirty">● modified</span>
            <span v-if="savedMsg" class="editor-saved">{{ savedMsg }}</span>
            <span class="editor-hint">Ctrl+S to save</span>
        </div>

        <!-- Loading -->
        <div v-if="loading" class="editor-loading">Loading {{ fileName }}...</div>

        <!-- Error -->
        <div v-if="error" class="editor-error">{{ error }}</div>

        <!-- Editor area -->
        <div v-if="!loading && !error" class="editor-area">
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
                    @input="onInput"
                    @scroll="onScroll"
                    @keydown="onKeydown"
                ></textarea>
            </div>
        </div>
    </div>
</template>

<style scoped>
.editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', monospace;
    font-size: 13px;
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
    font-size: 13px;
    line-height: 1.55;
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
    font-family: inherit;
    font-size: 13px;
    line-height: 1.55;
    tab-size: 2;
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
:deep(.editor-highlight code) {
    background: transparent !important;
}
</style>

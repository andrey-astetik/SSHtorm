<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { ssh } from '../../stores/ssh.js';

const props = defineProps({
    connectedSessionId: Number
});

const emit = defineEmits(['open-terminal', 'open-files', 'open-connect', 'open-monitor', 'open-browser', 'open-docker', 'open-notes', 'disconnect']);

const query = ref('');
const visible = ref(false);
const selectedIndex = ref(0);
const inputRef = ref(null);
const listRef = ref(null);

const isConnected = computed(() =>
    ssh.state.activeSessionId && ssh.state.sessions[ssh.state.activeSessionId]?.connected
);

const hostLabel = computed(() => {
    if (!isConnected.value) return '';
    const sid = ssh.state.activeSessionId;
    const s = ssh.state.sessions[sid];
    return s ? (s.label || `${s.user}@${s.host}`) : '';
});

const allActions = computed(() => {
    const items = [];

    if (isConnected.value) {
        items.push(
            { id: 'terminal',    icon: '⌨️',  label: 'Terminal',        desc: 'Open SSH terminal',               visible: true },
            { id: 'files',       icon: '📁',  label: 'File Explorer',   desc: 'Browse remote files (SFTP)',       visible: true },
            { id: 'monitor',     icon: '📊',  label: 'System Monitor',  desc: 'CPU, RAM, processes, kill',        visible: true },
            { id: 'browser',     icon: '🌐',  label: 'Browser',         desc: 'Web browser tunnelled over SSH',   visible: true },
            { id: 'docker',      icon: '🐳',  label: 'Docker',          desc: 'Manage containers & images',       visible: true },
            { id: 'notes',       icon: '📝',  label: 'Notes',           desc: `Notes for ${hostLabel.value} (saved locally)`, visible: true },
            { id: 'disconnect',  icon: '🔌',  label: 'Disconnect',      desc: `Disconnect from ${hostLabel.value}`, visible: true }
        );
    } else {
        items.push(
            { id: 'connect',     icon: '🔗',  label: 'Connect SSH',     desc: 'Connect to a remote server',       visible: true }
        );
    }

    items.push(
        { id: 'quit',           icon: '⏻',  label: 'Quit SSH Desktop', desc: 'Exit application',                 visible: true }
    );

    return items;
});

const filteredActions = computed(() => {
    const q = query.value.toLowerCase().trim();
    if (!q) return allActions.value.filter(a => a.visible);
    return allActions.value.filter(a =>
        a.visible && (
            a.label.toLowerCase().includes(q) ||
            a.desc.toLowerCase().includes(q)
        )
    );
});

function open() {
    visible.value = true;
    query.value = '';
    selectedIndex.value = 0;
    nextTick(() => {
        inputRef.value?.focus();
    });
}

function close() {
    visible.value = false;
    query.value = '';
}

function selectAction(action) {
    switch (action.id) {
        case 'terminal':   emit('open-terminal');   break;
        case 'files':      emit('open-files');      break;
        case 'monitor':    emit('open-monitor');    break;
        case 'browser':    emit('open-browser');    break;
        case 'docker':     emit('open-docker');     break;
        case 'notes':      emit('open-notes');      break;
        case 'connect':    emit('open-connect');    break;
        case 'disconnect': emit('disconnect');       break;
        case 'quit':
            if (window.app) window.app.quit();
            break;
    }
    close();
}

function onKeydown(e) {
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex.value = Math.min(selectedIndex.value + 1, filteredActions.value.length - 1);
        scrollToSelected();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex.value = Math.max(selectedIndex.value - 1, 0);
        scrollToSelected();
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredActions.value[selectedIndex.value]) {
            selectAction(filteredActions.value[selectedIndex.value]);
        }
    } else if (e.key === 'Escape') {
        close();
    }
}

function scrollToSelected() {
    nextTick(() => {
        const el = listRef.value?.children[selectedIndex.value];
        if (el) el.scrollIntoView({ block: 'nearest' });
    });
}

watch(query, () => {
    selectedIndex.value = 0;
});

// Global hotkey: Cmd+K or Ctrl+K
function onGlobalKeydown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (visible.value) {
            close();
        } else {
            open();
        }
    }
}

onMounted(() => {
    window.addEventListener('keydown', onGlobalKeydown);
});
onBeforeUnmount(() => {
    window.removeEventListener('keydown', onGlobalKeydown);
});

// Expose open method for parent (taskbar button)
defineExpose({ open, close });
</script>

<template>
    <!-- Backdrop -->
    <div
        v-if="visible"
        class="launcher-backdrop"
        @mousedown="close"
    />

    <!-- Launcher bar -->
    <div v-if="visible" class="launcher">
        <div class="launcher-input-wrap">
            <span class="launcher-icon">🔍</span>
            <input
                ref="inputRef"
                v-model="query"
                class="launcher-input"
                type="text"
                placeholder="Type a command..."
                @keydown="onKeydown"
            />
        </div>

        <!-- Dropdown -->
        <div ref="listRef" class="launcher-dropdown">
            <div
                v-for="(action, i) in filteredActions"
                :key="action.id"
                class="launcher-item"
                :class="{ 'launcher-item-selected': i === selectedIndex }"
                @click="selectAction(action)"
                @mouseenter="selectedIndex = i"
            >
                <span class="launcher-item-icon">{{ action.icon }}</span>
                <div class="launcher-item-text">
                    <span class="launcher-item-label">{{ action.label }}</span>
                    <span class="launcher-item-desc">{{ action.desc }}</span>
                </div>
            </div>
        </div>
    </div>

    <!-- Hotkey hint (visible only when launcher is closed) -->
    <div v-if="!visible" class="launcher-hint">
        Press <kbd>⌘</kbd> <kbd>K</kbd> to open launcher
    </div>
</template>

<style scoped>
.launcher {
    position: absolute;
    top: 38%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 15000;
    width: 420px;
    max-width: 90vw;
}
.launcher-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px);
    z-index: 14000;
    animation: fadeIn 0.12s ease;
}
@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}
.launcher-input-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: rgba(24, 24, 37, 0.97);
    border: 1px solid rgba(137, 180, 250, 0.4);
    border-radius: 12px 12px 0 0;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
}
.launcher-icon {
    font-size: 18px;
    flex-shrink: 0;
    opacity: 0.7;
}
.launcher-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: #cdd6f4;
    font-size: 16px;
    font-family: inherit;
    width: 100%;
}
.launcher-input::placeholder {
    color: #6c7086;
}
.launcher-dropdown {
    background: rgba(24, 24, 37, 0.97);
    border: 1px solid rgba(137, 180, 250, 0.4);
    border-top: 1px solid rgba(255,255,255,0.04);
    border-radius: 0 0 12px 12px;
    overflow: hidden;
    max-height: 260px;
    overflow-y: auto;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
}
.launcher-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    cursor: pointer;
    transition: background 0.1s;
}
.launcher-item:last-child {
    padding-bottom: 14px;
}
.launcher-item:hover,
.launcher-item-selected {
    background: rgba(137, 180, 250, 0.14);
}
.launcher-item-icon {
    font-size: 22px;
    flex-shrink: 0;
    width: 32px;
    text-align: center;
}
.launcher-item-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.launcher-item-label {
    font-size: 14px;
    font-weight: 500;
    color: #cdd6f4;
}
.launcher-item-desc {
    font-size: 12px;
    color: #a6adc8;
}

.launcher-hint {
    position: fixed;
    bottom: 60px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1;
    font-size: 13px;
    color: rgba(205, 214, 244, 0.25);
    pointer-events: none;
    user-select: none;
}
.launcher-hint kbd {
    display: inline-block;
    padding: 1px 6px;
    font-size: 11px;
    font-family: inherit;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 4px;
    color: rgba(205, 214, 244, 0.4);
}
</style>

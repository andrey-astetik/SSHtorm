<script setup>
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { windowManager } from '../../stores/windows.js';
import { ssh } from '../../stores/ssh.js';

const clock = ref(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
const nativeMaximized = ref(false);
const currentActiveSid = ref(null);
let clockTimer = null;

// Sync activeSessionId to a local ref (bypasses possible reactivity issues with store)
watch(() => ssh.state.activeSessionId, v => currentActiveSid.value = v, { immediate: true });

onMounted(async () => {
    clockTimer = setInterval(() => {
        clock.value = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }, 1000);
    const onNativeMax = () => { nativeMaximized.value = !!window.__nativeMaximized; };
    window.addEventListener('native-max-changed', onNativeMax);
    if (window.app) {
        try { nativeMaximized.value = await window.app.getNativeMaxState(); } catch (e) {}
    }
});
onBeforeUnmount(() => {
    if (clockTimer) clearInterval(clockTimer);
});

// Include minimized windows too — otherwise a minimized window has no taskbar
// entry and can never be restored (minimize would look like close).
const openWindows = computed(() =>
    windowManager.state.windows.filter(w => w.sessionId === currentActiveSid.value)
);
const connected = computed(() =>
    ssh.state.activeSessionId && ssh.state.sessions[ssh.state.activeSessionId]?.connected
);
const windowMaximized = computed(() => nativeMaximized.value);
const pad = computed(() => windowMaximized.value ? '0.5rem' : '4.5rem');

function focusWindow(id) { windowManager.focusWindow(id); }
function togglePanel() { ssh.state.showConnectionPanel = !ssh.state.showConnectionPanel; }
</script>

<template>
    <div
        class="fixed top-0 left-0 right-0 h-9 bg-[#11111b] flex items-center select-none z-[10000]"
        :style="{ paddingLeft: pad, paddingRight: '0.5rem', WebkitAppRegion: 'drag', appRegion: 'drag', transition: 'padding-left 0.2s ease' }"
    >
        <button
            class="h-6 shrink-0 px-2 border-none rounded text-xs cursor-pointer transition-colors bg-transparent text-[#6c7086] hover:bg-white/5 hover:text-[#a6adc8]"
            style="-webkit-app-region: no-drag; app-region: no-drag;"
            @click="togglePanel"
            title="Connections"
        >☰</button>

        <div class="flex-1 flex items-center gap-0.5 mx-2 overflow-x-auto">
            <button
                v-for="win in openWindows"
                :key="win.id"
                class="h-6 shrink-0 px-2.5 border-none rounded text-xs cursor-pointer truncate max-w-[160px] transition-colors"
                :class="[
                    windowManager.state.activeWindowId === win.id && !win.minimized
                        ? 'bg-white/10 text-[#cdd6f4]'
                        : 'bg-transparent text-[#6c7086] hover:bg-white/5 hover:text-[#a6adc8]',
                    win.minimized ? 'italic opacity-60' : ''
                ]"
                style="-webkit-app-region: no-drag; app-region: no-drag;"
                :title="(win.minimized ? 'Restore ' : '') + win.title + ' — double-click to center'"
                @click="focusWindow(win.id)"
                @dblclick="windowManager.centerWindow(win.id)"
            >{{ win.title }}</button>
        </div>

        <div class="flex items-center gap-2.5 shrink-0" style="-webkit-app-region: no-drag; app-region: no-drag;">
            <span class="text-[11px]" :class="connected ? 'text-[#a6e3a1]' : 'text-[#585b70]'">{{ connected ? '●' : '○' }}</span>
            <span class="text-xs text-[#a6adc8] tabular-nums">{{ clock }}</span>
        </div>
    </div>
</template>

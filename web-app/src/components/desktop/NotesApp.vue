<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';

// Per-host scratchpad. Persisted (encrypted) in the vault, keyed by the session's
// host, so each server keeps its own notes and they survive restarts.
const props = defineProps({
    sessionId: { type: [Number, String], default: null }
});

const text = ref('');
const status = ref('');   // '' | 'saving' | 'saved' | 'error'
let loaded = false;
let savedValue = '';      // last value known to be persisted (avoids no-op saves)
let saveTimer = null;

onMounted(async () => {
    if (window.app?.notes) {
        try { text.value = (await window.app.notes.load(props.sessionId)) || ''; } catch (e) {}
    }
    savedValue = text.value;
    loaded = true;
});

async function save() {
    if (!window.app?.notes) { status.value = 'error'; return; }
    const pending = text.value;
    try {
        const res = await window.app.notes.save(props.sessionId, pending);
        if (res?.ok) { savedValue = pending; status.value = 'saved'; }
        else status.value = 'error';
    } catch (e) { status.value = 'error'; }
    if (status.value === 'saved') setTimeout(() => { if (status.value === 'saved') status.value = ''; }, 1500);
}

watch(text, () => {
    if (!loaded || text.value === savedValue) return;   // skip load-assignment + no-op edits
    status.value = 'saving';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 500);
});

onBeforeUnmount(() => {
    clearTimeout(saveTimer);
    if (loaded && text.value !== savedValue && window.app?.notes) window.app.notes.save(props.sessionId, text.value);   // flush unsaved on close
});
</script>

<template>
    <div class="flex flex-col h-full bg-[#1e1e2e] text-[#cdd6f4]">
        <div class="flex items-center justify-between px-3 py-1.5 bg-[#181825] border-b border-[#313244] shrink-0">
            <span class="text-xs text-[#a6adc8]">Stored locally &amp; encrypted in the vault</span>
            <span class="text-[10px]"
                :class="status==='saved' ? 'text-[#a6e3a1]' : status==='saving' ? 'text-[#f9e2af]' : status==='error' ? 'text-[#f38ba8]' : 'text-transparent'">
                {{ status==='saved' ? 'saved' : status==='saving' ? 'saving…' : status==='error' ? 'save failed' : '·' }}
            </span>
        </div>
        <textarea
            v-model="text"
            class="selectable flex-1 w-full resize-none bg-[#1e1e2e] text-[#cdd6f4] text-[13px] font-mono leading-relaxed p-3 outline-none placeholder:text-[#585b70]"
            spellcheck="false"
            placeholder="Scratchpad — creds, port maps, commands…&#10;Persists between sessions on this machine."
        />
    </div>
</template>

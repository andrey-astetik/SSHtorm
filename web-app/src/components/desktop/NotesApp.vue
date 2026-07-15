<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';

const props = defineProps({
    sessionId: { type: [Number, String], default: null }
});

const text = ref('');
let loaded = false;
let savedValue = '';
let saveTimer = null;

onMounted(async () => {
    if (window.app?.notes) {
        try { text.value = (await window.app.notes.load(props.sessionId)) || ''; } catch (e) {}
    }
    savedValue = text.value;
    loaded = true;
});

function save() {
    if (!window.app?.notes) return;
    const pending = text.value;
    window.app.notes.save(props.sessionId, pending);
    savedValue = pending;
}

watch(text, () => {
    if (!loaded || text.value === savedValue) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 500);
});

onBeforeUnmount(() => {
    clearTimeout(saveTimer);
    if (loaded && text.value !== savedValue) save();
});
</script>

<template>
    <textarea
        v-model="text"
        class="notes-area"
        spellcheck="false"
        placeholder="Scratchpad — creds, port maps, commands…"
    />
</template>

<style scoped>
.notes-area {
    width: 100%; height: 100%; resize: none;
    padding: 12px; border: none; outline: none;
    background: #1e1e2e; color: #cdd6f4;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px; line-height: 1.55;
}
.notes-area::placeholder { color: #585b70; }
</style>

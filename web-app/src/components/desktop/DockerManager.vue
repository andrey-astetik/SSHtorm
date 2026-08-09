<script setup>
import { ref, onMounted, onBeforeUnmount, inject, computed } from 'vue';
import PlayFilledIcon from '../../compAst/icons/PlayFilled.vue';
import StopFilledIcon from '../../compAst/icons/StopFilled.vue';
import RepeatIcon from '../../compAst/icons/Repeat.vue';
import NoteIcon from '../../compAst/icons/Note.vue';
import ChevronRightIcon from '../../compAst/icons/ChevronRight.vue';
import TrashIcon from '../../compAst/icons/Trash.vue';

const props = defineProps({ sessionId: Number });
const openTerminalCmd = inject('openTerminalCmd', null);
// From WindowFrame; always visible when rendered standalone.
const visible = inject('windowVisible', computed(() => true));

const tab = ref('containers');           // 'containers' | 'images'
const status = ref('checking');          // 'checking' | 'ok' | 'unavailable'
const dockerError = ref('');
const version = ref('');
const containers = ref([]);
const images = ref([]);
const stats = ref({});
const busy = ref(null);                   // id currently acting on
const autoRefresh = ref(true);
let timer = null;

const running = (c) => c.State === 'running' || /^Up/i.test(c.Status || '');

async function check() {
    if (!window.app) { status.value = 'unavailable'; dockerError.value = 'Not running in app'; return; }
    const r = await window.app.docker.available(props.sessionId);
    if (r?.available) { status.value = 'ok'; version.value = r.version || ''; load(); }
    else { status.value = 'unavailable'; dockerError.value = r?.error || 'Docker is not available'; }
}

async function load() {
    if (status.value !== 'ok' || !window.app) return;
    const [ps, st] = await Promise.all([
        window.app.docker.ps(props.sessionId),
        window.app.docker.stats(props.sessionId)
    ]);
    if (ps?.containers) containers.value = ps.containers;
    else if (ps?.error) dockerError.value = ps.error;
    stats.value = st?.stats || {};
    if (tab.value === 'images') {
        const im = await window.app.docker.images(props.sessionId);
        if (im?.images) images.value = im.images;
    }
}

async function loadImages() {
    if (status.value !== 'ok' || !window.app) return;
    const im = await window.app.docker.images(props.sessionId);
    if (im?.images) images.value = im.images;
}

async function act(action, id) {
    if (!window.app) return;
    busy.value = id;
    const r = await window.app.docker.action(props.sessionId, action, id);
    busy.value = null;
    if (r?.error) { dockerError.value = r.error; setTimeout(() => { if (dockerError.value === r.error) dockerError.value = ''; }, 4000); }
    load();
}

function logs(c) {
    if (openTerminalCmd) openTerminalCmd(`docker logs -f --tail 500 ${c.ID}`, `logs: ${shortName(c)}`, props.sessionId);
}
function shell(c) {
    // bash if present, else sh
    if (openTerminalCmd) openTerminalCmd(`docker exec -it ${c.ID} sh -c 'command -v bash >/dev/null 2>&1 && exec bash || exec sh'`, `sh: ${shortName(c)}`, props.sessionId);
}

function shortName(c) { return (c.Names || c.ID || '').split(',')[0]; }
function cpu(c) { return stats.value[shortName(c)]?.CPUPerc || '-'; }
function mem(c) { return stats.value[shortName(c)]?.MemPerc || '-'; }

function setTab(t) { tab.value = t; if (t === 'images') loadImages(); }

onMounted(() => {
    check();
    // Windows of a non-active session stay mounted but must not keep polling.
    timer = setInterval(() => { if (visible.value && autoRefresh.value && status.value === 'ok') load(); }, 4000);
});
onBeforeUnmount(() => { if (timer) clearInterval(timer); });
</script>

<template>
    <div class="flex flex-col h-full text-[#cdd6f4] text-[13px] bg-[#1e1e2e]">
        <!-- Header -->
        <div class="flex items-center gap-2 px-3 py-2 bg-[#181825] border-b border-[#313244] shrink-0">
            <span class="text-base">🐳</span>
            <div class="flex gap-1">
                <button class="px-2.5 py-1 text-xs rounded transition-colors"
                    :class="tab === 'containers' ? 'bg-[#89b4fa]/15 text-[#89b4fa]' : 'text-[#a6adc8] hover:bg-white/5'"
                    @click="setTab('containers')">Containers</button>
                <button class="px-2.5 py-1 text-xs rounded transition-colors"
                    :class="tab === 'images' ? 'bg-[#89b4fa]/15 text-[#89b4fa]' : 'text-[#a6adc8] hover:bg-white/5'"
                    @click="setTab('images')">Images</button>
            </div>
            <span v-if="version" class="font-mono text-[10px] text-[#6c7086] ml-1">v{{ version }}</span>
            <div class="ml-auto flex items-center gap-2">
                <label class="flex items-center gap-1 text-[11px] text-[#a6adc8] cursor-pointer select-none">
                    <input type="checkbox" v-model="autoRefresh" class="accent-[#89b4fa]" /> auto
                </label>
                <button class="dk-btn" title="Refresh" @click="load(); tab==='images' && loadImages()"><RepeatIcon size="0.95em" /></button>
            </div>
        </div>

        <div v-if="dockerError" class="px-3 py-1.5 bg-[#f38ba8]/10 text-[#f38ba8] text-[11px] border-b border-[#313244] shrink-0">{{ dockerError }}</div>

        <!-- Unavailable -->
        <div v-if="status === 'unavailable'" class="flex-1 flex flex-col items-center justify-center text-center px-6 text-[#a6adc8]">
            <span class="text-3xl mb-2">🐳</span>
            <div class="text-sm text-[#cdd6f4] mb-1">Docker unavailable</div>
            <div class="text-xs max-w-[420px]">{{ dockerError }}</div>
            <button class="mt-3 px-3 py-1.5 text-xs bg-white/5 rounded hover:bg-white/10 transition-colors" @click="check">Retry</button>
        </div>
        <div v-else-if="status === 'checking'" class="flex-1 flex items-center justify-center text-[#a6adc8] text-xs">Checking Docker…</div>

        <!-- Containers -->
        <div v-else-if="tab === 'containers'" class="flex-1 overflow-y-auto">
            <div v-if="containers.length === 0" class="p-6 text-center text-[#a6adc8] text-xs">No containers</div>
            <table v-else class="w-full text-[12px]">
                <thead class="text-[#a6adc8] text-[10px] uppercase sticky top-0 bg-[#1e1e2e]">
                    <tr class="border-b border-[#313244]">
                        <th class="text-left font-normal px-3 py-1.5">Name</th>
                        <th class="text-left font-normal px-2 py-1.5">Image</th>
                        <th class="text-left font-normal px-2 py-1.5">Status</th>
                        <th class="text-right font-normal px-2 py-1.5">CPU</th>
                        <th class="text-right font-normal px-2 py-1.5">Mem</th>
                        <th class="text-right font-normal px-3 py-1.5">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="c in containers" :key="c.ID" class="border-b border-white/[0.03] hover:bg-white/[0.02]">
                        <td class="px-3 py-1.5">
                            <div class="flex items-center gap-1.5">
                                <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="running(c) ? 'bg-[#a6e3a1]' : 'bg-[#585b70]'" />
                                <span class="truncate max-w-[140px]" :title="shortName(c)">{{ shortName(c) }}</span>
                            </div>
                        </td>
                        <td class="px-2 py-1.5 text-[#a6adc8] truncate max-w-[150px]" :title="c.Image">{{ c.Image }}</td>
                        <td class="px-2 py-1.5 text-[#a6adc8] truncate max-w-[140px]" :title="c.Status">{{ c.Status }}</td>
                        <td class="px-2 py-1.5 text-right font-mono text-[11px] text-[#a6adc8]">{{ cpu(c) }}</td>
                        <td class="px-2 py-1.5 text-right font-mono text-[11px] text-[#a6adc8]">{{ mem(c) }}</td>
                        <td class="px-3 py-1.5">
                            <div class="flex items-center justify-end gap-1" :class="{ 'opacity-40 pointer-events-none': busy === c.ID }">
                                <button v-if="!running(c)" class="dk-btn text-[#a6e3a1]" title="Start" @click="act('start', c.ID)"><PlayFilledIcon size="0.95em" /></button>
                                <button v-if="running(c)" class="dk-btn text-[#f9e2af]" title="Stop" @click="act('stop', c.ID)"><StopFilledIcon size="0.95em" /></button>
                                <button v-if="running(c)" class="dk-btn text-[#89b4fa]" title="Restart" @click="act('restart', c.ID)"><RepeatIcon size="0.95em" /></button>
                                <button class="dk-btn" title="Logs" @click="logs(c)"><NoteIcon size="0.95em" /></button>
                                <button v-if="running(c)" class="dk-btn" title="Shell" @click="shell(c)"><ChevronRightIcon size="0.95em" /></button>
                                <button class="dk-btn text-[#f38ba8]" title="Remove" @click="act('remove', c.ID)"><TrashIcon size="0.95em" /></button>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- Images -->
        <div v-else class="flex-1 overflow-y-auto">
            <div v-if="images.length === 0" class="p-6 text-center text-[#a6adc8] text-xs">No images</div>
            <table v-else class="w-full text-[12px]">
                <thead class="text-[#a6adc8] text-[10px] uppercase sticky top-0 bg-[#1e1e2e]">
                    <tr class="border-b border-[#313244]">
                        <th class="text-left font-normal px-3 py-1.5">Repository</th>
                        <th class="text-left font-normal px-2 py-1.5">Tag</th>
                        <th class="text-left font-normal px-2 py-1.5">ID</th>
                        <th class="text-right font-normal px-2 py-1.5">Size</th>
                        <th class="text-right font-normal px-3 py-1.5"></th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="im in images" :key="im.ID + im.Repository + im.Tag" class="border-b border-white/[0.03] hover:bg-white/[0.02]">
                        <td class="px-3 py-1.5 truncate max-w-[200px]" :title="im.Repository">{{ im.Repository }}</td>
                        <td class="px-2 py-1.5 text-[#a6adc8]">{{ im.Tag }}</td>
                        <td class="px-2 py-1.5 font-mono text-[11px] text-[#a6adc8]">{{ im.ID }}</td>
                        <td class="px-2 py-1.5 text-right text-[#a6adc8]">{{ im.Size }}</td>
                        <td class="px-3 py-1.5" :class="{ 'opacity-40 pointer-events-none': busy === im.ID }">
                            <div class="flex justify-end">
                                <button class="dk-btn text-[#f38ba8]" title="Remove image" @click="act('image-remove', im.ID)"><TrashIcon size="0.95em" /></button>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>

<style scoped>
.dk-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.05);
    transition: background 0.12s;
    cursor: pointer;
}
.dk-btn:hover { background: rgba(255, 255, 255, 0.12); }
</style>

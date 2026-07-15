<script setup>
import { ref, computed, watch } from 'vue';
import { ssh } from '../../stores/ssh.js';
import CloseIcon from '../../compAst/icons/Close.vue';
import ConnectionsIcon from '../../compAst/icons/Connections.vue';
import PlusIcon from '../../compAst/icons/Plus.vue';
import NoteIcon from '../../compAst/icons/Note.vue';
import LogOutIcon from '../../compAst/icons/LogOut.vue';
import CheckIcon from '../../compAst/icons/Check.vue';
import BranchIcon from '../../compAst/icons/Branch.vue';
import TrashIcon from '../../compAst/icons/Trash.vue';
import CopyIcon from '../../compAst/icons/Copy.vue';

const emit = defineEmits(['close']);

const noteText = ref('');
const editingNote = ref(null);

const sessions = computed(() => Object.values(ssh.state.sessions));
const activeSid = computed(() => ssh.state.activeSessionId);
const activeSession = computed(() => activeSid.value ? ssh.state.sessions[activeSid.value] : null);

function switchTo(sid) { ssh.state.activeSessionId = sid; }

// ── Port forwarding (ssh -L) for the active session ──
const forwards = ref([]);
const fwLocal = ref('');
const fwHost = ref('localhost');
const fwPort = ref('');
const fwError = ref('');
const copied = ref(null);

async function refreshForwards() {
    if (!activeSid.value || !window.app) { forwards.value = []; return; }
    try { forwards.value = await window.app.forward.list(activeSid.value); } catch (e) { forwards.value = []; }
}
watch(activeSid, refreshForwards, { immediate: true });

async function addForward() {
    fwError.value = '';
    if (!activeSid.value || !activeSession.value?.connected) { fwError.value = 'No connected session'; return; }
    const rport = parseInt(fwPort.value, 10);
    if (!rport) { fwError.value = 'Remote port required'; return; }
    if (!window.app) return;
    const res = await window.app.forward.add(
        activeSid.value,
        fwLocal.value ? parseInt(fwLocal.value, 10) : 0,
        (fwHost.value || 'localhost').trim(),
        rport
    );
    if (res?.error) { fwError.value = res.error; return; }
    fwLocal.value = ''; fwPort.value = '';
    refreshForwards();
}

async function removeForward(id) {
    if (!window.app) return;
    await window.app.forward.remove(activeSid.value, id);
    refreshForwards();
}

function copyForward(f) {
    const text = `localhost:${f.localPort}`;
    navigator.clipboard?.writeText(text);
    copied.value = f.id;
    setTimeout(() => { if (copied.value === f.id) copied.value = null; }, 1200);
}
function disconnectSid(sid) { ssh.disconnect(sid); }

function startEditNote(sid) {
    const s = ssh.state.sessions[sid];
    editingNote.value = sid;
    noteText.value = (s && s.note) || '';
}
function saveNote() {
    const sid = editingNote.value;
    if (sid && ssh.state.sessions[sid]) ssh.state.sessions[sid].note = noteText.value;
    editingNote.value = null; noteText.value = '';
}
function cancelNote() { editingNote.value = null; noteText.value = ''; }
function openConnect() { ssh.state.showConnectDialog = true; }
</script>

<template>
    <div class="w-[260px] h-full bg-[#181825] border-r border-[#313244] flex flex-col select-none overflow-hidden">
        <!-- Header -->
        <div class="flex items-center justify-between px-3 py-2.5 border-b border-[#313244] shrink-0">
            <div class="flex items-center gap-2 text-[#89b4fa]">
                <ConnectionsIcon size="1.1em" />
                <span class="font-semibold text-sm text-[#cdd6f4]">Connections</span>
            </div>
            <button class="text-[#a6adc8] hover:text-[#cdd6f4] hover:bg-white/5 p-1 rounded transition-colors" @click="$emit('close')">
                <CloseIcon size="0.9em" />
            </button>
        </div>

        <!-- Session list -->
        <div class="flex-1 overflow-y-auto py-1.5">
            <div v-if="sessions.length === 0" class="px-3 py-8 text-center text-xs text-[#6c7086]">
                No connections yet
            </div>
            <div
                v-for="s in sessions"
                :key="s.id"
                class="px-3 py-2 cursor-pointer transition-colors border-l-[3px]"
                :class="s.id === activeSid
                    ? 'bg-[#89b4fa]/8 border-l-[#89b4fa]'
                    : 'border-l-transparent hover:bg-white/[0.03]'"
                @click="switchTo(s.id)"
            >
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2 min-w-0">
                        <span class="w-2 h-2 rounded-full shrink-0" :class="s.connected ? 'bg-[#a6e3a1]' : 'bg-[#585b70]'" />
                        <span class="font-mono text-xs truncate text-[#cdd6f4]">{{ s.user }}@{{ s.host }}</span>
                    </div>
                    <div class="flex items-center gap-0.5 shrink-0 ml-2">
                        <button class="text-[#a6adc8] hover:text-[#cdd6f4] hover:bg-white/5 p-1 rounded transition-colors" title="Note" @click.stop="startEditNote(s.id)">
                            <NoteIcon size="0.9em" />
                        </button>
                        <button class="text-[#a6adc8] hover:text-[#f38ba8] hover:bg-[#f38ba8]/10 p-1 rounded transition-colors" title="Disconnect" @click.stop="disconnectSid(s.id)">
                            <LogOutIcon size="0.9em" />
                        </button>
                    </div>
                </div>
                <div v-if="s.note && editingNote !== s.id" class="text-[11px] text-[#a6adc8] italic truncate mt-0.5 ml-4">{{ s.note }}</div>
            </div>
        </div>

        <!-- Port forwarding (active session) -->
        <div v-if="activeSession && activeSession.connected" class="border-t border-[#313244] shrink-0">
            <div class="flex items-center gap-2 px-3 py-2 text-[#89b4fa]">
                <BranchIcon size="1em" />
                <span class="font-semibold text-xs text-[#cdd6f4]">Port forwarding</span>
                <span class="font-mono text-[10px] text-[#6c7086] truncate ml-auto">{{ activeSession.host }}</span>
            </div>

            <!-- Active forwards -->
            <div v-if="forwards.length" class="px-3 pb-1.5 space-y-1">
                <div v-for="f in forwards" :key="f.id" class="flex items-center gap-1.5 text-[11px] font-mono bg-white/[0.03] rounded px-2 py-1">
                    <span class="text-[#a6e3a1]">:{{ f.localPort }}</span>
                    <span class="text-[#6c7086]">→</span>
                    <span class="text-[#cdd6f4] truncate">{{ f.remoteHost }}:{{ f.remotePort }}</span>
                    <button class="ml-auto text-[#a6adc8] hover:text-[#cdd6f4] p-0.5 rounded hover:bg-white/5 transition-colors" :title="copied === f.id ? 'Copied!' : 'Copy localhost:' + f.localPort" @click="copyForward(f)">
                        <CheckIcon v-if="copied === f.id" size="0.85em" />
                        <CopyIcon v-else size="0.85em" />
                    </button>
                    <button class="text-[#a6adc8] hover:text-[#f38ba8] p-0.5 rounded hover:bg-[#f38ba8]/10 transition-colors" title="Remove" @click="removeForward(f.id)">
                        <TrashIcon size="0.85em" />
                    </button>
                </div>
            </div>

            <!-- Add forward -->
            <div class="px-3 py-2">
                <div class="flex items-center gap-1 text-[11px] font-mono">
                    <input v-model="fwLocal" placeholder="local" inputmode="numeric"
                        class="w-12 px-1.5 py-1 bg-[#11111b] border border-[#45475a] rounded text-center text-[#cdd6f4] outline-none focus:border-[#89b4fa] placeholder:text-[#585b70]" />
                    <span class="text-[#6c7086]">→</span>
                    <input v-model="fwHost" placeholder="host"
                        class="flex-1 min-w-0 px-1.5 py-1 bg-[#11111b] border border-[#45475a] rounded text-[#cdd6f4] outline-none focus:border-[#89b4fa] placeholder:text-[#585b70]" />
                    <span class="text-[#6c7086]">:</span>
                    <input v-model="fwPort" placeholder="port" inputmode="numeric" @keydown.enter="addForward"
                        class="w-12 px-1.5 py-1 bg-[#11111b] border border-[#45475a] rounded text-center text-[#cdd6f4] outline-none focus:border-[#89b4fa] placeholder:text-[#585b70]" />
                    <button class="shrink-0 p-1 text-[#89b4fa] hover:bg-[#89b4fa]/10 rounded transition-colors" title="Add forward" @click="addForward">
                        <PlusIcon size="0.9em" />
                    </button>
                </div>
                <div v-if="fwError" class="text-[10px] text-[#f38ba8] mt-1">{{ fwError }}</div>
                <div v-else class="text-[10px] text-[#6c7086] mt-1">local empty → auto-assigned. Reach it at localhost:&lt;local&gt;.</div>
            </div>
        </div>

        <!-- Note editor -->
        <div v-if="editingNote" class="px-3 py-2 border-t border-[#313244] shrink-0">
            <textarea
                v-model="noteText"
                class="w-full p-1.5 border border-[#45475a] rounded bg-[#11111b] text-[#cdd6f4] text-xs resize-none outline-none focus:border-[#89b4fa] placeholder:text-[#585b70]"
                rows="3"
                placeholder="Note about this server..."
            />
            <div class="flex gap-1.5 mt-1.5">
                <button class="flex items-center gap-1 px-2.5 py-1 bg-[#89b4fa] text-[#11111b] text-[11px] font-medium rounded hover:bg-[#74a8f5] transition-colors" @click="saveNote">
                    <CheckIcon size="0.8em" /> Save
                </button>
                <button class="px-2.5 py-1 text-[11px] text-[#a6adc8] hover:bg-white/5 rounded transition-colors" @click="cancelNote">Cancel</button>
            </div>
        </div>

        <!-- Footer -->
        <div class="px-3 py-2.5 border-t border-[#313244] shrink-0">
            <button
                class="w-full flex items-center justify-center gap-1.5 py-1.5 border border-dashed border-[#45475a] rounded-lg bg-transparent text-xs text-[#a6adc8] hover:border-[#89b4fa] hover:text-[#cdd6f4] hover:bg-[#89b4fa]/5 transition-colors"
                @click="openConnect"
            >
                <PlusIcon size="0.9em" />
                New Connection
            </button>
        </div>
    </div>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue';

const props = defineProps({
    file: { type: Object, required: true },   // { name, mode, isDirectory, longname }
    path: { type: String, required: true }
});
const emit = defineEmits(['close', 'apply']);

// ── Permission bits ──
const initialMode = (props.file?.mode || 0) & 0o777;
const bits = reactive({
    ur: !!(initialMode & 0o400), uw: !!(initialMode & 0o200), ux: !!(initialMode & 0o100),
    gr: !!(initialMode & 0o040), gw: !!(initialMode & 0o020), gx: !!(initialMode & 0o010),
    or: !!(initialMode & 0o004), ow: !!(initialMode & 0o002), ox: !!(initialMode & 0o001)
});

const octal = computed(() => {
    const d = (r, w, x) => (r ? 4 : 0) + (w ? 2 : 0) + (x ? 1 : 0);
    return `${d(bits.ur, bits.uw, bits.ux)}${d(bits.gr, bits.gw, bits.gx)}${d(bits.or, bits.ow, bits.ox)}`;
});

const octalInput = ref(octal.value);
watch(octal, (v) => { octalInput.value = v; });
function applyOctalInput() {
    const v = octalInput.value.trim();
    if (!/^[0-7]{3}$/.test(v)) { octalInput.value = octal.value; return; }
    const n = parseInt(v, 8);
    bits.ur = !!(n & 0o400); bits.uw = !!(n & 0o200); bits.ux = !!(n & 0o100);
    bits.gr = !!(n & 0o040); bits.gw = !!(n & 0o020); bits.gx = !!(n & 0o010);
    bits.or = !!(n & 0o004); bits.ow = !!(n & 0o002); bits.ox = !!(n & 0o001);
}

// ── Owner / group (parsed from the ls -l style longname: perms links owner group …) ──
const lnTokens = (props.file?.longname || '').split(/\s+/);
const origOwner = lnTokens[2] || '';
const origGroup = lnTokens[3] || '';
const owner = ref(origOwner);
const group = ref(origGroup);
const recursive = ref(false);

const rows = [
    { key: 'u', label: 'Owner' },
    { key: 'g', label: 'Group' },
    { key: 'o', label: 'Other' }
];

function apply() {
    const out = { recursive: recursive.value, chmod: null, chown: null };
    if (parseInt(octal.value, 8) !== initialMode) out.chmod = octal.value;
    const o = owner.value.trim(), g = group.value.trim();
    if (o !== origOwner || g !== origGroup) {
        out.chown = g ? `${o}:${g}` : o;
    }
    emit('apply', out);
    emit('close');
}
</script>

<template>
    <!-- Dismiss only when the press itself lands on the backdrop; a text-selection
         drag inside the modal that releases outside won't close it. -->
    <div class="fixed inset-0 z-[30000] flex items-center justify-center bg-black/60" @mousedown.self="emit('close')">
        <div class="w-[360px] bg-[#1e1e2e] border border-[#45475a] rounded-xl shadow-2xl text-[#cdd6f4] text-[13px] overflow-hidden">
            <!-- Header -->
            <div class="px-4 py-3 border-b border-[#313244] flex items-center gap-2">
                <span class="text-base">{{ file.isDirectory ? '📁' : '📄' }}</span>
                <span class="font-semibold truncate">{{ file.name }}</span>
            </div>

            <div class="px-4 py-3 space-y-4">
                <!-- Permission matrix -->
                <div>
                    <div class="text-[11px] uppercase text-[#a6adc8] mb-1.5">Permissions</div>
                    <table class="w-full text-center text-[12px]">
                        <thead>
                            <tr class="text-[#a6adc8] text-[11px]">
                                <th class="text-left font-normal"></th>
                                <th class="font-normal">Read</th>
                                <th class="font-normal">Write</th>
                                <th class="font-normal">Exec</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="r in rows" :key="r.key">
                                <td class="text-left text-[#cdd6f4] py-0.5">{{ r.label }}</td>
                                <td><input type="checkbox" v-model="bits[r.key + 'r']" class="accent-[#89b4fa]" /></td>
                                <td><input type="checkbox" v-model="bits[r.key + 'w']" class="accent-[#89b4fa]" /></td>
                                <td><input type="checkbox" v-model="bits[r.key + 'x']" class="accent-[#89b4fa]" /></td>
                            </tr>
                        </tbody>
                    </table>
                    <div class="flex items-center gap-2 mt-2">
                        <span class="text-[11px] text-[#a6adc8]">Octal</span>
                        <input v-model="octalInput" @input="applyOctalInput" @blur="applyOctalInput"
                            maxlength="3"
                            class="w-16 px-2 py-1 bg-[#11111b] border border-[#45475a] rounded font-mono text-center outline-none focus:border-[#89b4fa]" />
                    </div>
                </div>

                <!-- Ownership -->
                <div>
                    <div class="text-[11px] uppercase text-[#a6adc8] mb-1.5">Ownership</div>
                    <div class="flex gap-2">
                        <label class="flex-1">
                            <span class="block text-[11px] text-[#a6adc8] mb-0.5">Owner</span>
                            <input v-model="owner" class="w-full px-2 py-1 bg-[#11111b] border border-[#45475a] rounded font-mono outline-none focus:border-[#89b4fa]" />
                        </label>
                        <label class="flex-1">
                            <span class="block text-[11px] text-[#a6adc8] mb-0.5">Group</span>
                            <input v-model="group" class="w-full px-2 py-1 bg-[#11111b] border border-[#45475a] rounded font-mono outline-none focus:border-[#89b4fa]" />
                        </label>
                    </div>
                </div>

                <!-- Recursive -->
                <label v-if="file.isDirectory" class="flex items-center gap-2 text-[12px] text-[#a6adc8] cursor-pointer">
                    <input type="checkbox" v-model="recursive" class="accent-[#89b4fa]" />
                    Apply recursively to contents
                </label>
            </div>

            <!-- Footer -->
            <div class="px-4 py-3 border-t border-[#313244] flex justify-end gap-2">
                <button class="px-3 py-1.5 text-[12px] text-[#a6adc8] hover:bg-white/5 rounded transition-colors" @click="emit('close')">Cancel</button>
                <button class="px-3 py-1.5 text-[12px] font-medium bg-[#89b4fa] text-[#11111b] rounded hover:bg-[#74a8f5] transition-colors" @click="apply">Apply</button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';

const emit = defineEmits(['unlocked']);

const mode = ref('loading'); // 'loading' | 'set' | 'unlock' | 'reset'
const password = ref('');
const confirm = ref('');
const error = ref('');
const resetText = ref('');

function checkStatus() {
    if (window.app) {
        window.app.master.status();
        const h = (msg) => {
            if (msg.method === 'master.status') {
                mode.value = msg.data.hasPassword ? 'unlock' : 'set';
            }
        };
        window.app.recieve(h);
    } else {
        emit('unlocked');
    }
}

function handleSet() {
    if (!password.value) { error.value = 'Enter password'; return; }
    if (password.value !== confirm.value) { error.value = 'Passwords do not match'; return; }
    error.value = '';
    mode.value = 'loading';
    if (window.app) {
        window.app.master.set(password.value);
        const h = (msg) => {
            if (msg.method === 'master.set') {
                if (msg.data.success) emit('unlocked');
                else { error.value = msg.data.error || 'Failed'; mode.value = 'set'; }
            }
        };
        window.app.recieve(h);
    }
}

function handleVerify() {
    if (!password.value) { error.value = 'Enter password'; return; }
    error.value = '';
    mode.value = 'loading';
    if (window.app) {
        window.app.master.verify(password.value);
        const h = (msg) => {
            if (msg.method === 'master.verify') {
                if (msg.data.success) emit('unlocked');
                else { error.value = msg.data.error || 'Wrong password'; mode.value = 'unlock'; }
            }
        };
        window.app.recieve(h);
    }
}

function startReset() {
    mode.value = 'reset';
    resetText.value = '';
    error.value = '';
}

function confirmReset() {
    if (resetText.value.trim() !== 'delete all my credentials') {
        error.value = 'Type "delete all my credentials" to confirm';
        return;
    }
    error.value = '';
    if (window.app) {
        window.app.master.reset();
        const h = (msg) => {
            if (msg.method === 'master.reset') {
                if (msg.data.success) {
                    password.value = '';
                    confirm.value = '';
                    mode.value = 'set';
                } else {
                    error.value = msg.data.error || 'Reset failed';
                    mode.value = 'unlock';
                }
            }
        };
        window.app.recieve(h);
    }
}

function cancelReset() {
    mode.value = 'unlock';
    resetText.value = '';
    error.value = '';
}

onMounted(() => checkStatus());
</script>

<template>
    <div class="fixed inset-0 z-[30000] bg-black/60 backdrop-blur-sm flex items-center justify-center">
        <div class="bg-[#1e1e2e] border border-[#45475a] rounded-xl shadow-2xl p-8 w-[380px] max-w-[90vw]">
            <div class="text-center mb-6">
                <div class="text-3xl mb-2">🔐</div>
                <h2 class="text-lg font-semibold text-[#cdd6f4]">
                    <template v-if="mode === 'set'">Set Master Password</template>
                    <template v-else-if="mode === 'reset'">Reset Vault</template>
                    <template v-else>Unlock SSHtorm</template>
                </h2>
                <p class="text-xs text-[#a6adc8] mt-1" v-if="mode === 'set'">Your credentials will be encrypted with this password.</p>
                <p class="text-xs text-[#f38ba8] mt-1" v-else-if="mode === 'reset'">This will delete all saved credentials.</p>
                <p class="text-xs text-[#a6adc8] mt-1" v-else>Enter your master password to decrypt saved credentials.</p>
            </div>

            <div v-if="mode === 'loading'" class="text-center py-4 text-[#a6adc8] text-sm">Checking...</div>

            <!-- Set mode -->
            <div v-else-if="mode === 'set'" class="flex flex-col gap-3">
                <input v-model="password" type="password" class="w-full px-3 py-2 bg-[#11111b] border border-[#45475a] rounded-md text-[#cdd6f4] text-sm outline-none focus:border-[#89b4fa] transition-colors" placeholder="Master password" @keydown.enter="handleSet" />
                <input v-model="confirm" type="password" class="w-full px-3 py-2 bg-[#11111b] border border-[#45475a] rounded-md text-[#cdd6f4] text-sm outline-none focus:border-[#89b4fa] transition-colors" placeholder="Confirm password" @keydown.enter="handleSet" />
                <button class="w-full py-2 bg-[#89b4fa] text-[#11111b] text-sm font-semibold rounded-md hover:bg-[#74a8f5] transition-colors" @click="handleSet">Set Password</button>
            </div>

            <!-- Reset mode -->
            <div v-else-if="mode === 'reset'" class="flex flex-col gap-3">
                <p class="text-xs text-[#a6adc8]">Type <code class="text-[#f9e2af] bg-[#11111b] px-1 rounded">delete all my credentials</code> to confirm:</p>
                <input v-model="resetText" class="w-full px-3 py-2 bg-[#11111b] border border-[#45475a] rounded-md text-[#cdd6f4] text-sm outline-none focus:border-[#f38ba8] transition-colors" placeholder="delete all my credentials" @keydown.enter="confirmReset" />
                <div class="flex gap-2">
                    <button class="flex-1 py-2 bg-[#f38ba8] text-[#11111b] text-sm font-semibold rounded-md hover:opacity-85 transition-opacity" @click="confirmReset">Delete Everything</button>
                    <button class="flex-1 py-2 bg-white/5 text-[#cdd6f4] text-sm rounded-md hover:bg-white/10 transition-colors" @click="cancelReset">Cancel</button>
                </div>
            </div>

            <!-- Unlock mode -->
            <div v-else class="flex flex-col gap-3">
                <input v-model="password" type="password" class="w-full px-3 py-2 bg-[#11111b] border border-[#45475a] rounded-md text-[#cdd6f4] text-sm outline-none focus:border-[#89b4fa] transition-colors" placeholder="Master password" @keydown.enter="handleVerify" />
                <button class="w-full py-2 bg-[#89b4fa] text-[#11111b] text-sm font-semibold rounded-md hover:bg-[#74a8f5] transition-colors" @click="handleVerify">Unlock</button>
                <button class="text-[11px] text-[#585b70] hover:text-[#f38ba8] transition-colors mt-1" @click="startReset">Forgot password? Reset vault</button>
            </div>

            <div v-if="error" class="mt-3 p-2 bg-[#f38ba8]/10 border border-[#f38ba8]/20 rounded-md text-[#f38ba8] text-xs text-center">{{ error }}</div>
        </div>
    </div>
</template>

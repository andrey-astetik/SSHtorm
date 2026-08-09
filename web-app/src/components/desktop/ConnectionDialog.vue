<script setup>
import { ref, reactive, onMounted, toRaw } from 'vue';
import { ssh } from '../../stores/ssh.js';

const emit = defineEmits(['connected', 'close']);

const form = reactive({
    label: '',
    host: 'localhost',
    port: 22,
    username: 'root',
    password: '',
    privateKey: ''
});

const connecting = ref(false);
const error = ref('');
const savedHosts = ref([]);
const showAdvanced = ref(false);
let connectTimer = null;

function loadSavedHosts() {
    if (window.app) {
        window.app.hosts.load();
        const handler = (msg) => {
            if (msg.method === 'hosts.loaded') {
                savedHosts.value = msg.data || [];
            }
        };
        window.app.recieve(handler);
    }
}

function saveHost() {
    const entry = { host: form.host, port: form.port, username: form.username, password: form.password, label: form.label || '' };
    const raw = savedHosts.value.map(h => toRaw(h));
    const idx = raw.findIndex(h => h.host === entry.host && h.username === entry.username && h.port === entry.port);
    if (idx >= 0) raw[idx] = entry;
    else raw.push(entry);
    savedHosts.value = raw;
    if (window.app) window.app.hosts.save(raw);
}

function selectHost(host) {
    form.label = host.label || '';
    form.host = host.host;
    form.port = host.port;
    form.username = host.username;
    form.password = host.password || '';
    form.privateKey = '';
}

function deleteHost(host) {
    savedHosts.value = savedHosts.value.filter(h => h !== host);
    const raw = savedHosts.value.map(h => toRaw(h));
    if (window.app) {
        window.app.hosts.save(raw);
        window.app.hosts.forgetKey(host.host, host.port);   // also drop its host-key fingerprint
    }
}

function connectWith(host) {
    selectHost(host);
    connect();
}

function connect() {
    if (!form.host || !form.username) { error.value = 'Host and username required'; return; }
    // Password and key are both optional: "none" auth or an ssh-agent identity.
    connecting.value = true;
    error.value = '';

    const sessionId = ssh.connect({
        host: form.host, port: form.port, username: form.username,
        label: form.label || undefined,
        password: form.password || undefined,
        privateKey: form.privateKey || undefined
    });

    ssh.on(sessionId, 'ssh.connected', (data) => {
        if (data.sessionId !== sessionId) return;
        clearTimeout(connectTimer);
        connecting.value = false;
        saveHost();
        ssh.state.lastConnectedSessionId = sessionId;
        ssh.state.showConnectDialog = false;
    });
    ssh.on(sessionId, 'ssh.error', (data) => {
        if (data.sessionId !== sessionId) return;
        clearTimeout(connectTimer);
        connecting.value = false;
        error.value = data.error || 'Unknown error';
    });
    // Host key changed: the connection was dropped on purpose and a HostKeyDialog
    // is now up. Stop our connect wait so the timeout can't fire / tear down the
    // session — the user's decision re-drives the connection.
    ssh.on(sessionId, 'ssh.hostkey.changed', (data) => {
        if (data.sessionId !== sessionId) return;
        clearTimeout(connectTimer);
        connecting.value = false;
    });

    connectTimer = setTimeout(() => {
        if (connecting.value) { connecting.value = false; error.value = 'Connection timeout'; ssh.disconnect(sessionId); }
    }, 25000);
}

onMounted(() => loadSavedHosts());
</script>

<template>
    <div class="connect-dialog">
        <h2 class="cd-title">SSH Connection</h2>

        <div class="cd-cols">
            <!-- Left: known hosts -->
            <div class="cd-col cd-col-left">
                <div class="cd-saved-title">Saved hosts</div>
                <div class="cd-saved-list">
                    <div v-if="!savedHosts.length" class="cd-saved-empty">No saved hosts yet</div>
                    <div v-for="h in savedHosts" :key="h.host+h.username" class="cd-saved-item" @click="selectHost(h)" @dblclick="connectWith(h)" title="Click to fill · double-click to connect">
                        <button class="cd-saved-delete" @click.stop="deleteHost(h)" title="Delete">✕</button>
                        <span class="cd-saved-label">
                            <template v-if="h.label">
                                <span class="cd-saved-name">{{ h.label }}</span>
                                <span class="cd-saved-sub">{{ h.username }}@{{ h.host }}:{{ h.port }}</span>
                            </template>
                            <span v-else class="cd-saved-name">{{ h.username }}@{{ h.host }}:{{ h.port }}</span>
                        </span>
                        <button class="cd-saved-connect" @click.stop="connectWith(h)" title="Connect">→</button>
                    </div>
                </div>
            </div>

            <div class="cd-divider"></div>

            <!-- Right: connection form -->
            <div class="cd-col cd-col-right">
                <div class="cd-form">
                    <div class="cd-row"><label class="cd-label">Label <span class="cd-optional">(optional)</span></label><input v-model="form.label" class="cd-input" placeholder="e.g. prod-01 — shown instead of user@host" /></div>
                    <div class="cd-row"><label class="cd-label">Host</label><input v-model="form.host" class="cd-input" placeholder="192.168.1.1" /></div>
                    <div class="cd-row"><label class="cd-label">Port</label><input v-model.number="form.port" class="cd-input cd-input-short" type="number" /></div>
                    <div class="cd-row"><label class="cd-label">Username</label><input v-model="form.username" class="cd-input" placeholder="root" /></div>
                    <div class="cd-row"><label class="cd-label">Password <span class="cd-optional">(optional)</span></label><input v-model="form.password" class="cd-input" type="password" placeholder="Leave empty for agent / no auth" /></div>
                    <div v-if="showAdvanced" class="cd-row"><label class="cd-label">Private Key</label><textarea v-model="form.privateKey" class="cd-textarea" rows="4"></textarea></div>
                    <button class="cd-toggle" @click="showAdvanced=!showAdvanced">{{ showAdvanced ? '- Hide' : '+ Private key' }}</button>
                </div>

                <div v-if="error" class="cd-error">{{ error }}</div>

                <div class="cd-actions">
                    <button class="cd-btn cd-btn-connect" :disabled="connecting" @click="connect">{{ connecting ? 'Connecting...' : 'Connect' }}</button>
                    <button class="cd-btn cd-btn-cancel" @click="$emit('close')">Cancel</button>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.connect-dialog { padding: 20px; color: #cdd6f4; }
.cd-title { margin: 0 0 16px; font-size: 18px; font-weight: 600; }

/* Two columns: known hosts | form, split by a vertical divider.
   Relative flex ratios (2:3) + min-width:0 so both shrink together on narrow
   screens instead of overflowing. */
.cd-cols { display: flex; align-items: stretch; gap: 1rem; }
.cd-col { min-width: 0; }
.cd-col-left { flex: 2 1 0; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.cd-col-right { flex: 3 1 0; min-width: 0; display: flex; flex-direction: column; }
.cd-divider { width: 1px; align-self: stretch; background: #45475a; flex-shrink: 0; }
/* flex:1 + min-height:0 → the list fills the column (stretched to the form's
   height) and scrolls internally, instead of driving the height itself. */
.cd-saved-list { flex: 1 1 0; min-height: 0; overflow-y: auto; padding-right: 2px; }
.cd-saved-empty { padding: 24px 8px; text-align: center; font-size: 12px; color: #6c7086; }
.cd-saved-title { font-size: 11px; text-transform: uppercase; color: #a6adc8; margin-bottom: 8px; }
.cd-saved-item { display: flex; align-items: center; gap: 6px; overflow: hidden; padding: 6px 8px; border-radius: 6px; cursor: pointer; font-size: 13px; font-family: monospace; background: rgba(255,255,255,0.04); margin-bottom: 4px; transition: background 0.15s; }
.cd-saved-item:hover { background: rgba(255,255,255,0.1); }
.cd-saved-label { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }
.cd-saved-name { font-weight: 600; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cd-saved-sub { font-size: 11px; color: #a6adc8; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cd-optional { color: #6c7086; font-weight: 400; }
.cd-saved-connect { flex-shrink: 0; padding: 2px 9px; border: none; border-radius: 4px; background: #89b4fa; color: #11111b; font-size: 12px; font-weight: 600; cursor: pointer; }
.cd-saved-connect:hover { background: #74a8f5; }
.cd-saved-delete { padding: 2px 6px; border: none; border-radius: 4px; background: transparent; color: #585b70; font-size: 11px; cursor: pointer; flex-shrink: 0; margin-right: 6px; }
.cd-saved-delete:hover { background: rgba(243,139,168,0.2); color: #f38ba8; }
.cd-form { display: flex; flex-direction: column; gap: 10px; }
.cd-row { display: flex; flex-direction: column; gap: 4px; }
.cd-label { font-size: 12px; color: #a6adc8; font-weight: 500; }
.cd-input { padding: 8px 12px; border: 1px solid #45475a; border-radius: 6px; background: #11111b; color: #cdd6f4; font-size: 14px; outline: none; transition: border-color 0.15s; }
.cd-input:focus { border-color: #89b4fa; }
.cd-input-short { width: 100px; }
.cd-textarea { padding: 8px 12px; border: 1px solid #45475a; border-radius: 6px; background: #11111b; color: #cdd6f4; font-size: 12px; font-family: monospace; outline: none; resize: vertical; }
.cd-textarea:focus { border-color: #89b4fa; }
.cd-toggle { background: none; border: none; color: #89b4fa; font-size: 12px; cursor: pointer; padding: 4px 0; text-align: left; }
.cd-toggle:hover { text-decoration: underline; }
.cd-error { margin-top: 12px; padding: 8px 12px; background: rgba(243,139,168,0.15); border: 1px solid rgba(243,139,168,0.3); border-radius: 6px; color: #f38ba8; font-size: 13px; }
.cd-actions { display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end; }
.cd-btn { padding: 8px 20px; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; font-weight: 500; transition: background 0.15s; }
.cd-btn-connect { background: #89b4fa; color: #11111b; }
.cd-btn-connect:hover { background: #74a8f5; }
.cd-btn-connect:disabled { opacity: 0.5; cursor: not-allowed; }
.cd-btn-cancel { background: rgba(255,255,255,0.08); color: #cdd6f4; }
.cd-btn-cancel:hover { background: rgba(255,255,255,0.15); }
</style>

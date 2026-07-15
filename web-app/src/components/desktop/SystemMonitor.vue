<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';
import { ssh } from '../../stores/ssh.js';

const props = defineProps({ sessionId: [Number, String] });
const sid = computed(() => props.sessionId || ssh.state.activeSessionId);

const cpuUsage = ref(null);
const memTotal = ref(null), memUsed = ref(null), swapTotal = ref(null), swapUsed = ref(null);
const uptime = ref(''), loadAvg = ref('');
const diskInfo = ref([]), processes = ref([]);
const sortKey = ref('cpu'), sortDesc = ref(true);
const killPid = ref(''), killSignal = ref('TERM');
const error = ref('');
let timer = null, unsubExec = null;

const memPercent = computed(() => (memTotal.value && memUsed.value) ? Math.round(memUsed.value/memTotal.value*100) : null);
const swapPercent = computed(() => (swapTotal.value && swapUsed.value) ? Math.round(swapUsed.value/swapTotal.value*100) : null);

function parseSection(out, marker) {
    const startTag = `===${marker}===`;
    const idx = out.indexOf(startTag);
    if (idx === -1) return '';
    const start = idx + startTag.length;
    // Skip \r?\n after the marker
    let s = start;
    if (out[s] === '\r') s++;
    if (out[s] === '\n') s++;
    // Find next === marker
    const nextIdx = out.indexOf('\n===', s);
    const end = nextIdx === -1 ? out.length : nextIdx;
    return out.substring(s, end).trim();
}

function handleExecData(out) {
    try {
        const cpu = parseFloat(parseSection(out, 'CPU')); if (!isNaN(cpu)) cpuUsage.value = cpu;
        const mp = parseSection(out, 'MEM').split(/\s+/); if (mp.length>=2) { memTotal.value=parseInt(mp[0])||memTotal.value; memUsed.value=parseInt(mp[1])||memUsed.value; }
        const sp = parseSection(out, 'SWAP').split(/\s+/); if (sp.length>=2) { swapTotal.value=parseInt(sp[0])||swapTotal.value; swapUsed.value=parseInt(sp[1])||swapUsed.value; }
        const d = parseSection(out, 'DISK'); if (d) diskInfo.value = d.split(/\r?\n/).filter(l=>l).map(l=>{const p=l.trim().split(/\s+/);return{fs:p[0],size:p[1]||'-',used:p[2]||'-',avail:p[3]||'-',pct:p[4]||'-',mount:p[5]||'/'};});
        const ps = parseSection(out, 'PS'); window.__psRaw = ps; if (ps) processes.value = ps.split(/\r?\n/).filter(l=>l && !l.startsWith('USER')).map(l=>{const p=l.trim().split(/\s+/);return{user:p[0],pid:p[1],cpu:p[2],mem:p[3],vsz:p[4],rss:p[5],tty:p[6],stat:p[7],start:p[8],time:p[9],cmd:p.slice(10).join(' ')};});
        const up = parseSection(out, 'UP'); if (up) { uptime.value=up; const m=up.match(/load average:\s*(.+)/); if(m) loadAvg.value=m[1]; }
        error.value = '';
    } catch(e) { error.value = 'Parse: '+e.message; }
}

async function fetchAll() {
    if (!window.app) return;
    window.app.ssh.exec(sid.value, [
        "echo '===CPU==='","top -bn1 | awk '/%Cpu/{print $2+$4}'",
        "echo '===MEM==='","free -b | awk '/^Mem:/{print $2,$3}'",
        "echo '===SWAP==='","free -b | awk '/^Swap:/{print $2,$3}'",
        "echo '===DISK==='","df -h / | tail -n +2",
        "echo '===PS==='","ps aux --sort=-%cpu | head -40",
        "echo '===UP==='","uptime"
    ].join('; '));
}

function refresh() { fetchAll(); }
async function sendSignal() { const p=killPid.value.trim(); if(p){window.app.ssh.exec(sid.value,`kill -${killSignal.value} ${p}`);killPid.value='';setTimeout(fetchAll,800);} }

function sortedProcs() {
    return [...processes.value].sort((a,b)=>{
        const va=sortKey.value==='pid'?parseInt(a.pid):(parseFloat(a[sortKey.value])||0);
        const vb=sortKey.value==='pid'?parseInt(b.pid):(parseFloat(b[sortKey.value])||0);
        return sortDesc.value?vb-va:va-vb;
    });
}
function setSort(k) { if(sortKey.value===k) sortDesc.value=!sortDesc.value; else { sortKey.value=k; sortDesc.value=true; } }
function formatBytes(b) { if(!b&&b!==0) return'-'; if(b<1024)return b+' B'; if(b<1048576)return(b/1024).toFixed(1)+' KB'; if(b<1073741824)return(b/1048576).toFixed(1)+' MB'; return(b/1073741824).toFixed(1)+' GB'; }

onMounted(() => {
    if (window.app) {
        unsubExec = window.app.recieve((msg) => {
            if (msg.method === 'ssh.exec.result' && msg.data?.sessionId === sid.value) {
                handleExecData(msg.data.output || '');
            }
            if (msg.method === 'ssh.error' && msg.data?.sessionId === sid.value) {
                error.value = msg.data.error || 'Unknown error';
            }
        });
    }
    fetchAll();
    timer = setInterval(fetchAll, 3000);
});
onBeforeUnmount(() => {
    if (timer) clearInterval(timer);
    if (unsubExec) unsubExec();
});
</script>

<template>
    <div class="flex flex-col h-full text-xs text-[#cdd6f4] overflow-hidden">
        <div v-if="error" class="flex items-center gap-2 px-2 py-1 bg-[#f38ba8]/10 border-b border-[#f38ba8]/20 shrink-0">
            <span class="text-[11px] text-[#f38ba8]">{{ error }}</span>
            <button class="text-[11px] text-[#f38ba8] underline hover:text-[#cdd6f4] ml-auto" @click="refresh">Retry</button>
        </div>
        <div class="flex gap-2 p-2 shrink-0">
            <div class="flex-1 bg-[#181825] rounded-md p-2"><div class="text-[10px] text-[#a6adc8] uppercase mb-1">CPU</div><div class="h-2 bg-[#313244] rounded-full overflow-hidden mb-1"><div class="h-full bg-[#89b4fa] rounded-full transition-all duration-500" :style="{width:Math.min(cpuUsage||0,100)+'%'}"/></div><div class="text-[11px]">{{cpuUsage!==null?cpuUsage.toFixed(1)+'%':'...'}}</div></div>
            <div class="flex-1 bg-[#181825] rounded-md p-2"><div class="text-[10px] text-[#a6adc8] uppercase mb-1">RAM</div><div class="h-2 bg-[#313244] rounded-full overflow-hidden mb-1"><div class="h-full bg-[#a6e3a1] rounded-full transition-all duration-500" :style="{width:(memPercent||0)+'%'}"/></div><div class="text-[11px]">{{memUsed!==null?formatBytes(memUsed)+' / '+formatBytes(memTotal):'...'}}</div></div>
            <div v-if="swapTotal" class="flex-1 bg-[#181825] rounded-md p-2"><div class="text-[10px] text-[#a6adc8] uppercase mb-1">SWAP</div><div class="h-2 bg-[#313244] rounded-full overflow-hidden mb-1"><div class="h-full bg-[#f9e2af] rounded-full transition-all duration-500" :style="{width:(swapPercent||0)+'%'}"/></div><div class="text-[11px]">{{swapUsed!==null?formatBytes(swapUsed)+' / '+formatBytes(swapTotal):'...'}}</div></div>
        </div>
        <div class="px-2 pb-1.5 text-[11px] text-[#6c7086] truncate shrink-0" v-if="uptime">{{ uptime }}</div>
        <div v-if="diskInfo.length" class="px-2 pb-1.5 flex gap-3 text-[10px] text-[#a6adc8] shrink-0"><span v-for="d in diskInfo" :key="d.mount">{{d.mount}} &nbsp;{{d.used}}/{{d.size}} &nbsp;{{d.pct}}</span></div>
        <div class="flex gap-1.5 px-2 py-1.5 items-center shrink-0 border-y border-[#313244] bg-[#181825]">
            <input v-model="killPid" class="w-[55px] px-1.5 py-0.5 border border-[#45475a] rounded bg-[#11111b] text-[#cdd6f4] text-[11px] outline-none focus:border-[#89b4fa]" placeholder="PID"/>
            <select v-model="killSignal" class="px-1 py-0.5 border border-[#45475a] rounded bg-[#11111b] text-[#cdd6f4] text-[11px] outline-none"><option value="TERM">TERM</option><option value="KILL">KILL</option><option value="HUP">HUP</option><option value="INT">INT</option><option value="STOP">STOP</option></select>
            <button class="px-2 py-0.5 bg-[#f38ba8] text-[#11111b] text-[11px] font-medium rounded hover:opacity-85 transition-opacity" @click="sendSignal">Send</button>
            <button class="px-2 py-0.5 bg-white/5 text-[#cdd6f4] text-[11px] rounded hover:bg-white/10 transition-colors ml-auto" @click="refresh">↻</button>
        </div>
        <div class="flex-1 overflow-auto">
            <table class="w-full border-collapse">
                <thead><tr>
                    <th class="sticky top-0 bg-[#181825] px-2 py-1 text-left text-[10px] text-[#a6adc8] cursor-pointer hover:text-[#cdd6f4] select-none border-b border-[#313244]" @click="setSort('user')">USER</th>
                    <th class="sticky top-0 bg-[#181825] px-2 py-1 text-left text-[10px] text-[#a6adc8] cursor-pointer hover:text-[#cdd6f4] select-none border-b border-[#313244]" @click="setSort('pid')">PID</th>
                    <th class="sticky top-0 bg-[#181825] px-2 py-1 text-right text-[10px] text-[#a6adc8] cursor-pointer hover:text-[#cdd6f4] select-none border-b border-[#313244]" @click="setSort('cpu')">CPU%</th>
                    <th class="sticky top-0 bg-[#181825] px-2 py-1 text-right text-[10px] text-[#a6adc8] cursor-pointer hover:text-[#cdd6f4] select-none border-b border-[#313244]" @click="setSort('mem')">MEM%</th>
                    <th class="sticky top-0 bg-[#181825] px-2 py-1 text-left text-[10px] text-[#a6adc8] select-none border-b border-[#313244]">CMD</th>
                </tr></thead>
                <tbody>
                    <tr v-for="p in sortedProcs()" :key="p.pid" class="hover:bg-white/[0.02] cursor-pointer border-b border-white/[0.02]" @click="killPid=p.pid">
                        <td class="px-2 py-0.5 text-[11px] whitespace-nowrap">{{p.user}}</td><td class="px-2 py-0.5 text-[11px] text-[#f9e2af] font-medium whitespace-nowrap">{{p.pid}}</td><td class="px-2 py-0.5 text-[11px] text-right whitespace-nowrap">{{p.cpu}}</td><td class="px-2 py-0.5 text-[11px] text-right whitespace-nowrap">{{p.mem}}</td><td class="px-2 py-0.5 text-[11px] truncate max-w-[220px]">{{p.cmd}}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>

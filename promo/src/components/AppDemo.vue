<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';

/* A faithful mock of the SSHtorm desktop: top taskbar (traffic lights, window
   tabs, clock), the gradient desktop, a File Explorer window and an active
   Terminal window that types out a session. The whole scene is laid out at a
   fixed 1000×600 and scaled to the container width, so it stays pixel-faithful
   at any size. */

const DESIGN_W = 1000;
const viewport = ref(null);
const scale = ref(1);
let ro;

const clock = ref('');
let clockTimer;
const tick = () => {
    clock.value = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// ── Terminal: type a few commands, hold, clear, loop ──
const script = [
    { t: 'cmd', c: 'docker ps' },
    { t: 'out', x: 'CONTAINER   IMAGE          STATUS' },
    { t: 'out', x: 'a1f3d2      nginx:latest   Up 2 hours' },
    { t: 'out', x: 'b7c2e9      postgres:16    Up 5 hours' },
    { t: 'cmd', c: 'systemctl reload nginx' },
    { t: 'cmd', c: 'df -h /' },
    { t: 'out', x: 'Filesystem  Size  Used Avail Use%' },
    { t: 'out', x: '/dev/vda1    40G   18G   22G  45%' },
];
const MAX = 12;

const lines = ref([]);
let stopped = false;
const timers = new Set();
const sleep = (ms) => new Promise((r) => {
    const t = setTimeout(() => { timers.delete(t); r(); }, ms);
    timers.add(t);
});
const push = (l) => {
    lines.value.push(l);
    if (lines.value.length > MAX) lines.value.shift();
};

// Type into the object THROUGH the reactive array (lines.value[idx]) — mutating
// a raw pushed object is not tracked by Vue, which froze the line mid-type.
async function typeCmd(text) {
    const idx = lines.value.push({ cmd: true, text: '' }) - 1;
    for (const ch of text) {
        if (stopped) return;
        lines.value[idx].text += ch;
        await sleep(45);
    }
    await sleep(400);
}

async function run() {
    while (!stopped) {
        lines.value = [];
        for (const step of script) {
            if (stopped) return;
            if (step.t === 'cmd') await typeCmd(step.c);
            else { push({ cmd: false, text: step.x }); await sleep(200); }
        }
        await sleep(1600);           // hold so the output is readable
        if (stopped) return;
        await typeCmd('clear');      // type `clear` for real…
        await sleep(450);            // …then the loop wipes the screen
    }
}

onMounted(() => {
    tick();
    clockTimer = setInterval(tick, 1000 * 20);
    const resize = () => {
        if (viewport.value) scale.value = viewport.value.clientWidth / DESIGN_W;
    };
    resize();
    ro = new ResizeObserver(resize);
    if (viewport.value) ro.observe(viewport.value);
    run();
});
onBeforeUnmount(() => {
    stopped = true;
    timers.forEach(clearTimeout); timers.clear();
    if (clockTimer) clearInterval(clockTimer);
    if (ro) ro.disconnect();
});

// static file listing for the File Explorer window
const files = [
    { icon: '📁', name: 'sites-enabled', size: '' },
    { icon: '📁', name: 'conf.d', size: '' },
    { icon: '📄', name: 'nginx.conf', size: '1.4 KB', sel: true },
    { icon: '📄', name: 'mime.types', size: '5.1 KB' },
    { icon: '📄', name: 'fastcgi.conf', size: '1.1 KB' },
];
</script>

<template>
    <div ref="viewport" class="demo-viewport rounded-xl border border-[#45475a] shadow-2xl shadow-black/60">
        <div class="demo-scene" :style="{ transform: `scale(${scale})` }">
            <!-- Desktop background -->
            <div class="desktop-bg"></div>

            <!-- Taskbar -->
            <div class="absolute top-0 left-0 right-0 h-9 bg-[#11111b] flex items-center z-40 px-2">
                <!-- traffic lights -->
                <div class="flex items-center gap-2 pl-1 pr-3">
                    <span class="w-3 h-3 rounded-full bg-[#f38ba8]"></span>
                    <span class="w-3 h-3 rounded-full bg-[#f9e2af]"></span>
                    <span class="w-3 h-3 rounded-full bg-[#a6e3a1]"></span>
                </div>
                <button class="h-6 px-2 rounded text-xs text-[#6c7086]">☰</button>
                <!-- window tabs -->
                <div class="flex items-center gap-1 mx-2">
                    <span class="h-6 flex items-center px-2.5 rounded text-xs bg-white/10 text-[#cdd6f4]">Terminal — prod-01</span>
                    <span class="h-6 flex items-center px-2.5 rounded text-xs text-[#6c7086]">Files</span>
                    <span class="h-6 flex items-center px-2.5 rounded text-xs text-[#6c7086]">Docker</span>
                </div>
                <div class="ml-auto flex items-center gap-2.5 pr-1">
                    <span class="text-[11px] text-[#a6e3a1]">●</span>
                    <span class="text-xs text-[#a6adc8] tabular-nums">{{ clock }}</span>
                </div>
            </div>

            <!-- File Explorer window (behind) -->
            <div class="win absolute" style="left:534px; top:150px; width:420px; height:300px; z-index:10;">
                <div class="win-title inactive">
                    <span class="text-xs text-[#cdd6f4] font-medium">File Explorer</span>
                    <div class="win-controls">
                        <span class="win-btn">—</span><span class="win-btn">□</span><span class="win-btn">✕</span>
                    </div>
                </div>
                <div class="flex-1 bg-[#1e1e2e] overflow-hidden">
                    <!-- path bar -->
                    <div class="flex items-center gap-1.5 px-2 py-1.5 bg-[#181825] border-b border-[#313244]">
                        <span class="px-1.5 py-0.5 bg-white/5 text-[#cdd6f4] text-xs rounded">⬆</span>
                        <span class="px-1.5 py-0.5 bg-white/5 text-[#cdd6f4] text-xs rounded">↻</span>
                        <span class="flex-1 font-mono text-xs text-[#a6adc8] truncate">/etc/nginx</span>
                    </div>
                    <!-- rows -->
                    <div v-for="f in files" :key="f.name"
                         class="flex items-center gap-2 px-2 py-1 border-b border-white/[0.03] text-[13px] text-[#cdd6f4]"
                         :class="f.sel ? 'bg-[#89b4fa]/15' : ''">
                        <span class="text-base shrink-0">{{ f.icon }}</span>
                        <span class="flex-1 truncate">{{ f.name }}</span>
                        <span class="w-[64px] text-right text-[11px] text-[#a6adc8]">{{ f.size || '-' }}</span>
                    </div>
                </div>
            </div>

            <!-- Terminal window (active, front) -->
            <div class="win absolute" style="left:60px; top:92px; width:520px; height:360px; z-index:20;">
                <div class="win-title active">
                    <span class="text-xs text-[#cdd6f4] font-medium">Terminal — prod-01</span>
                    <div class="win-controls">
                        <span class="win-btn">—</span><span class="win-btn">□</span><span class="win-btn win-close">✕</span>
                    </div>
                </div>
                <div class="flex-1 bg-[#1e1e2e] p-3 font-mono text-[12.5px] leading-[1.55] overflow-hidden">
                    <div v-for="(l, i) in lines" :key="i" class="whitespace-pre">
                        <template v-if="l.cmd">
                            <span class="text-[#a6e3a1]">deploy@prod-01</span><span class="text-[#cdd6f4]">:</span><span class="text-[#89b4fa]">~</span><span class="text-[#cdd6f4]">$ {{ l.text }}</span>
                        </template>
                        <span v-else class="text-[#a6adc8]">{{ l.text }}</span>
                    </div>
                    <span class="term-cursor"></span>
                </div>
            </div>

            <!-- launcher hint -->
            <div class="absolute left-1/2 -translate-x-1/2 bottom-5 text-xs text-[#6c7086] flex items-center gap-1.5">
                Press
                <kbd class="px-1.5 py-0.5 rounded bg-[#1e1e2e] border border-[#45475a] text-[#a6adc8] font-mono text-[11px]">⌘K</kbd>
                to open launcher
            </div>
        </div>
    </div>
</template>

<style scoped>
.demo-viewport {
    position: relative;
    width: 100%;
    aspect-ratio: 1000 / 600;
    overflow: hidden;
    background: #11111b;
}
.demo-scene {
    position: absolute;
    top: 0;
    left: 0;
    width: 1000px;
    height: 600px;
    transform-origin: top left;
    text-align: left; /* hero section is text-center; don't inherit it into the mock */
}
.desktop-bg {
    position: absolute;
    inset: 0;
    background:
        radial-gradient(ellipse at 20% 50%, rgba(137, 180, 250, 0.08) 0%, transparent 60%),
        radial-gradient(ellipse at 80% 30%, rgba(245, 194, 231, 0.06) 0%, transparent 60%),
        radial-gradient(ellipse at 50% 80%, rgba(166, 227, 161, 0.05) 0%, transparent 60%),
        linear-gradient(180deg, #1e1e2e 0%, #11111b 100%);
}
.win {
    display: flex;
    flex-direction: column;
    background: #1e1e2e;
    border: 1px solid #45475a;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
}
.win-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 32px;
    padding: 0 8px;
    flex-shrink: 0;
}
.win-title.active   { background: #11111b; }
.win-title.inactive { background: #181825; }
.win-controls { display: flex; gap: 4px; }
.win-btn {
    width: 20px; height: 20px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 4px;
    font-size: 10px;
    color: #cdd6f4;
}
.term-cursor {
    display: inline-block;
    width: 8px; height: 15px;
    vertical-align: text-bottom;
    background: #89b4fa;
    animation: blink 1.05s steps(1) infinite;
}
@keyframes blink { 50% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .term-cursor { animation: none; } }
</style>

<script setup>
import { ref, reactive, onMounted, inject, onBeforeUnmount, computed } from 'vue';
import { ssh } from '../../stores/ssh.js';
import PermissionsDialog from './PermissionsDialog.vue';

const props = defineProps({ sessionId: Number });
const emit = defineEmits(['open-file']);
const openInEditor = inject('openInEditor', null);
const openInImageViewer = inject('openImageViewer', null);
const openTerminalAt = inject('openTerminalAt', null);
const imageExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico']);

const currentPath = ref('/');
const files = ref([]);
const loading = ref(false);
const error = ref('');
const selectedFile = ref(null);
const fileContent = ref('');
const viewingFile = ref('');
const dirCache = {};

// ── Predictive permissions ──
// Our identity on the remote (fetched in the background — never blocks startup) and
// the stat of the directory currently shown. Together they let us predict whether a
// write op will succeed, so we only apply optimistic UI when it actually would.
const myId = reactive({ uid: null, gid: null, groups: new Set(), loaded: false });
const cwdStat = ref(null); // { mode, uid, gid } of currentPath
// Per-session id cache shared across all File Explorer windows (fetched once).
const idCache = (globalThis.__feIdCache ||= new Map());

// Does our identity have the requested bits (w/x) on a node with this mode/owner?
function hasPerm(mode, fileUid, fileGid, needW, needX) {
    if (!myId.loaded || mode == null) return true;   // unknown → stay permissive, don't block
    if (myId.uid === 0) return true;                 // root
    let w, x;
    if (myId.uid === fileUid) { w = 0o200; x = 0o100; }
    else if (myId.gid === fileGid || myId.groups.has(fileGid)) { w = 0o020; x = 0o010; }
    else { w = 0o002; x = 0o001; }
    if (needW && !(mode & w)) return false;
    if (needX && !(mode & x)) return false;
    return true;
}
// Creating/deleting/renaming entries needs write+execute on the *directory* itself.
const canWriteCwd = computed(() => {
    if (!cwdStat.value) return true; // not yet known → permissive
    return hasPerm(cwdStat.value.mode, cwdStat.value.uid, cwdStat.value.gid, true, true);
});

// Our uid/gid/groups are fixed for the lifetime of an SSH session, so fetch them
// exactly once per session and share the result across every File Explorer window
// (idCache lives at module scope). A failed probe is not cached, so it retries later.
function loadIdInfo() {
    if (!window.app?.ssh?.execCapture) return;
    let p = idCache.get(props.sessionId);
    if (!p) {
        p = window.app.ssh.execCapture(props.sessionId, 'id -u; id -g; id -G').then((res) => {
            if (!res || res.error) { idCache.delete(props.sessionId); return null; }
            const lines = String(res.output || '').trim().split('\n');
            const uid = parseInt(lines[0], 10), gid = parseInt(lines[1], 10);
            if (Number.isNaN(uid)) { idCache.delete(props.sessionId); return null; }
            return { uid, gid, groups: new Set(String(lines[2] || '').trim().split(/\s+/).map(Number).filter(n => !Number.isNaN(n))) };
        }).catch(() => { idCache.delete(props.sessionId); return null; });
        idCache.set(props.sessionId, p);
    }
    p.then((info) => { if (info) { myId.uid = info.uid; myId.gid = info.gid; myId.groups = info.groups; myId.loaded = true; } });
}

// ── Clipboard ──
const clipboard = ref(null); // { path, name, op: 'copy'|'cut' }

// ── Context menu ──
const ctxMenu = ref({ show: false, x: 0, y: 0, file: null });

// ── Permissions dialog ──
const permFile = ref(null);

// ── Rename ──
const renaming = ref(null); // file being renamed
const renameValue = ref('');

// ── Drag ──
const draggedFile = ref(null);

// ── Listeners ──
onMounted(() => {
    // sfp.list — директории работают через ssh.on (проверено)
    const u1 = ssh.on(props.sessionId, 'ssh.sftp.listResult', (data) => {
        if (data.path !== currentPath.value) return;
        if (data.error) { error.value = data.error; loading.value = false; return; }
        const list = (data.files || []).filter(f => f.name !== '.' && f.name !== '..');
        list.sort((a, b) => { if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1; return a.name.localeCompare(b.name); });
        dirCache[data.path] = list;
        if (currentPath.value === data.path) { files.value = list; loading.value = false; }
    });
    // sftp.read — прямой recieve (надёжнее)
    let unsubRead = null;
    if (window.app) {
        unsubRead = window.app.recieve((msg) => {
            if (msg.method === 'ssh.sftp.readResult' && msg.data?.sessionId === props.sessionId) {
                if (msg.data.path !== viewingFile.value) return;
                fileContent.value = msg.data.error || msg.data.content || '(empty)';
            }
        });
    }
    // Listen for exec results via direct recieve (ssh.on doesn't route ssh.exec.result)
    let unsubExec = null;
    if (window.app) {
        unsubExec = window.app.recieve((msg) => {
            if (msg.method === 'ssh.exec.result' && msg.data?.sessionId === props.sessionId) {
                refreshSilent();
            }
        });
    }
    // SFTP write results (upload / save) — refresh the dir so the new file shows up
    let unsubWrite = null;
    if (window.app) {
        unsubWrite = window.app.recieve((msg) => {
            if (msg.method === 'ssh.sftp.writeResult' && msg.data?.sessionId === props.sessionId) {
                if (msg.data.error) { error.value = msg.data.error; return; }
                // Reload the directory the written file lives in, if it's the one shown.
                const dir = msg.data.path.replace(/\/[^/]*$/, '') || '/';
                if (dir === currentPath.value) refreshSilent();
            }
        });
    }
    // Binary download results
    let unsubDl = null;
    if (window.app) {
        unsubDl = window.app.recieve((msg) => {
            if (msg.method === 'ssh.sftp.binaryResult' && msg.data?.sessionId === props.sessionId) {
                const { base64, path: dlPath } = msg.data;
                if (base64 && window.__pendingDownload === dlPath) {
                    window.__pendingDownload = null;
                    window.app.saveFile(dlPath.split('/').pop(), base64);
                }
            }
        });
    }
    // Directory stat results → feed predictive permission checks
    let unsubStat = null;
    if (window.app) {
        unsubStat = window.app.recieve((msg) => {
            if (msg.method === 'ssh.sftp.statResult' && msg.data?.sessionId === props.sessionId) {
                if (msg.data.path === currentPath.value && msg.data.stat) cwdStat.value = msg.data.stat;
            }
        });
    }
    onBeforeUnmount(() => { u1(); unsubRead(); unsubExec(); unsubWrite && unsubWrite(); unsubDl(); unsubStat && unsubStat(); document.removeEventListener('click', onGlobalClick); });
    loadIdInfo();   // background — does not block the initial listing
    loadDir('/');
    document.addEventListener('click', onGlobalClick);
});

// ── Helpers ──
function fileIcon(file) {
    if (file.isDirectory) return '📁';
    const n = file.name.toLowerCase();
    if (n.endsWith('.sh')||n.endsWith('.bash')) return '📜';
    if (n.endsWith('.js')||n.endsWith('.ts')||n.endsWith('.py')||n.endsWith('.rb')) return '📝';
    if (n.endsWith('.json')||n.endsWith('.xml')||n.endsWith('.yml')) return '📋';
    return '📄';
}
function formatSize(b) { if (!b) return '-'; if (b<1024) return b+' B'; if (b<1048576) return (b/1024).toFixed(1)+' KB'; if (b<1073741824) return (b/1048576).toFixed(1)+' MB'; return (b/1073741824).toFixed(1)+' GB'; }
function formatDate(ts) { return ts ? new Date(ts*1000).toLocaleString() : '-'; }
function fmtPerms(mode) { if (!mode) return ''; const t = (mode & 0o170000) === 0o040000 ? 'd' : '-'; const r = (s) => (mode&s)?'r':'-'; const w = (s) => (mode&s)?'w':'-'; const x = (s) => (mode&s)?'x':'-'; return t+r(0o400)+w(0o200)+x(0o100)+r(0o40)+w(0o20)+x(0o10)+r(0o4)+w(0o2)+x(0o1); }
function fullPath(name) { return currentPath.value === '/' ? '/'+name : currentPath.value+'/'+name; }

// ── Navigation ──
function loadDir(path) {
    const target = path || '/';
    files.value = []; loading.value = true; error.value = ''; selectedFile.value = null; viewingFile.value = ''; currentPath.value = target;
    cwdStat.value = null;
    if (window.app) window.app.ssh.sftp.stat(props.sessionId, target); // for predictive perms
    if (dirCache[target]) { files.value = dirCache[target]; loading.value = false; return; }
    if (window.app) window.app.ssh.sftp.list(props.sessionId, target);
}
function enterDir(name) { loadDir(fullPath(name)); }
// Force a re-fetch of the current dir (refresh button) — bypasses dirCache.
// loadDir re-stats the dir, so dir perms are re-verified here too.
function refreshDir() { delete dirCache[currentPath.value]; loadDir(currentPath.value); }
// Re-fetch the current dir WITHOUT clearing the list or showing a spinner. Used to
// reconcile optimistic updates against the real server state in the background: if an
// op succeeded the list is unchanged, if it failed (no perms) the truth is restored —
// either way no flicker, no blocking.
function refreshSilent() { delete dirCache[currentPath.value]; if (window.app) window.app.ssh.sftp.list(props.sessionId, currentPath.value); }
// Keep dirs-first, then alphabetical — same ordering the listResult handler applies.
function resortFiles() { files.value.sort((a, b) => { if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1; return a.name.localeCompare(b.name); }); }
// Collision-safe name for a copy: keep the original if free, else `_copy`, else
// `_copy_<rand>` regenerated until unique.
function uniqueCopyName(name, existing) {
    if (!existing.has(name)) return name;
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let cand = base + '_copy' + ext;
    if (!existing.has(cand)) return cand;
    do { cand = base + '_copy_' + randSuffix() + ext; } while (existing.has(cand));
    return cand;
}
function goUp() { if (currentPath.value === '/') return; const p = currentPath.value.split('/').filter(Boolean); p.pop(); loadDir('/'+p.join('/')||'/'); }
function viewFile(file) {
    if (file.isDirectory) { enterDir(file.name); return; }
    const fp = fullPath(file.name);
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext && imageExts.has(ext) && openInImageViewer) { openInImageViewer(fp, file.name, props.sessionId); return; }
    if (openInEditor) { openInEditor(fp, file.name, props.sessionId); return; }
    viewingFile.value = fp; fileContent.value = 'Loading...';
    if (window.app) window.app.ssh.sftp.read(props.sessionId, fp);
}
function closeViewer() { viewingFile.value = ''; fileContent.value = ''; }
function refreshViewer() { if (viewingFile.value && window.app) window.app.ssh.sftp.read(props.sessionId, viewingFile.value); }

// ── Exec helper ──
function exec(cmd) { if (window.app) window.app.ssh.exec(props.sessionId, cmd); }

// ── Clipboard operations ──
function copyFile(file) { clipboard.value = { path: fullPath(file.name), name: file.name, op: 'copy', file }; ctxMenu.value.show = false; }
function cutFile(file) { clipboard.value = { path: fullPath(file.name), name: file.name, op: 'cut', file }; ctxMenu.value.show = false; }
function randSuffix() { return Math.random().toString(36).slice(2, 5); }

function pasteFile() {
    if (!clipboard.value) return;
    const { path: src, name, op, file: srcFile } = clipboard.value;
    const isCopy = op === 'copy';
    const existing = new Set(files.value.map(f => f.name));
    // Copy: keep the original name unless it collides; move: keep the name as-is.
    const dstName = isCopy ? uniqueCopyName(name, existing) : name;
    const dst = fullPath(dstName);
    exec(`${isCopy?'cp -r':'mv'} "${src}" "${dst}"`);
    // Optimistic only when we predict we can write into this dir.
    if (canWriteCwd.value && srcFile && !existing.has(dstName)) { files.value.push({ ...srcFile, name: dstName }); resortFiles(); }
    if (!isCopy) clipboard.value = null;
}
function deleteSelected() {
    const file = selectedFile.value ? files.value.find(f=>f.name===selectedFile.value) : null;
    if (!file) return;
    exec(`rm -${file.isDirectory?'rf':'f'} "${fullPath(file.name)}"`);
    if (canWriteCwd.value) files.value = files.value.filter(f => f.name !== file.name); // optimistic
    selectedFile.value = null;
    ctxMenu.value.show = false;
}
function deleteFileByName(name) {
    const file = files.value.find(f=>f.name===name);
    if (!file) return;
    exec(`rm -${file.isDirectory?'rf':'f'} "${fullPath(name)}"`);
    if (canWriteCwd.value) files.value = files.value.filter(f => f.name !== name); // optimistic
}

// ── Rename ──
function startRename(file) {
    renaming.value = file; renameValue.value = file.name; ctxMenu.value.show = false;
    setTimeout(() => { const inp = document.querySelector('.fe-rename-input'); if (inp) { inp.focus(); inp.select(); } }, 50);
}
function finishRename() {
    if (!renaming.value || !renameValue.value || renameValue.value === renaming.value.name) { renaming.value = null; return; }
    const oldName = renaming.value.name, newName = renameValue.value;
    exec(`mv "${fullPath(oldName)}" "${fullPath(newName)}"`);
    if (canWriteCwd.value) { // optimistic
        const f = files.value.find(x => x.name === oldName);
        if (f) { f.name = newName; resortFiles(); }
        if (selectedFile.value === oldName) selectedFile.value = newName;
    }
    renaming.value = null;
}
function cancelRename() { renaming.value = null; }

// ── Context menu ──
function showContextMenu(e, file) {
    e.preventDefault();
    e.stopPropagation();
    selectedFile.value = file ? file.name : null;
    ctxMenu.value = { show: true, x: e.clientX, y: e.clientY, file };
}
function hideContextMenu() { ctxMenu.value.show = false; }

// ── New folder ──
const creatingFolder = ref(false);
const newFolderName = ref('');

function startNewFolder() {
    creatingFolder.value = true;
    newFolderName.value = '';
    hideContextMenu();
    setTimeout(() => { const inp = document.querySelector('.fe-new-folder-input'); if (inp) inp.focus(); }, 50);
}
function finishNewFolder() {
    const name = newFolderName.value.trim();
    if (!name) { creatingFolder.value = false; return; }
    exec(`mkdir -p "${fullPath(name)}"`);
    if (canWriteCwd.value && !files.value.some(f => f.name === name)) { // optimistic
        files.value.push({ name, isDirectory: true, isFile: false, size: 0, mode: 0o040755, mtime: Date.now() / 1000 });
        resortFiles();
    }
    creatingFolder.value = false;
    newFolderName.value = '';
}
function cancelNewFolder() { creatingFolder.value = false; newFolderName.value = ''; }

// ── New file ──
const creatingFile = ref(false);
const newFileName = ref('');

function startNewFile() {
    creatingFile.value = true;
    newFileName.value = '';
    hideContextMenu();
    setTimeout(() => { const inp = document.querySelector('.fe-new-file-input'); if (inp) inp.focus(); }, 50);
}
function finishNewFile() {
    const name = newFileName.value.trim();
    if (!name) { creatingFile.value = false; return; }
    exec(`touch "${fullPath(name)}"`);
    if (canWriteCwd.value && !files.value.some(f => f.name === name)) { // optimistic
        files.value.push({ name, isDirectory: false, isFile: true, size: 0, mode: 0o100644, mtime: Date.now() / 1000 });
        resortFiles();
    }
    creatingFile.value = false;
    newFileName.value = '';
}
function cancelNewFile() { creatingFile.value = false; newFileName.value = ''; }

// ── Upload ──
const fileInput = ref(null);
function triggerUpload() {
    hideContextMenu();
    setTimeout(() => fileInput.value?.click(), 100);
}
function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        const arr = new Uint8Array(reader.result);
        let binary = '';
        for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
        const base64 = btoa(binary);
        if (window.app) {
            window.app.ssh.sftp.write(props.sessionId, fullPath(file.name), base64, true);
        }
        // Optimistic: show the uploaded file right away; writeResult reconciles.
        if (canWriteCwd.value) {
            const existing = files.value.find(f => f.name === file.name);
            if (existing) { existing.size = file.size; existing.mtime = Date.now() / 1000; }
            else { files.value.push({ name: file.name, isDirectory: false, isFile: true, size: file.size, mode: 0o100644, mtime: Date.now() / 1000 }); resortFiles(); }
        }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
}

// ── Download ──
async function downloadFile(file) {
    if (!file || file.isDirectory) return;
    hideContextMenu();
    const fp = fullPath(file.name);
    if (!window.app) return;
    // Read binary via sftp
    window.app.ssh.sftp.readBinary(props.sessionId, fp);
}
// Listen for binary result in onMounted
// (handled via unsubDl in onMounted)

function triggerDownload(file) {
    window.__pendingDownload = fullPath(file.name);
    downloadFile(file);
}

// ── Zip / Unzip ──
function zipFile(file) {
    if (!file) return;
    hideContextMenu();
    const fp = fullPath(file.name);
    const zipName = file.isDirectory ? file.name + '.zip' : file.name.replace(/\.[^.]+$/, '') + '.zip';
    exec(`cd "${currentPath.value}" && zip -r "${zipName}" "${file.name}"`);
}
function unzipFile(file) {
    if (!file) return;
    hideContextMenu();
    const fp = fullPath(file.name);
    const dirName = file.name.replace(/\.zip$/i, '');
    exec(`cd "${currentPath.value}" && mkdir -p "${dirName}" && unzip -o "${file.name}" -d "${dirName}"`);
}

// ── Open terminal here ──
function openTerminalHere(file) {
    hideContextMenu();
    const dir = (file && file.isDirectory) ? fullPath(file.name) : currentPath.value;
    if (openTerminalAt) openTerminalAt(dir, props.sessionId);
}

// ── Permissions / ownership ──
function openPermissions(file) { permFile.value = file; hideContextMenu(); }
function applyPermissions(out) {
    if (!permFile.value) return;
    const fp = fullPath(permFile.value.name);
    const R = out.recursive ? '-R ' : '';
    const cmds = [];
    if (out.chmod) cmds.push(`chmod ${R}${out.chmod} "${fp}"`);
    if (out.chown) cmds.push(`chown ${R}${out.chown} "${fp}"`);
    if (cmds.length) exec(cmds.join(' && '));
    permFile.value = null;
}

function onDragStart(e, file) { draggedFile.value = file; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', file.name); }
function onDragOver(e, file) { if (file.isDirectory && draggedFile.value && draggedFile.value !== file) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }
function onDrop(e, dir) {
    e.preventDefault();
    if (!draggedFile.value || !dir.isDirectory || draggedFile.value === dir) return;
    exec(`mv "${fullPath(draggedFile.value.name)}" "${fullPath(dir.name)}/${draggedFile.value.name}"`);
    draggedFile.value = null;
}

// ── Keyboard ──
function onKeydown(e) {
    if (renaming.value) return;
    if ((e.ctrlKey||e.metaKey) && e.key === 'c') { const f = files.value.find(f=>f.name===selectedFile.value); if(f) copyFile(f); return; }
    if ((e.ctrlKey||e.metaKey) && e.key === 'x') { const f = files.value.find(f=>f.name===selectedFile.value); if(f) cutFile(f); return; }
    if ((e.ctrlKey||e.metaKey) && e.key === 'v') { pasteFile(); return; }
    if (e.key === 'F2') { const f = files.value.find(f=>f.name===selectedFile.value); if(f) startRename(f); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); return; }
    if (e.key === 'Backspace' && !selectedFile.value) { goUp(); return; }
}
function onGlobalClick() { hideContextMenu(); }

</script>

<template>
    <div class="flex flex-col h-full text-[#cdd6f4] text-[13px]" tabindex="0" @keydown="onKeydown">
        <!-- Path bar -->
        <div class="flex items-center gap-1.5 px-2 py-1.5 bg-[#181825] border-b border-[#313244] shrink-0">
            <button class="px-1.5 py-0.5 bg-white/5 text-[#cdd6f4] text-xs rounded hover:bg-white/10 transition-colors" @click="goUp" title="Up">⬆</button>
            <button class="px-1.5 py-0.5 bg-white/5 text-[#cdd6f4] text-xs rounded hover:bg-white/10 transition-colors" @click="refreshDir" title="Refresh">↻</button>
            <span class="flex-1 font-mono text-xs text-[#a6adc8] truncate">{{ currentPath }}</span>
            <span v-if="clipboard" class="text-[10px] text-[#f9e2af] shrink-0">{{ clipboard.op === 'copy' ? '📋' : '✂' }} {{ clipboard.name }}</span>
        </div>

        <div v-if="loading" class="p-5 text-center text-[#a6adc8]">Loading...</div>
        <div v-if="error" class="p-5 text-center text-[#f38ba8]">{{ error }}</div>

        <div class="flex flex-1 overflow-hidden">
            <!-- File list -->
            <div class="@container flex-1 overflow-y-auto min-w-[200px]" :class="{ 'max-w-[250px] border-r border-[#313244]': viewingFile }" @contextmenu="showContextMenu($event, null)">
                <div v-for="f in files" :key="f.name"
                    class="flex items-center gap-2 px-2 py-1 cursor-pointer border-b border-white/[0.03] hover:bg-white/5 transition-colors"
                    :class="{ 'bg-[#89b4fa]/15': selectedFile === f.name }"
                    :draggable="!renaming"
                    @click="selectedFile = f.name" @dblclick="viewFile(f)"
                    @contextmenu="showContextMenu($event, f)"
                    @dragstart="onDragStart($event, f)"
                    @dragover="onDragOver($event, f)"
                    @drop="onDrop($event, f)">
                    <span class="text-base shrink-0">{{ fileIcon(f) }}</span>
                    <!-- Rename input or label -->
                    <input v-if="renaming && renaming.name === f.name" v-model="renameValue" class="fe-rename-input flex-1 px-1 py-0 bg-[#11111b] border border-[#89b4fa] rounded text-xs text-[#cdd6f4] outline-none" @keydown.enter="finishRename" @keydown.escape="cancelRename" @blur="finishRename" />
                    <span v-else class="flex-1 truncate">{{ f.name }}</span>
                    <span class="w-[70px] text-right text-[11px] text-[#a6adc8] shrink-0">{{ f.isDirectory ? '-' : formatSize(f.size) }}</span>
                    <span class="w-[130px] text-right text-[11px] text-[#a6adc8] shrink-0 hidden @[380px]:block">{{ formatDate(f.mtime) }}</span>
                </div>
                <div v-if="!loading && files.length===0 && !creatingFolder && !creatingFile" class="p-5 text-center text-[#a6adc8]">Empty</div>
                <!-- New folder inline row -->
                <div v-if="creatingFolder" class="flex items-center gap-2 px-2 py-1 border-b border-white/[0.03]">
                    <span class="text-base shrink-0">📁</span>
                    <input v-model="newFolderName" class="fe-new-folder-input flex-1 px-1 py-0 bg-[#11111b] border border-[#89b4fa] rounded text-xs text-[#cdd6f4] outline-none" placeholder="folder name" @keydown.enter="finishNewFolder" @keydown.escape="cancelNewFolder" @blur="finishNewFolder" />
                </div>
                <!-- New file inline row -->
                <div v-if="creatingFile" class="flex items-center gap-2 px-2 py-1 border-b border-white/[0.03]">
                    <span class="text-base shrink-0">📄</span>
                    <input v-model="newFileName" class="fe-new-file-input flex-1 px-1 py-0 bg-[#11111b] border border-[#89b4fa] rounded text-xs text-[#cdd6f4] outline-none" placeholder="file name" @keydown.enter="finishNewFile" @keydown.escape="cancelNewFile" @blur="finishNewFile" />
                </div>
            </div>

            <!-- File viewer -->
            <div v-if="viewingFile" class="flex-1 flex flex-col overflow-hidden">
                <div class="flex items-center justify-between px-2 py-1 bg-[#181825] border-b border-[#313244] shrink-0">
                    <span class="font-mono text-xs text-[#a6adc8] truncate">{{ viewingFile }}</span>
                    <div class="flex gap-1">
                        <button class="px-1.5 py-0.5 bg-white/5 text-[#cdd6f4] text-xs rounded hover:bg-white/10 transition-colors" @click="refreshViewer">↻</button>
                        <button class="px-1.5 py-0.5 bg-white/5 text-[#cdd6f4] text-xs rounded hover:bg-white/10 transition-colors" @click="closeViewer">✕</button>
                    </div>
                </div>
                <pre class="selectable flex-1 overflow-auto p-2 m-0 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">{{ fileContent }}</pre>
            </div>
        </div>

        <!-- Context menu (compact) -->
        <div v-if="ctxMenu.show" class="fixed z-[30000] bg-[#1e1e2e] border border-[#45475a] rounded-lg shadow-xl py-0.5 min-w-[140px] text-[12px]" :style="{ left: ctxMenu.x+'px', top: ctxMenu.y+'px' }" @click.stop>
            <div class="px-2.5 py-1 text-[10px] text-[#a6adc8] uppercase">{{ ctxMenu.file ? ctxMenu.file.name : currentPath }}</div>
            <div class="border-t border-[#313244]"></div>
            <button v-if="ctxMenu.file" class="w-full text-left px-2.5 py-1 hover:bg-white/5 transition-colors" @click="copyFile(ctxMenu.file)">Copy</button>
            <button v-if="ctxMenu.file" class="w-full text-left px-2.5 py-1 hover:bg-white/5 transition-colors" @click="cutFile(ctxMenu.file)">Cut</button>
            <button v-if="clipboard" class="w-full text-left px-2.5 py-1 hover:bg-white/5 transition-colors" @click="pasteFile(); hideContextMenu()">Paste</button>
            <button v-if="ctxMenu.file" class="w-full text-left px-2.5 py-1 hover:bg-white/5 transition-colors" @click="startRename(ctxMenu.file)">Rename</button>
            <button v-if="ctxMenu.file" class="w-full text-left px-2.5 py-1 hover:bg-white/5 transition-colors" @click="triggerDownload(ctxMenu.file)">Download</button>
            <button v-if="ctxMenu.file" class="w-full text-left px-2.5 py-1 hover:bg-white/5 transition-colors" @click="zipFile(ctxMenu.file)">Zip</button>
            <button v-if="ctxMenu.file && ctxMenu.file.name.endsWith('.zip')" class="w-full text-left px-2.5 py-1 hover:bg-white/5 transition-colors" @click="unzipFile(ctxMenu.file)">Unzip</button>
            <button v-if="ctxMenu.file" class="w-full text-left px-2.5 py-1 hover:bg-white/5 transition-colors" @click="openPermissions(ctxMenu.file)">Permissions…</button>
            <button v-if="ctxMenu.file" class="w-full text-left px-2.5 py-1 hover:bg-white/5 transition-colors text-[#f38ba8]" @click="deleteSelected(); hideContextMenu()">Delete</button>
            <div class="border-t border-[#313244]"></div>
            <button class="w-full text-left px-2.5 py-1 hover:bg-white/5 transition-colors" @click="openTerminalHere(ctxMenu.file)">Open terminal here</button>
            <button class="w-full text-left px-2.5 py-1 hover:bg-white/5 transition-colors" @click="startNewFile()">New File</button>
            <button class="w-full text-left px-2.5 py-1 hover:bg-white/5 transition-colors" @click="startNewFolder()">New Folder</button>
            <button class="w-full text-left px-2.5 py-1 hover:bg-white/5 transition-colors" @click="triggerUpload()">Upload</button>
            <div class="border-t border-[#313244]"></div>
            <button class="w-full text-left px-2.5 py-1 hover:bg-white/5 transition-colors" @click="refreshDir(); hideContextMenu()">Refresh</button>
        </div>
        <!-- Hidden file input for upload -->
        <input ref="fileInput" type="file" class="hidden" @change="handleUpload" />

        <!-- Permissions / ownership dialog -->
        <PermissionsDialog v-if="permFile" :file="permFile" :path="fullPath(permFile.name)" @close="permFile = null" @apply="applyPermissions" />
    </div>
</template>

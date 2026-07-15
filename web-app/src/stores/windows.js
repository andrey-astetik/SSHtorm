// Window Manager Store — singleton (globalThis avoids Vite chunk duplication)
import { reactive, ref } from 'vue';

const _wm = (() => {
    if (globalThis.__wmStore) return globalThis.__wmStore;

    const state = reactive({ windows: [], nextZ: 100, nextId: 1, activeWindowId: null });
    const anyMaximized = ref(false);
    function recompute() { anyMaximized.value = state.windows.some(w => w.maximized); }

    function openWindow(cfg) {
        const id = state.nextId++;
        const w = { id, title: cfg.title || 'Window', type: cfg.type || 'default', component: cfg.component || null, props: cfg.props || {}, x: cfg.x || 80 + Math.random() * 200, y: cfg.y || 60 + Math.random() * 150, w: cfg.w || 700, h: cfg.h || 450, minW: cfg.minW || 300, minH: cfg.minH || 200, z: ++state.nextZ, minimized: false, maximized: false, _saved: null, sessionId: null };
        state.windows.push(w); state.activeWindowId = id;
        return id;
    }

    function closeWindow(id) {
        const i = state.windows.findIndex(w => w.id === id);
        if (i !== -1) { state.windows.splice(i, 1); if (state.activeWindowId === id) state.activeWindowId = state.windows.length ? state.windows[state.windows.length - 1].id : null; recompute(); }
    }

    function focusWindow(id) {
        const w = state.windows.find(w => w.id === id);
        if (w) { w.z = ++state.nextZ; state.activeWindowId = id; if (w.minimized) w.minimized = false; }
    }

    function minimizeWindow(id) {
        const w = state.windows.find(w => w.id === id);
        if (w) { w.minimized = !w.minimized; if (w.minimized) state.activeWindowId = state.windows.filter(w => !w.minimized).pop()?.id || null; else focusWindow(id); }
    }

    function toggleMaximize(id) {
        const w = state.windows.find(w => w.id === id);
        if (w) {
            if (w.maximized) { if (w._saved) { w.x = w._saved.x; w.y = w._saved.y; w.w = w._saved.w; w.h = w._saved.h; } w.maximized = false; w._saved = null; }
            else { const tb = 38; w._saved = { x: w.x, y: w.y, w: w.w, h: w.h }; w.x = 0; w.y = tb; w.w = window.innerWidth; w.h = window.innerHeight - tb; w.maximized = true; }
        }
        recompute();
    }

    function centerWindow(id) {
        const w = state.windows.find(w => w.id === id);
        if (!w) return;
        w.minimized = false;
        if (w.maximized) { w.maximized = false; w._saved = null; }
        w.x = Math.max(0, Math.round((window.innerWidth - w.w) / 2));
        w.y = Math.max(36, Math.round((window.innerHeight - w.h) / 2));
        focusWindow(id);
        recompute();
    }

    function updateWindow(id, updates) { const w = state.windows.find(w => w.id === id); if (w) Object.assign(w, updates); }
    function hasWindowOfType(type) { return state.windows.some(w => w.type === type); }

    return globalThis.__wmStore = { state, anyMaximized, openWindow, closeWindow, focusWindow, minimizeWindow, toggleMaximize, centerWindow, updateWindow, hasWindowOfType };
})();

export { _wm as windowManager };
export default () => _wm;
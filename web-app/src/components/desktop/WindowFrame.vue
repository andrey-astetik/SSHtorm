<script setup>
import { ref, computed, onMounted, onBeforeUnmount, provide } from 'vue';
import { windowManager } from '../../stores/windows.js';

const props = defineProps({
    windowId: Number,
    // Belongs to a session that isn't the active one — kept mounted, painted off.
    hidden: { type: Boolean, default: false }
});

const emit = defineEmits(['close']);

// Top taskbar height — windows can't be dragged/resized above it.
const TASKBAR_H = 36;

const win = computed(() => windowManager.state.windows.find(w => w.id === props.windowId));
const isActive = computed(() => windowManager.state.activeWindowId === props.windowId);

// Controls inside a drag region: `@click.stop` on the button stops only `click`,
// while `mousedown` and `dblclick` keep bubbling here. Checked centrally so
// titlebars rendered by slot content obey the same rule.
const CONTROL_SELECTOR = 'button, input, textarea, select, a, [data-no-drag]';
const isControl = (e) => !!e.target?.closest?.(CONTROL_SELECTOR);

// A press below this stays a click and moves nothing. Without the threshold the
// shield would go up on mousedown and take the mouseup with it, leaving the browser
// no pair to build a click — let alone a dblclick — from.
const DRAG_THRESHOLD_PX = 3;

// pendingDrag/pendingResize: pressed, not yet past the threshold.
const dragging = ref(false);
const pendingDrag = ref(false);
const dragStart = ref({ x: 0, y: 0 });
const winStart = ref({ x: 0, y: 0 });

// Resizing state
const resizing = ref(false);
const pendingResize = ref(false);
const resizeEdge = ref('');
const resizeStart = ref({ x: 0, y: 0, w: 0, h: 0, winX: 0, winY: 0 });

function movedEnough(e, from) {
    return Math.abs(e.clientX - from.x) >= DRAG_THRESHOLD_PX
        || Math.abs(e.clientY - from.y) >= DRAG_THRESHOLD_PX;
}

function beginInteraction(cursor) {
    windowManager.state.interactCursor = cursor;
    windowManager.state.interacting = true;
}

function endInteraction() {
    windowManager.state.interacting = false;
}

function onTitleMouseDown(e) {
    if (isControl(e)) return;
    if (win.value?.maximized) return;
    pendingDrag.value = true;
    dragStart.value = { x: e.clientX, y: e.clientY };
    winStart.value = { x: win.value.x, y: win.value.y };
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
}

// Not on the window controls, where it would fight with the button's own action.
function onTitleDblClick(e) {
    if (isControl(e)) return;
    windowManager.toggleMaximize(props.windowId);
}

function onDragMove(e) {
    if (!win.value) return;
    if (pendingDrag.value) {
        if (!movedEnough(e, dragStart.value)) return;
        pendingDrag.value = false;
        dragging.value = true;
        beginInteraction('grabbing');
    }
    if (!dragging.value) return;
    const dx = e.clientX - dragStart.value.x;
    const dy = e.clientY - dragStart.value.y;
    windowManager.updateWindow(props.windowId, {
        x: winStart.value.x + dx,
        y: Math.max(TASKBAR_H, winStart.value.y + dy)   // titlebar can't go under the taskbar
    });
}

function onDragEnd() {
    dragging.value = false;
    pendingDrag.value = false;
    endInteraction();
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
}

// The shield wears the handle's own cursor so it doesn't change under the pointer.
function cursorForEdge(edge) {
    if (edge === 'n' || edge === 's') return 'ns-resize';
    if (edge === 'e' || edge === 'w') return 'ew-resize';
    if (edge === 'ne' || edge === 'sw') return 'nesw-resize';
    return 'nwse-resize';
}

function onResizeStart(e, edge) {
    if (win.value?.maximized) return;
    pendingResize.value = true;
    // Handles stopPropagation below, so the frame's mousedown->focus never runs.
    // Without this the shield can end up beneath a foreground window's webview.
    windowManager.focusWindow(props.windowId);
    resizeEdge.value = edge;
    resizeStart.value = {
        x: e.clientX,
        y: e.clientY,
        w: win.value.w,
        h: win.value.h,
        winX: win.value.x,
        winY: win.value.y
    };
    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onResizeEnd);
    e.stopPropagation();
    e.preventDefault();
}

function onResizeMove(e) {
    if (!win.value) return;
    if (pendingResize.value) {
        if (!movedEnough(e, resizeStart.value)) return;
        pendingResize.value = false;
        resizing.value = true;
        beginInteraction(cursorForEdge(resizeEdge.value));
    }
    if (!resizing.value) return;
    const dx = e.clientX - resizeStart.value.x;
    const dy = e.clientY - resizeStart.value.y;
    const updates = {};
    const edge = resizeEdge.value;

    if (edge.includes('e')) updates.w = Math.max(win.value.minW, resizeStart.value.w + dx);
    if (edge.includes('s')) updates.h = Math.max(win.value.minH, resizeStart.value.h + dy);
    if (edge.includes('w')) {
        const newW = Math.max(win.value.minW, resizeStart.value.w - dx);
        updates.w = newW;
        updates.x = resizeStart.value.winX + resizeStart.value.w - newW;
    }
    if (edge.includes('n')) {
        let newH = Math.max(win.value.minH, resizeStart.value.h - dy);
        let newY = resizeStart.value.winY + resizeStart.value.h - newH;
        if (newY < TASKBAR_H) { newY = TASKBAR_H; newH = resizeStart.value.winY + resizeStart.value.h - TASKBAR_H; }
        updates.h = newH;
        updates.y = newY;
    }

    windowManager.updateWindow(props.windowId, updates);
}

function onResizeEnd() {
    resizing.value = false;
    pendingResize.value = false;
    endInteraction();
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);
}

function focus() {
    windowManager.focusWindow(props.windowId);
}

// Content may veto (unsaved edits): don't announce a close that didn't happen.
function requestClose() {
    if (windowManager.closeWindow(props.windowId)) emit('close');
}

// Expose this window's chrome so slot content that hides the default titlebar
// (e.g. the browser, which puts its tabs there) can render its own titlebar with
// working drag + min/max/close. Avoids Teleport, which corrupts the vdom when
// teleporting from slotted content.
const maximized = computed(() => !!win.value?.maximized);

// Windows stay mounted off-screen, so timer-driven pollers need to know when
// nobody is looking.
const windowVisible = computed(() => !props.hidden && !win.value?.minimized);
provide('windowVisible', windowVisible);

provide('windowChrome', {
    windowId: props.windowId,
    focus: () => windowManager.focusWindow(props.windowId),
    startDrag: onTitleMouseDown,
    // Custom titlebars use this rather than toggleMaximize, for the control check.
    titleDblClick: onTitleDblClick,
    minimize: () => windowManager.minimizeWindow(props.windowId),
    toggleMaximize: () => windowManager.toggleMaximize(props.windowId),
    // A vetoed close must not report itself as a close.
    close: () => { if (windowManager.closeWindow(props.windowId)) emit('close'); },
    maximized
});

onBeforeUnmount(() => {
    // Unmounting mid-gesture would strand the shield.
    if (dragging.value || resizing.value) endInteraction();
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);
});
</script>

<template>
    <div
        v-if="win"
        class="window-frame"
        :class="{
            'window-active': isActive,
            'window-maximized': win.maximized
        }"
        :style="{
            left: win.x + 'px',
            top: win.y + 'px',
            width: win.w + 'px',
            height: win.h + 'px',
            zIndex: win.z,
            display: (win.minimized || hidden) ? 'none' : undefined
        }"
        @mousedown="focus"
    >
        <!-- Resize handles (invisible zones) -->
        <div class="resize-n" @mousedown="onResizeStart($event, 'n')"></div>
        <div class="resize-s" @mousedown="onResizeStart($event, 's')"></div>
        <div class="resize-e" @mousedown="onResizeStart($event, 'e')"></div>
        <div class="resize-w" @mousedown="onResizeStart($event, 'w')"></div>
        <div class="resize-ne" @mousedown="onResizeStart($event, 'ne')"></div>
        <div class="resize-nw" @mousedown="onResizeStart($event, 'nw')"></div>
        <div class="resize-se" @mousedown="onResizeStart($event, 'se')"></div>
        <div class="resize-sw" @mousedown="onResizeStart($event, 'sw')"></div>

        <!-- Title bar (windows with customTitlebar render their own inside the slot) -->
        <div
            v-if="!win.customTitlebar"
            class="window-titlebar"
            @mousedown="onTitleMouseDown"
            @dblclick="onTitleDblClick"
        >
            <div class="window-title">{{ win.title }}</div>
            <div class="window-controls">
                <button class="win-btn win-min" @click.stop="windowManager.minimizeWindow(props.windowId)">&#x2014;</button>
                <button class="win-btn win-max" @click.stop="windowManager.toggleMaximize(props.windowId)">
                    {{ win.maximized ? '❐' : '□' }}
                </button>
                <button class="win-btn win-close" @click.stop="requestClose">✕</button>
            </div>
        </div>

        <!-- Content -->
        <div class="window-content">
            <slot />
        </div>
    </div>
</template>

<style scoped>
.window-frame {
    position: absolute;
    background: #1e1e2e;
    border: 1px solid #45475a;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    transition: box-shadow 0.15s;
}
.window-active {
    border-color: #585b70;
    box-shadow: 0 12px 40px rgba(0,0,0,0.6);
}
.window-maximized {
    border-radius: 0;
    border: none;
}
.window-titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 32px;
    padding: 0 8px;
    background: #181825;
    cursor: grab;
    flex-shrink: 0;
    user-select: none;
}
.window-active .window-titlebar {
    background: #11111b;
}
.window-title {
    font-size: 12px;
    color: #cdd6f4;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.window-controls {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
}
.win-btn {
    width: 20px;
    height: 20px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    color: #cdd6f4;
    background: transparent;
    transition: background 0.15s;
}
.win-btn:hover {
    background: rgba(255,255,255,0.1);
}
.win-close:hover {
    background: #f38ba8;
    color: #11111b;
}
.window-content {
    flex: 1;
    overflow: hidden;
    background: #1e1e2e;
    color: #cdd6f4;
}

/* Resize handles */
.resize-n, .resize-s { position: absolute; left: 8px; right: 8px; height: 6px; cursor: ns-resize; z-index: 10; }
.resize-n { top: 0; }
.resize-s { bottom: 0; }
.resize-e, .resize-w { position: absolute; top: 8px; bottom: 8px; width: 6px; cursor: ew-resize; z-index: 10; }
.resize-e { right: 0; }
.resize-w { left: 0; }
.resize-ne, .resize-nw, .resize-se, .resize-sw { position: absolute; width: 12px; height: 12px; z-index: 10; }
.resize-ne { top: 0; right: 0; cursor: nesw-resize; }
.resize-nw { top: 0; left: 0; cursor: nwse-resize; }
.resize-se { bottom: 0; right: 0; cursor: nwse-resize; }
.resize-sw { bottom: 0; left: 0; cursor: nesw-resize; }

.window-maximized .resize-n,
.window-maximized .resize-s,
.window-maximized .resize-e,
.window-maximized .resize-w,
.window-maximized .resize-ne,
.window-maximized .resize-nw,
.window-maximized .resize-se,
.window-maximized .resize-sw {
    display: none;
}
</style>

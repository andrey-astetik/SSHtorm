<script setup>
import { ssh } from '../../stores/ssh.js';

const prompt = () => ssh.state.hostKeyPrompt;

function trust() { ssh.respondHostKey(true); }
function reject() { ssh.respondHostKey(false); }
</script>

<template>
    <div v-if="prompt()" class="hk-overlay">
        <div class="hk-dialog">
            <div class="hk-head">
                <span class="hk-icon">⚠️</span>
                <h2 class="hk-title">Host key changed</h2>
            </div>
            <p class="hk-text">
                The SSH key for <code class="hk-host selectable">{{ prompt().id }}</code> is different from the one
                you trusted before. This can mean the server was reinstalled — or that someone is
                intercepting the connection (MITM).
            </p>
            <div class="hk-fps selectable">
                <div class="hk-fp"><span class="hk-fp-label">Previously trusted</span><code>{{ prompt().oldFp }}</code></div>
                <div class="hk-fp"><span class="hk-fp-label hk-new">Now presented</span><code>{{ prompt().newFp }}</code></div>
            </div>
            <p class="hk-q">Do you still trust this host?</p>
            <div class="hk-actions">
                <button class="hk-btn hk-no" @click="reject">No, don't connect</button>
                <button class="hk-btn hk-yes" @click="trust">Yes, trust &amp; update</button>
            </div>
        </div>
    </div>
</template>

<style scoped>
.hk-overlay {
    position: fixed; inset: 0; z-index: 25000;
    background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center;
}
.hk-dialog {
    width: 480px; max-width: 92vw; padding: 22px;
    background: #1e1e2e; border: 1px solid #f38ba8; border-radius: 12px;
    box-shadow: 0 16px 48px rgba(0,0,0,0.55); color: #cdd6f4;
}
.hk-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.hk-icon { font-size: 22px; }
.hk-title { margin: 0; font-size: 17px; font-weight: 600; color: #f38ba8; }
.hk-text { font-size: 13px; line-height: 1.5; color: #bac2de; margin: 0 0 14px; }
.hk-host { background: #11111b; padding: 1px 6px; border-radius: 4px; color: #f9e2af; }
.hk-fps { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
.hk-fp { display: flex; flex-direction: column; gap: 3px; }
.hk-fp-label { font-size: 11px; text-transform: uppercase; color: #a6adc8; }
.hk-fp-label.hk-new { color: #f38ba8; }
.hk-fp code {
    font-size: 12px; font-family: monospace; word-break: break-all;
    background: #11111b; border: 1px solid #313244; border-radius: 6px; padding: 6px 8px;
}
.hk-q { font-size: 14px; font-weight: 500; margin: 0 0 16px; }
.hk-actions { display: flex; gap: 10px; justify-content: flex-end; }
.hk-btn { padding: 8px 16px; border: none; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; transition: background 0.15s; }
.hk-no { background: rgba(255,255,255,0.08); color: #cdd6f4; }
.hk-no:hover { background: rgba(255,255,255,0.16); }
.hk-yes { background: #f38ba8; color: #11111b; }
.hk-yes:hover { background: #eb6f93; }
</style>

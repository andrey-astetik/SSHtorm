<script setup>
import { ref, onMounted } from 'vue';

const props = defineProps({
    sessionId: Number,
    filePath: String,
    fileName: String
});

const loading = ref(true);
const error = ref('');
const imageSrc = ref('');
const imageSize = ref(0);

function loadImage() {
    loading.value = true;
    error.value = '';

    if (window.app) {
        window.app.ssh.sftp.readBinary(props.sessionId, props.filePath);
    }

    const handler = (msg) => {
        if (msg.method === 'ssh.sftp.binaryResult' &&
            msg.data.sessionId === props.sessionId &&
            msg.data.path === props.filePath) {
            if (msg.data.error) {
                error.value = msg.data.error;
                loading.value = false;
            } else {
                imageSrc.value = `data:${msg.data.mime};base64,${msg.data.base64}`;
                imageSize.value = msg.data.size;
                loading.value = false;
            }
        }
    };

    if (window.app) {
        window.app.recieve(handler);
    }
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

onMounted(() => {
    if (props.filePath) loadImage();
});
</script>

<template>
    <div class="image-viewer">
        <div class="iv-status">
            <span class="iv-filename">{{ fileName || filePath }}</span>
            <span v-if="imageSize" class="iv-size">{{ formatSize(imageSize) }}</span>
        </div>
        <div class="iv-area">
            <div v-if="loading" class="iv-loading">Loading image...</div>
            <div v-if="error" class="iv-error">{{ error }}</div>
            <img
                v-if="imageSrc"
                :src="imageSrc"
                :alt="fileName"
                class="iv-image"
            />
        </div>
    </div>
</template>

<style scoped>
.image-viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #11111b;
}
.iv-status {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 10px;
    background: #181825;
    border-bottom: 1px solid #313244;
    font-size: 11px;
    flex-shrink: 0;
    user-select: none;
}
.iv-filename {
    color: #cdd6f4;
    font-weight: 500;
}
.iv-size {
    color: #a6adc8;
}
.iv-area {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
    padding: 10px;
}
.iv-loading, .iv-error {
    color: #a6adc8;
    font-size: 14px;
}
.iv-error {
    color: #f38ba8;
}
.iv-image {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 4px;
    box-shadow: 0 2px 16px rgba(0,0,0,0.4);
}
</style>

<script setup>
    defineProps({
        size: {
            type: String,
            default: '1.5em'
        }
    });
</script>

<template>
    <svg xmlns="http://www.w3.org/2000/svg" :style="`width: ${size}; height: ${size};`" fill="currentColor" viewBox="0 0 20 20" >
        <rect x="5" y="5" width="10" height="10" rx="2"></rect>
    </svg>
</template>

<style scoped></style>

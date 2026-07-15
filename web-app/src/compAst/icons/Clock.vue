<script setup>
    defineProps({
        size: {
            type: String,
            default: '1.5em'
        }
    });
</script>

<template>
    <svg xmlns="http://www.w3.org/2000/svg" :style="`width: ${size}; height: ${size};`" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9"></circle>
        <path d="M12 7.5V12l3 1.8"></path>
    </svg>
</template>

<style scoped></style>

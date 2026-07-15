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
        <path d="M12.5 4.5H15.5V7.5" stroke="currentColor" stroke-width="1.33" stroke-linecap="round" stroke-linejoin="round"></path>
        <path d="M12.5 15.5H15.5V12.5" stroke="currentColor" stroke-width="1.33" stroke-linecap="round" stroke-linejoin="round"></path>
        <path d="M3.32996 10H8.01173C8.7455 10 9.11239 10 9.45765 9.91711C9.76376 9.84362 10.0564 9.72241 10.3248 9.55792C10.6276 9.3724 10.887 9.11297 11.4058 8.59411L15.5 4.5" stroke="currentColor" stroke-width="1.33" stroke-linecap="round" stroke-linejoin="round"></path>
        <path d="M12 12L15.5 15.5" stroke="currentColor" stroke-width="1.33" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
</template>

<style scoped></style>
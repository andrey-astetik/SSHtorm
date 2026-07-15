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
        <path d="M6 14.7229V5.27708C6 4.29072 7.08894 3.69295 7.9211 4.22251L15.3428 8.94541C16.1147 9.43661 16.1147 10.5634 15.3428 11.0546L7.92109 15.7775C7.08894 16.307 6 15.7093 6 14.7229Z"></path>
    </svg>
</template>

<style scoped></style>
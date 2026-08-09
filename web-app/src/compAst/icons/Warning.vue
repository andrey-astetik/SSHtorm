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
        <path fill-rule="evenodd" d="M9.137 3.53Q10 1.95 10.863 3.53L17.485 15.658Q18.3 17.15 16.6 17.15L3.4 17.15Q1.7 17.15 2.515 15.658ZM9.449 5.734Q10 4.725 10.551 5.734L15.531 14.855Q16.058 15.82 14.958 15.82L5.042 15.82Q3.942 15.82 4.469 14.855Z"></path>
        <path d="M9.335 8.75A0.665 0.665 0 0 1 10.665 8.75L10.665 11.6A0.665 0.665 0 0 1 9.335 11.6Z"></path>
        <path d="M9.25 14.1A0.75 0.75 0 1 1 10.75 14.1A0.75 0.75 0 1 1 9.25 14.1Z"></path>
    </svg>
</template>

<style scoped></style>

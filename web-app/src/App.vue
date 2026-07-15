<script setup>
import { onMounted } from 'vue';
import { router } from './assets/router';

// Ensure the app takes full height
onMounted(() => {
    document.documentElement.style.height = '100%';
    document.body.style.height = '100%';
    document.getElementById('root').style.height = '100%';
});
</script>

<template>
    <router-view />
</template>

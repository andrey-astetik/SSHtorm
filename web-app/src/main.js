import { createApp } from 'vue'
import './style.css'
import App from './App.vue'

import { router } from './assets/router.js';
createApp(App).use(router).mount('#root');
import { createRouter, createWebHashHistory } from 'vue-router';
import Desktop from '../pages/Desktop.vue';

export const router = createRouter({
    history: createWebHashHistory(),
    routes: [
        {
            path: '/',
            name: 'Desktop',
            component: Desktop
        }
    ]
});

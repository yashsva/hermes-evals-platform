import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/experiments' },
    { path: '/experiments', component: () => import('./views/ExperimentsView.vue') },
    { path: '/experiments/new', component: () => import('./views/NewExperimentView.vue') },
    { path: '/experiments/:id', component: () => import('./views/ExperimentView.vue'), props: (r) => ({ id: Number(r.params.id) }) },
    { path: '/trials/:id', component: () => import('./views/TrialView.vue'), props: (r) => ({ id: Number(r.params.id) }) },
    // Generic definition routes: one list page and one edit page for every kind (task, config, skill, …).
    { path: '/defs/:kind', component: () => import('./views/DefinitionListView.vue'), props: true },
    { path: '/defs/:kind/new', component: () => import('./views/DefinitionEditView.vue'), props: true },
    { path: '/defs/:kind/:defKey', component: () => import('./views/DefinitionEditView.vue'), props: true },
  ],
});

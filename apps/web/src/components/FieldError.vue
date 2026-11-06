<script setup lang="ts">
defineProps<{ errors: Record<string, string>; path: string }>();
</script>

<template>
  <div v-if="errors[path]" class="field-error">{{ errors[path] }}</div>
</template>

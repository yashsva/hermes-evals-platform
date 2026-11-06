import { onBeforeUnmount, ref, type Ref } from 'vue';

/**
 * Loads data now and re-loads every `intervalMs` while `shouldContinue` says so (e.g. while an
 * experiment is running). Polling keeps the server stateless; one user doesn't need push.
 */
export function usePoll<T>(load: () => Promise<T>, shouldContinue: (value: T) => boolean, intervalMs = 2000) {
  const data = ref<T | null>(null) as Ref<T | null>;
  const error = ref<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function refresh(): Promise<void> {
    if (timer) clearTimeout(timer);
    try {
      data.value = await load();
      error.value = null;
    } catch (err) {
      error.value = (err as Error).message;
    }
    if (!stopped && (data.value === null || shouldContinue(data.value))) {
      timer = setTimeout(refresh, intervalMs);
    }
  }

  onBeforeUnmount(() => {
    stopped = true;
    if (timer) clearTimeout(timer);
  });

  void refresh();
  return { data, error, refresh };
}

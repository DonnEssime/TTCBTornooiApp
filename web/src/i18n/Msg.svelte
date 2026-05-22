<script lang="ts">
  import type { MessageKey } from 'ttc-tornooiapp';
  import { getLocale } from './locale.svelte';
  import { msg } from './msg';

  let {
    key,
    params = undefined,
    tag = 'span',
    class: className = undefined,
  }: {
    key: MessageKey;
    params?: Record<string, string>;
    tag?: 'span' | 'div' | 'p' | 'h1' | 'h2' | 'h3' | 'label' | 'button' | 'legend' | 'th' | 'td';
    class?: string;
  } = $props();

  const resolved = $derived.by(() => {
    void getLocale();
    return msg(key, params);
  });
</script>

<svelte:element this={tag} class={className} class:i18n-fallback={resolved.isFallback}>{resolved.text}</svelte:element>

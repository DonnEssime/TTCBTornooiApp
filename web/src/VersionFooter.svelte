<script lang="ts">
  import { BUILD_INFO } from './buildInfo';
</script>

<footer class="version-footer" aria-label="Build information">
  <span>v{BUILD_INFO.version}</span>
  <span class="sep" aria-hidden="true">·</span>
  <span class="mono" title="Git commit">{BUILD_INFO.commitHash}</span>
  {#if BUILD_INFO.commitDate}
    <span class="sep" aria-hidden="true">·</span>
    <time datetime={BUILD_INFO.commitDate}>{BUILD_INFO.commitDate}</time>
  {/if}
</footer>

<style>
  .version-footer {
    position: fixed;
    right: 0.65rem;
    bottom: calc(0.35rem + env(safe-area-inset-bottom, 0px));
    z-index: 18;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
    margin: 0;
    padding: 0.15rem 0.45rem;
    font-size: 0.68rem;
    line-height: 1.2;
    color: #94a3b8;
    pointer-events: none;
    user-select: none;
  }

  :global(.app-with-footer) .version-footer {
    bottom: calc(3.15rem + env(safe-area-inset-bottom, 0px));
  }

  .sep {
    opacity: 0.65;
  }

  .mono {
    font-family: ui-monospace, 'Cascadia Code', 'Consolas', monospace;
    font-size: 0.66rem;
    letter-spacing: 0.02em;
  }
</style>

<script lang="ts">
  let { message = "Loading…", size = "medium" } = $props<{
    message?: string;
    size?: "small" | "medium" | "large";
  }>();

  const sizePx = $derived(size === "small" ? 24 : size === "large" ? 48 : 32);
</script>

<div class="loading" role="status" aria-live="polite" aria-label={message}>
  <div
    class="spinner"
    style="width: {sizePx}px; height: {sizePx}px;"
    aria-hidden="true"
  ></div>
  {#if message}
    <span class="message">{message}</span>
  {/if}
</div>

<style>
  .loading {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }
  .spinner {
    border: 2px solid var(--loading-track, #e5e5ea);
    border-top-color: var(--loading-active, #1d1d1f);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  .message {
    font-size: 13px;
    color: var(--loading-text, #86868b);
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  :global([data-theme="dark"]) .spinner,
  :global(.dark) .spinner {
    --loading-track: #38383a;
    --loading-active: #f5f5f7;
  }
  :global([data-theme="dark"]) .message,
  :global(.dark) .message {
    --loading-text: #a1a1a6;
  }
  @media (prefers-color-scheme: dark) {
    .spinner {
      --loading-track: #38383a;
      --loading-active: #f5f5f7;
    }
    .message {
      --loading-text: #a1a1a6;
    }
  }
</style>

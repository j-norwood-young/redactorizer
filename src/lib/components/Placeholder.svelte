<script lang="ts">
  import Button from "./Button.svelte";

  let { message = "No content", onAction, actionLabel = "Open" } = $props<{
    message?: string;
    onAction?: () => void;
    actionLabel?: string;
  }>();
</script>

<div class="placeholder">
  <p>{message}</p>
  {#if onAction}
    <Button onclick={onAction}>{actionLabel}</Button>
  {/if}
</div>

<style>
  .placeholder {
    text-align: center;
    color: #86868b;
  }
  .placeholder p {
    margin-bottom: 12px;
  }
</style>

<script lang="ts">
  let { message = $bindable(null) } = $props<{ message: string | null }>();
</script>

{#if message}
  <p class="error">{message}</p>
{/if}

<style>
  .error {
    padding: 8px 16px;
    margin: 0;
    background: #ffebee;
    color: #c62828;
    font-size: 12px;
  }
</style>

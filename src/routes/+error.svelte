<script lang="ts">
	import { page } from '$app/state';

	let copied = $state(false);
	const CMD = 'curl -s https://wastage.expanse.sh/scan | bash';

	function copyCommand() {
		navigator.clipboard.writeText(CMD);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<div class="flex min-h-screen flex-col items-center justify-center bg-surface px-6">
	<h1 class="text-6xl font-bold text-foreground">{page.status}</h1>
	<p class="mt-4 text-lg text-muted">{page.error?.message || 'Page not found'}</p>

	{#if page.status === 404}
		<p class="mt-6 text-muted">Run the scanner to create a waste report:</p>
		<div class="relative mt-4 overflow-x-auto rounded-lg bg-terminal-bg p-4">
			<pre class="font-mono text-sm text-white"><span class="text-terminal-green">$</span> {CMD}</pre>
			<button
				onclick={copyCommand}
				class="absolute right-3 top-3 rounded-md border border-white/20 px-3 py-1 font-mono text-xs text-white/70 hover:bg-white/10 hover:text-white"
			>
				{copied ? 'Copied!' : 'Copy'}
			</button>
		</div>
	{/if}

	<a href="/" class="mt-8 text-sm text-muted hover:text-foreground underline">← Back to wastage.expanse.sh</a>
</div>

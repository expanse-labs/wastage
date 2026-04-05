<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let copied = $state(false);

	const CMD = 'curl -s https://wastage.expanse.sh/scan | bash';

	function copyCommand() {
		navigator.clipboard.writeText(CMD);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	function formatNumber(n: number): string {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
		return n.toLocaleString();
	}

	function formatCurrency(n: number): string {
		if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
		return `$${n.toFixed(0)}`;
	}

	function scoreColor(score: number): string {
		if (score >= 70) return 'text-success';
		if (score >= 40) return 'text-warning';
		return 'text-danger';
	}
</script>

<svelte:head>
	<title>wastage.expanse.sh — How much compute is your cluster wasting?</title>
	<meta name="description" content="One command to see how much compute your cluster wastes. Works on SLURM and Kubernetes." />
	<meta property="og:title" content="wastage.expanse.sh — Compute Waste Analysis" />
	<meta property="og:description" content="One command. 30 seconds. See exactly where resources go to waste." />
	<meta property="og:type" content="website" />
	<meta property="og:url" content="https://wastage.expanse.sh" />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<div class="min-h-screen bg-surface">
	<!-- Nav -->
	<nav class="mx-auto flex max-w-[960px] items-center justify-between px-6 py-6">
		<a href="/" class="font-mono text-sm font-bold text-foreground">wastage.expanse.sh</a>
		<div class="flex items-center gap-4">
			<a
				href="https://github.com/expanse-labs/wastage"
				class="text-sm text-muted hover:text-foreground"
				target="_blank"
				rel="noopener"
			>
				GitHub
			</a>
			<span class="rounded-full bg-elevated px-2.5 py-1 text-xs font-medium text-muted">YC P26</span>
		</div>
	</nav>

	<!-- Hero -->
	<section class="mx-auto max-w-[960px] px-6 pb-16 pt-12 md:pt-20">
		<h1 class="text-3xl font-bold leading-tight text-foreground md:text-5xl">
			How much compute is your<br />cluster wasting?
		</h1>
		<p class="mt-4 text-lg text-muted md:text-xl">
			One command. 30 seconds. See exactly where resources go to waste.
		</p>

		<!-- Terminal block -->
		<div class="relative mt-8 overflow-x-auto rounded-lg bg-terminal-bg p-4">
			<pre class="font-mono text-sm text-white md:text-base"><span class="text-terminal-green">$</span> {CMD}</pre>
			<button
				onclick={copyCommand}
				class="absolute right-3 top-3 rounded-md border border-white/20 px-3 py-1 font-mono text-xs text-white/70 hover:bg-white/10 hover:text-white"
				aria-label="Copy command to clipboard"
			>
				{copied ? 'Copied!' : 'Copy'}
			</button>
		</div>

		<p class="mt-3 text-sm text-faint">
			Works on SLURM and Kubernetes. All processing happens locally on your machine.
		</p>
	</section>

	<!-- Counter -->
	<section class="border-y border-subtle-border bg-card">
		<div class="mx-auto grid max-w-[960px] grid-cols-1 gap-6 px-6 py-10 md:grid-cols-4">
			<div>
				<p class="font-mono text-3xl font-bold text-foreground md:text-4xl">
					{formatNumber(data.stats.total_jobs)}
				</p>
				<p class="mt-1 text-sm text-muted">jobs analysed</p>
			</div>
			<div>
				<p class="font-mono text-3xl font-bold text-danger md:text-4xl">
					{formatNumber(data.stats.total_wasted_core_hours)}
				</p>
				<p class="mt-1 text-sm text-muted">core-hours wasted</p>
			</div>
			<div>
				<p class="font-mono text-3xl font-bold text-danger md:text-4xl">
					{formatCurrency(data.stats.total_waste_usd)}
				</p>
				<p class="mt-1 text-sm text-muted">estimated waste</p>
			</div>
			<div>
				<p class="font-mono text-3xl font-bold text-foreground md:text-4xl">
					{formatNumber(data.stats.cluster_count)}
				</p>
				<p class="mt-1 text-sm text-muted">clusters scanned</p>
			</div>
		</div>
	</section>

	<!-- How it works -->
	<section class="mx-auto max-w-[960px] px-6 py-16">
		<h2 class="text-2xl font-bold text-foreground">How it works</h2>
		<div class="mt-8 space-y-8">
			<div>
				<p class="text-lg font-semibold text-foreground">1. Run the command</p>
				<p class="mt-1 text-muted">
					The script auto-detects your scheduler (SLURM or Kubernetes), collects resource usage data,
					and computes waste metrics entirely on your machine. No data leaves your cluster.
				</p>
			</div>
			<div>
				<p class="text-lg font-semibold text-foreground">2. See your waste report</p>
				<p class="mt-1 text-muted">
					CPU, memory, and GPU waste breakdown with estimated dollar cost.
					A utilisation score from 0-100 tells you how efficiently your cluster runs.
				</p>
			</div>
			<div>
				<p class="text-lg font-semibold text-foreground">3. Share with your team</p>
				<p class="mt-1 text-muted">
					Get a shareable URL with a visual report you can send to your manager,
					post in Slack, or share on Twitter.
				</p>
			</div>
		</div>
	</section>

	<!-- Leaderboard -->
	{#if data.leaderboard.length > 0}
		<section class="border-t border-subtle-border">
			<div class="mx-auto max-w-[960px] px-6 py-16">
				<h2 class="text-2xl font-bold text-foreground">Cluster Leaderboard</h2>
				<p class="mt-2 text-muted">Top clusters by utilisation score. Opt-in only.</p>

				<div class="mt-6 overflow-x-auto rounded-xl border border-subtle-border bg-card">
					<table class="w-full text-left text-sm">
						<thead>
							<tr class="border-b border-subtle-border text-xs uppercase text-muted">
								<th class="px-4 py-3">#</th>
								<th class="px-4 py-3">Cluster</th>
								<th class="px-4 py-3">Score</th>
								<th class="px-4 py-3">Type</th>
								<th class="px-4 py-3">Country</th>
							</tr>
						</thead>
						<tbody>
							{#each data.leaderboard as entry, i}
								<tr class="border-b border-subtle-border last:border-0 hover:bg-elevated">
									<td class="px-4 py-3 font-mono font-bold text-foreground">{i + 1}</td>
									<td class="px-4 py-3 font-medium text-foreground">{entry.cluster_name}</td>
									<td class="px-4 py-3 font-mono {scoreColor(entry.utilisation_score)}">
										{entry.utilisation_score.toFixed(0)}/100
									</td>
									<td class="px-4 py-3">
										<span class="rounded-full px-2 py-0.5 text-xs font-medium {entry.scheduler_type === 'slurm' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'}">
											{entry.scheduler_type.toUpperCase()}
										</span>
									</td>
									<td class="px-4 py-3 text-muted">{entry.country || '—'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		</section>
	{:else}
		<section class="border-t border-subtle-border">
			<div class="mx-auto max-w-[960px] px-6 py-16 text-center">
				<h2 class="text-2xl font-bold text-foreground">Cluster Leaderboard</h2>
				<p class="mt-4 text-muted">
					No clusters on the leaderboard yet. Be the first.
				</p>
				<button
					onclick={copyCommand}
					class="mt-4 rounded-lg bg-foreground px-6 py-2.5 text-sm font-medium text-surface hover:bg-foreground/90"
				>
					{copied ? 'Copied!' : 'Copy the one-liner'}
				</button>
			</div>
		</section>
	{/if}

	<!-- Expanse CTA -->
	<section class="border-t border-subtle-border bg-elevated">
		<div class="mx-auto max-w-[960px] px-6 py-12 text-center">
			<p class="text-lg font-semibold text-foreground">Want more than a one-time scan?</p>
			<p class="mx-auto mt-2 max-w-lg text-sm text-muted">
				Expanse installs on your cluster in one command and tracks CPU, memory, and GPU waste
				continuously, with per-job breakdowns and historical trends. Free.
			</p>
			<a
				href="https://app.expanse.sh"
				class="mt-4 inline-block rounded-lg bg-foreground px-6 py-2.5 text-sm font-medium text-surface hover:bg-foreground/90"
			>
				Install Expanse free →
			</a>
		</div>
	</section>

	<!-- Footer -->
	<footer class="border-t border-subtle-border">
		<div class="mx-auto flex max-w-[960px] items-center justify-between px-6 py-8">
			<p class="text-sm text-muted">
				Powered by <a href="https://expanse.sh" class="text-foreground underline hover:no-underline">Expanse</a>
			</p>
			<span class="rounded-full bg-elevated px-2.5 py-1 text-xs font-medium text-muted">YC P26</span>
		</div>
	</footer>
</div>

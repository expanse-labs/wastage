<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const r = data.report;

	let copied = $state(false);
	let emailInput = $state('');
	let emailStatus = $state<'idle' | 'loading' | 'success' | 'error'>('idle');
	let emailError = $state('');

	function formatNumber(n: number): string {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
		return n.toLocaleString();
	}

	const CMD = 'curl -s https://wastage.expanse.sh/scan | bash';
	const REPORT_URL = `https://wastage.expanse.sh/r/${r.id}`;

	function copyUrl() {
		navigator.clipboard.writeText(REPORT_URL);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	function shareTwitter() {
		const text = encodeURIComponent(
			`Our cluster scores ${r.utilisation_score.toFixed(0)}/100 on compute efficiency. ${r.avg_cpu_waste_pct.toFixed(0)}% CPU waste. See the full report:`
		);
		window.open(`https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(REPORT_URL)}`, '_blank');
	}

	async function submitEmail() {
		if (!emailInput || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput)) {
			emailStatus = 'error';
			emailError = 'Please enter a valid email.';
			return;
		}
		emailStatus = 'loading';
		try {
			const res = await fetch('/api/capture-email', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ report_id: r.id, email: emailInput })
			});
			if (res.ok) {
				emailStatus = 'success';
			} else {
				emailStatus = 'error';
				emailError = 'Something went wrong. Try again.';
			}
		} catch {
			emailStatus = 'error';
			emailError = 'Network error. Try again.';
		}
	}

	function wasteColor(pct: number): string {
		if (pct > 50) return 'bg-danger';
		if (pct > 30) return 'bg-warning';
		return 'bg-success';
	}

	function scoreColor(score: number): string {
		if (score >= 70) return '#059669';
		if (score >= 40) return '#D97706';
		return '#DC2626';
	}

	// SVG gauge calculations
	const GAUGE_R = 52;
	const GAUGE_C = 2 * Math.PI * GAUGE_R;
	const gaugeDash = $derived((r.utilisation_score / 100) * GAUGE_C);
</script>

<svelte:head>
	<title>Waste Report — {r.utilisation_score.toFixed(0)}/100 | wastage.expanse.sh</title>
	<meta name="description" content="Analyzed {r.job_count} {r.scheduler_type === 'slurm' ? 'jobs' : 'pods'}. Estimated ${r.total_estimated_cost_usd.toLocaleString()} wasted." />
	<meta property="og:title" content="Compute Waste Report — {r.utilisation_score.toFixed(0)}% Efficiency" />
	<meta property="og:description" content="Analyzed {r.job_count} {r.scheduler_type === 'slurm' ? 'jobs' : 'pods'}. Estimated ${r.total_estimated_cost_usd.toLocaleString()} wasted." />
	<meta property="og:image" content="https://wastage.expanse.sh/api/og/{r.id}" />
	<meta property="og:type" content="website" />
	<meta property="og:url" content={REPORT_URL} />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<div class="min-h-screen bg-surface">
	<!-- Nav -->
	<nav class="mx-auto flex max-w-[960px] items-center justify-between px-6 py-6">
		<a href="/" class="text-sm text-muted hover:text-foreground">← wastage.expanse.sh</a>
		<div class="flex items-center gap-3">
			<button
				onclick={shareTwitter}
				class="rounded-lg border border-subtle-border px-4 py-2 text-sm text-foreground hover:bg-elevated"
			>
				Share on Twitter
			</button>
			<button
				onclick={copyUrl}
				class="rounded-lg border border-subtle-border px-4 py-2 text-sm text-foreground hover:bg-elevated"
			>
				{copied ? 'Copied!' : 'Copy URL'}
			</button>
		</div>
	</nav>

	<div class="mx-auto max-w-[960px] px-6 pb-16">
		<!-- K8s snapshot banner -->
		{#if r.scheduler_type === 'kubernetes'}
			<div class="mb-8 rounded-lg border border-amber-200 bg-amber-50 p-4">
				<p class="text-sm text-amber-800">
					Based on a 90-second cluster snapshot. Run again anytime for updated numbers.
				</p>
			</div>
		{/if}

		<!-- Title -->
		<h1 class="text-2xl font-bold text-foreground md:text-3xl">Compute Waste Report</h1>
		<p class="mt-2 text-muted">
			{r.cluster_name || 'Anonymous cluster'} ·
			<span class="rounded-full px-2 py-0.5 text-xs font-medium {r.scheduler_type === 'slurm' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'}">
				{r.scheduler_type.toUpperCase()}
			</span>
			· {r.scheduler_type === 'slurm' ? 'Last 30 days' : '90-second snapshot'}
		</p>

		<!-- Hero metrics -->
		<div class="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
			<!-- Score gauge -->
			<div class="col-span-2 flex flex-col items-center rounded-xl border border-subtle-border bg-card p-6 md:col-span-1">
				<svg width="120" height="120" viewBox="0 0 120 120">
					<circle cx="60" cy="60" r={GAUGE_R} fill="none" stroke="#E8E6DD" stroke-width="8" />
					<circle
						cx="60" cy="60" r={GAUGE_R}
						fill="none"
						stroke={scoreColor(r.utilisation_score)}
						stroke-width="8"
						stroke-dasharray="{gaugeDash} {GAUGE_C}"
						stroke-dashoffset={GAUGE_C * 0.25}
						stroke-linecap="round"
						transform="rotate(-90 60 60)"
					/>
					<text x="60" y="55" text-anchor="middle" class="font-mono text-3xl font-bold" fill={scoreColor(r.utilisation_score)}>
						{r.utilisation_score.toFixed(0)}
					</text>
					<text x="60" y="72" text-anchor="middle" class="text-xs" fill="#73726D">/100</text>
				</svg>
				<p class="mt-2 text-sm text-muted">Utilisation Score</p>
			</div>

			<!-- Cost -->
			<div class="flex flex-col items-center justify-center rounded-xl border border-subtle-border bg-card p-6">
				<p class="font-mono text-3xl font-bold text-danger">
					${r.total_estimated_cost_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
				</p>
				<p class="mt-2 text-sm text-muted">estimated waste</p>
			</div>

			<!-- Core-hours wasted -->
			<div class="flex flex-col items-center justify-center rounded-xl border border-subtle-border bg-card p-6">
				<p class="font-mono text-2xl font-bold text-danger">
					{r.wasted_core_hours ? formatNumber(r.wasted_core_hours) : '—'}
				</p>
				<p class="mt-2 text-sm text-muted">core-hours wasted</p>
			</div>

			<!-- Jobs -->
			<div class="flex flex-col items-center justify-center rounded-xl border border-subtle-border bg-card p-6">
				<p class="font-mono text-2xl font-bold text-foreground">
					{r.job_count.toLocaleString()}
				</p>
				<p class="mt-2 text-sm text-muted">{r.scheduler_type === 'slurm' ? 'jobs' : 'pods'} analysed</p>
			</div>
		</div>

		<!-- SLURM tracking limitation note -->
		{#if r.scheduler_type === 'slurm' && r.total_core_hours > 0 && r.wasted_core_hours > 0}
			{@const trackedPct = Math.round((r.wasted_core_hours / (r.total_core_hours * (r.avg_cpu_waste_pct / 100))) * 100)}
			{#if trackedPct < 80}
				<div class="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
					<p class="text-sm text-amber-800">
						<span class="font-medium">Some jobs on this cluster lack CPU accounting.</span>
						SLURM's sacct only tracks jobs with cgroup data enabled. The waste figures above are based on tracked jobs only.
						<a href="https://app.expanse.sh" class="underline font-medium">Expanse tracks all jobs via cgroups (free) →</a>
					</p>
				</div>
			{/if}
		{/if}

		<!-- Failed jobs banner -->
		{#if r.failed_jobs > 0}
			<div class="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
				<p class="text-sm text-red-800">
					<span class="font-bold">{r.failed_job_pct?.toFixed(0)}% of jobs failed</span>
					({r.failed_jobs.toLocaleString()} jobs, consuming {r.failed_core_pct?.toFixed(0)}% of total compute).
					Every failed core-hour is pure waste.
				</p>
			</div>
		{/if}

		<!-- Resource bars -->
		<div class="mt-8 rounded-xl border border-subtle-border bg-card p-6">
			<h2 class="text-lg font-semibold text-foreground">Resource Efficiency</h2>
			<div class="mt-4 space-y-4">
				<div>
					<div class="flex items-center justify-between text-sm">
						<span class="text-muted">CPU</span>
						<span class="font-mono text-foreground">{(100 - r.avg_cpu_waste_pct).toFixed(0)}% utilised</span>
					</div>
					<div class="mt-1.5 h-2 w-full rounded-full bg-elevated">
						<div class="h-2 rounded-full {wasteColor(r.avg_cpu_waste_pct)}" style="width: {100 - r.avg_cpu_waste_pct}%"></div>
					</div>
				</div>
				<div>
					<div class="flex items-center justify-between text-sm">
						<span class="text-muted">Memory</span>
						<span class="font-mono text-foreground">{(100 - r.avg_mem_waste_pct).toFixed(0)}% utilised</span>
					</div>
					<div class="mt-1.5 h-2 w-full rounded-full bg-elevated">
						<div class="h-2 rounded-full {wasteColor(r.avg_mem_waste_pct)}" style="width: {100 - r.avg_mem_waste_pct}%"></div>
					</div>
				</div>
				{#if r.avg_gpu_core_waste_pct != null}
					<div>
						<div class="flex items-center justify-between text-sm">
							<span class="text-muted">GPU</span>
							<span class="font-mono text-foreground">{(100 - r.avg_gpu_core_waste_pct).toFixed(0)}% utilised</span>
						</div>
						<div class="mt-1.5 h-2 w-full rounded-full bg-elevated">
							<div class="h-2 rounded-full {wasteColor(r.avg_gpu_core_waste_pct)}" style="width: {100 - r.avg_gpu_core_waste_pct}%"></div>
						</div>
					</div>
				{:else if r.gpu_jobs > 0}
					<div class="rounded-lg bg-elevated p-3 text-sm text-muted">
						<span class="font-medium">{r.gpu_jobs} GPU {r.scheduler_type === 'slurm' ? 'jobs' : 'pods'} detected</span>
						({r.gpu_hours.toFixed(0)} GPU-hours allocated).
						GPU utilisation data is not available from {r.scheduler_type === 'slurm' ? 'sacct' : 'kubectl'}.
						<a href="https://app.expanse.sh" class="text-foreground underline">Expanse tracks GPU core and memory utilisation per job (free) →</a>
					</div>
				{/if}
			</div>
		</div>

		<!-- Waste distribution histogram -->
		{#if r.histogram_cpu && Object.keys(r.histogram_cpu).length > 0}
			{@const buckets = ['0-10', '10-20', '20-30', '30-40', '40-50', '50-60', '60-70', '70-80', '80-90', '90-100']}
			{@const maxVal = Math.max(...buckets.map(b => r.histogram_cpu?.[b] ?? 0))}
			<div class="mt-8 rounded-xl border border-subtle-border bg-card p-6">
				<h2 class="text-lg font-semibold text-foreground">Waste Distribution</h2>
				<p class="mt-1 text-xs text-muted">Core-hours by CPU waste percentage</p>
				<div class="mt-4 flex items-end gap-1" style="height: 120px;">
					{#each buckets as bucket}
						{@const val = r.histogram_cpu?.[bucket] ?? 0}
						{@const height = maxVal > 0 ? (val / maxVal) * 100 : 0}
						{@const pct = parseInt(bucket.split('-')[0])}
						<div class="group relative flex-1 flex flex-col items-center justify-end h-full">
							<div
								class="w-full rounded-t {pct >= 50 ? 'bg-danger' : pct >= 30 ? 'bg-warning' : 'bg-success'}"
								style="height: {Math.max(height, 2)}%;"
							></div>
							<span class="mt-1 text-[10px] text-faint">{bucket.split('-')[0]}</span>
							{#if val > 0}
								<div class="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block rounded bg-foreground px-2 py-1 text-xs text-surface whitespace-nowrap">
									{formatNumber(val)} core-hrs
								</div>
							{/if}
						</div>
					{/each}
				</div>
				<p class="mt-1 text-right text-[10px] text-faint">CPU waste %</p>
			</div>
		{/if}

		<!-- K8s categories -->
		{#if r.categories && Object.keys(r.categories).length > 0}
			<div class="mt-8 rounded-xl border border-subtle-border bg-card p-6">
				<h2 class="text-lg font-semibold text-foreground">Waste by Workload Category</h2>
				<div class="mt-4 overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead>
							<tr class="border-b border-subtle-border text-xs uppercase text-muted">
								<th class="px-3 py-2">Category</th>
								<th class="px-3 py-2">Pods</th>
								<th class="px-3 py-2">CPU Waste</th>
								<th class="px-3 py-2">Mem Waste</th>
								<th class="px-3 py-2">$/mo</th>
							</tr>
						</thead>
						<tbody>
							{#each Object.entries(r.categories).sort(([,a], [,b]) => b.cost - a.cost) as [cat, data]}
								<tr class="border-b border-subtle-border last:border-0">
									<td class="px-3 py-2 font-medium text-foreground">{cat}</td>
									<td class="px-3 py-2 font-mono text-muted">{data.pod_count}</td>
									<td class="px-3 py-2 font-mono {data.cpu_waste > 50 ? 'text-danger' : data.cpu_waste > 30 ? 'text-warning' : 'text-success'}">{data.cpu_waste.toFixed(0)}%</td>
									<td class="px-3 py-2 font-mono {data.mem_waste > 50 ? 'text-danger' : data.mem_waste > 30 ? 'text-warning' : 'text-success'}">{data.mem_waste.toFixed(0)}%</td>
									<td class="px-3 py-2 font-mono text-foreground">${data.cost.toLocaleString()}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}

		<!-- Expanse CTA -->
		<div class="mt-8 rounded-xl border border-foreground/10 bg-elevated p-6">
			<p class="text-lg font-semibold text-foreground">This is ~10% of what Expanse shows you.</p>
			<p class="mt-2 text-sm text-muted">
				This scan gives you aggregate waste numbers. With Expanse installed on your cluster:
			</p>
			<div class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
				<div>
					<p class="text-xs font-semibold uppercase text-muted">Free</p>
					<ul class="mt-2 space-y-1 text-sm text-foreground">
						<li>Live CPU, memory, and GPU utilisation per job</li>
						<li>Per-job, per-user waste breakdown</li>
						<li>GPU core and memory waste tracking</li>
						<li>API access for your own dashboards</li>
					</ul>
				</div>
				<div>
					<p class="text-xs font-semibold uppercase text-muted">Pro</p>
					<ul class="mt-2 space-y-1 text-sm text-foreground">
						<li>Resource prediction before you submit</li>
						<li>Failure root-cause analysis</li>
						<li>Optimisation suggestions per job</li>
						<li>Natural language knowledge base</li>
					</ul>
				</div>
			</div>
			<a
				href="https://app.expanse.sh"
				class="mt-4 inline-block rounded-lg bg-foreground px-6 py-2.5 text-sm font-medium text-surface hover:bg-foreground/90"
			>
				Get started free →
			</a>
		</div>

		<!-- One-liner (viral loop) -->
		<div class="mt-8 rounded-xl border border-subtle-border bg-card p-6">
			<p class="text-sm font-medium text-foreground">Run it on your cluster</p>
			<div class="relative mt-3 overflow-x-auto rounded-lg bg-terminal-bg p-4">
				<pre class="font-mono text-sm text-white"><span class="text-terminal-green">$</span> {CMD}</pre>
			</div>
		</div>

		<!-- Email capture -->
		<div class="mt-8 rounded-xl border border-subtle-border bg-card p-6">
			{#if emailStatus === 'success'}
				<p class="text-center text-success font-medium">You're on the list. Welcome.</p>
			{:else}
				<p class="text-sm font-medium text-foreground">Join the Expanse mailing list</p>
				<p class="mt-1 text-xs text-muted">HPC insights, waste analysis tips, and product updates. No spam.</p>
				<div class="mt-3 flex gap-3">
					<input
						type="email"
						bind:value={emailInput}
						placeholder="Enter your email"
						class="flex-1 rounded-lg border border-subtle-border bg-surface px-4 py-2.5 text-sm text-foreground placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-foreground/20"
					/>
					<button
						onclick={submitEmail}
						disabled={emailStatus === 'loading'}
						class="rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-surface hover:bg-foreground/90 disabled:opacity-50"
					>
						{emailStatus === 'loading' ? '...' : 'Submit'}
					</button>
				</div>
				{#if emailStatus === 'error'}
					<p class="mt-2 text-sm text-danger">{emailError}</p>
				{/if}
			{/if}
		</div>
	</div>

	<!-- Footer -->
	<footer class="border-t border-subtle-border">
		<div class="mx-auto flex max-w-[960px] items-center justify-between px-6 py-8">
			<p class="text-sm text-muted">
				Powered by <a href="https://expanse.sh" class="text-foreground underline hover:no-underline">Expanse</a>
			</p>
			<span class="inline-flex items-center gap-1.5 rounded-full border border-[#F26522]/20 bg-[#FFF6F0] px-2.5 py-1 text-xs font-semibold text-[#F26522]">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="#F26522"><path d="M0 0h24v24H0V0zm12.7 13.3L17 6h-2.3l-2.7 5-2.7-5H7l4.3 7.3V18h1.4v-4.7z"/></svg>
					P26
				</span>
		</div>
	</footer>
</div>

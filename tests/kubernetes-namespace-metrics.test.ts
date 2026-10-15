import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { accessSync, chmodSync, constants, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const root = join(import.meta.dirname, '..');
const scanner = join(root, 'static/scan.sh');
const fixtureDirs: string[] = [];

const kubectlStub = `#!/usr/bin/env bash
if [[ "$*" == "get pods --all-namespaces -o json" ]]; then
    if [[ "$FAKE_SCOPE" == "cluster" ]]; then printf '{}\\n'; else exit 1; fi
elif [[ "$*" == "config view --minify -o jsonpath={..namespace}" ]]; then
    printf '%s' "$FAKE_CONTEXT_NAMESPACE"
elif [[ "$*" == *".status.phase"* ]]; then
    printf '%s' "$FAKE_REQUESTS"
elif [[ "$*" == *".resources.requests.nvidia"* ]]; then
    printf '%s' "$FAKE_GPU_REQUESTS"
elif [[ "$*" == "get pods -n $FAKE_EXPECTED_NAMESPACE -o json" ]]; then
    printf '{}\\n'
elif [[ "$*" == "top pods $FAKE_METRICS_SCOPE --no-headers" ]]; then
    printf '%s' "$FAKE_METRICS"
elif [[ "$*" == "top nodes --no-headers" ]]; then
    :
elif [[ "$*" == "get nodes -o json" ]]; then
    printf '{}\\n'
else
    printf 'Unexpected kubectl invocation: %s\\n' "$*" >&2
    exit 1
fi
`;

const sleepStub = `#!/usr/bin/env bash
exit 0
`;

// The full CLI test keeps command output at the Kubernetes boundary while exercising real report generation.
function findExecutable(name: string): string {
	for (const directory of process.env.PATH?.split(delimiter) ?? []) {
		const executable = join(directory, name);
		try {
			accessSync(executable, constants.X_OK);
			return executable;
		} catch {
			// Keep looking in the remaining PATH entries.
		}
	}
	throw new Error(`Required command not found: ${name}`);
}

function scanReport(options: {
	scope: 'namespace' | 'cluster';
	contextNamespace: string;
	expectedNamespace: string;
	metricsScope: string;
	metrics: string;
	requests: string;
	gpuRequests: string;
}): Record<string, unknown> {
	const fixtureDir = mkdtempSync(join(tmpdir(), 'wastage-k8s-'));
	fixtureDirs.push(fixtureDir);

	const requiredCommands = ['awk', 'bash', 'cat', 'grep', 'head', 'mktemp', 'rm', 'sed', 'tr'];
	for (const command of requiredCommands) {
		symlinkSync(findExecutable(command), join(fixtureDir, command));
	}

	const kubectlPath = join(fixtureDir, 'kubectl');
	const sleepPath = join(fixtureDir, 'sleep');
	writeFileSync(kubectlPath, kubectlStub);
	writeFileSync(sleepPath, sleepStub);
	chmodSync(kubectlPath, 0o755);
	chmodSync(sleepPath, 0o755);

	const output = execFileSync(join(fixtureDir, 'bash'), [scanner, '--local', '--json'], {
		encoding: 'utf8',
		timeout: 15_000,
		env: {
			...process.env,
			PATH: fixtureDir,
			FAKE_SCOPE: options.scope,
			FAKE_CONTEXT_NAMESPACE: options.contextNamespace,
			FAKE_EXPECTED_NAMESPACE: options.expectedNamespace,
			FAKE_METRICS_SCOPE: options.metricsScope,
			FAKE_METRICS: options.metrics,
			FAKE_REQUESTS: options.requests,
			FAKE_GPU_REQUESTS: options.gpuRequests
		}
	});

	const reportStart = output.indexOf('{\n  "scheduler_type"');
	expect(reportStart, 'scanner JSON report').toBeGreaterThanOrEqual(0);
	return JSON.parse(output.slice(reportStart)) as Record<string, unknown>;
}

// Shared one-pod fixture: 500m CPU and 512Mi memory requested; 100m and 256Mi used.
function onePodRows(
	namespace: string,
	pod: string,
	includeNamespace = false
): { metrics: string; requests: string; gpuRequests: string } {
	const metrics = `${includeNamespace ? `${namespace} ` : ''}${pod} 100m 256Mi\n`;
	return {
		metrics,
		requests: `${namespace}\t${pod}\t500m\t512Mi\n`,
		gpuRequests: `${namespace}/${pod}\t0\n`
	};
}

describe('Kubernetes namespace metrics parsing', () => {
	afterEach(() => {
		for (const fixtureDir of fixtureDirs.splice(0)) rmSync(fixtureDir, { recursive: true, force: true });
	});

	it('matches every pod in a configured namespace to its resource requests', () => {
		const first = onePodRows('research', 'worker-a');
		const second = onePodRows('research', 'worker-b');
		const report = scanReport({
			scope: 'namespace',
			contextNamespace: 'research',
			expectedNamespace: 'research',
			metricsScope: '-n research',
			metrics: first.metrics + second.metrics,
			requests: first.requests + second.requests,
			gpuRequests: first.gpuRequests + second.gpuRequests
		});

		expect(report).toMatchObject({
			job_count: 2,
			avg_cpu_waste_pct: 80,
			avg_mem_waste_pct: 50,
			utilisation_score: 32,
			total_estimated_cost_usd: 58.4
		});
	});

	it('uses default as the namespace when the context has no namespace', () => {
		const rows = onePodRows('default', 'worker');
		const report = scanReport({
			scope: 'namespace',
			contextNamespace: '',
			expectedNamespace: 'default',
			metricsScope: '-n default',
			metrics: rows.metrics,
			requests: rows.requests,
			gpuRequests: rows.gpuRequests
		});

		expect(report).toMatchObject({
			job_count: 1,
			avg_cpu_waste_pct: 80,
			avg_mem_waste_pct: 50,
			utilisation_score: 32,
			total_estimated_cost_usd: 29.2
		});
	});

	it('keeps same-named pods from different namespaces separate in a cluster-wide scan', () => {
		const first = onePodRows('team-a', 'worker', true);
		const second = {
			metrics: 'team-b worker 500m 256Mi\n',
			requests: 'team-b\tworker\t1000m\t1024Mi\n',
			gpuRequests: 'team-b/worker\t0\n'
		};
		const report = scanReport({
			scope: 'cluster',
			contextNamespace: '',
			expectedNamespace: '',
			metricsScope: '--all-namespaces',
			metrics: first.metrics + second.metrics,
			requests: first.requests + second.requests,
			gpuRequests: first.gpuRequests + second.gpuRequests
		});

		expect(report).toMatchObject({
			job_count: 2,
			avg_cpu_waste_pct: 60,
			avg_mem_waste_pct: 62.5,
			utilisation_score: 39,
			total_estimated_cost_usd: 65.7
		});
	});
});

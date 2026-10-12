import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { accessSync, chmodSync, constants, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

// sacct --parsable2 reports a user cancellation as "CANCELLED by <uid>", not "CANCELLED". The scanner must still
// count those jobs as failed instead of scoring them as tracked compute.

const root = join(import.meta.dirname, '..');
const scanner = join(root, 'static/scan.sh');
const fixtureDirs: string[] = [];

const sacctStub = `#!/usr/bin/env bash
printf '%s' "$FAKE_SACCT"
`;

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

function scanReport(sacct: string): Record<string, unknown> {
	const fixtureDir = mkdtempSync(join(tmpdir(), 'wastage-slurm-'));
	fixtureDirs.push(fixtureDir);

	const requiredCommands = ['awk', 'bash', 'cat', 'date', 'grep', 'head', 'mktemp', 'rm', 'sed', 'sleep', 'tr', 'wc'];
	for (const command of requiredCommands) {
		symlinkSync(findExecutable(command), join(fixtureDir, command));
	}

	const sacctPath = join(fixtureDir, 'sacct');
	writeFileSync(sacctPath, sacctStub);
	chmodSync(sacctPath, 0o755);

	const output = execFileSync(join(fixtureDir, 'bash'), [scanner, '--local', '--json'], {
		cwd: fixtureDir,
		encoding: 'utf8',
		input: '\n',
		timeout: 15_000,
		env: { ...process.env, PATH: fixtureDir, FAKE_SACCT: sacct }
	});

	const reportStart = output.indexOf('{\n  "scheduler_type"');
	expect(reportStart, 'scanner JSON report').toBeGreaterThanOrEqual(0);
	return JSON.parse(output.slice(reportStart)) as Record<string, unknown>;
}

// JobID|AllocCPUS|Elapsed|TotalCPU|ReqMem|MaxRSS|AllocTRES|State, as sacct --parsable2 prints them.
function job(id: number, totalCpu: string, state: string, elapsed = '01:00:00', cpus = 8, gpus = 0): string {
	const tres = `billing=${cpus},cpu=${cpus},mem=16G,node=1${gpus > 0 ? `,gres/gpu=${gpus}` : ''}`;
	return `${id}|${cpus}|${elapsed}|${totalCpu}|16G|0|${tres}|${state}\n`;
}

describe('SLURM job states', () => {
	afterEach(() => {
		for (const fixtureDir of fixtureDirs.splice(0)) rmSync(fixtureDir, { recursive: true, force: true });
	});

	it('counts a job cancelled by a user as failed', () => {
		const report = scanReport(
			job(101, '07:30:00', 'COMPLETED') + job(102, '00:30:00', 'CANCELLED by 1001') + job(103, '00:30:00', 'FAILED')
		);

		expect(report).toMatchObject({
			job_count: 3,
			failed_jobs: 2,
			avg_cpu_waste_pct: 6.25,
			wasted_core_hours: 0.5
		});
	});

	it('counts a job that hit its deadline as failed', () => {
		const report = scanReport(job(101, '07:30:00', 'COMPLETED') + job(102, '00:30:00', 'DEADLINE'));

		expect(report).toMatchObject({ job_count: 2, failed_jobs: 1, avg_cpu_waste_pct: 6.25 });
	});

	it('counts a job that failed to boot as failed even with no elapsed time', () => {
		const report = scanReport(
			job(101, '07:30:00', 'COMPLETED') +
				job(102, '00:00:00', 'BOOT_FAIL', '00:00:00') +
				job(103, '00:00:00', 'CANCELLED by 1001', '00:00:00') +
				job(104, '00:00:02', 'COMPLETED', '00:00:05')
		);

		expect(report).toMatchObject({ job_count: 2, failed_jobs: 1, avg_cpu_waste_pct: 6.25 });
		// A job that never started burned nothing, so it adds a job and no hours.
		expect(report).toMatchObject({ total_core_hours: 8, failed_core_pct: 0 });
	});

	it('bills the core hours of a job that failed in seconds', () => {
		// A nine-second failure used to be counted in job_count and failed_jobs while its core hours went
		// nowhere, so a whole node dying at launch read as costing zero and failed_core_pct came out low.
		const report = scanReport(
			job(101, '07:30:00', 'COMPLETED') + job(102, '00:00:01', 'FAILED', '00:00:09', 3200)
		);

		// 8 core-hours completed, 3200 cores x 9s = 8 core-hours failed.
		expect(report).toMatchObject({
			job_count: 2,
			failed_jobs: 1,
			total_core_hours: 16,
			failed_core_pct: 50
		});
	});

	it('bills the GPU hours of a job that failed in seconds', () => {
		const report = scanReport(
			job(101, '07:30:00', 'COMPLETED') + job(102, '00:00:01', 'NODE_FAIL', '00:00:09', 8, 8)
		);

		// 8 GPUs x 9s = 0.02 GPU-hours, which is small and is not nothing.
		expect(report).toMatchObject({ job_count: 2, failed_jobs: 1, gpu_jobs: 1, gpu_hours: 0.02 });
	});

	it('still ignores short jobs that did not fail', () => {
		const report = scanReport(
			job(101, '07:30:00', 'COMPLETED') +
				job(102, '00:00:01', 'COMPLETED', '00:00:09', 3200) +
				job(103, '00:00:01', 'CANCELLED by 1001', '00:00:09', 3200)
		);

		expect(report).toMatchObject({ job_count: 1, failed_jobs: 0, total_core_hours: 8 });
	});
});

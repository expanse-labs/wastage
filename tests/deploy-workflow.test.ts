import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The deploy path INF-174 fixed: the image is pushed by digest to the platform registry through the access
// repository's deploy role, every action is pinned to a commit, and the pin reaches main only by pull request.

const root = join(import.meta.dirname, '..');
const workflow = readFileSync(join(root, '.depot/workflows/deploy.yml'), 'utf8');
const manifest = join(root, 'deploy/k8s/deployment.yaml');
const pin = join(root, 'deploy/pin-image.sh');
const registry = '941017932298.dkr.ecr.eu-west-2.amazonaws.com/expanse-wastage';
const digest = 'sha256:' + 'ab'.repeat(32);
const sha = '0123abc' + 'd'.repeat(33);
const good = `${registry}:wastage-${sha}@${digest}`;

// The entries nested under one mapping key, wherever it sits: the lines after it that are indented deeper than it.
function block(name: string): string[] {
	const lines = workflow.split('\n');
	const start = lines.findIndex((line) => line.trim() === `${name}:`);
	expect(start, `${name} block`).toBeGreaterThan(-1);
	const indent = lines[start].search(/\S/);
	const entries: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (line.trim() && line.search(/\S/) <= indent) break;
		if (line.trim() && !line.trim().startsWith('#')) entries.push(line.trim());
	}
	return entries;
}

describe('deploy.yml', () => {
	it('publishes to the platform registry, never to the Depot registry', () => {
		expect(workflow).toContain('ECR_REGISTRY: 941017932298.dkr.ecr.eu-west-2.amazonaws.com');
		expect(workflow).toContain('ECR_REPOSITORY: expanse-wastage');
		expect(workflow).not.toContain('registry.depot.dev');
		expect(workflow).not.toMatch(/--save\b/);
		expect(workflow).toContain('--push');
	});

	it('assumes the access repository deploy role for the registry', () => {
		expect(workflow).toContain('DEPLOY_ROLE_ARN: arn:aws:iam::941017932298:role/expanse-wastage-deploy-ci');
		expect(workflow).toContain('role-to-assume: ${{ env.DEPLOY_ROLE_ARN }}');
	});

	it('pins by the digest the registry reports and hands it to the pin script', () => {
		expect(workflow).toContain('containerimage.digest');
		expect(workflow).toContain('describe-images');
		expect(workflow).toContain('IMAGE=${ECR_REGISTRY}/${ECR_REPOSITORY}:${tag}@${digest}');
		expect(workflow).toContain('run: deploy/pin-image.sh "${IMAGE}" "${MANIFEST_PATH}"');
	});

	it('tags the image with the full commit sha, so an existing tag is this commit and never a shorter twin', () => {
		expect(workflow).toContain('tag="wastage-${TAG}"');
		expect(workflow).not.toMatch(/\$\{TAG::\d+\}/);
		expect(workflow).not.toContain('SHORT_TAG');
		expect(workflow).toContain('title: "deploy: pin ${{ env.IMAGE_TAG }} by digest"');
	});

	it('opens a pull request against main and never pushes main', () => {
		expect(workflow).toMatch(/uses: peter-evans\/create-pull-request@/);
		expect(workflow).toContain('base: main');
		expect(workflow).toContain('branch: deploy/pin-image');
		expect(workflow).not.toMatch(/git push/);
		expect(workflow).not.toMatch(/git commit/);
	});

	it('holds contents and pull-requests write with the OIDC token and nothing else', () => {
		expect(block('permissions')).toEqual(['contents: write', 'pull-requests: write', 'id-token: write']);
	});

	it('pins every action to a full commit SHA with its version beside it', () => {
		const uses = workflow.split('\n').filter((line) => line.trim().startsWith('uses:'));
		expect(uses.length).toBe(4);
		for (const line of uses) {
			expect(line).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d/);
		}
	});

	it('does not rebuild when the pin merges', () => {
		const paths = block('paths');
		expect(paths).toContain('- Dockerfile');
		expect(paths.some((path) => path.includes('deploy/'))).toBe(false);
	});
});

describe('deploy/pin-image.sh', () => {
	function copy(): string {
		const dir = mkdtempSync(join(tmpdir(), 'wastage-pin-'));
		const target = join(dir, 'deployment.yaml');
		copyFileSync(manifest, target);
		return target;
	}

	function run(image: string, target: string): { status: number; stderr: string } {
		try {
			execFileSync(pin, [image, target], { stdio: 'pipe' });
			return { status: 0, stderr: '' };
		} catch (error) {
			const failure = error as { status: number; stderr: Buffer };
			return { status: failure.status, stderr: failure.stderr.toString() };
		}
	}

	it('moves the one image line to a digest on the platform registry and touches nothing else', () => {
		const target = copy();
		const before = readFileSync(target, 'utf8').split('\n');
		expect(run(good, target).status).toBe(0);
		const after = readFileSync(target, 'utf8').split('\n');
		expect(after.length).toBe(before.length);
		const changed = after.map((line, i) => [line, before[i]]).filter(([a, b]) => a !== b);
		expect(changed).toHaveLength(1);
		expect(changed[0][0]).toMatch(/^\s+image: /);
		expect(changed[0][0].trim()).toBe(`image: ${good}`);
		expect(run(good, target).status).toBe(0);
		expect(readFileSync(target, 'utf8')).toBe(after.join('\n'));
	});

	it('refuses a reference that is not a digest on expanse-wastage in the platform registry', () => {
		const target = copy();
		const before = readFileSync(target, 'utf8');
		for (const bad of [
			'registry.depot.dev/h04kh3b12g:wastage-0123abc',
			`${registry}:wastage-0123abc`,
			`742550615465.dkr.ecr.eu-west-2.amazonaws.com/expanse-wastage:wastage-0123abc@${digest}`,
			`941017932298.dkr.ecr.eu-west-2.amazonaws.com/expanse-controlplane:wastage-0123abc@${digest}`,
			`${registry}:latest@${digest}`,
			`${registry}:wastage-${sha}@sha256:abc`,
			`${registry}:wastage-${sha}0@${digest}`,
			`${registry}:wastage-012ab@${digest}`
		]) {
			const result = run(bad, target);
			expect(result.status, bad).toBe(1);
			expect(result.stderr, bad).toContain('refusing');
		}
		expect(readFileSync(target, 'utf8')).toBe(before);
	});

	it('refuses a manifest with more or fewer than one image line', () => {
		const target = copy();
		writeFileSync(target, readFileSync(target, 'utf8') + '        - name: sidecar\n          image: busybox\n');
		const result = run(good, target);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain('2 image lines');
	});
});

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  accessSync,
  chmodSync,
  constants,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

// In awk, `print expr > 0.3` is a redirection, not a comparison: the result goes to a file named 0.3 and the
// command substitution reads back nothing. So the untracked-share check never fired and every scan dropped a
// stray 0.3 file into whatever directory the user ran it from. The file is the visible half of that bug and it
// is what this guards.

const root = join(import.meta.dirname, "..");
const scanner = join(root, "static/scan.sh");
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

function runScan(sacct: string): {
  report: Record<string, unknown>;
  files: string[];
  cpuPartial: string | undefined;
} {
  const fixtureDir = mkdtempSync(join(tmpdir(), "wastage-share-"));
  fixtureDirs.push(fixtureDir);

  const requiredCommands = [
    "awk",
    "bash",
    "cat",
    "date",
    "grep",
    "head",
    "mktemp",
    "rm",
    "sed",
    "sleep",
    "tr",
    "wc",
  ];
  const planted = new Set(requiredCommands);
  for (const command of requiredCommands) {
    symlinkSync(findExecutable(command), join(fixtureDir, command));
  }

  const sacctPath = join(fixtureDir, "sacct");
  writeFileSync(sacctPath, sacctStub);
  chmodSync(sacctPath, 0o755);
  planted.add("sacct");

  // CPU_PARTIAL is not in the report, so the scan runs under xtrace and the test reads the last value the
  // SLURM path assigned to it from the trace.
  // PS4 is pinned so an inherited custom prompt cannot change the trace prefix the regex expects.
  const result = spawnSync(
    join(fixtureDir, "bash"),
    ["-x", scanner, "--local", "--json"],
    {
      cwd: fixtureDir,
      encoding: "utf8",
      input: "\n",
      timeout: 15_000,
      env: { ...process.env, PATH: fixtureDir, FAKE_SACCT: sacct, PS4: "+ " },
    },
  );
  expect(result.status, result.stderr).toBe(0);
  const output = result.stdout;
  const assignments = [...result.stderr.matchAll(/^\++ CPU_PARTIAL=(\w+)$/gm)];

  const reportStart = output.indexOf('{\n  "scheduler_type"');
  expect(reportStart, "scanner JSON report").toBeGreaterThanOrEqual(0);
  return {
    report: JSON.parse(output.slice(reportStart)) as Record<string, unknown>,
    files: readdirSync(fixtureDir).filter((name) => !planted.has(name)),
    cpuPartial: assignments.at(-1)?.[1],
  };
}

// JobID|AllocCPUS|Elapsed|TotalCPU|ReqMem|MaxRSS|AllocTRES|State, as sacct --parsable2 prints them.
function job(id: number, totalCpu: string, state = "COMPLETED"): string {
  return `${id}|8|01:00:00|${totalCpu}|16G|0|billing=8,cpu=8,mem=16G,node=1|${state}\n`;
}

describe("untracked core-hour share", () => {
  afterEach(() => {
    for (const fixtureDir of fixtureDirs.splice(0))
      rmSync(fixtureDir, { recursive: true, force: true });
  });

  it("writes no stray file when most core hours are untracked", () => {
    // Two jobs reporting near-zero TotalCPU are classified untracked, which puts the share well over 0.3
    // and is the case that used to create the file.
    const { report, files, cpuPartial } = runScan(
      job(101, "00:00:01") + job(102, "00:00:01") + job(103, "07:30:00"),
    );

    expect(report).toMatchObject({ job_count: 3 });
    expect(files).toEqual([]);
    expect(cpuPartial).toBe("true");
  });

  it("writes no stray file when the share is under the threshold", () => {
    const { files, cpuPartial } = runScan(
      job(101, "07:30:00") + job(102, "07:30:00") + job(103, "07:30:00"),
    );

    expect(files).toEqual([]);
    expect(cpuPartial).toBe("false");
  });
});

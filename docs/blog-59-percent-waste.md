# 59% of compute is wasted. I measured it.

*What I found when analysing 1.1 million jobs on two UK supercomputers*

---

Every HPC cluster is bound to waste compute. Everyone seems to know this, but I was curious to actually measure this for myself.

I built an open-source tool that tracks SLURM job wastage, and ran it on two UK supercomputers. One wastes 59% of its allocated CPU. The other can't even tell you how much it wastes.

## What I built

[wastage.expanse.sh](https://wastage.expanse.sh) is an open-source tool that analyses compute waste on any SLURM cluster. One command, shareable report.

```bash
curl -s https://wastage.expanse.sh/scan -o scan.sh && bash scan.sh
```

It processes `sacct` data locally on your cluster, computes CPU waste from allocated vs actually used resources, and returns a shareable URL with your results. No raw job data leaves your cluster. The server only aggregates anonymised telemetry for a nice leaderboard to track the most efficient clusters globally.

I tested it on two production supercomputers. The results were... educational.

<!-- TODO: Screenshot of the wastage.expanse.sh landing page with counter showing real data -->

## ARCHER2: 59% CPU waste across 122,000 jobs

ARCHER2 is one of the UK's national supercomputing facilities. 750,000+ cores. Thousands of users. Real production workloads: physics simulations, drug discovery, climate modelling, materials science.

ARCHER2 has proper cgroup CPU accounting enabled - which means `sacct` can actually tell you how much CPU each job used. Most clusters can't (more on that below).

I set my tool to track the last 7-day window, which included 122,000 jobs:

| Metric | Value |
|--------|-------|
| Jobs analysed | 122,000 |
| CPU waste (core-hour weighted) | 59% |
| Failed jobs | 7% of jobs, consuming 43% of compute |
| Estimated waste at cloud rates* | $8.5M/week |

\* *ARCHER2 is publicly funded. This figure uses on-demand cloud pricing ($0.10/core-hour) to illustrate the scale of wasted compute, not the actual cost to UK taxpayers.*

Interestingly, the waste isn't evenly distributed:

| Job size | Jobs | CPU waste |
|----------|------|-----------|
| 1-8 cores | 148 | 67.6% |
| 129-1024 cores | 61,909 | 60.9% |
| 1025+ cores | 13,171 | 58.3% |

The small jobs wasted the most per core (e.g. serial tasks on multi-core allocations). But most wasted compute comes from the 129-1024 core range, because there are so many of them.

### What does 59% waste actually look like?

I decided to dig deeper into some specific jobs. A visualisation tool allocated 256 cores and used 1.2% of them. It only needed 2-3 threads but it requested 2 entire nodes because its batch script said so.

A physics simulation on 16,384 cores showed a 92% waste. Most of its time was spent in MPI communication barriers, not actually doing compute. The code was correct but the resource request seemed to be based on "what worked last time" not "what is actually needed".

This is a common pattern in HPC. Users request resources based on habit, templates, and "better safe than sorry." Nobody tells them what they actually used. So the waste actually compounds. We think we are being smart by preventing under-allocation failures, but it's secretly killing us.

### 7% of jobs fail, consuming 43% of compute

Only 7% of jobs failed, but failed jobs consumed 43% of total compute. This is because the jobs that fail tend to be the big ones. A 16,384-core simulation that crashes after 12 hours wastes more compute than a thousand successful 1-core scripts.

Every single failed core-hour is a waste. You get no output, no results, just a burned budget.

<!-- TODO: Screenshot of ARCHER2 web report from wastage.expanse.sh/r/XXXXX showing the 59% score, or the ASCII terminal output -->

## Cirrus: 68% of compute is invisible

We tested on Cirrus, another UK national HPC facility. Cirrus doesn't have cgroup CPU accounting enabled. The results were different, but not in a good way unfortunately.

68% of core-hours had zero TotalCPU in sacct. This wasn't "zero waste", it was zero data. SLURM literally didn't know how much CPU those jobs used.

Without cgroup accounting, `sacct` only tracks the batch script overhead (1-2 seconds of CPU time for the submission wrapper). The actual MPI computation, the bit that makes up 99.9% of the allocation, is completely invisible.

The 32% of jobs that were actually tracked by SLURM showed 14% CPU waste. Which is reasonable, but with 68% in the dark, there's no way to know the true wastage - it could be 80% for all we know. sacct has no idea.

If your cluster doesn't have cgroup accounting, your waste is invisible. It's like trying to put out a fire you can't even see - but you will constantly feel the heat. You can check your own cluster by running:

```bash
sacct --allusers --parsable2 --noheader --starttime=$(date -d "7 days ago" +%Y-%m-%d) --format=TotalCPU | awk -F'|' '{if ($1=="00:00:00" || $1=="") z++; else n++} END{printf "Tracked: %d\nZero CPU: %d\nTracking rate: %.0f%%\n", n, z, n/(n+z)*100}'
```

If your tracking rate is below 80%, most of your waste is unmeasured.

<!-- TODO: Screenshot of Cirrus web report from wastage.expanse.sh/r/XXXXX showing the partial tracking note, or the ASCII terminal output -->

## Memory waste from sacct is meaningless

I tried to measure memory waste as well, but it didn't work.

`sacct` stores MaxRSS (peak memory usage) on sub-step lines, not on the main job line. And the MaxRSS it captures is only the peak RSS of a single process, not the total across all nodes.

A 1024-core job requesting 888GB of memory showed MaxRSS of 5.6MB. Which is the batch script's memory footprint, not the actual computation running. The real memory usage across 8 nodes could be anything.

Memory waste from `sacct` is actually architecturally broken for multi-node jobs. You need per-node cgroup memory polling to measure it properly.

## sacct is slow on big clusters

On ARCHER2, a 30-day `sacct --allusers` query takes longer than 10 minutes. Setting this to a 7-day window took 2 minutes, returning 1.1 million records. Even one day took a minute for 294,000 records.

ARCHER2 produces roughly 300,000 sacct records per day, due to it being a busy national facility, sacct is expected to be clogging along at this slow rate. Large enterprise clusters with thousands of users will have similar volumes and experience the exact same thing.

The wastage tool I made had to auto-adapt because of this. It first tries a month of wastage calculations, but if sacct is too slow, it decreases this to 7 days, then 3, then 1. I tried to make it always return results, so you can see at least something - even if small. But the underlying problem is that sacct queries the accounting database sequentially, and there's no way to speed it up from the user side.

## What standard tools can and can't tell you

Every existing HPC waste tool uses sacct under the hood. `seff`, `reportseff` (Princeton), `Jobstats`, and now our tool too. They're all limited by what sacct provides.

| What sacct gives you | What sacct doesn't give you |
|---------------------|---------------------------|
| TotalCPU per job (if cgroups enabled) | Per-node CPU breakdown |
| MaxRSS per step (single process peak) | Total memory across nodes |
| Elapsed wall time | GPU utilisation |
| AllocTRES (what was requested) | Why a job wasted resources |
| Job state (COMPLETED, FAILED, etc.) | What to do about it |

The gap between "what was allocated" and "what was used" is the waste. sacct can sometimes tell you the size of the gap. It can never tell you why it exists or how to close it.

## Try it on your cluster

I open-sourced the tool (open to enhancement PRs and additional scheduler support). You can run it with:

```bash
curl -s https://wastage.expanse.sh/scan -o scan.sh && bash scan.sh
```

It works on any SLURM cluster. Takes 30 seconds to 10 minutes depending on your cluster's size. Everything is processed locally, you can inspect the repo for more detail. At the end you get an ASCII report in your terminal and a shareable URL to compete with fellow cluster builders and pioneers.

If your cluster has cgroup accounting, you'll see real waste numbers. If it doesn't, you'll see exactly how much of your compute is unmeasured, which is its own kind of finding I guess.

The source is at [github.com/expanse-labs/wastage](https://github.com/expanse-labs/wastage) (MIT licence).

## What we're building next

This tool shows you aggregate waste. It's a one-time scan, useful, but extremely limited.

I'm building [Expanse](https://app.expanse.sh), which installs on your cluster and tracks waste continuously:

- Live CPU, memory, and GPU utilisation per job via cgroups (free)
- Per-job, per-user waste breakdown with weekly/monthly breakdowns with tips (free)
- Historical trends and continuous monitoring (free)
- Resource prediction before you submit (pro)
- Failure root-cause analysis (pro)

The small wastage tool I made is ~10% of what Expanse provides. 

The same over-provisioning patterns exist on Kubernetes. Expanse tracks both.

[Get started free → app.expanse.sh](https://app.expanse.sh)

---

*We're Expanse (YC P26). We're building the intelligence layer for compute. If your cluster wastes resources, whether you know it or not, we'd like to help you see it.*

*Questions? Reach us at contact@expanse.org.uk or join our community on [Expanse Community](https://community.expanse.sh).*

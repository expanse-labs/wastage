# Wastage

> One command to see how much compute your cluster wastes.

```bash
curl -s https://wastage.expanse.sh/scan | bash
```

Works on **SLURM** and **Kubernetes**. All processing happens locally on your machine. Only aggregates are sent for the shareable report.

[![YC P26](https://img.shields.io/badge/Y%20Combinator-P26-orange)](https://www.ycombinator.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## What you get

- **Utilisation Score** (0-100) — how efficiently your cluster uses allocated resources
- **CPU & Memory waste breakdown** — allocated vs actually used, per job or per pod
- **GPU detection** — flags GPU-hours allocated with best-effort utilisation data
- **Estimated $ wasted** — configurable cost rates for SLURM, real instance pricing for K8s
- **Shareable report URL** — visual report with gauges, charts, and share buttons
- **Cluster leaderboard** — opt-in, ranked by utilisation score

### SLURM mode

Parses `sacct` data from the last 30 days (configurable with `--days`). Computes per-job CPU and memory waste from actual vs allocated resources. Flags GPU jobs. Asks for your cost-per-core-hour (default: $0.10).

### Kubernetes mode

Takes 3 metric samples over 90 seconds from `kubectl top` for accuracy. Analyses both pod-level over-provisioning and node-level idle capacity. Auto-detects instance types from node labels for real $ cost figures. Categorises workloads into 13 types (Database, Web/API, ML/AI, Queue, CI/CD, Monitoring, etc.) using pod names, namespaces, and labels.

## Usage

### Basic

```bash
curl -s https://wastage.expanse.sh/scan | bash
```

### Options

```bash
# Run locally without uploading (no network calls)
curl -s https://wastage.expanse.sh/scan | bash -s -- --local

# Output JSON instead of ASCII report
curl -s https://wastage.expanse.sh/scan | bash -s -- --json

# Analyse last 90 days instead of 30 (SLURM only)
curl -s https://wastage.expanse.sh/scan | bash -s -- --days 90
```

### What gets sent

Only aggregate metrics are uploaded to generate the shareable report:

- Job/pod count, average CPU/memory waste percentages
- GPU hours allocated, estimated cost
- Waste distribution histogram (for anti-spoofing verification)
- Cluster name and country (only if you opt into the leaderboard)

**No raw job data, no usernames, no job names, no code, no IP addresses are stored.**

## Requirements

### SLURM
- `sacct` with accounting enabled
- `bash`, `awk` (standard on any Linux system)
- `curl` or `wget` (for uploading; optional with `--local`)

### Kubernetes
- `kubectl` with cluster access
- `metrics-server` installed (for actual usage data; falls back gracefully without it)
- `bash`, `awk`, `curl` or `wget`

## Privacy

- All waste calculations happen locally in the bash script
- The shareable report contains only aggregates (averages, totals, histograms)
- IP addresses are salted + hashed for rate limiting, never stored raw
- Use `--local` to skip all network calls
- Reports never expire and cannot be traced back to individuals

## Waste formulas

### CPU waste (SLURM)

```
cpu_time_allocated = AllocCPUS × elapsed_seconds
cpu_time_used = TotalCPU (parsed from sacct DD-HH:MM:SS format)
cpu_waste_pct = (1 − cpu_time_used / cpu_time_allocated) × 100
```

### Memory waste (SLURM)

```
mem_requested = ReqMem (parsed: "4Gc" = 4GB × cores, "16Gn" = 16GB total)
mem_actual_peak = MaxRSS (converted from KB to GB)
mem_waste_pct = (1 − mem_actual_peak / mem_requested) × 100
```

Jobs where SLURM didn't track memory (MaxRSS = 0) are excluded rather than counted as 100% waste.

### CPU/Memory waste (Kubernetes)

```
cpu_waste_pct = (1 − actual_cpu / requested_cpu) × 100
mem_waste_pct = (1 − actual_memory / requested_memory) × 100
```

Metrics are averaged over 3 samples taken 30 seconds apart.

### Utilisation score

```
Without GPU: score = 0.6 × cpu_utilisation + 0.4 × mem_utilisation
With GPU:    score = 0.3 × cpu_utilisation + 0.2 × mem_utilisation + 0.5 × gpu_utilisation
```

## Limitations

This tool analyses what SLURM and Kubernetes expose through their standard APIs. There are real limits to what it can measure.

| Limitation | Why | What Expanse adds |
|-----------|-----|-------------------|
| **SLURM CPU tracking** | Many clusters lack cgroup accounting. TotalCPU is zero for MPI jobs without it. The tool filters these out and reports from tracked jobs only. | Expanse's daemon tracks CPU via cgroups for every job, including MPI ranks. (Free) |
| **SLURM memory** | `MaxRSS` from sacct only captures the batch script's memory, not the actual compute processes. Memory waste is unreliable on most clusters. | Per-process memory tracking via cgroup polling. (Free) |
| **GPU utilisation** | sacct records GPU allocation but not utilisation. The tool reports GPU-hours allocated, not GPU-hours used. | GPU core and memory utilisation via DCGM/nvidia-smi polling. (Free) |
| **K8s is a snapshot** | `kubectl top` gives a point-in-time reading averaged over 90 seconds. No historical data. | Continuous metric collection with historical trends. (Free) |
| **Large clusters are slow** | sacct queries on clusters like ARCHER2 (1M+ records) can take minutes. The tool auto-shrinks the time window to cope. | Expanse stores metrics locally and queries instantly. (Free) |
| **Per-job breakdown** | This tool reports cluster-wide aggregates. You can't see which specific jobs or users are the worst offenders. | Per-job, per-user waste breakdown with drill-down. (Free) |
| **Predictions & analysis** | No resource recommendations or failure analysis. | Resource prediction before submission, failure root-cause analysis, optimisation suggestions. (Pro) |

## Contributing

PRs welcome. The bash script (`static/scan.sh`) is where most of the domain logic lives. If you work with a scheduler we don't support yet, open an issue.

## License

MIT

---

Built by [Expanse](https://expanse.sh) (YC P26). We're building the intelligence layer for large-scale compute.

| | Free | Pro |
|---|---|---|
| Live metrics via cgroups | ✓ | ✓ |
| Per-job, per-user waste | ✓ | ✓ |
| Memory & GPU tracking | ✓ | ✓ |
| API access | ✓ | ✓ |
| Resource prediction | | ✓ |
| Failure root-cause analysis | | ✓ |
| Optimisation suggestions | | ✓ |
| Natural language knowledge base | | ✓ |

[Get started free → app.expanse.sh](https://app.expanse.sh)

#!/bin/bash
# wastage.expanse.sh — Compute Waste Analysis
# Usage: curl -s https://wastage.expanse.sh/scan -o scan.sh && bash scan.sh
#
# Analyses SLURM or Kubernetes cluster resource waste.
# All processing happens locally. Only aggregates are sent for the shareable report.

set -uo pipefail

# ── Cleanup on exit ───────────────────────────────────────
CLEANUP_FILES=""
# shellcheck disable=SC2086 — intentional word splitting on space-separated temp paths
cleanup() { [ -n "$CLEANUP_FILES" ] && rm -rf $CLEANUP_FILES 2>/dev/null; }
trap cleanup EXIT

# ── Config ──────────────────────────────────────────────
API_URL="https://wastage.expanse.sh/api/ingest"
DAYS=30
LOCAL_ONLY=false
JSON_OUTPUT=false
COST_PER_CORE_HOUR=0.10
GPU_COST_PER_HOUR=2.50

# ── Colors ──────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ── Helpers ─────────────────────────────────────────────
die()  { echo -e "${RED}ERROR:${NC} $1" >&2; exit 1; }
warn() { echo -e "${YELLOW}WARNING:${NC} $1" >&2; }
info() { echo -e "${DIM}$1${NC}"; }

# ── Parse args ──────────────────────────────────────────
while [ $# -gt 0 ]; do
    case "$1" in
        --local)  LOCAL_ONLY=true; shift ;;
        --json)   JSON_OUTPUT=true; shift ;;
        --days)   DAYS="${2:-30}"; shift 2 ;;
        --help|-h)
            echo "Usage: curl -s https://wastage.expanse.sh/scan -o scan.sh && bash scan.sh [OPTIONS]"
            echo "  --local    Skip upload, print report locally only"
            echo "  --json     Output JSON instead of ASCII report"
            echo "  --days N   Analyse last N days (default: 30, SLURM only)"
            exit 0 ;;
        *) shift ;;
    esac
done

# ── Dependency check ────────────────────────────────────
command -v awk >/dev/null 2>&1 || die "awk is required but not found"
HAS_CURL=$(command -v curl 2>/dev/null || true)
HAS_WGET=$(command -v wget 2>/dev/null || true)
if [ -z "$HAS_CURL" ] && [ -z "$HAS_WGET" ] && [ "$LOCAL_ONLY" = "false" ]; then
    warn "Neither curl nor wget found. Running in local-only mode."
    LOCAL_ONLY=true
fi

# ── HTTP helper ─────────────────────────────────────────
http_post() {
    local url="$1" data="$2"
    if [ -n "$HAS_CURL" ]; then
        curl -s -X POST "$url" -H "Content-Type: application/json" -d "$data" 2>/dev/null
    elif [ -n "$HAS_WGET" ]; then
        wget -qO- --post-data="$data" --header="Content-Type: application/json" "$url" 2>/dev/null
    fi
}

# ── Detect scheduler ───────────────────────────────────
HAS_SACCT=$(command -v sacct 2>/dev/null || true)
HAS_KUBECTL=$(command -v kubectl 2>/dev/null || true)
HAS_NVIDIA=$(command -v nvidia-smi 2>/dev/null || true)

MODE=""
if [ -n "$HAS_SACCT" ] && [ -n "$HAS_KUBECTL" ]; then
    echo -e "${BOLD}Both SLURM and Kubernetes detected.${NC}"
    printf "Which scheduler? [s]lurm / [k]ubernetes: "
    read -r choice
    case "$choice" in
        k|K|kubernetes|Kubernetes) MODE="kubernetes" ;;
        *) MODE="slurm" ;;
    esac
elif [ -n "$HAS_SACCT" ]; then
    MODE="slurm"
elif [ -n "$HAS_KUBECTL" ]; then
    MODE="kubernetes"
else
    die "No supported scheduler found. This tool requires SLURM (sacct) or Kubernetes (kubectl)."
fi

info "Detected: $MODE"

# ── Vars ───────────────────────────────────────────
TOTAL_JOBS=0
AVG_CPU_WASTE=0
AVG_MEM_WASTE=0
AVG_GPU_CORE_WASTE=""
AVG_GPU_MEM_WASTE=""
GPU_JOBS=0
GPU_HOURS=0
TOTAL_COST=0
UTIL_SCORE=0
NODE_COUNT=0
CATEGORIES_JSON="null"

declare -A HIST_CPU HIST_MEM
for b in "0-10" "10-20" "20-30" "30-40" "40-50" "50-60" "60-70" "70-80" "80-90" "90-100"; do
    HIST_CPU[$b]=0
    HIST_MEM[$b]=0
done

bucket_for() {
    local val="$1"
    local v=$(echo "$val" | awk '{printf "%d", $1}')
    if [ "$v" -lt 10 ]; then echo "0-10"
    elif [ "$v" -lt 20 ]; then echo "10-20"
    elif [ "$v" -lt 30 ]; then echo "20-30"
    elif [ "$v" -lt 40 ]; then echo "30-40"
    elif [ "$v" -lt 50 ]; then echo "40-50"
    elif [ "$v" -lt 60 ]; then echo "50-60"
    elif [ "$v" -lt 70 ]; then echo "60-70"
    elif [ "$v" -lt 80 ]; then echo "70-80"
    elif [ "$v" -lt 90 ]; then echo "80-90"
    else echo "90-100"
    fi
}

#
# Single sacct query with 8 fields, processed in one awk pass.
# Main lines -> CPU waste. Sub-step lines -> MaxRSS for memory waste.
#
# Three job buckets:
#   TRACKED:   TotalCPU > 0, completed  -> CPU waste
#   UNTRACKED: TotalCPU == 0, completed -> no CPU data (missing cgroup accounting)
#   FAILED:    terminal failure state   -> 100% waste
#
# CPU waste = tracked jobs only.

if [ "$MODE" = "slurm" ]; then
    printf "Cost per core-hour in USD (default: 0.10): "
    read -r user_cost
    [ -n "$user_cost" ] && COST_PER_CORE_HOUR="$user_cost"

    SACCT_TMP=$(mktemp)
    CLEANUP_FILES="$CLEANUP_FILES $SACCT_TMP"
    ACTUAL_DAYS=$DAYS
    MAX_SACCT_WAIT=120
    CLUSTER_WIDE=true

    fetch_sacct() {
        local flags="$1" days="$2" fmt="$3"
        local sd
        sd=$(date -d "$days days ago" +%Y-%m-%d 2>/dev/null || date -v-${days}d +%Y-%m-%d 2>/dev/null)

        > "$SACCT_TMP"
        info "Querying SLURM (${flags:---your-jobs} last $days days)..."

        ( sacct $flags --parsable2 --noheader --starttime="$sd" --format="$fmt" 2>/dev/null > "$SACCT_TMP" ) &
        local pid=$! elapsed=0 spin='|/-\'
        while kill -0 $pid 2>/dev/null; do
            printf "\r  ${DIM}Fetching jobs... %s (%ds)${NC}" "${spin:$((elapsed%4)):1}" "$elapsed"
            sleep 1; elapsed=$((elapsed + 1))
            if [ "$elapsed" -ge "$MAX_SACCT_WAIT" ]; then
                kill -- -$pid 2>/dev/null || kill $pid 2>/dev/null || true
                wait $pid 2>/dev/null || true
                printf "\r                                    \r"
                warn "Query timed out after ${MAX_SACCT_WAIT}s."
                return 1
            fi
        done
        wait $pid 2>/dev/null || true
        printf "\r                                    \r"
        [ -s "$SACCT_TMP" ] && return 0 || return 2
    }

    GOT_DATA=false
    for try_flags in "--allusers" ""; do
        [ "$try_flags" = "" ] && [ "$GOT_DATA" = "true" ] && break
        [ "$try_flags" = "" ] && CLUSTER_WIDE=false && info "Trying your own jobs..."
        for try_days in $DAYS 7 3 2 1; do
            fetch_sacct "$try_flags" "$try_days" "JobID,AllocCPUS,Elapsed,TotalCPU,ReqMem,MaxRSS,AllocTRES,State"
            rc=$?
            if [ "$rc" -eq 0 ]; then
                ACTUAL_DAYS=$try_days; GOT_DATA=true
                [ "$try_days" -ne "$DAYS" ] && info "Using ${try_days}-day window."
                break 2
            elif [ "$rc" -eq 1 ]; then
                warn "Timed out. Trying shorter..."
            else break; fi
        done
    done
    [ "$GOT_DATA" = "false" ] && { rm -f "$SACCT_TMP"; die "No jobs found."; }
    [ "$CLUSTER_WIDE" = "false" ] && warn "Showing YOUR jobs only."
    if [ "$ACTUAL_DAYS" -lt "$DAYS" ] 2>/dev/null; then
        info "Expanse queries job data instantly (no sacct dependency) → app.expanse.sh"
    fi
    DAYS=$ACTUAL_DAYS

    TOTAL_LINES=$(wc -l < "$SACCT_TMP" | tr -d ' ')
    export TOTAL_LINES
    SACCT_SIZE=$(wc -c < "$SACCT_TMP" | tr -d ' ')
    AWK_OUT=$(mktemp)
    CLEANUP_FILES="$CLEANUP_FILES $AWK_OUT"
    info "Found $TOTAL_LINES records. Analysing..."

    # Single-pass awk over all records.
    # 8 pipe-delimited fields:
    #   $1=JobID $2=AllocCPUS $3=Elapsed $4=TotalCPU $5=ReqMem $6=MaxRSS $7=AllocTRES $8=State
    #
    # Main job lines (no "." in JobID): compute CPU waste, store ReqMem
    # Sub-step lines ("." in JobID): collect MaxRSS for memory waste
    # Memory waste computed in END block by comparing stored ReqMem vs max MaxRSS per job
    #
    # Time parsing uses separate arrays (a1 for Elapsed, a2 for TotalCPU) to stop gawk array element persistence across split() calls

    awk -F'|' '
    function mem_gb(s, cpus,    v, nn, last, u, g) {
        if (s=="" || s=="0") return 0
        nn=length(s); last=substr(s,nn)
        if (last=="c"||last=="n"||last=="C"||last=="N") { u=substr(s,nn-1,1); v=substr(s,1,nn-2)+0 }
        else { u=last; v=substr(s,1,nn-1)+0 }
        if (u=="G"||u=="g") g=v; else if (u=="M"||u=="m") g=v/1024
        else if (u=="T"||u=="t") g=v*1024; else if (u=="K"||u=="k") g=v/(1024*1024)
        else g=v/1024
        if (last=="c"||last=="C") g=g*cpus
        return g
    }
    {
        if (index($1, ".") > 0) {
            if ($6 != "" && $6 != "0") {
                split($1, jp, ".")
                rss=$6; rn=length(rss); ru=substr(rss,rn); rv=substr(rss,1,rn-1)+0
                if (ru=="K"||ru=="k") kb=rv; else if (ru=="M"||ru=="m") kb=rv*1024
                else if (ru=="G"||ru=="g") kb=rv*1024*1024; else kb=rss+0
                if (kb > max_rss[jp[1]]) max_rss[jp[1]] = kb
            }
            next
        }

        cpus=$2+0; state=$8
        if (state=="RUNNING"||state=="PENDING"||state=="REQUEUED"||state=="SUSPENDED") next

        job_req[$1] = $5; job_cpus[$1] = cpus

        elapsed_raw = $3; cpu_raw = $4

        sub(/\.[0-9]+$/, "", elapsed_raw)
        d1=0; e=elapsed_raw
        if (index(e,"-")>0) { d1=substr(e,1,index(e,"-")-1)+0; e=substr(e,index(e,"-")+1) }
        n1=split(e,a1,":")
        if (n1==3) esec=d1*86400+a1[1]*3600+a1[2]*60+a1[3]
        else if (n1==2) esec=d1*86400+a1[1]*60+a1[2]
        else esec=d1*86400+a1[1]+0

        if (esec < 10) next
        alloc = cpus * esec
        if (alloc <= 0) next

        sub(/\.[0-9]+$/, "", cpu_raw)
        d2=0; t=cpu_raw
        if (index(t,"-")>0) { d2=substr(t,1,index(t,"-")-1)+0; t=substr(t,index(t,"-")+1) }
        n2=split(t,a2,":")
        if (n2==3) used=d2*86400+a2[1]*3600+a2[2]*60+a2[3]
        else if (n2==2) used=d2*86400+a2[1]*60+a2[2]
        else used=d2*86400+a2[1]+0

        ch = cpus * esec / 3600
        total_jobs++
        total_ch += ch

        if (state=="FAILED"||state=="TIMEOUT"||state=="CANCELLED"||state=="OUT_OF_MEMORY"||state=="NODE_FAIL") {
            fail_n++; fail_ch += ch
        } else if (alloc > 0 && (used / alloc) < 0.001) {
            # TotalCPU < 0.1% of allocated CPU-seconds
            # This is batch script overhead, not real compute (e.g. 2s CPU on a 288-core, 23-hour job). We classify as untracked for these
            notrack_n++; notrack_ch += ch
        } else {
            cw = (1 - used/alloc) * 100
            if (cw < 0) cw = 0; if (cw > 100) cw = 100
            track_n++; track_ch += ch; track_w += cw * ch
            printf "JOB_WASTE %.1f %.2f\n", cw, ch
        }

        # GPU detection from AllocTRES (POSIX-compatible, no gawk extensions)
        if (index($7, "gres/gpu") > 0) {
            gpu_n++
            gpu_str = $7
            sub(/.*gres\/gpu[^,]*=/, "", gpu_str)
            sub(/,.*/, "", gpu_str)
            gpu_h += (gpu_str+0) * esec / 3600
        }

    }
    END {
        # CPU waste (tracked jobs only)
        cpu_avg  = (track_ch > 0) ? track_w / track_ch : 0
        fail_pct = (total_jobs > 0) ? (fail_n / total_jobs) * 100 : 0

        # Memory waste: compare stored ReqMem vs max MaxRSS per job
        for (id in max_rss) {
            if (!(id in job_req)) continue
            rg = mem_gb(job_req[id], job_cpus[id])
            if (rg <= 0) continue
            pk = max_rss[id] / (1024*1024)
            mw = (1 - pk/rg) * 100
            if (mw < 0) mw = 0; if (mw > 100) mw = 100
            mem_w += mw; mem_n++
        }
        mem_avg = (mem_n > 0) ? mem_w / mem_n : 0

        printf "S %d %.2f %d %.2f %.2f %.2f %d %.2f %d %.2f %d %.2f %.2f %d\n", \
            total_jobs, total_ch, \
            track_n+0, track_ch+0, cpu_avg, mem_avg, \
            notrack_n+0, notrack_ch+0, \
            fail_n+0, fail_ch+0, \
            gpu_n+0, gpu_h+0, fail_pct, mem_n+0
    }' "$SACCT_TMP" > "$AWK_OUT" &
    AWK_PID=$!

    elapsed=0
    last_print=0
    while kill -0 $AWK_PID 2>/dev/null; do
        sleep 1
        elapsed=$((elapsed + 1))
        if [ $((elapsed - last_print)) -ge 5 ]; then
            # Try /proc for percentage (Linux only)
            pct=""
            if [ -r "/proc/$AWK_PID/fdinfo/0" ] 2>/dev/null; then
                pos=$(awk '/^pos:/{print $2}' "/proc/$AWK_PID/fdinfo/0" 2>/dev/null)
                [ -n "$pos" ] && [ "$SACCT_SIZE" -gt 0 ] && pct="$((pos * 100 / SACCT_SIZE))%"
            fi
            if [ -n "$pct" ]; then
                info "  Analysing... ${pct} (${elapsed}s)"
            else
                info "  Analysing... (${elapsed}s)"
            fi
            last_print=$elapsed
        fi
    done
    wait $AWK_PID 2>/dev/null || true

    RESULT=$(cat "$AWK_OUT")
    rm -f "$SACCT_TMP" "$AWK_OUT"

    SL=$(echo "$RESULT" | grep "^S ")
    TOTAL_JOBS=$(echo "$SL" | awk '{print $2}')
    TOTAL_CORE_HOURS=$(echo "$SL" | awk '{print $3}')
    TRACKED_JOBS=$(echo "$SL" | awk '{print $4}')
    TRACKED_CORE_HOURS=$(echo "$SL" | awk '{print $5}')
    AVG_CPU_WASTE=$(echo "$SL" | awk '{print $6}')
    AVG_MEM_WASTE=$(echo "$SL" | awk '{print $7}')
    UNTRACKED_JOBS=$(echo "$SL" | awk '{print $8}')
    UNTRACKED_CORE_HOURS=$(echo "$SL" | awk '{print $9}')
    FAILED_JOBS=$(echo "$SL" | awk '{print $10}')
    FAILED_CORE_HOURS=$(echo "$SL" | awk '{print $11}')
    GPU_JOBS=$(echo "$SL" | awk '{print $12}')
    GPU_HOURS=$(echo "$SL" | awk '{print $13}')
    FAIL_PCT=$(echo "$SL" | awk '{print $14}')
    MEM_JOBS=$(echo "$SL" | awk '{print $15}')
    FAIL_CORE_PCT=$(echo "$TOTAL_CORE_HOURS $FAILED_CORE_HOURS" | awk '{printf "%.1f",($1>0)?($2/$1)*100:0}')
    ACTIVE_JOB_COUNT="$TRACKED_JOBS"

    CPU_PARTIAL=false
    TRACKED_PCT=$(echo "$TRACKED_CORE_HOURS $TOTAL_CORE_HOURS" | awk '{printf "%.0f",($2>0)?($1/$2)*100:0}')
    UNTRACKED_PCT=$(echo "$UNTRACKED_CORE_HOURS $TOTAL_CORE_HOURS" | awk '{printf "%.0f",($2>0)?($1/$2)*100:0}')
    if [ "$(echo "$UNTRACKED_CORE_HOURS $TOTAL_CORE_HOURS" | awk '{print (($2>0)?($1/$2):0) > 0.3}')" = "1" ]; then
        CPU_PARTIAL=true
    fi

    # MaxRSS from sacct sub-steps only captures batch script memory, not actual
    # compute process memory (MPI ranks, srun steps). The number is unreliable.
    # We report it with a caveat, or skip it if it looks like batch overhead.
    MEM_RELIABLE=true
    if [ "$(echo "$AVG_MEM_WASTE" | awk '{print ($1 > 90)}')" = "1" ]; then
        # >90% memory waste mostly means MaxRSS is batch overhead only
        MEM_RELIABLE=false
        AVG_MEM_WASTE=0
    fi

    CPU_UTIL=$(echo "$AVG_CPU_WASTE" | awk '{printf "%.2f",100-$1}')
    if [ "$MEM_RELIABLE" = "true" ] && [ "$(echo "$AVG_MEM_WASTE" | awk '{print ($1 > 0)}')" = "1" ]; then
        MEM_UTIL=$(echo "$AVG_MEM_WASTE" | awk '{printf "%.2f",100-$1}')
        UTIL_SCORE=$(echo "$CPU_UTIL $MEM_UTIL" | awk '{printf "%.1f",0.6*$1+0.4*$2}')
    else
        # CPU only when memory data is unreliable
        UTIL_SCORE=$(echo "$CPU_UTIL" | awk '{printf "%.1f",$1}')
    fi

    WASTED_CORE_HOURS=$(echo "$TRACKED_CORE_HOURS $AVG_CPU_WASTE" | awk '{printf "%.2f",$1*($2/100)}')
    CPU_COST=$(echo "$WASTED_CORE_HOURS $COST_PER_CORE_HOUR" | awk '{printf "%.2f",$1*$2}')
    TOTAL_COST="$CPU_COST"

    RANKING_SCORE=$(echo "$UTIL_SCORE $TOTAL_JOBS" | awk '{
        lj=($2>1)?log($2)/log(10):0; printf "%.2f",$1*(lj/4<1?lj/4:1)
    }')

    # Build core-hour weighted histogram (float accumulation via awk)
    while IFS= read -r line; do
        cpu_w=$(echo "$line" | awk '{print $2}')
        ch_val=$(echo "$line" | awk '{print $3}')
        [ -z "$cpu_w" ] || [ -z "$ch_val" ] && continue
        b=$(bucket_for "$cpu_w")
        [ -z "$b" ] && continue
        HIST_CPU["$b"]=$(echo "${HIST_CPU[$b]:-0} ${ch_val}" | awk '{printf "%.2f", $1 + $2}')
    done <<< "$(echo "$RESULT" | grep "^JOB_WASTE")"
fi

#
# K8s mode
#
if [ "$MODE" = "kubernetes" ]; then
    info "Sampling Kubernetes cluster utilisation..."

    NS_FLAG=""
    K8S_SCOPE=""
    if kubectl get pods --all-namespaces -o json >/dev/null 2>&1; then
        NS_FLAG="--all-namespaces"
        K8S_SCOPE="cluster-wide"
    else
        CURRENT_NS=$(kubectl config view --minify -o jsonpath='{..namespace}' 2>/dev/null)
        [ -z "$CURRENT_NS" ] && CURRENT_NS="default"
        if kubectl get pods -n "$CURRENT_NS" -o json >/dev/null 2>&1; then
            NS_FLAG="-n $CURRENT_NS"
            K8S_SCOPE="namespace: $CURRENT_NS"
            warn "Cluster-wide access denied. Scanning namespace '$CURRENT_NS' only."
        else
            die "kubectl access denied. Check your kubeconfig and RBAC permissions."
        fi
    fi
    info "Scope: $K8S_SCOPE"

    HAS_METRICS=true
    if ! kubectl top pods $NS_FLAG --no-headers 2>/dev/null | head -1 >/dev/null 2>&1; then
        warn "metrics-server not available. Showing resource requests only."
        HAS_METRICS=false
    fi

    info "  Collecting pod resource requests..."
    POD_JSON=$(kubectl get pods $NS_FLAG -o json 2>/dev/null) || die "Failed to get pods"

    TMPDIR_METRICS=$(mktemp -d)
    CLEANUP_FILES="$CLEANUP_FILES $TMPDIR_METRICS"
    if [ "$HAS_METRICS" = "true" ]; then
        for i in 1 2 3; do
            info "  [$i/3] Collecting metrics..."
            kubectl top pods $NS_FLAG --no-headers 2>/dev/null > "$TMPDIR_METRICS/pods-$i.txt" || true
            kubectl top nodes --no-headers 2>/dev/null > "$TMPDIR_METRICS/nodes-$i.txt" || true
            [ "$i" -lt 3 ] && sleep 30
        done
    fi

    NODE_JSON=$(kubectl get nodes -o json 2>/dev/null) || true
    NODE_COUNT=$(echo "$NODE_JSON" | awk -F'"' '/"kubernetes.io\/hostname"/{count++} END{print count+0}')

    categorize_pod() {
        local ns_lower=$(echo "$1" | tr 'A-Z' 'a-z')
        local pod_lower=$(echo "$2" | tr 'A-Z' 'a-z')
        local label_lower=$(echo "${3:-}" | tr 'A-Z' 'a-z')

        case "$label_lower" in
            *database*|*db*|*datastore*) echo "Database"; return ;;
            *frontend*|*backend*|*api*|*web*) echo "Web/API"; return ;;
            *ml*|*ai*|*training*|*inference*) echo "ML/AI"; return ;;
            *queue*|*broker*|*messaging*) echo "Queue"; return ;;
            *ci*|*cd*|*build*|*deploy*) echo "CI/CD"; return ;;
            *monitor*|*observ*|*metric*|*log*) echo "Monitoring"; return ;;
            *storage*|*s3*|*nfs*) echo "Storage"; return ;;
            *worker*|*job*|*batch*) echo "Batch/Workers"; return ;;
            *cache*) echo "Cache"; return ;;
            *search*) echo "Search"; return ;;
            *mesh*|*proxy*|*sidecar*) echo "Service Mesh"; return ;;
        esac

        case "$ns_lower" in
            kube-system|kube-public|kube-node-lease) echo "System"; return ;;
            *monitor*|*observ*|*logging*|*elk*|*loki*|*grafana*|*prometheus*) echo "Monitoring"; return ;;
            *istio*|*linkerd*|*cilium*) echo "Service Mesh"; return ;;
            *argo*|*flux*|*tekton*|*jenkins*|*cicd*) echo "CI/CD"; return ;;
            *ml*|*training*|*inference*|*gpu*|*ai*) echo "ML/AI"; return ;;
        esac

        case "$pod_lower" in
            *postgres*|*postgresql*|*mysql*|*mariadb*|*mongo*|*mongodb*|*redis*|*memcached*|*elastic*|*elasticsearch*|*opensearch*|*cassandra*|*cockroach*|*clickhouse*|*influxdb*|*timescaledb*|*vitess*|*tikv*|*etcd*|*consul*|*vault*|*neo4j*|*dgraph*|*supabase*|*planetscale*|*neon*|*dragonfly*|*keydb*|*valkey*|*scylla*|*foundationdb*|*couchdb*|*couchbase*|*arangodb*|*surreal*)
                echo "Database"; return ;;
            *nginx*|*apache*|*httpd*|*envoy*|*haproxy*|*traefik*|*caddy*|*ingress*|*gateway*|*api-server*|*fastapi*|*express*|*flask*|*django*|*rails*|*spring*|*tomcat*|*gunicorn*|*uvicorn*|*puma*|*unicorn*|*next*|*nuxt*|*svelte*|*remix*|*astro*)
                echo "Web/API"; return ;;
            *tensorflow*|*pytorch*|*torch*|*cuda*|*nvidia*|*gpu-operator*|*dcgm*|*model-serv*|*train*|*inference*|*predict*|*jupyter*|*notebook*|*ray*|*spark*|*dask*|*airflow*|*mlflow*|*kubeflow*|*triton*|*vllm*|*ollama*|*llm*|*huggingface*|*transformers*|*diffusion*|*langchain*|*llamaindex*|*onnx*|*tensorrt*|*deepspeed*|*megatron*|*nemo*)
                echo "ML/AI"; return ;;
            *kafka*|*rabbitmq*|*nats*|*pulsar*|*celery*|*sidekiq*|*resque*|*bull*|*activemq*|*zeromq*|*mosquitto*|*emqx*|*redpanda*|*strimzi*|*rocketmq*|*nsq*|*beanstalkd*)
                echo "Queue"; return ;;
            *jenkins*|*gitlab-runner*|*github-action*|*buildkite*|*drone*|*tekton*|*argo-workflow*|*argocd*|*concourse*|*spinnaker*|*flux*|*harness*|*woodpecker*|*dagger*|*depot*)
                echo "CI/CD"; return ;;
            *prometheus*|*grafana*|*alertmanager*|*jaeger*|*zipkin*|*otel*|*opentelemetry*|*datadog*|*newrelic*|*sentry*|*loki*|*tempo*|*thanos*|*mimir*|*alloy*|*fluentd*|*fluentbit*|*logstash*|*filebeat*|*vector*|*kibana*|*telegraf*|*statsd*|*nagios*|*zabbix*|*victoria-metrics*|*cortex*|*signoz*)
                echo "Monitoring"; return ;;
            *minio*|*ceph*|*rook*|*longhorn*|*nfs*|*gluster*|*openebs*|*portworx*|*velero*|*restic*|*s3-gateway*)
                echo "Storage"; return ;;
            *worker*|*cronjob*|*processor*|*consumer*|*handler*|*runner*|*executor*|*daemon*|*rq-worker*)
                echo "Batch/Workers"; return ;;
            *varnish*|*hazelcast*|*cache-server*)
                echo "Cache"; return ;;
            *solr*|*meilisearch*|*typesense*|*algolia*|*manticore*|*zinc*)
                echo "Search"; return ;;
            *istio*|*linkerd*|*consul-connect*|*cilium*|*kuma*)
                echo "Service Mesh"; return ;;
            *coredns*|*kube-proxy*|*kube-apiserver*|*kube-scheduler*|*kube-controller*|*metrics-server*|*calico*|*flannel*|*weave*|*cni*)
                echo "System"; return ;;
        esac

        echo "Other"
    }

    get_instance_price() {
        local itype="$1"
        case "$itype" in
            m5.xlarge) echo "0.192" ;; m5.2xlarge) echo "0.384" ;; m5.4xlarge) echo "0.768" ;;
            m6i.xlarge) echo "0.192" ;; m6i.2xlarge) echo "0.384" ;; m6i.4xlarge) echo "0.768" ;;
            m6g.xlarge) echo "0.154" ;; m6g.2xlarge) echo "0.308" ;; m6g.4xlarge) echo "0.616" ;;
            m7g.xlarge) echo "0.163" ;; m7g.2xlarge) echo "0.326" ;; m7g.4xlarge) echo "0.653" ;;
            c5.xlarge) echo "0.170" ;; c5.2xlarge) echo "0.340" ;; c5.4xlarge) echo "0.680" ;;
            c6i.xlarge) echo "0.170" ;; c6i.2xlarge) echo "0.340" ;;
            c6g.xlarge) echo "0.136" ;; c6g.2xlarge) echo "0.272" ;;
            r5.xlarge) echo "0.252" ;; r5.2xlarge) echo "0.504" ;; r5.4xlarge) echo "1.008" ;;
            p3.2xlarge) echo "3.060" ;; p3.8xlarge) echo "12.24" ;; p4d.24xlarge) echo "32.77" ;;
            g4dn.xlarge) echo "0.526" ;; g4dn.2xlarge) echo "0.752" ;; g4dn.12xlarge) echo "3.912" ;;
            g5.xlarge) echo "1.006" ;; g5.2xlarge) echo "1.212" ;; g5.12xlarge) echo "5.672" ;;
            n1-standard-4) echo "0.190" ;; n1-standard-8) echo "0.380" ;; n1-standard-16) echo "0.760" ;;
            e2-standard-2) echo "0.067" ;; e2-standard-4) echo "0.134" ;; e2-standard-8) echo "0.268" ;;
            a2-highgpu-1g) echo "3.670" ;; a2-highgpu-2g) echo "7.350" ;;
            *) echo "" ;;
        esac
    }

    # Sum resource requests across ALL containers per pod (including sidecars).
    # Uses containers[*] wildcard to get all containers, then sums in awk.
    POD_REQUESTS=$(kubectl get pods $NS_FLAG -o jsonpath='{range .items[?(@.status.phase=="Running")]}{.metadata.namespace}{"\t"}{.metadata.name}{"\t"}{.spec.containers[*].resources.requests.cpu}{"\t"}{.spec.containers[*].resources.requests.memory}{"\n"}{end}' 2>/dev/null | awk -F'\t' '{
        # $3 may contain space-separated CPU values from multiple containers (e.g. "500m 100m")
        # $4 may contain space-separated memory values (e.g. "512Mi 64Mi")
        total_cpu = 0; total_mem = 0
        n = split($3, cpus, " ")
        for (i = 1; i <= n; i++) {
            v = cpus[i]
            if (index(v, "m") > 0) { gsub(/m/, "", v); total_cpu += v }
            else { total_cpu += v * 1000 }
        }
        m = split($4, mems, " ")
        for (i = 1; i <= m; i++) {
            v = mems[i]
            if (index(v, "Gi") > 0) { gsub(/Gi/, "", v); total_mem += v * 1024 }
            else { gsub(/Mi/, "", v); total_mem += v }
        }
        printf "%s\t%s\t%dm\t%dMi\n", $1, $2, total_cpu, total_mem
    }')

    declare -A CAT_PODS CAT_CPU CAT_MEM CAT_COST
    METRICS_AVG=""

    # Count running pods from requests data (always available, even without metrics-server)
    TOTAL_JOBS=$(echo "$POD_REQUESTS" | grep -c . 2>/dev/null || echo 0)
    [ "$TOTAL_JOBS" -eq 0 ] && TOTAL_JOBS=0

    SUM_CPU_WASTE=0
    SUM_MEM_WASTE=0

    if [ "$HAS_METRICS" = "true" ] && [ -f "$TMPDIR_METRICS/pods-1.txt" ]; then
        # Average metrics across 3 samples, then join with resource requests
        METRICS_AVG=$(cat "$TMPDIR_METRICS"/pods-*.txt | awk '{
            key = $1 "/" $2
            cpu_str = $3
            if (index(cpu_str, "m") > 0) { gsub(/m/, "", cpu_str); cpu_m = cpu_str + 0 }
            else { cpu_m = (cpu_str + 0) * 1000 }
            mem_str = $4
            if (index(mem_str, "Gi") > 0) { gsub(/Gi/, "", mem_str); mem_mi = (mem_str + 0) * 1024 }
            else { gsub(/Mi/, "", mem_str); mem_mi = mem_str + 0 }
            cpu_sum[key] += cpu_m; mem_sum[key] += mem_mi; count[key]++
            ns[key] = $1; pod[key] = $2
        }
        END {
            for (k in cpu_sum) printf "%s\t%s\t%.0f\t%.0f\n", ns[k], pod[k], cpu_sum[k]/count[k], mem_sum[k]/count[k]
        }')

        # Build a lookup of requested resources (ns/pod → req_cpu_m, req_mem_mi)
        declare -A REQ_CPU REQ_MEM
        while IFS=$'\t' read -r rns rpod rcpu rmem; do
            [ -z "$rns" ] && continue
            # Parse CPU request to millicores
            if echo "$rcpu" | grep -q "m$"; then
                rcpu_m=$(echo "$rcpu" | sed 's/m$//')
            else
                rcpu_m=$((${rcpu:-0} * 1000))
            fi
            # Parse memory request to Mi
            if echo "$rmem" | grep -q "Gi$"; then
                rmem_mi=$(echo "$rmem" | sed 's/Gi$//' | awk '{printf "%.0f", $1 * 1024}')
            elif echo "$rmem" | grep -q "Mi$"; then
                rmem_mi=$(echo "$rmem" | sed 's/Mi$//')
            else
                rmem_mi=0
            fi
            REQ_CPU["$rns/$rpod"]=$rcpu_m
            REQ_MEM["$rns/$rpod"]=$rmem_mi
        done <<< "$POD_REQUESTS"

        TOTAL_JOBS=$(echo "$METRICS_AVG" | grep -c . || echo 0)

        SUM_CPU_WASTE=0
        SUM_MEM_WASTE=0

        while IFS=$'\t' read -r ns pod_name actual_cpu actual_mem; do
            [ -z "$ns" ] && continue

            category=$(categorize_pod "$ns" "$pod_name" "")

            key="$ns/$pod_name"
            req_cpu=${REQ_CPU[$key]:-0}
            req_mem=${REQ_MEM[$key]:-0}

            # Fall back to 2x actual if no request data (pods without resource requests)
            [ "$req_cpu" -eq 0 ] 2>/dev/null && req_cpu=$((actual_cpu * 2))
            [ "$req_mem" -eq 0 ] 2>/dev/null && req_mem=$((actual_mem * 2))

            if [ "$req_cpu" -gt 0 ] 2>/dev/null; then
                cpu_waste=$(echo "$actual_cpu $req_cpu" | awk '{w=(1-$1/$2)*100; if(w<0)w=0; if(w>100)w=100; printf "%.1f", w}')
            else
                cpu_waste="0.0"
            fi

            if [ "$req_mem" -gt 0 ] 2>/dev/null; then
                mem_waste=$(echo "$actual_mem $req_mem" | awk '{w=(1-$1/$2)*100; if(w<0)w=0; if(w>100)w=100; printf "%.1f", w}')
            else
                mem_waste="0.0"
            fi

            SUM_CPU_WASTE=$(echo "$SUM_CPU_WASTE $cpu_waste" | awk '{printf "%.2f", $1+$2}')
            SUM_MEM_WASTE=$(echo "$SUM_MEM_WASTE $mem_waste" | awk '{printf "%.2f", $1+$2}')

            b=$(bucket_for "$cpu_waste")
            [ -n "$b" ] && HIST_CPU["$b"]=$(( ${HIST_CPU[$b]:-0} + 1 ))
            b=$(bucket_for "$mem_waste")
            [ -n "$b" ] && HIST_MEM["$b"]=$(( ${HIST_MEM[$b]:-0} + 1 ))

            # Categories
            CAT_PODS[$category]=$(( ${CAT_PODS[$category]:-0} + 1 ))
            CAT_CPU[$category]=$(echo "${CAT_CPU[$category]:-0} $cpu_waste" | awk '{printf "%.2f", $1+$2}')
            CAT_MEM[$category]=$(echo "${CAT_MEM[$category]:-0} $mem_waste" | awk '{printf "%.2f", $1+$2}')

        done <<< "$METRICS_AVG"

        AVG_CPU_WASTE=$(echo "$SUM_CPU_WASTE $TOTAL_JOBS" | awk '{if($2>0) printf "%.2f",$1/$2; else print "0"}')
        AVG_MEM_WASTE=$(echo "$SUM_MEM_WASTE $TOTAL_JOBS" | awk '{if($2>0) printf "%.2f",$1/$2; else print "0"}')
    else
        # No metrics-server: we can see pod requests but not actual usage.
        # Report pod count but mark waste as unmeasurable.
        info "  $TOTAL_JOBS running pods found (requests only, no usage data)."
        AVG_CPU_WASTE=0
        AVG_MEM_WASTE=0
        MEM_RELIABLE=false
    fi

    TOTAL_NODE_COST_MONTHLY=0
    if [ -n "$NODE_JSON" ]; then
        NODE_INSTANCES=$(echo "$NODE_JSON" | awk -F'"' '/"node.kubernetes.io\/instance-type"/{print $4}' 2>/dev/null)
        while read -r itype; do
            [ -z "$itype" ] && continue
            price=$(get_instance_price "$itype")
            if [ -n "$price" ]; then
                TOTAL_NODE_COST_MONTHLY=$(echo "$TOTAL_NODE_COST_MONTHLY $price" | awk '{printf "%.2f", $1 + ($2 * 730)}')
            fi
        done <<< "$NODE_INSTANCES"
    fi

    if [ "$TOTAL_NODE_COST_MONTHLY" != "0" ]; then
        TOTAL_COST=$(echo "$TOTAL_NODE_COST_MONTHLY $AVG_CPU_WASTE" | awk '{printf "%.2f", $1 * ($2/100)}')
    else
        # No node access: estimate cost from pod-level CPU requests × default rate
        # Sum requested CPU across all pods (in millicores), convert to core-hours for the sample window
        POD_CPU_COST=$(echo "$METRICS_AVG" | awk -F'\t' '
        { req_cpu += $3 }
        END {
            core_hours = (req_cpu / 1000) * (90 / 3600)  # 90-second sample
            monthly = core_hours * (730 * 3600 / 90)      # extrapolate to monthly
            printf "%.2f", monthly * 0.10                  # $0.10/core-hour default
        }')
        TOTAL_COST=$(echo "$POD_CPU_COST $AVG_CPU_WASTE" | awk '{printf "%.2f", $1 * ($2/100)}')
    fi

    CATEGORIES_JSON="{"
    first=true
    for cat in "${!CAT_PODS[@]}"; do
        count=${CAT_PODS[$cat]}
        avg_cpu=$(echo "${CAT_CPU[$cat]} $count" | awk '{if($2>0) printf "%.0f",$1/$2; else print "0"}')
        avg_mem=$(echo "${CAT_MEM[$cat]} $count" | awk '{if($2>0) printf "%.0f",$1/$2; else print "0"}')
        cat_cost=$(echo "$TOTAL_COST $count $TOTAL_JOBS" | awk '{if($3>0) printf "%.0f", $1*($2/$3); else print "0"}')
        [ "$first" = "true" ] && first=false || CATEGORIES_JSON="$CATEGORIES_JSON,"
        CATEGORIES_JSON="$CATEGORIES_JSON\"$cat\":{\"pod_count\":$count,\"cpu_waste\":$avg_cpu,\"mem_waste\":$avg_mem,\"cost\":$cat_cost}"
    done
    CATEGORIES_JSON="$CATEGORIES_JSON}"

    # GPU detection from pod resource requests
    GPU_DATA=$(kubectl get pods $NS_FLAG -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[*].resources.requests.nvidia\.com/gpu}{"\n"}{end}' 2>/dev/null)
    GPU_JOBS=0
    GPU_HOURS=0
    if [ -n "$GPU_DATA" ]; then
        GPU_JOBS=$(echo "$GPU_DATA" | awk -F'\t' '$2+0 > 0 {n++} END{print n+0}')
        GPU_TOTAL=$(echo "$GPU_DATA" | awk -F'\t' '$2+0 > 0 {g+=$2} END{print g+0}')
        # Estimate GPU-hours from running pods (assume running for sample window)
        GPU_HOURS=$(echo "$GPU_TOTAL" | awk '{printf "%.1f", $1 * 730}')  # monthly estimate
    fi

    rm -rf "$TMPDIR_METRICS"

    TOTAL_CORE_HOURS=0
    WASTED_CORE_HOURS=$(echo "$TOTAL_COST $COST_PER_CORE_HOUR" | awk '{printf "%.2f", ($2>0)?$1/$2:0}')
    MEM_RELIABLE=$HAS_METRICS
    FAILED_JOBS=0
    FAIL_PCT=0
    FAIL_CORE_PCT=0
    UNTRACKED_JOBS=0
    UNTRACKED_PCT=0
    ACTIVE_JOB_COUNT="$TOTAL_JOBS"
    TRACKED_PCT=100
    CPU_PARTIAL=false

    CPU_UTIL=$(echo "$AVG_CPU_WASTE" | awk '{printf "%.2f",100-$1}')
    MEM_UTIL=$(echo "$AVG_MEM_WASTE" | awk '{printf "%.2f",100-$1}')
    UTIL_SCORE=$(echo "$CPU_UTIL $MEM_UTIL" | awk '{printf "%.1f",0.6*$1+0.4*$2}')

    RANKING_SCORE=$(echo "$UTIL_SCORE $TOTAL_JOBS" | awk '{
        lj=($2>1)?log($2)/log(10):0; printf "%.2f",$1*(lj/4<1?lj/4:1)
    }')
fi


hist_json() {
    local -n arr=$1
    local json="{"
    local first=true
    for b in "0-10" "10-20" "20-30" "30-40" "40-50" "50-60" "60-70" "70-80" "80-90" "90-100"; do
        [ "$first" = "true" ] && first=false || json="$json,"
        json="$json\"$b\":${arr[$b]}"
    done
    echo "$json}"
}

HIST_CPU_JSON=$(hist_json HIST_CPU)
HIST_MEM_JSON=$(hist_json HIST_MEM)

progress_bar() {
    local pct=$1 width=20
    local filled=$(echo "$pct $width" | awk '{printf "%d", ($1/100)*$2}')
    local empty=$((width - filled))
    local bar=""
    for ((i=0; i<filled; i++)); do bar="${bar}█"; done
    for ((i=0; i<empty; i++)); do bar="${bar}░"; done
    echo "$bar"
}

if [ "$JSON_OUTPUT" = "false" ]; then
    SCORE_INT=$(echo "$UTIL_SCORE" | awk '{printf "%d", $1}')
    CPU_W_INT=$(echo "$AVG_CPU_WASTE" | awk '{printf "%d", $1}')
    MEM_W_INT=$(echo "$AVG_MEM_WASTE" | awk '{printf "%d", $1}')
    COST_FMT=$(echo "$TOTAL_COST" | awk '{printf "$%\047.0f", $1}')
    FAIL_INT=$(echo "${FAIL_PCT:-0}" | awk '{printf "%d", $1}')
    CORE_HRS_FMT=$(echo "$TOTAL_CORE_HOURS" | awk '{if($1>=1000000) printf "%.1fM",$1/1000000; else if($1>=1000) printf "%.1fk",$1/1000; else printf "%d",$1}')
    WASTE_HRS_FMT=$(echo "$WASTED_CORE_HOURS" | awk '{if($1>=1000000) printf "%.1fM",$1/1000000; else if($1>=1000) printf "%.1fk",$1/1000; else printf "%d",$1}')

    if [ "$SCORE_INT" -ge 70 ]; then SCORE_CLR="$GREEN"
    elif [ "$SCORE_INT" -ge 40 ]; then SCORE_CLR="$YELLOW"
    else SCORE_CLR="$RED"; fi

    W=56
    LINE=$(printf '%*s' "$W" '' | tr ' ' '═')
    BLANK=$(printf "║%-${W}s║" "")

    echo ""
    echo ""
    echo -e "  ${BOLD}╔${LINE}╗${NC}"
    echo -e "  ${BOLD}║$(printf '%*s' $(( (W - 42) / 2 )) '')COMPUTE WASTE REPORT — wastage.expanse.sh$(printf '%*s' $(( (W - 42 + 1) / 2 )) '')║${NC}"
    echo -e "  ${BOLD}╠${LINE}╣${NC}"
    echo -e "  $BLANK"

    BAR=$(progress_bar $SCORE_INT)
    printf "  ║  Utilisation Score:  ${SCORE_CLR}${BOLD}%3s/100${NC}  %s       ║\n" "$SCORE_INT" "$BAR"
    echo -e "  $BLANK"

    if [ "$MODE" = "slurm" ]; then
        printf "  ║  Jobs Analysed:      %-32s║\n" "$(echo $TOTAL_JOBS | awk '{printf "%\047d", $1}')"
        printf "  ║  Core-hours Total:   %-32s║\n" "$CORE_HRS_FMT"
        printf "  ║  Time Period:        %-32s║\n" "Last $DAYS days"
    else
        printf "  ║  Pods Analysed:      %-32s║\n" "$(echo $TOTAL_JOBS | awk '{printf "%\047d", $1}')"
        printf "  ║  Nodes:              %-32s║\n" "$NODE_COUNT"
        printf "  ║  Sampling:           %-32s║\n" "90-second average"
    fi
    echo -e "  $BLANK"

    printf "  ║  CPU Waste:          ${RED}%3s%%${NC}  %s          ║\n" "$CPU_W_INT" "$(progress_bar $CPU_W_INT)"
    if [ "$MEM_RELIABLE" = "true" ]; then
        printf "  ║  Memory Waste:       ${RED}%3s%%${NC}  %s          ║\n" "$MEM_W_INT" "$(progress_bar $MEM_W_INT)"
    else
        if [ "$MODE" = "slurm" ]; then
            printf "  ║  Memory Waste:       ${DIM}%-32s${NC}║\n" "N/A (sacct tracking limited)"
        else
            printf "  ║  Memory Waste:       ${DIM}%-32s${NC}║\n" "N/A (metrics unavailable)"
        fi
    fi

    if [ "$GPU_JOBS" -gt 0 ]; then
        printf "  ║  GPU Jobs:           %-32s║\n" "$GPU_JOBS  ($(echo $GPU_HOURS | awk '{printf "%d", $1}') GPU-hours)"
    fi
    echo -e "  $BLANK"

    printf "  ║  ${DIM}Based on %s tracked jobs (%s%% of core-hrs)${NC}" "${ACTIVE_JOB_COUNT:-0}" "${TRACKED_PCT}"
    COVERAGE_LEN=$((21 + ${#ACTIVE_JOB_COUNT} + ${#TRACKED_PCT}))
    printf "%*s║\n" $((W - COVERAGE_LEN)) ""

    if [ "${FAILED_JOBS:-0}" -gt 0 ] 2>/dev/null; then
        FAIL_CORE_INT=$(echo "${FAIL_CORE_PCT:-0}" | awk '{printf "%d", $1}')
        printf "  ║  ${RED}Failed:              %s%% of jobs (%s%% of compute)${NC}" "$FAIL_INT" "$FAIL_CORE_INT"
        FAIL_LEN=$((28 + ${#FAIL_INT} + ${#FAIL_CORE_INT}))
        printf "%*s║\n" $((W - FAIL_LEN)) ""
    fi

    if [ "${UNTRACKED_JOBS:-0}" -gt 0 ] 2>/dev/null && [ "${UNTRACKED_PCT:-0}" -gt 5 ] 2>/dev/null; then
        printf "  ║  ${YELLOW}Untracked:           %s%% of core-hours${NC}" "$UNTRACKED_PCT"
        UT_LEN=$((26 + ${#UNTRACKED_PCT}))
        printf "%*s║\n" $((W - UT_LEN)) ""
        printf "  ║    ${DIM}%-52s${NC}║\n" "SLURM lacks cgroup data for these jobs."
        printf "  ║    ${DIM}%-52s${NC}║\n" "Expanse tracks all jobs → app.expanse.sh"
    fi
    echo -e "  $BLANK"

    printf "  ║  Core-hours Wasted:  %-32s║\n" "${WASTE_HRS_FMT}"
    printf "  ║  Estimated Waste:    ${RED}${BOLD}%-32s${NC}║\n" "${COST_FMT}"
    echo -e "  $BLANK"

    if [ "$MODE" = "kubernetes" ] && [ ${#CAT_PODS[@]} -gt 0 ]; then
        echo -e "  ╠${LINE}╣"
        printf "  ║  ${BOLD}%-52s${NC}║\n" "Waste by Workload Category"
        for cat in "${!CAT_PODS[@]}"; do
            count=${CAT_PODS[$cat]}
            avg_cpu=$(echo "${CAT_CPU[$cat]} $count" | awk '{if($2>0) printf "%d",$1/$2; else print "0"}')
            avg_mem=$(echo "${CAT_MEM[$cat]} $count" | awk '{if($2>0) printf "%d",$1/$2; else print "0"}')
            printf "  ║  %-16s %4d pods  CPU:%3s%%  Mem:%3s%%    ║\n" "$cat" "$count" "$avg_cpu" "$avg_mem"
        done
    fi

    echo -e "  ╠${LINE}╣"
    echo -e "  $BLANK"
    printf "  ║  ${BOLD}%-52s${NC}║\n" "This is ~10% of what Expanse shows you."
    echo -e "  $BLANK"
    printf "  ║  %-54s║\n" "Install Expanse on your cluster (free) to get:"
    printf "  ║  • %-52s║\n" "Live CPU, memory & GPU utilisation per job"
    printf "  ║  • %-52s║\n" "Per-job, per-user waste breakdown"
    printf "  ║  • %-52s║\n" "GPU core & memory waste tracking"
    printf "  ║  • %-52s║\n" "Historical trends and continuous monitoring"
    printf "  ║  • %-52s║\n" "API access for your own dashboards"
    echo -e "  $BLANK"
    printf "  ║  ${GREEN}${BOLD}%-54s${NC}║\n" "Get started → app.expanse.sh"
    echo -e "  $BLANK"

    if [ "$MODE" = "kubernetes" ]; then
        printf "  ║  ${YELLOW}%-54s${NC}║\n" "Note: K8s data is a 90-second snapshot."
        printf "  ║  ${YELLOW}%-54s${NC}║\n" "Expanse tracks continuously with history."
    fi

    echo -e "  ${BOLD}╚${LINE}╝${NC}"
    echo ""
fi

SHOW_LEADERBOARD=false
CLUSTER_NAME=""
COUNTRY=""
EMAIL=""

if [ "$LOCAL_ONLY" = "false" ] && [ -t 0 ]; then
    printf "Show your cluster on the leaderboard? (y/N): "
    read -r lb_choice
    case "$lb_choice" in
        y|Y|yes|Yes)
            SHOW_LEADERBOARD=true
            printf "Cluster name: "
            read -r CLUSTER_NAME
            # Sanitize: alphanumeric, spaces, hyphens, max 50
            CLUSTER_NAME=$(echo "$CLUSTER_NAME" | tr -cd 'a-zA-Z0-9 -' | head -c 50)
            printf "Country: "
            read -r COUNTRY
            COUNTRY=$(echo "$COUNTRY" | head -c 100)
            ;;
    esac

    printf "Join the Expanse mailing list for HPC insights (Enter to skip): "
    read -r EMAIL
fi

escape_json() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g; s/\n/\\n/g'; }

PAYLOAD=$(cat <<JSONEOF
{
  "scheduler_type": "$MODE",
  "job_count": $TOTAL_JOBS,
  "node_count": $NODE_COUNT,
  "avg_cpu_waste_pct": $AVG_CPU_WASTE,
  "avg_mem_waste_pct": $AVG_MEM_WASTE,
  "avg_gpu_core_waste_pct": ${AVG_GPU_CORE_WASTE:-null},
  "avg_gpu_mem_waste_pct": ${AVG_GPU_MEM_WASTE:-null},
  "gpu_jobs": $GPU_JOBS,
  "gpu_hours": $GPU_HOURS,
  "total_estimated_cost_usd": $TOTAL_COST,
  "utilisation_score": $UTIL_SCORE,
  "show_on_leaderboard": $SHOW_LEADERBOARD,
  "cluster_name": $([ -n "$CLUSTER_NAME" ] && echo "\"$(escape_json "$CLUSTER_NAME")\"" || echo "null"),
  "country": $([ -n "$COUNTRY" ] && echo "\"$(escape_json "$COUNTRY")\"" || echo "null"),
  "email": $([ -n "$EMAIL" ] && echo "\"$(escape_json "$EMAIL")\"" || echo "null"),
  "histogram_cpu": $HIST_CPU_JSON,
  "histogram_mem": $HIST_MEM_JSON,
  "cost_per_core_hour": $COST_PER_CORE_HOUR,
  "categories": $CATEGORIES_JSON,
  "total_core_hours": ${TOTAL_CORE_HOURS:-0},
  "wasted_core_hours": ${WASTED_CORE_HOURS:-0},
  "failed_jobs": ${FAILED_JOBS:-0},
  "failed_job_pct": ${FAIL_PCT:-0},
  "failed_core_pct": ${FAIL_CORE_PCT:-0}
}
JSONEOF
)

if [ "$JSON_OUTPUT" = "true" ]; then
    echo "$PAYLOAD"
    [ "$LOCAL_ONLY" = "true" ] && exit 0
fi

if [ "$LOCAL_ONLY" = "true" ]; then
    echo -e "${DIM}Run without --local to get a shareable URL.${NC}"
    exit 0
fi

info "Uploading report..."
RESPONSE=$(http_post "$API_URL" "$PAYLOAD" 2>/dev/null) || {
    warn "Could not reach wastage.expanse.sh. Your report was generated locally above."
    echo -e "${DIM}Run with --local to skip network.${NC}"
    exit 0
}

REPORT_URL=$(echo "$RESPONSE" | tr -d '\n' | awk -F'"' '{for(i=1;i<=NF;i++){if($i=="url")print $(i+2)}}')
if [ -n "$REPORT_URL" ]; then
    echo ""
    echo -e "  ${BOLD}View full report:${NC} ${BLUE}${REPORT_URL}${NC}"
    echo ""
else
    ERROR_MSG=$(echo "$RESPONSE" | awk -F'"' '/"error"/{print $4}')
    if [ -n "$ERROR_MSG" ]; then
        warn "Upload failed: $ERROR_MSG"
    else
        warn "Unexpected response from server."
    fi
fi

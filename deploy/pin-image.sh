#!/usr/bin/env bash
# Pins the Wastage image in a manifest: its one image line moves to the reference given, which must be a digest on
# expanse-wastage in the platform registry, so an expired tag never takes the running image with it (INF-174).
set -euo pipefail

image="${1:?usage: deploy/pin-image.sh <registry>/expanse-wastage:wastage-<sha>@sha256:<digest> [manifest]}"
manifest="${2:-deploy/k8s/deployment.yaml}"

if [[ ! "$image" =~ ^941017932298\.dkr\.ecr\.eu-west-2\.amazonaws\.com/expanse-wastage:wastage-[0-9a-f]{7,40}@sha256:[0-9a-f]{64}$ ]]; then
  echo "refusing ${image}: the pin is 941017932298.dkr.ecr.eu-west-2.amazonaws.com/expanse-wastage:wastage-<sha>@sha256:<digest>" >&2
  exit 1
fi

lines="$(grep -c -E '^[[:space:]]*image: ' "$manifest" || true)"
if [ "$lines" != 1 ]; then
  echo "refusing to pin ${manifest}: ${lines} image lines, want exactly one" >&2
  exit 1
fi

tmp="$(mktemp)"
sed -E "s#^([[:space:]]*image: ).*\$#\\1${image}#" "$manifest" > "$tmp"
mv "$tmp" "$manifest"
echo "pinned ${manifest} to ${image}"

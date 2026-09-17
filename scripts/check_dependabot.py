#!/usr/bin/env python3
"""Every manifest in this checkout is watched by a block in .github/dependabot.yml (INF-175).

Walks the checkout for go.mod, uv.lock, package-lock.json, bun.lock, Dockerfile and compose
files, maps each to Dependabot's ecosystem name and asserts the (ecosystem, directory) set
equals the blocks, bar exclusions passed as `--exclude ecosystem:directory`, each of which
must still name a real manifest so a stale exclusion fails too. Every block must keep the
shape shared across the estate: version 2, weekly on Monday in Europe/London, a seven-day
cooldown and the `chore(deps)` commit prefix.

A go.mod `tool` directive, on its own line or inside a `tool (...)` block, is an indirect
requirement to Go, which Dependabot skips unless the block allows it (`dependency-type: all`,
or the module named as `indirect`), so each tool's module must be allowed by the block that
covers its directory.

A compose file is its own manifest: Dependabot's docker updater takes a YAML file beside a
Dockerfile only when it looks like a Kubernetes resource (`apiVersion` and `kind`) or a Helm
chart, and a compose file is neither, so it needs a `docker-compose` block or an exclusion.

Inside a Dockerfile the docker parser reads FROM instructions only, so an image named in
`COPY --from=` or a `--mount=from=` is never bumped; every such reference must be a stage the
Dockerfile declares. Comment lines are dropped and backslash continuations joined first, as
Docker does. `--self-test` runs the checker against mutated fixtures and must fail each one.
"""

import argparse
import os
import re
import shutil
import sys
import tempfile

import yaml

MANIFESTS = {
    "go.mod": "gomod",
    "uv.lock": "uv",
    "package-lock.json": "npm",
    "bun.lock": "bun",
    "Dockerfile": "docker",
    "docker-compose.yml": "docker-compose",
    "docker-compose.yaml": "docker-compose",
    "compose.yml": "docker-compose",
    "compose.yaml": "docker-compose",
}
SKIPPED_DIRS = {".git", ".venv", "node_modules", "vendor"}
TOOL_LINE = re.compile(r"^tool\s+([^\s(]\S*)", re.M)
TOOL_BLOCK = re.compile(r"^tool\s*\([ \t]*(?://[^\n]*)?\n(.*?)^\)", re.M | re.S)
GO_COMMENT = re.compile(r"//.*")
REQUIRE_LINE = re.compile(r"^\s*(?:require\s+)?(\S+)\s+v\S+", re.M)
FROM_LINE = re.compile(r"^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?", re.I | re.M)
STAGE_REFERENCE = re.compile(r"--(?:from=|mount=[^\s]*\bfrom=)([^\s,]+)", re.I)


def manifests(root):
    """Return {(ecosystem, directory)} for every manifest under root, plus tool modules per go.mod directory."""
    found, tools = set(), {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIPPED_DIRS)
        rel = os.path.relpath(dirpath, root)
        directory = "/" if rel == "." else "/" + rel.replace(os.sep, "/")
        for name in filenames:
            if name not in MANIFESTS:
                continue
            found.add((MANIFESTS[name], directory))
            if name == "go.mod":
                modules = tool_modules(os.path.join(dirpath, name))
                if modules:
                    tools[directory] = modules
    return found, tools


def tool_directives(text):
    """Every module path a go.mod names as a tool, on its own line or inside a tool (...) block."""
    tools = TOOL_LINE.findall(text)
    for body in TOOL_BLOCK.findall(text):
        tools += [t for t in (GO_COMMENT.sub("", line).strip() for line in body.splitlines()) if t]
    return tools


def tool_modules(path):
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    required = [m for m in REQUIRE_LINE.findall(text) if "/" in m]
    out = set()
    for tool in tool_directives(text):
        owners = [m for m in required if tool == m or tool.startswith(m + "/")]
        out.add(max(owners, key=len) if owners else tool)
    return out


def allowed(entries, module):
    for entry in entries:
        if entry.get("dependency-type") == "all" and not entry.get("dependency-name"):
            return True
        if entry.get("dependency-name") == module and entry.get("dependency-type") in ("indirect", "all"):
            return True
    return False


def shape_errors(update):
    schedule = update.get("schedule", {})
    want = {
        "schedule.interval": (schedule.get("interval"), "weekly"),
        "schedule.day": (schedule.get("day"), "monday"),
        "schedule.timezone": (schedule.get("timezone"), "Europe/London"),
        "cooldown.default-days": (update.get("cooldown", {}).get("default-days"), 7),
        "commit-message.prefix": (update.get("commit-message", {}).get("prefix"), "chore(deps)"),
    }
    return [f"{key} is {got!r}, want {expected!r}" for key, (got, expected) in want.items() if got != expected]


def dockerfile_instructions(text):
    """(first line number, instruction) pairs with comment lines dropped and continuations joined."""
    out, start, parts = [], None, []
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        start = start or number
        if line.endswith("\\"):
            parts.append(line[:-1].rstrip())
            continue
        out.append((start, " ".join(parts + [line])))
        start, parts = None, []
    if parts:
        out.append((start, " ".join(parts)))
    return out


def dockerfile_errors(path):
    with open(path, encoding="utf-8") as handle:
        instructions = dockerfile_instructions(handle.read())
    froms = [m for _, text in instructions for m in FROM_LINE.findall(text)]
    stages = {alias for _, alias in froms if alias} | {str(i) for i in range(len(froms))}
    return [
        f"{path}:{number}: `{ref}` is not a stage this Dockerfile declares, so Dependabot never bumps it"
        for number, text in instructions
        for ref in STAGE_REFERENCE.findall(text)
        if ref not in stages and not ref.startswith("$")
    ]


def check(root, exclusions):
    """Return a list of failures for the checkout at root; empty means covered."""
    with open(os.path.join(root, ".github", "dependabot.yml"), encoding="utf-8") as handle:
        doc = yaml.safe_load(handle)
    failures = []
    if doc.get("version") != 2:
        failures.append(f"version is {doc.get('version')!r}, want 2")
    found, tools = manifests(root)
    covered, allows = set(), {}
    for update in doc.get("updates", []):
        eco = update["package-ecosystem"]
        for directory in update.get("directories") or [update["directory"]]:
            covered.add((eco, directory))
            if eco == "gomod":
                allows[directory] = update.get("allow", [])
        failures += [f"{eco} block: {e}" for e in shape_errors(update)]
    excluded = {tuple(e.split(":", 1)) for e in exclusions}
    missing = sorted(m for m in found if m not in covered and m not in excluded)
    phantom = sorted(c for c in covered if c not in found)
    stale = sorted(e for e in excluded if e not in found or e in covered)
    if missing:
        failures.append(f"MISSING: {missing}")
    if phantom:
        failures.append(f"PHANTOM: {phantom}")
    if stale:
        failures.append(f"STALE EXCLUSION: {stale}")
    for directory, modules in sorted(tools.items()):
        for module in sorted(modules):
            if not allowed(allows.get(directory, []), module):
                failures.append(f"TOOL NOT ALLOWED: {directory}:{module}")
    for eco, directory in sorted(found):
        if eco == "docker":
            failures += dockerfile_errors(os.path.join(root, directory.lstrip("/"), "Dockerfile"))
    return failures


FIXTURE_CONFIG = """version: 2
updates:
  - package-ecosystem: "docker"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "09:00"
      timezone: "Europe/London"
    open-pull-requests-limit: 2
    cooldown:
      default-days: 7
    commit-message:
      prefix: "chore(deps)"
    groups:
      docker-base-images:
        patterns:
          - "*"
"""
FIXTURE_DOCKERFILE = "FROM alpine:3.20 AS build\nFROM alpine:3.20\nCOPY --from=build /x /x\n"
CONTINUED_DOCKERFILE = "FROM alpine:3.20 \\\n    AS build\nFROM alpine:3.20\nCOPY --from=build /x /x\n"
COMMENTED_DOCKERFILE = FIXTURE_DOCKERFILE + "# COPY --from=ghcr.io/x/y:1 /y /y is the shape Dependabot cannot bump\n"
FIXTURE_COMPOSE = "services:\n  db:\n    image: postgres:16-alpine\n"


FIXTURE_GOMOD = "module m\n\ngo 1.25\n\ntool golang.org/x/tools/cmd/goimports\n\nrequire golang.org/x/tools v0.30.0 // indirect\n"
BLOCK_GOMOD = FIXTURE_GOMOD.replace(
    "tool golang.org/x/tools/cmd/goimports\n",
    "tool (\n\tgolang.org/x/tools/cmd/goimports // formatter\n\tgolang.org/x/tools/cmd/stringer\n)\n",
)
COMMENTED_BLOCK_GOMOD = BLOCK_GOMOD.replace("tool (\n", "tool ( // build tools\n")
FIXTURE_GOMOD_BLOCK = """
  - package-ecosystem: "gomod"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "09:00"
      timezone: "Europe/London"
    open-pull-requests-limit: 5
    cooldown:
      default-days: 7
    commit-message:
      prefix: "chore(deps)"
"""
FIXTURE_COMPOSE_BLOCK = FIXTURE_GOMOD_BLOCK.replace('"gomod"', '"docker-compose"')
ALLOW_ALL = "    allow:\n      - dependency-type: \"all\"\n"


def self_test():
    """Each mutation of a covered fixture must fail with the named message; the covered shapes must pass."""
    config = ".github/dependabot.yml"
    cases = [
        ("fixture", {}, [], None),
        ("dropped block", {config: "version: 2\nupdates: []\n"}, [], "MISSING: [('docker', '/')]"),
        ("phantom block", {config: FIXTURE_CONFIG.replace('"/"', '"/web"')}, [], "PHANTOM: [('docker', '/web')]"),
        ("version 1", {config: FIXTURE_CONFIG.replace("version: 2", "version: 1")}, [], "version is 1, want 2"),
        ("cooldown 3", {config: FIXTURE_CONFIG.replace("default-days: 7", "default-days: 3")}, [], "cooldown.default-days is 3, want 7"),
        ("compose beside the Dockerfile without a block", {"docker-compose.yml": FIXTURE_COMPOSE}, [], "MISSING: [('docker-compose', '/')]"),
        ("compose with its own block", {"docker-compose.yml": FIXTURE_COMPOSE, config: FIXTURE_CONFIG + FIXTURE_COMPOSE_BLOCK}, [], None),
        ("compose excluded", {"docker-compose.yml": FIXTURE_COMPOSE}, ["docker-compose:/"], None),
        ("stale exclusion", {}, ["docker-compose:/"], "STALE EXCLUSION: [('docker-compose', '/')]"),
        ("exclusion of a compose file that has a block", {"docker-compose.yml": FIXTURE_COMPOSE, config: FIXTURE_CONFIG + FIXTURE_COMPOSE_BLOCK}, ["docker-compose:/"], "STALE EXCLUSION: [('docker-compose', '/')]"),
        ("image in COPY --from", {"Dockerfile": FIXTURE_DOCKERFILE + "COPY --from=ghcr.io/x/y:1 /y /y\n"}, [], "`ghcr.io/x/y:1` is not a stage"),
        ("image in a continued COPY", {"Dockerfile": FIXTURE_DOCKERFILE + "COPY \\\n  --from=ghcr.io/x/y:1 /y /y\n"}, [], "`ghcr.io/x/y:1` is not a stage"),
        ("image in a comment", {"Dockerfile": COMMENTED_DOCKERFILE}, [], None),
        ("continued FROM", {"Dockerfile": CONTINUED_DOCKERFILE}, [], None),
        ("tool not allowed", {"go.mod": FIXTURE_GOMOD, config: FIXTURE_CONFIG + FIXTURE_GOMOD_BLOCK}, [], "TOOL NOT ALLOWED: /:golang.org/x/tools"),
        ("tool block not allowed", {"go.mod": BLOCK_GOMOD, config: FIXTURE_CONFIG + FIXTURE_GOMOD_BLOCK}, [], "TOOL NOT ALLOWED: /:golang.org/x/tools"),
        ("tool block with a comment on its opener", {"go.mod": COMMENTED_BLOCK_GOMOD, config: FIXTURE_CONFIG + FIXTURE_GOMOD_BLOCK}, [], "TOOL NOT ALLOWED: /:golang.org/x/tools"),
        ("tool allowed", {"go.mod": FIXTURE_GOMOD, config: FIXTURE_CONFIG + FIXTURE_GOMOD_BLOCK + ALLOW_ALL}, [], None),
        ("tool block allowed", {"go.mod": BLOCK_GOMOD, config: FIXTURE_CONFIG + FIXTURE_GOMOD_BLOCK + ALLOW_ALL}, [], None),
    ]
    failed = []
    for name, files, exclusions, expected in cases:
        root = tempfile.mkdtemp(prefix="dependabot-selftest-")
        try:
            write(root, config, FIXTURE_CONFIG)
            write(root, "Dockerfile", FIXTURE_DOCKERFILE)
            for rel, text in files.items():
                write(root, rel, text)
            failures = check(root, exclusions)
        finally:
            shutil.rmtree(root)
        ok = not failures if expected is None else any(expected in f for f in failures)
        print(f"{'ok' if ok else 'FAIL'}: {name}: {failures}")
        if not ok:
            failed.append(name)
    return failed


def write(root, rel, text):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("root", nargs="?", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    parser.add_argument("--exclude", action="append", default=[], metavar="ECOSYSTEM:DIRECTORY",
                        help="a manifest left out on purpose; the reason belongs in the dependabot.yml comment")
    parser.add_argument("--self-test", action="store_true", help="run the mutation fixtures and exit")
    args = parser.parse_args()
    if args.self_test:
        failed = self_test()
        print("self-test ok" if not failed else f"self-test FAILED: {failed}")
        return 1 if failed else 0
    root = os.path.abspath(args.root)
    found, tools = manifests(root)
    print(f"{os.path.basename(root)}: manifests={sorted(found)} tools={ {d: sorted(m) for d, m in tools.items()} } exclusions={sorted(args.exclude)}")
    failures = check(root, args.exclude)
    for failure in failures:
        print(failure)
    print("coverage ok" if not failures else f"{len(failures)} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

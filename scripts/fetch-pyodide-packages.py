#!/usr/bin/env python3
"""Downloads the scientific Python wheels (numpy, pandas, matplotlib, scipy and their dependencies) into
public/pyodide so Python works offline on the phone. Every file is checked against the sha256 in pyodide-lock.json."""
import hashlib, json, pathlib, urllib.request
ROOT = pathlib.Path(__file__).resolve().parent.parent / "public" / "pyodide"
WANTED = ["numpy", "pandas", "matplotlib", "scipy"]
VERSION = json.load(open(ROOT.parent.parent / "node_modules" / "pyodide" / "package.json"))["version"]
lock = json.load(open(ROOT / "pyodide-lock.json"))["packages"]
need, stack = set(), list(WANTED)
while stack:
    n = stack.pop()
    if n not in need:
        need.add(n); stack += lock[n].get("depends", [])
for n in sorted(need):
    meta = lock[n]; dest = ROOT / meta["file_name"]
    if dest.exists() and hashlib.sha256(dest.read_bytes()).hexdigest() == meta["sha256"]:
        continue
    data = urllib.request.urlopen(f"https://cdn.jsdelivr.net/pyodide/v{VERSION}/full/{meta['file_name']}").read()
    if hashlib.sha256(data).hexdigest() != meta["sha256"]:
        raise SystemExit(f"sha256 mismatch for {meta['file_name']}")
    dest.write_bytes(data); print("ok", meta["file_name"], len(data))

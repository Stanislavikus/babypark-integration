#!/usr/bin/env python3
"""Stage C (S5-S6) bounded §1/§3 alternatives scan: PyPI metadata for every candidate, written as deterministic evidence JSON.

RESEARCH TOOLING ONLY (network to pypi.org). It is deliberately outside ``tools/`` and ``oem_intake/``, which stay offline.

    python3 governance/s5_alternatives_scan.py --out governance/s5_scan_evidence.json [--ca-bundle ~/.ccr/ca-bundle.crt]

Per candidate it records, from the PyPI JSON API only: normalized name, latest version, license (PEP 639 expression or
classifier or free text), requires-python, requires-dist, first/last upload time of the latest release, release count,
the project URLs, and the SHA-256 of the latest sdist/wheel files. The record is a point-in-time observation: the scan
time is stored, and any re-run is a NEW scan (new digest) that invalidates the decision bound to the old one (Agreement §1).
Candidate list = CANDIDATES below (the bounded discovery set; every entry keeps its requirement area and discovery query).

The Stage B scan (``docs/oem-stage-b-20261117/S0_ALTERNATIVES_SCAN_20261117.md``) is NOT reused as-is: Stage C adds three requirement areas
(an optional default-OFF feature seam, structured JSON diffing for the replay, applying/verifying a patch of the legacy engine), so
the two Stage B areas it still depends on (typed-envelope validation, property tests) are re-observed here at the new scan time.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import ssl
import sys
import urllib.error
import urllib.request

# (candidate, requirement area, discovery query / reason it is materially plausible)
CANDIDATES = [
    ("openfeature-sdk", "RC1", "pypi search: openfeature vendor-neutral feature flag api python"),
    ("UnleashClient", "RC1", "pypi search: unleash feature toggle client python"),
    ("flagsmith", "RC1", "pypi search: feature flag remote config python client"),
    ("launchdarkly-server-sdk", "RC1", "pypi search: feature flag server sdk python"),
    ("growthbook", "RC1", "pypi search: feature flags experimentation python sdk"),
    ("django-waffle", "RC1", "pypi search: feature flipper python waffle"),
    ("deepdiff", "RC2", "pypi search: deep difference of python objects json"),
    ("jsondiff", "RC2", "pypi search: json diff patch python"),
    ("dictdiffer", "RC2", "pypi search: dictionary diff patch python"),
    ("jsonpatch", "RC2", "pypi search: json patch rfc 6902 python"),
    ("unidiff", "RC3", "pypi search: unified diff parser python"),
    ("whatthepatch", "RC3", "pypi search: parse and apply patch python"),
    ("patch-ng", "RC3", "pypi search: apply unified diff patch python"),
    ("jsonschema", "RC4", "pypi search: json schema validation python (Stage B RA2 re-observation)"),
    ("pydantic", "RC4", "pypi search: data validation python typed models (Stage B RA2 re-observation)"),
    ("fastjsonschema", "RC4", "pypi search: json schema validator python (Stage B RA2 re-observation)"),
    ("msgspec", "RC4", "pypi search: fast typed json validation python (Stage B RA2 re-observation)"),
    ("hypothesis", "RC5", "pypi search: property-based testing python (Stage B RA1 re-observation)"),
    ("sortedcontainers", "RC5", "required (non-extra) component of hypothesis: pypi requires_dist (Stage B RA1 re-observation)"),
]
UA = "babypark-s5-scan/1 (bounded alternatives scan; read-only)"


def fetch(name: str, ctx) -> dict:
    url = f"https://pypi.org/pypi/{name}/json"
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(request, context=ctx, timeout=60) as response:
        return json.load(response)


def license_of(info: dict) -> str:
    if info.get("license_expression"):
        return str(info["license_expression"])
    classifiers = [c.split("::")[-1].strip() for c in info.get("classifiers") or [] if c.startswith("License ::")]
    if classifiers:
        return "; ".join(sorted(classifiers))
    text = (info.get("license") or "").strip().splitlines()
    return text[0][:120] if text else "UNSPECIFIED"


def record(name: str, area: str, query: str, doc: dict) -> dict:
    info, releases = doc["info"], doc["releases"]
    files = doc["urls"]
    times = sorted(f["upload_time_iso_8601"] for f in files if f.get("upload_time_iso_8601"))
    all_times = sorted(f["upload_time_iso_8601"] for fs in releases.values() for f in fs if f.get("upload_time_iso_8601"))
    return {
        "candidate": name, "area": area, "discovery_query": query, "pypi_name": info["name"], "version": info["version"],
        "license": license_of(info), "requires_python": info.get("requires_python"),
        "requires_dist": sorted(info.get("requires_dist") or []),
        "latest_release_uploaded": times[-1] if times else None, "first_release_uploaded": all_times[0] if all_times else None,
        "release_count": len([r for r, fs in releases.items() if fs]), "yanked": bool(info.get("yanked")),
        "project_urls": dict(sorted((info.get("project_urls") or {}).items())),
        "core_requires": sorted(r for r in (info.get("requires_dist") or []) if "extra ==" not in r),
        "latest_files": sorted(({"filename": f["filename"], "packagetype": f["packagetype"], "sha256": f["digests"]["sha256"]}
                                for f in files), key=lambda x: x["filename"]),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--ca-bundle", default=os.path.expanduser("~/.ccr/ca-bundle.crt"))
    args = ap.parse_args(argv)
    ctx = ssl.create_default_context(cafile=args.ca_bundle if os.path.isfile(args.ca_bundle) else None)
    started = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    records, failures = [], []
    for name, area, query in CANDIDATES:
        try:
            records.append(record(name, area, query, fetch(name, ctx)))
        except (urllib.error.URLError, KeyError, ValueError) as exc:
            failures.append({"candidate": name, "area": area, "error": f"{type(exc).__name__}: {str(exc)[:160]}"})
    doc = {"schema": "bp-oem-s5-scan-evidence-v1", "scan_time_utc": started, "source": "https://pypi.org/pypi/<name>/json",
           "candidates": sorted(records, key=lambda r: (r["area"], r["candidate"].lower())), "failures": failures}
    with open(args.out, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(doc, ensure_ascii=False, sort_keys=True, indent=2) + "\n")
    print(f"scanned {len(records)} candidates, {len(failures)} failures -> {args.out}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

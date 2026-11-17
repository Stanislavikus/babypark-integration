#!/usr/bin/env python3
"""S0 bounded §1/§3 alternatives scan: PyPI metadata for every candidate, written as deterministic evidence JSON.

RESEARCH TOOLING ONLY (network to pypi.org). It is deliberately outside ``tools/`` and ``oem_stage/``, which stay offline.

    python3 governance/s0_alternatives_scan.py --out governance/s0_scan_evidence.json [--ca-bundle ~/.ccr/ca-bundle.crt]

Per candidate it records, from the PyPI JSON API only: normalized name, latest version, license (PEP 639 expression or
classifier or free text), requires-python, requires-dist, first/last upload time of the latest release, release count,
the project URLs, and the SHA-256 of the latest sdist/wheel files. The record is a point-in-time observation: the scan
time is stored, and any re-run is a NEW scan (new digest) that invalidates the decision bound to the old one (Agreement §1).
Candidate list = CANDIDATES below (the bounded discovery set; every entry keeps its requirement area and discovery query).
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
    ("hypothesis", "RA1", "pypi search: property-based testing python; owner/Agreement 7.0 names maintained OSS test tooling"),
    ("sortedcontainers", "RA1", "required (non-extra) component of hypothesis: pypi requires_dist"),
    ("crosshair-tool", "RA1", "pypi search: symbolic execution contracts python"),
    ("atheris", "RA1", "pypi search: coverage-guided fuzzing python"),
    ("jsonschema", "RA2", "pypi search: json schema validation python"),
    ("pydantic", "RA2", "pypi search: data validation python typed models"),
    ("msgspec", "RA2", "pypi search: fast typed json validation python"),
    ("fastjsonschema", "RA2", "pypi search: json schema validator python"),
    ("voluptuous", "RA2", "pypi search: python data validation library"),
    ("cerberus", "RA2", "pypi search: lightweight data validation python"),
    ("cel-python", "RA3", "pypi search: common expression language python"),
    ("json-logic", "RA3", "pypi search: jsonlogic python rules"),
    ("simpleeval", "RA3", "pypi search: safe expression evaluator python"),
    ("rapidfuzz", "RA4", "pypi search: fuzzy string matching python"),
    ("thefuzz", "RA4", "pypi search: fuzzy string matching python"),
    ("recordlinkage", "RA4", "pypi search: record linkage entity resolution python"),
    ("dedupe", "RA4", "pypi search: entity resolution deduplication python"),
    ("splink", "RA4", "pypi search: probabilistic record linkage python"),
    ("confusable-homoglyphs", "RA4", "pypi search: unicode confusables homoglyph detection python"),
    ("Unidecode", "RA4", "pypi search: transliterate unicode ascii python"),
    ("beautifulsoup4", "RA5", "pypi search: html parser text extraction python"),
    ("lxml", "RA5", "pypi search: html parser python"),
    ("selectolax", "RA5", "pypi search: fast html parser python"),
    ("trafilatura", "RA5", "pypi search: web text extraction python"),
    ("pypdf", "RA5", "pypi search: pdf text extraction python"),
    ("pdfminer.six", "RA5", "pypi search: pdf text extraction python"),
    ("PyMuPDF", "RA5", "pypi search: pdf text extraction python"),
    ("prov", "RA6", "pypi search: W3C PROV provenance python"),
    ("in-toto", "RA6", "pypi search: supply chain attestation provenance python"),
]
UA = "babypark-s0-scan/1 (bounded alternatives scan; read-only)"


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
    doc = {"schema": "bp-oem-s0-scan-evidence-v1", "scan_time_utc": started, "source": "https://pypi.org/pypi/<name>/json",
           "candidates": sorted(records, key=lambda r: (r["area"], r["candidate"].lower())), "failures": failures}
    with open(args.out, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(doc, ensure_ascii=False, sort_keys=True, indent=2) + "\n")
    print(f"scanned {len(records)} candidates, {len(failures)} failures -> {args.out}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

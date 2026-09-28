#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="${1:-$REPO_ROOT/config/drupal/exporter-runtime.json}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "runtime installation requires root" >&2
  exit 2
fi

readarray -t META < <(python3 - "$MANIFEST" <<'PY'
import json,re,sys
p=sys.argv[1]
d=json.load(open(p))
required={'schema','node_version','platform','arch','archive','sha256','source_base_url','install_root'}
if set(d) != required:
    raise SystemExit('runtime manifest keys mismatch')
if d['schema'] != 'bp.drupal-exporter.runtime/1':
    raise SystemExit('runtime manifest schema mismatch')
if d['platform'] != 'linux' or d['arch'] != 'x64':
    raise SystemExit('runtime manifest platform/arch unsupported')
v=d['node_version']
if not re.fullmatch(r'24\.\d+\.\d+', v):
    raise SystemExit('runtime manifest must pin Node 24.x.y')
if d['archive'] != f'node-v{v}-linux-x64.tar.xz':
    raise SystemExit('runtime manifest archive/version mismatch')
if not re.fullmatch(r'[0-9a-f]{64}', d['sha256']):
    raise SystemExit('runtime manifest sha256 invalid')
if d['source_base_url'] != f'https://nodejs.org/dist/v{v}':
    raise SystemExit('runtime manifest source_base_url/version mismatch')
if d['install_root'] != f'/opt/babypark-exporter/runtime/node-v{v}':
    raise SystemExit('runtime manifest install_root/version mismatch')
for k in ('node_version','archive','sha256','source_base_url','install_root'):
    print(d[k])
PY
)

VERSION="${META[0]}"
ARCHIVE="${META[1]}"
SHA256="${META[2]}"
BASE_URL="${META[3]}"
INSTALL_ROOT="${META[4]}"
INSTALL_PARENT="$(dirname "$INSTALL_ROOT")"

if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  echo "unsupported host platform" >&2
  exit 2
fi

if [[ -e "$INSTALL_ROOT" ]]; then
  NODE="$INSTALL_ROOT/bin/node"
  if [[ ! -x "$NODE" || "$("$NODE" -p 'process.versions.node')" != "$VERSION" ]]; then
    echo "existing runtime does not match pinned version: $INSTALL_ROOT" >&2
    exit 1
  fi
  echo "runtime already installed: $INSTALL_ROOT"
else
  TMP="$(mktemp -d /tmp/babypark-node-runtime-XXXXXX)"
  mkdir -p "$INSTALL_PARENT"
  STAGING="$INSTALL_PARENT/.node-v$VERSION.installing.$$"
  if [[ -e "$STAGING" ]]; then
    echo "runtime staging path already exists: $STAGING" >&2
    exit 1
  fi
  cleanup() {
    rm -rf "$TMP"
    [[ ! -e "$INSTALL_ROOT" ]] && rm -rf "$STAGING"
  }
  trap cleanup EXIT

  curl --proto '=https' --tlsv1.2 -fsSLo "$TMP/$ARCHIVE" "$BASE_URL/$ARCHIVE"
  printf '%s  %s\n' "$SHA256" "$TMP/$ARCHIVE" | sha256sum -c -
  tar -xJf "$TMP/$ARCHIVE" -C "$TMP"

  EXTRACTED="$TMP/node-v$VERSION-linux-x64"
  [[ -x "$EXTRACTED/bin/node" ]] || {
    echo "node binary missing after extract" >&2
    exit 1
  }
  [[ "$("$EXTRACTED/bin/node" -p 'process.versions.node')" == "$VERSION" ]] || {
    echo "extracted node version mismatch" >&2
    exit 1
  }

  mv "$EXTRACTED" "$STAGING"
  chown -R root:root "$STAGING"
  chmod -R a-w "$STAGING"
  [[ ! -e "$INSTALL_ROOT" ]] || {
    echo "runtime appeared during install: $INSTALL_ROOT" >&2
    exit 1
  }
  mv -T "$STAGING" "$INSTALL_ROOT"
  NODE="$INSTALL_ROOT/bin/node"
fi

"$NODE" --input-type=module - <<'JS'
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(':memory:');
db.exec("CREATE VIRTUAL TABLE fts_probe USING fts5(body); INSERT INTO fts_probe(body) VALUES ('babypark runtime probe');");
const count = db.prepare("SELECT COUNT(*) AS c FROM fts_probe WHERE fts_probe MATCH 'runtime'").get().c;
if (Number(count) !== 1) throw new Error('node:sqlite FTS5 probe failed');
db.close();
console.log(JSON.stringify({ node: process.version, sqlite_fts5: true }));
JS

echo "installed and verified: $INSTALL_ROOT"

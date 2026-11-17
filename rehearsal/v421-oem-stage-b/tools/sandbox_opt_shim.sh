#!/usr/bin/env bash
# SANDBOX ONLY. The V4.2.1 engine modules read a hard-coded rehearsal path at import time
# (v32_pipeline.CLASS_CATS is parsed from /opt/bp-recommendations-full-rollout-rehearsal-20261111/v3.2/engine/run_v3_final.py).
# On the rehearsal host that path already exists and this script must NOT be run. In a throw-away sandbox it
# links the same files from an engine_root copy so the real modules can be imported unchanged.
set -euo pipefail
ENGINE_ROOT="${BP_V421_ENGINE_ROOT:?set BP_V421_ENGINE_ROOT to an engine_root-layout directory}"
TARGET=/opt/bp-recommendations-full-rollout-rehearsal-20261111/v3.2/engine
if [ -e "$TARGET" ]; then echo "exists: $TARGET (nothing to do)"; exit 0; fi
mkdir -p "$(dirname "$TARGET")"
ln -s "$ENGINE_ROOT/upstream/v32/engine" "$TARGET"
echo "linked $TARGET -> $ENGINE_ROOT/upstream/v32/engine"

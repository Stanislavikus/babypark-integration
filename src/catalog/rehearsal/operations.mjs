import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { processProductionFullChunk } from '../ingest/production-full-coordinator.mjs';
import { verifyFrozenSpoolArtifact } from '../../drupal-d2b/spool.mjs';

export const REHEARSAL_AUDIENCE = 'babypark-catalog-rehearsal-v1';
export const REHEARSAL_PORT = 18081;
export const REHEARSAL_REMOTE_USER = 'babypark-exporter';
export const REHEARSAL_FAILPOINTS = Object.freeze([
  'certification.afterCommit',
  'publication.after',
]);
export const LINK_A_SYSTEMD_PROPERTIES = Object.freeze({
  User: 'babypark-catalog',
  Group: 'babypark-catalog',
  UMask: '0077',
  MemoryAccounting: 'yes',
  CPUAccounting: 'yes',
  IOAccounting: 'yes',
  MemoryMax: '536870912',
  MemoryHigh: '402653184',
  CPUWeight: '10',
  IOWeight: '10',
  Nice: '10',
  NoNewPrivileges: 'yes',
  PrivateTmp: 'yes',
  ProtectSystem: 'strict',
  ProtectHome: 'yes',
});

const HASH_RE = /^[a-f0-9]{64}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const HOST_RE = /^[A-Za-z0-9.-]+$/;
const SAFE_ABSOLUTE_RE = /^\/[A-Za-z0-9._/+:-]+$/;
const PRODUCTION_ROOTS = Object.freeze([
  '/var/lib/babypark-catalog',
  '/var/lib/babypark-exporter',
]);

const inside = (candidate, root) =>
  candidate === root || candidate.startsWith(`${root}${path.sep}`);
const canonicalJson = value =>
  JSON.stringify(value, Object.keys(value ?? {}).sort());

function fail(message) {
  throw new Error(message);
}

function canonicalRoot(raw) {
  if (!raw || !path.isAbsolute(raw)) fail('BABYPARK_REHEARSAL_ROOT must be absolute');
  const resolved = path.resolve(raw);
  const canonical = fs.realpathSync(resolved);
  if (canonical !== resolved) fail('rehearsal root must not be a symlink alias');
  for (const production of PRODUCTION_ROOTS) {
    if (inside(canonical, production) || inside(production, canonical)) {
      fail('rehearsal root must be disjoint from production roots');
    }
  }
  return canonical;
}

function canonicalInsideExisting(candidate, root, label) {
  if (!candidate || !path.isAbsolute(candidate)) fail(`${label} must be absolute`);
  const resolved = path.resolve(candidate);
  const canonical = fs.realpathSync(resolved);
  if (canonical !== resolved) fail(`${label} must not be a symlink alias`);
  if (!inside(canonical, root)) fail(`${label} must canonicalize inside rehearsal root`);
  for (const production of PRODUCTION_ROOTS) {
    if (inside(canonical, production)) fail(`${label} must not use a production path`);
  }
  return canonical;
}

export function validateRehearsalPath(candidate, label = 'path', env = process.env) {
  if (env.BABYPARK_REHEARSAL !== '1') fail('BABYPARK_REHEARSAL must equal 1');
  const root = canonicalRoot(env.BABYPARK_REHEARSAL_ROOT);
  return canonicalInsideExisting(candidate, root, label);
}

export function validateRehearsalConfig(config, env = process.env) {
  if (env.BABYPARK_REHEARSAL !== '1') fail('BABYPARK_REHEARSAL must equal 1');
  const root = canonicalRoot(env.BABYPARK_REHEARSAL_ROOT);
  for (const key of ['identityPath', 'replayPath', 'storageDir', 'backupRoot']) {
    if (!config[key]) fail(`${key} is required`);
    canonicalInsideExisting(config[key], root, key);
  }
  if (
    config.host !== '127.0.0.1' ||
    config.port !== REHEARSAL_PORT ||
    config.audience !== REHEARSAL_AUDIENCE ||
    !config.ingestEnabled ||
    config.secrets.size === 0 ||
    ![...config.secrets.keys()].every(key => key.startsWith('rehearsal-'))
  ) {
    fail('rehearsal network/audience/KID/ingest guard failed');
  }
  const selected = env.BABYPARK_REHEARSAL_FAILPOINT ?? null;
  if (selected && !REHEARSAL_FAILPOINTS.includes(selected)) {
    fail('unknown rehearsal failpoint');
  }
  return { root, failpoint: selected };
}

export function validateRehearsalSender({ spoolPath, config, env = process.env }) {
  if (env.BABYPARK_REHEARSAL !== '1') fail('BABYPARK_REHEARSAL must equal 1');
  const root = canonicalRoot(env.BABYPARK_REHEARSAL_ROOT);
  const spool = canonicalInsideExisting(spoolPath, root, 'spool');
  const stateDir = canonicalInsideExisting(config.stateDir, root, 'sender stateDir');
  if (!spool.endsWith('.ready')) fail('rehearsal spool must be an exact .ready artifact');
  if (config.origin !== `http://127.0.0.1:${REHEARSAL_PORT}`) {
    fail('rehearsal sender origin must be exact loopback rehearsal Catalog origin');
  }
  if (config.audience !== REHEARSAL_AUDIENCE) {
    fail('rehearsal sender audience mismatch');
  }
  if (typeof config.kid !== 'string' || !config.kid.startsWith('rehearsal-')) {
    fail('rehearsal sender KID must use rehearsal- prefix');
  }
  if (config.producerReleaseRoot !== null && config.producerReleaseRoot !== undefined) {
    const releaseRoot = path.resolve(config.producerReleaseRoot);
    const allowedRoot = '/opt/babypark-rehearsal/releases';
    if (!path.isAbsolute(config.producerReleaseRoot) ||
        releaseRoot !== config.producerReleaseRoot ||
        !releaseRoot.startsWith(allowedRoot + path.sep)) {
      fail('rehearsal producer release root must be an exact immutable rehearsal release');
    }
  }
  return { root, spoolPath: spool, stateDir };
}

export function rehearsalCoordinator(
  selected,
  {
    kill = () => process.kill(process.pid, 'SIGKILL'),
    coordinator = processProductionFullChunk,
  } = {},
) {
  return args => coordinator({
    ...args,
    failpoint: name => {
      if (name === selected) kill();
    },
  });
}

export function lostFinalResponseFetch(fetchImpl = globalThis.fetch) {
  let dropped = false;
  return async (url, options = {}) => {
    const response = await fetchImpl(url, options);
    const final =
      options.method === 'POST' &&
      options.headers?.['X-BP-Final'] === '1';
    if (final && !dropped && response.ok) {
      dropped = true;
      throw Object.assign(new Error('rehearsal lost final response'), {
        code: 'ECONNRESET',
      });
    }
    return response;
  };
}

function validateRootManagedWrapper(sshWrapperPath, lstat = fs.lstatSync) {
  if (
    !path.isAbsolute(sshWrapperPath ?? '') ||
    !SAFE_ABSOLUTE_RE.test(sshWrapperPath)
  ) {
    fail('ssh wrapper path must be an absolute safe path');
  }
  const stat = lstat(sshWrapperPath);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.uid !== 0 ||
    (stat.mode & 0o777) !== 0o755
  ) {
    fail('ssh wrapper must be a root-owned non-symlink mode 0755 file');
  }
}

export function createRsyncTransfer({
  host,
  sshWrapperPath,
  spawn = spawnSync,
  lstat = fs.lstatSync,
}) {
  if (!HOST_RE.test(host ?? '') || String(host).includes('..')) {
    fail('invalid rsync host');
  }
  validateRootManagedWrapper(sshWrapperPath, lstat);
  return buildingPath => {
    if (!path.isAbsolute(buildingPath)) fail('building path must be absolute');
    const argv = [
      '-a',
      '--chmod=D700,F600',
      `--rsh=${sshWrapperPath}`,
      `${REHEARSAL_REMOTE_USER}@${host}:./`,
      `${buildingPath}/`,
    ];
    const result = spawn('rsync', argv, { stdio: 'inherit', shell: false });
    if (result.error) throw result.error;
    if (result.status !== 0) fail(`rsync failed: ${result.status}`);
  };
}

function cliValue(args, name) {
  const prefix = `--${name}=`;
  const found = args.filter(value => value.startsWith(prefix));
  if (found.length !== 1 || !path.isAbsolute(found[0].slice(prefix.length))) {
    fail(`exact absolute --${name} is required`);
  }
  return found[0].slice(prefix.length);
}

export function resolveLinkAReleasePaths(metaUrl) {
  const scriptDirectory = path.dirname(fileURLToPath(metaUrl));
  const releaseRoot = path.resolve(scriptDirectory, '..');
  return {
    releaseRoot,
    gateScript: path.join(releaseRoot, 'scripts/catalog-link-a-gate.mjs'),
    linkACli: path.join(releaseRoot, 'scripts/catalog-link-a.mjs'),
  };
}

export function buildLinkASystemdRun({
  unit,
  workRoot,
  gatePath,
  cliArgs,
  node = process.execPath,
  gateScript,
  linkACli,
  releaseRoot,
}) {
  if (
    !/^babypark-link-a-[a-f0-9]{8,64}$/.test(unit) ||
    ![workRoot, gatePath, gateScript, linkACli, releaseRoot].every(path.isAbsolute) ||
    !Array.isArray(cliArgs)
  ) {
    fail('invalid systemd runner input');
  }
  const readOnly = [
    cliValue(cliArgs, 'staged-spool'),
    cliValue(cliArgs, 'catalog-dir'),
    cliValue(cliArgs, 'identity'),
    releaseRoot,
  ].join(' ');
  const properties = {
    ...LINK_A_SYSTEMD_PROPERTIES,
    ReadWritePaths: workRoot,
    ReadOnlyPaths: readOnly,
  };
  return {
    properties,
    argv: [
      'systemd-run',
      '--no-block',
      '--service-type=oneshot',
      '--remain-after-exit',
      `--unit=${unit}`,
      ...Object.entries(properties).map(([key, value]) => `--property=${key}=${value}`),
      node,
      gateScript,
      gatePath,
      node,
      linkACli,
      ...cliArgs,
    ],
  };
}

export function parseSystemdShow(text) {
  return Object.fromEntries(
    String(text)
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const at = line.indexOf('=');
        if (at < 1) fail('invalid systemd show output');
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
}

export function validateEffectiveProperties(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (String(actual[key]) !== String(value)) {
      fail(`systemd property mismatch: ${key}`);
    }
  }
  return true;
}

export function lookupServiceIdentity(name, { run = spawnSync } = {}) {
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(name ?? '')) {
    fail('invalid service account name');
  }
  const read = flag => {
    const result = run('id', [flag, name], { encoding: 'utf8', shell: false });
    if (result.error) throw result.error;
    if (result.status !== 0 || !/^(0|[1-9]\d*)\n?$/.test(result.stdout ?? '')) {
      fail(`cannot resolve service account ${name}`);
    }
    return Number(String(result.stdout).trim());
  };
  return { uid: read('-u'), gid: read('-g') };
}

function assertNoSymlinkComponents(target, fsImpl = fs) {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  for (const part of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!fsImpl.existsSync(current)) continue;
    const stat = fsImpl.lstatSync(current);
    if (stat.isSymbolicLink()) fail(`symlinked path component is forbidden: ${current}`);
  }
}

export function prepareLinkAWorkRoot(
  workRoot,
  {
    identity,
    protectedPaths = [],
    fsImpl = fs,
  } = {},
) {
  if (!path.isAbsolute(workRoot ?? '')) fail('work root must be absolute');
  if (
    !identity ||
    !Number.isSafeInteger(identity.uid) ||
    !Number.isSafeInteger(identity.gid) ||
    identity.uid < 0 ||
    identity.gid < 0
  ) {
    fail('service account identity is required');
  }
  const resolved = path.resolve(workRoot);
  for (const protectedPath of protectedPaths) {
    if (!path.isAbsolute(protectedPath ?? '')) fail('protected path must be absolute');
    const protectedResolved = path.resolve(protectedPath);
    const protectedCanonical = fsImpl.realpathSync(protectedResolved);
    if (protectedCanonical !== protectedResolved) fail('protected paths must be canonical');
    if (inside(resolved, protectedCanonical) || inside(protectedCanonical, resolved)) {
      fail('work root must be disjoint from protected authority paths');
    }
  }
  const parent = path.dirname(resolved);
  if (!fsImpl.existsSync(parent)) fail('work root parent must already exist');
  assertNoSymlinkComponents(parent, fsImpl);
  const canonicalParent = fsImpl.realpathSync(parent);
  if (canonicalParent !== parent) fail('work root parent must be canonical');

  const existed = fsImpl.existsSync(resolved);
  if (!existed) {
    fsImpl.mkdirSync(resolved, { mode: 0o700 });
    fsImpl.chownSync(resolved, identity.uid, identity.gid);
    fsImpl.chmodSync(resolved, 0o700);
  }
  assertNoSymlinkComponents(resolved, fsImpl);
  const canonical = fsImpl.realpathSync(resolved);
  if (canonical !== resolved) fail('work root must be canonical');
  const stat = fsImpl.lstatSync(canonical);
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    (stat.mode & 0o777) !== 0o700 ||
    stat.uid !== identity.uid ||
    stat.gid !== identity.gid
  ) {
    fail('work root must be a private directory owned by babypark-catalog');
  }
  return canonical;
}

function runChecked(run, command, args, label, { allow = [] } = {}) {
  const result = run(command, args, { encoding: 'utf8', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allow.includes(result.status)) {
    fail(`${label} failed: ${result.stderr || result.status}`);
  }
  return result;
}

function showUnit(run, unit) {
  const result = run('systemctl', ['show', unit, '--no-page'], {
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) return { result, show: null };
  return { result, show: parseSystemdShow(result.stdout) };
}

function cleanupTransientUnit(run, unit, sleep, { polls = 40, pollMs = 250 } = {}) {
  const errors = [];
  const remember = (label, fn) => {
    try { fn(); } catch (error) { errors.push(`${label}: ${error.message}`); }
  };
  remember('stop', () => runChecked(
    run,
    'systemctl',
    ['stop', '--no-block', unit],
    'systemctl stop',
    { allow: [5] },
  ));
  const first = showUnit(run, unit);
  if (
    first.show &&
    ['active', 'activating', 'deactivating', 'reloading'].includes(first.show.ActiveState)
  ) {
    remember('kill', () => runChecked(
      run,
      'systemctl',
      ['kill', '--kill-who=all', '--signal=SIGKILL', unit],
      'systemctl kill',
      { allow: [5] },
    ));
  }
  remember('reset-failed', () => {
    const result = run('systemctl', ['reset-failed', unit], { encoding: 'utf8', shell: false });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const stderr = String(result.stderr ?? '');
      const alreadyRemoved = /\bUnit\s+\S+\s+(?:not loaded|could not be found)\.?\s*$/m.test(stderr);
      if (!alreadyRemoved) fail(`systemctl reset-failed failed: ${stderr || result.status}`);
    }
  });
  let removed = false;
  for (let attempt = 0; attempt < polls; attempt += 1) {
    const final = showUnit(run, unit);
    removed =
      final.result.status !== 0 ||
      final.show?.LoadState === 'not-found' ||
      (final.show?.LoadState === 'loaded' && final.show?.ActiveState === 'inactive');
    if (removed) break;
    sleep(pollMs);
  }
  if (!removed) errors.push('verification: transient unit was not removed/inactive');
  if (errors.length) fail(`transient unit cleanup failed: ${errors.join('; ')}`);
}

export async function executeLinkASystemdUnit({
  built,
  unit,
  gatePath,
  run = spawnSync,
  sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  writeGate = file => fs.writeFileSync(file, 'go\n', { mode: 0o600, flag: 'wx' }),
  gatePolls = 120,
  executionPolls = 3600,
  pollMs = 250,
  onCompleted = async show => show,
}) {
  if (!built?.argv?.length || !unit || !path.isAbsolute(gatePath)) {
    fail('invalid Link A systemd controller input');
  }
  let created = false;
  let primaryError = null;
  try {
    runChecked(run, built.argv[0], built.argv.slice(1), 'systemd-run');
    created = true;

    let show = null;
    for (let attempt = 0; attempt < gatePolls; attempt += 1) {
      const current = showUnit(run, unit);
      if (current.show) {
        show = current.show;
        if (
          show.LoadState === 'loaded' &&
          ['activating', 'active'].includes(show.ActiveState)
        ) break;
      }
      sleep(pollMs);
    }
    if (
      !show ||
      show.LoadState !== 'loaded' ||
      !['activating', 'active'].includes(show.ActiveState)
    ) {
      fail('transient unit did not reach its gated running state');
    }

    validateEffectiveProperties(show, built.properties);
    writeGate(gatePath);

    let completed = null;
    for (let attempt = 0; attempt < executionPolls; attempt += 1) {
      const current = showUnit(run, unit);
      if (current.show) {
        show = current.show;
        if (
          (show.ActiveState === 'active' && show.SubState === 'exited') ||
          show.ActiveState === 'failed'
        ) {
          completed = show;
          break;
        }
      }
      sleep(pollMs);
    }
    if (!completed) fail('Link A transient unit did not complete within 15 minutes');
    return await onCompleted(completed);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (created) {
      try {
        cleanupTransientUnit(run, unit, sleep);
      } catch (cleanupError) {
        if (primaryError) {
          primaryError.message = `${primaryError.message}; cleanup: ${cleanupError.message}`;
        } else {
          throw cleanupError;
        }
      }
    }
  }
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const fd = fs.openSync(file, 'r');
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function fileEvidence(file) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) fail(`unsafe evidence file: ${file}`);
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mode: stat.mode & 0o777,
    mtime_ms: stat.mtimeMs,
    ctime_ms: stat.ctimeMs,
    sha256: sha256File(file),
  };
}

function flatDirectoryEvidence(directory) {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail(`unsafe evidence directory: ${directory}`);
  }
  return Object.fromEntries(
    fs.readdirSync(directory).sort().map(name => {
      if (path.basename(name) !== name) fail('unsafe evidence entry');
      return [name, fileEvidence(path.join(directory, name))];
    }),
  );
}

export function captureLinkAAuthorityEvidence({
  stagedSpoolPath,
  catalogDir,
  identityPath,
  generationId,
}) {
  if (!ID_RE.test(generationId ?? '')) fail('invalid generation id');
  const spool = verifyFrozenSpoolArtifact(stagedSpoolPath);
  const currentPath = path.join(catalogDir, 'CURRENT');
  const generationPath = path.join(catalogDir, `catalog.${generationId}.sqlite`);
  return {
    staged_spool_manifest_sha256: spool.spoolManifestSha256,
    staged_spool: flatDirectoryEvidence(stagedSpoolPath),
    catalog_generation: fileEvidence(generationPath),
    identity: fileEvidence(identityPath),
    current: {
      ...fileEvidence(currentPath),
      value: fs.readFileSync(currentPath, 'utf8'),
    },
  };
}

function exactEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function probeCatalogReadability({
  origin,
  client,
  expectedGenerationId = null,
  acceptedRun = null,
  fetchImpl = globalThis.fetch,
}) {
  if (
    origin !== `http://127.0.0.1:${REHEARSAL_PORT}` ||
    typeof client?.state !== 'function'
  ) {
    fail('invalid rehearsal Catalog probe input');
  }
  const health = await fetchImpl(`${origin}/health`, {
    method: 'GET',
    redirect: 'manual',
  });
  if (!health.ok) fail(`rehearsal Catalog health probe failed: ${health.status}`);
  const state = await client.state();
  if (
    state.status !== 200 ||
    !state.body ||
    typeof state.body !== 'object' ||
    state.body.schema !== 'bp.catalog.state/1'
  ) {
    fail('rehearsal Catalog state probe failed');
  }
  if (expectedGenerationId !== null) {
    if (
      state.body.state !== 'CURRENT' ||
      state.body.current_generation !== expectedGenerationId
    ) {
      fail('rehearsal Catalog generation binding failed');
    }
  }
  if (acceptedRun !== null) {
    const actual = state.body.accepted_run;
    if (
      !actual ||
      actual.run_id !== acceptedRun.run_id ||
      actual.run_digest !== acceptedRun.run_digest ||
      actual.final_seq !== acceptedRun.final_seq
    ) {
      fail('rehearsal Catalog accepted-run binding failed');
    }
  }
  return {
    health_readable: true,
    state_readable: true,
    generation_id: state.body.current_generation ?? null,
    accepted_run: state.body.accepted_run
      ? {
          run_id: state.body.accepted_run.run_id,
          run_digest: state.body.accepted_run.run_digest,
          final_seq: state.body.accepted_run.final_seq,
        }
      : null,
  };
}

export function resourceEvidence({
  unit,
  show,
  effectiveProperties,
  linkAReport,
  linkAReportBytes,
  authorityBefore,
  authorityAfter,
  probeBefore,
  probeAfter,
  expectedGenerationId,
  acceptedRun,
}) {
  if (!unit || !show || !effectiveProperties || !Buffer.isBuffer(linkAReportBytes)) {
    fail('complete resource evidence input is required');
  }
  const start = BigInt(show.ExecMainStartTimestampMonotonic);
  const end = BigInt(show.ExecMainExitTimestampMonotonic);
  const wallMs = Number((end - start) / 1000n);
  const memory = Number(show.MemoryPeak);
  const guards = {
    staged_spool_unchanged:
      authorityBefore.staged_spool_manifest_sha256 === authorityAfter.staged_spool_manifest_sha256 &&
      exactEqual(authorityBefore.staged_spool, authorityAfter.staged_spool),
    catalog_unchanged:
      exactEqual(authorityBefore.catalog_generation, authorityAfter.catalog_generation),
    identity_unchanged:
      exactEqual(authorityBefore.identity, authorityAfter.identity),
    current_unchanged:
      exactEqual(authorityBefore.current, authorityAfter.current),
    health_readable:
      probeBefore.health_readable === true && probeAfter.health_readable === true,
    state_readable:
      probeBefore.state_readable === true && probeAfter.state_readable === true,
  };
  validateEffectiveProperties(show, effectiveProperties);
  const actualProperties = Object.fromEntries(
    Object.keys(effectiveProperties).map(key => [key, String(show[key])]),
  );
  const reportBound =
    linkAReport.status === 'PASS' &&
    linkAReport.mismatch_count === 0 &&
    linkAReport.spool_manifest_sha256 === authorityBefore.staged_spool_manifest_sha256 &&
    linkAReport.generation?.generation_id === expectedGenerationId &&
    linkAReport.accepted_run?.run_id === acceptedRun.run_id &&
    linkAReport.accepted_run?.run_digest === acceptedRun.run_digest &&
    linkAReport.accepted_run?.final_seq === acceptedRun.final_seq;
  const stateBound =
    probeBefore.generation_id === expectedGenerationId &&
    probeAfter.generation_id === expectedGenerationId &&
    exactEqual(probeBefore.accepted_run, acceptedRun) &&
    exactEqual(probeAfter.accepted_run, acceptedRun);
  const pass =
    show.Result === 'success' &&
    show.ExecMainStatus === '0' &&
    reportBound &&
    stateBound &&
    memory < 384 * 1024 * 1024 &&
    wallMs <= 900000 &&
    Object.values(guards).every(Boolean);
  return {
    schema: 'bp.catalog.link-a-resource-evidence/1',
    version: 1,
    status: pass ? 'PASS' : 'FAIL',
    unit,
    effective_properties: actualProperties,
    link_a_report_sha256: crypto.createHash('sha256').update(linkAReportBytes).digest('hex'),
    staged_spool_manifest_sha256: authorityBefore.staged_spool_manifest_sha256,
    generation_id: expectedGenerationId,
    accepted_run: { ...acceptedRun },
    result: show.Result,
    exec_main_status: Number(show.ExecMainStatus),
    memory_peak: memory,
    cpu_usage_nsec: Number(show.CPUUsageNSec),
    io_read_bytes: Number(show.IOReadBytes),
    io_write_bytes: Number(show.IOWriteBytes),
    exec_main_start_monotonic: String(show.ExecMainStartTimestampMonotonic),
    exec_main_exit_monotonic: String(show.ExecMainExitTimestampMonotonic),
    wall_ms: wallMs,
    bindings: {
      report_bound: reportBound,
      state_bound: stateBound,
    },
    guards,
  };
}

export function writePrivateJsonAtomic(file, value) {
  const directory = path.dirname(file);
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`,
  );
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, file);
  const dir = fs.openSync(directory, 'r');
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}
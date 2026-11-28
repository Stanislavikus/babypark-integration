import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const compose = readFileSync(new URL('deploy/n8n/compose.yaml', root), 'utf8');
const restoreCompose = readFileSync(new URL('deploy/n8n/compose.restore.yaml', root), 'utf8');
const service = readFileSync(new URL('deploy/n8n/systemd/babypark-n8n.service', root), 'utf8');
const runtimeMountName = readdirSync(new URL('deploy/n8n/systemd/', root)).find((name) => name.endsWith('.mount'));
const runtimeMount = readFileSync(join(fileURLToPath(new URL('deploy/n8n/systemd/', root)), runtimeMountName), 'utf8');
const runbook = readFileSync(new URL('docs/N8N_RELEASE_RUNBOOK_20261127.md', root), 'utf8');
const traceability = readFileSync(new URL('docs/N8N_COHOST_IMPLEMENTATION_TRACEABILITY_20261127.md', root), 'utf8');
const optionsScan = readFileSync(new URL('docs/N8N_COHOST_OPTIONS_SCAN_20261127.md', root), 'utf8');
const sqliteCompatibility = readFileSync(new URL('docs/N8N_SQLITE_BUSY_TIMEOUT_COMPATIBILITY_20261128.md', root), 'utf8');
const normalizedRunbook = runbook.replace(/^ {3}/gm, '');
const shellBlocks = [...normalizedRunbook.matchAll(/```sh\n([\s\S]*?)\n```/g)].map((match) => match[1]);

function blockContaining(fragment) {
  const block = shellBlocks.find((candidate) => candidate.includes(fragment));
  assert.ok(block, `missing shell block containing ${fragment}`);
  return block;
}

function capturePhaseFunction() {
  const start = runbook.indexOf('capture_phase() {');
  const end = runbook.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, 'resource capture function is present');
  return runbook.slice(start, end + 2);
}

function withTempDir(callback) {
  const temp = mkdtempSync(join(tmpdir(), 'babypark-n8n-release-test-'));
  try {
    callback(temp);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function writeExecutable(path, content) {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function runBash(script, env = {}) {
  return spawnSync('bash', ['-eu', '-c', script], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 1024 * 1024,
  });
}

function localSocketDocker(script) {
  return script.replaceAll('/usr/bin/docker', 'docker');
}

function fakeDockerBin(dir, body) {
  const fakeBin = join(dir, 'bin');
  mkdirSync(fakeBin, { recursive: true });
  writeExecutable(join(fakeBin, 'docker'), body);
  return fakeBin;
}

function systemdExpandedExecStartPreLines() {
  return service.split('\n')
    .filter((line) => line.startsWith('ExecStartPre=/bin/sh -ec '))
    .map((line) => {
      const match = /^ExecStartPre=\/bin\/sh -ec '(.*)'$/.exec(line);
      assert.ok(match, `unexpected ExecStartPre shape: ${line}`);
      return match[1].replaceAll('%%', '%').replaceAll('$$', '$');
    });
}

function runSystemdExpandedPre(command, env = {}) {
  return spawnSync('/bin/sh', ['-ec', command], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 1024 * 1024,
  });
}

function substituteBackupPaths(script, backupRoot, userDir, keyFile) {
  return script
    .replaceAll('/var/backups/babypark-n8n', backupRoot)
    .replaceAll('/var/lib/babypark-n8n/user', userDir)
    .replaceAll('/etc/babypark-n8n/n8n.env', keyFile);
}

function prepareSyntheticBackup(dir) {
  const userDir = join(dir, 'user');
  const backupDir = join(dir, 'backup', 'verified');
  mkdirSync(userDir, { recursive: true });
  mkdirSync(backupDir, { recursive: true });
  writeFileSync(join(userDir, 'config'), 'synthetic n8n settings');
  writeFileSync(join(backupDir, 'n8n.pgdump'), 'synthetic PostgreSQL custom dump bytes');
  writeFileSync(join(backupDir, 'n8n.env'), 'N8N_ENCRYPTION_KEY=' + 'a'.repeat(64) + '\nPOSTGRES_PASSWORD=' + 'b'.repeat(64) + '\n');
  execFileSync('tar', ['-czf', join(backupDir, 'user-folder.tar.gz'), '-C', userDir, '.']);
  execFileSync('sha256sum', [join(backupDir, 'n8n.pgdump'), join(backupDir, 'user-folder.tar.gz'), join(backupDir, 'n8n.env')], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim().split('\n').forEach((line) => {
    const name = line.slice(line.indexOf('  ') + 2).split('/').at(-1);
    const digest = line.slice(0, line.indexOf('  '));
    writeFileSync(join(backupDir, 'SHA256SUMS'), `${digest}  ${name}\n`, { flag: 'a' });
  });
  return backupDir;
}

function composeBackupDockerStub() {
  return `#!/bin/sh
[ "$1" = --host=unix:///var/run/docker.sock ] && shift
case "$1" in
  compose)
    case " $* " in
      *" pg_dump "*) printf 'synthetic PostgreSQL custom dump bytes\\n';;
      *" pg_restore "*) printf 'synthetic pg_restore list\\n';;
    esac
    exit 0
    ;;
  run)
    case " $* " in *" -u postgres "*|*" -g postgres "*) printf '999\\n';; *" pg_restore "*) printf 'synthetic pg_restore list\\n';; esac
    exit 0
    ;;
  *) exit 0;;
esac
`;
}

function restorePreflightBlock() {
  const block = blockContaining('backup_dir=/var/backups/babypark-n8n/REPLACE_WITH_VERIFIED_GENERATION');
  const stateCreate = block.indexOf('mkdir -m 0700 /var/lib/babypark-n8n/restore-test');
  assert.ok(stateCreate > 0, 'restore target creation is present');
  return localSocketDocker(block.slice(0, stateCreate));
}

test('n8n runtime directories are created only after the verified mount and key checks', () => {
  const mountCheck = service.indexOf('ExecStartPre=/bin/sh -ec \'set -f; row=');
  const permissionCheck = service.indexOf('stat -c "%%U:%%G:%%a" /etc/babypark-n8n/n8n.env');
  const keyCheck = service.indexOf('ExecStartPre=/bin/sh -ec \'printf');
  const mkdir = service.indexOf('ExecStartPre=/usr/bin/install -d -o 1000 -g 1000 -m 0700 /run/babypark-n8n-runtime/storage /run/babypark-n8n-runtime/events');

  assert.ok(mountCheck >= 0);
  assert.ok(permissionCheck > mountCheck);
  assert.ok(keyCheck > permissionCheck);
  assert.ok(mkdir > keyCheck);
  assert.ok(service.includes('stat -c "%%U:%%G:%%a" /etc/babypark-n8n)" = "root:root:700"'));
});

test('systemd-expanded mount and key guards preserve shell printf conversions', () => {
  const sourceLines = service.split('\n').filter((line) => line.startsWith('ExecStartPre='));
  const commands = systemdExpandedExecStartPreLines();
  assert.equal(sourceLines.length, 5);
  assert.equal(commands.length, 4);
  assert.match(sourceLines[0], /--bytes --output FSTYPE,OPTIONS,SIZE/);
  assert.match(sourceLines[2], /printf "%%s\\n" "\$\$N8N_ENCRYPTION_KEY"/);
  assert.match(commands[0], /test "\$1" = tmpfs/);
  assert.match(commands[0], /test "\$3" = 134217728/);
  assert.match(commands[0], /uid=1000 gid=1000 noswap nodev nosuid noexec/);
  assert.match(commands[2], /printf "%s\\n" "\$N8N_ENCRYPTION_KEY"/);
  assert.match(commands[2], /POSTGRES_PASSWORD/);
  assert.match(commands[2], /test "\$N8N_ENCRYPTION_KEY" != "\$POSTGRES_PASSWORD"/);
  assert.match(commands[3], /--host=unix:\/\/\/var\/run\/docker\.sock/);
  assert.match(service, /UnsetEnvironment=DOCKER_CONTEXT DOCKER_HOST/);

  withTempDir((temp) => {
    const findmnt = join(temp, 'findmnt');
    writeExecutable(findmnt, '#!/bin/sh\nprintf "%s\\n" "$TEST_MOUNT_ROW"\n');
    const mountCommand = commands[0].replace('/usr/bin/findmnt', findmnt);
    const validMount = runSystemdExpandedPre(mountCommand, { TEST_MOUNT_ROW: 'tmpfs rw,noswap,nodev,nosuid,noexec,mode=700,uid=1000,gid=1000 134217728' });
    assert.equal(validMount.status, 0, validMount.stderr);
    for (const row of [
      'ext4 rw,noswap,nodev,nosuid,noexec,mode=700,uid=1000,gid=1000 134217728',
      'tmpfs rw,sw,nodev,nosuid,noexec,mode=700,uid=1000,gid=1000 134217728',
      'tmpfs rw,noswap,nosuid,noexec,mode=700,uid=1000,gid=1000 134217728',
      'tmpfs rw,noswap,nodev,noexec,mode=700,uid=1000,gid=1000 134217728',
      'tmpfs rw,noswap,nodev,nosuid,mode=700,uid=1000,gid=1000 134217728',
      'tmpfs rw,noswap,nodev,nosuid,noexec,mode=755,uid=1000,gid=1000 134217728',
      'tmpfs rw,noswap,nodev,nosuid,noexec,mode=700,uid=0,gid=1000 134217728',
      'tmpfs rw,noswap,nodev,nosuid,noexec,mode=700,uid=1000,gid=0 134217728',
      'tmpfs rw,noswap,nodev,nosuid,noexec,mode=700,uid=1000,gid=1000 268435456',
      'tmpfs rw,noswap,nodev,nosuid,noexec,mode=700,uid=1000,gid=1000',
    ]) {
      const invalidMount = runSystemdExpandedPre(mountCommand, { TEST_MOUNT_ROW: row });
      assert.notEqual(invalidMount.status, 0);
    }
  });

  const validKey = runSystemdExpandedPre(commands[2], { N8N_ENCRYPTION_KEY: 'a'.repeat(64), POSTGRES_PASSWORD: 'b'.repeat(64) });
  const invalidKey = runSystemdExpandedPre(commands[2], { N8N_ENCRYPTION_KEY: 'malformed' });
  assert.equal(validKey.status, 0, validKey.stderr);
  assert.notEqual(invalidKey.status, 0);

  withTempDir((temp) => {
    const fakeStat = join(temp, 'stat');
    writeExecutable(fakeStat, '#!/bin/sh\ncase "$3" in */n8n.env) printf "%s\\n" "$TEST_KEY_STAT";; */babypark-n8n) printf "%s\\n" "$TEST_DIR_STAT";; *) exit 2;; esac\n');
    const permissionCommand = commands[1].replaceAll('/usr/bin/stat', fakeStat);
    const validPermissions = runSystemdExpandedPre(permissionCommand, {
      TEST_KEY_STAT: 'root:root:600',
      TEST_DIR_STAT: 'root:root:700',
    });
    const wrongDirectoryOwner = runSystemdExpandedPre(permissionCommand, {
      TEST_KEY_STAT: 'root:root:600',
      TEST_DIR_STAT: 'deploy:root:700',
    });
    const wrongDirectoryMode = runSystemdExpandedPre(permissionCommand, {
      TEST_KEY_STAT: 'root:root:600',
      TEST_DIR_STAT: 'root:root:750',
    });
    assert.equal(validPermissions.status, 0, validPermissions.stderr);
    assert.notEqual(wrongDirectoryOwner.status, 0);
    assert.notEqual(wrongDirectoryMode.status, 0);
  });
});

test('primary and restore Compose services inherit exactly one internal network', () => {
  assert.match(compose, /services:\n  postgres:[\s\S]*?    networks:\n      - n8n_private[\s\S]*?\n  n8n:[\s\S]*?    networks:\n      - n8n_private\n/);
  assert.match(compose, /\nnetworks:\n  n8n_private:\n    internal: true\n?$/);
  assert.doesNotMatch(compose, /network_mode:|external:\s*true/);
  assert.doesNotMatch(restoreCompose, /networks:|network_mode:/);
  assert.match(runbook, /exactly one service network marked `internal: true`/);
  assert.match(runbook, /docker --host=unix:\/\/\/var\/run\/docker\.sock network inspect --format '\{\{\.Internal\}\}' "\$network_id"\)" = true/);
  assert.match(runbook, /docker --host=unix:\/\/\/var\/run\/docker\.sock inspect --format '\{\{len \.NetworkSettings\.Networks\}\}' "\$container_id"\)" = 1/);
  assert.match(runbook, /curl --fail --silent --show-error --max-time 5 --output \/dev\/null http:\/\/127\.0\.0\.1:5678\//);
  assert.match(runbook, /check\("203\.0\.113\.1", 4\), check\("2001:db8::1", 6\)/);
  assert.match(runbook, /\["ENETUNREACH", "EHOSTUNREACH", "EAFNOSUPPORT"\]/);
  assert.match(runbook, /Do not replace this check with a live URL or a real customer\/partner endpoint/);
  assert.match(traceability, /exactly one `internal: true` project bridge/);
});

test('official PostgreSQL is independent, private, capped and separately restorable', () => {
  const postgresService = compose.slice(compose.indexOf('  postgres:'), compose.indexOf('  n8n:'));
  assert.match(compose, /image: postgres:16\.16@sha256:ce81150802644ddfac1db4da9e63be6f2a3818aa6ee98a7a28838aeea65dc37a/);
  assert.match(compose, /DB_TYPE: postgresdb/);
  assert.match(compose, /DB_POSTGRESDB_HOST: postgres/);
  assert.match(compose, /source: \/var\/lib\/babypark-n8n\/postgres\n        target: \/var\/lib\/postgresql\/data/);
  assert.match(compose, /source: \/var\/lib\/babypark-n8n\/user\n        target: \/home\/node\/\.n8n/);
  assert.match(compose, /POSTGRES_PASSWORD: \$\{POSTGRES_PASSWORD:\?Load POSTGRES_PASSWORD/);
  assert.match(compose, /N8N_ENCRYPTION_KEY: \$\{N8N_ENCRYPTION_KEY:\?Load N8N_ENCRYPTION_KEY/);
  assert.match(compose, /mem_limit: 512m\n    memswap_limit: 512m\n    cpus: 0\.5/);
  assert.match(compose, /mem_limit: 1200m\n    memswap_limit: 1200m\n    cpus: 1\.0/);
  assert.match(compose, /logging:\n      driver: none/);
  assert.doesNotMatch(postgresService, /\n    ports:/);
  assert.match(compose, /host_ip: 127\.0\.0\.1/);
  assert.match(restoreCompose, /source: \/var\/lib\/babypark-n8n\/restore-test\/postgres/);
  assert.match(restoreCompose, /source: \/var\/lib\/babypark-n8n\/restore-test\/user/);
  assert.match(restoreCompose, /published: "5679"/);
});

test('alternatives scan records dated official activity, support and license evidence', () => {
  assert.match(optionsScan, /Candidate support and current activity evidence/);
  assert.match(optionsScan, /0\.94\.0.*Latest.*2026-11-25/);
  assert.match(optionsScan, /5\.0\.10.*maintenance release.*2026-11-17/);
  assert.match(optionsScan, /v4\.20\.2.*published 2026-11-28/);
  assert.match(optionsScan, /Signed official `2\.49\.8` release published 2026-11-27/);
  assert.match(optionsScan, /Community core is MIT-licensed/);
  assert.match(optionsScan, /Official product-update page lists a 2026-09-24 update/);
  assert.match(optionsScan, /PostgreSQL 16 as a supported compatibility major/);
  assert.match(optionsScan, /PostgreSQL License permits use for any purpose without a fee/);
  assert.match(optionsScan, /PostgreSQL security information is at/);
  assert.match(optionsScan, /Official PostgreSQL 16\.16 database component/);
});

test('alternatives scan scores each serious candidate on every frozen R1-R6 area', () => {
  const start = optionsScan.indexOf('## Requirement-area fit matrix');
  const end = optionsScan.indexOf('\n## Candidate support and current activity evidence', start);
  assert.ok(start >= 0 && end > start, 'candidate requirement matrix is present');
  const matrix = optionsScan.slice(start, end);
  const candidates = new Map();
  for (const line of matrix.split('\n').filter(row => row.startsWith('|'))) {
    const fields = line.split('|').slice(1, -1).map(value => value.trim());
    if (fields[0] === 'Candidate' || fields[0].startsWith('---')) continue;
    assert.equal(fields.length, 4, line);
    assert.match(fields[1], /^R[1-6]$/);
    assert.match(fields[2], /^(PASS|PARTIAL|FAIL)$/);
    const areas = candidates.get(fields[0]) ?? new Set();
    assert.equal(areas.has(fields[1]), false, `duplicate ${fields[1]} for ${fields[0]}`);
    areas.add(fields[1]);
    candidates.set(fields[0], areas);
  }
  assert.equal(candidates.size, 6);
  for (const [candidate, areas] of candidates) {
    assert.deepEqual([...areas].sort(), ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'], candidate);
  }
  assert.match(matrix, /Official n8n 2\.49\.8 \+ PostgreSQL 16\.16/);
  assert.match(optionsScan, /PostgreSQL 16\.16 database component, PostgreSQL License/);
});

test('implementation traceability uses only the Agreement section 6 status vocabulary', () => {
  const rows = traceability.split('\n').filter(line => line.startsWith('|'));
  assert.ok(rows.length > 3);
  for (const row of rows.slice(2)) {
    const fields = row.split('|').slice(1, -1).map(value => value.trim());
    assert.equal(fields.length, 6, row);
    assert.match(fields[5], /^(DONE|IN PROGRESS|DEFERRED)$/, row);
  }
  assert.match(traceability, /All `DEFERRED` rows are outside this implementation-only PR/);
});

test('synthetic external-egress check passes only for an explicit no-route result', () => {
  const block = blockContaining('external egress denial: PASS');
  const source = /node -e '\n([\s\S]*?)\n'/.exec(block)?.[1];
  assert.ok(source);

  const runScenario = (event, code = '') => {
    let result;
    withTempDir((temp) => {
    const scriptPath = join(temp, 'egress-check.mjs');
    const notification = event === 'error' ? `listeners.error({ code: ${JSON.stringify(code)} })` : `listeners.${event}()`;
    let stub = `const net = { createConnection() { const listeners = {}; const socket = { once(name, callback) { listeners[name] = callback; return socket; }, destroy() {} }; queueMicrotask(() => ${notification}); return socket; } };`;
    if (event === 'timeout') {
      stub = `const net = { createConnection() { return { once() { return this; }, destroy() {} }; } };`;
    }
    const injected = source.replace('const net = require("node:net");', stub);
    assert.notEqual(injected, source, 'the synthetic probe must replace the real network module');
    const shortened = event === 'timeout' ? injected.replace('}, 3000);', '}, 1);') : injected;
    writeFileSync(scriptPath, shortened);
    result = spawnSync('node', [scriptPath], { encoding: 'utf8', timeout: 3000 });
    });
    return result;
  };

  const blocked = runScenario('error', 'ENETUNREACH');
  assert.equal(blocked.status, 0, blocked.stderr);
  assert.match(blocked.stdout, /external egress denial: PASS/);

  const connected = runScenario('connect');
  assert.notEqual(connected.status, 0);
  assert.match(connected.stderr, /external egress connection succeeded/);

  const refused = runScenario('error', 'ECONNREFUSED');
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /egress test inconclusive \(ECONNREFUSED\)/);

  const timeout = runScenario('timeout');
  assert.notEqual(timeout.status, 0);
  assert.match(timeout.stderr, /egress test timed out/);
});

test('stopping n8n stops and clears its runtime tmpfs while restore remounts explicitly', () => {
  assert.match(runtimeMount, /^PartOf=babypark-n8n\.service$/m);
  assert.ok(runbook.includes('normal service stop clears execution/event data from tmpfs'));
  const mountStartCommand = "systemctl start '" + runtimeMountName + "'";
  const restoreMountStart = runbook.indexOf(mountStartCommand);
  const restoreMountCheck = runbook.indexOf('findmnt --mountpoint /run/babypark-n8n-runtime --types tmpfs', restoreMountStart);
  const restoreScratchCreate = runbook.indexOf('install -d -o 1000 -g 1000 -m 0700 /run/babypark-n8n-runtime/restore-test\n', restoreMountCheck);
  const restoreScratchSubdirs = runbook.indexOf('install -d -o 1000 -g 1000 -m 0700 /run/babypark-n8n-runtime/restore-test/storage', restoreScratchCreate);
  const restoreScratchModeCheck = runbook.indexOf('test \"$(stat -c \'%u:%g:%a\' \"$path\")\" = 1000:1000:700', restoreScratchSubdirs);
  const restoreContainerStart = runbook.indexOf('-p babypark-n8n-restore', restoreMountStart);
  assert.ok(restoreMountStart >= 0 && restoreMountStart < restoreMountCheck);
  assert.ok(restoreMountCheck < restoreScratchCreate);
  assert.ok(restoreScratchCreate < restoreScratchSubdirs);
  assert.ok(restoreScratchSubdirs < restoreScratchModeCheck);
  assert.ok(restoreScratchModeCheck < restoreContainerStart);
  assert.match(service, /BindsTo=run-babypark\\x2dn8n\\x2druntime\.mount/);
  const restoreSection = runbook.indexOf('## Clean PostgreSQL and encryption-key restore');
  const primaryStop = runbook.indexOf('systemctl stop babypark-n8n.service', restoreSection);
  assert.ok(primaryStop >= 0 && primaryStop < restoreMountStart);
});

test('restore start rejects a missing runtime tmpfs option or a size mismatch', () => {
  const block = blockContaining('runtime tmpfs mount verification: PASS');
  const mountStart = block.indexOf('mount_row=$(findmnt --mountpoint');
  const checkEnd = block.indexOf("printf '%s\\n' 'restore runtime tmpfs mount verification: PASS'", mountStart);
  assert.ok(mountStart >= 0 && checkEnd > mountStart);
  const check = 'set -euo pipefail\n' + block.slice(mountStart, checkEnd);
  assert.match(check, /--bytes --output FSTYPE,OPTIONS,SIZE/);
  assert.match(check, /test "\$1" = tmpfs/);
  assert.match(check, /test "\$3" = 134217728/);

  withTempDir((temp) => {
    const findmnt = join(temp, 'findmnt');
    writeExecutable(findmnt, '#!/bin/sh\nprintf "%s\\n" "$TEST_MOUNT_ROW"\n');
    const command = check.replace('findmnt --mountpoint', findmnt + ' --mountpoint');
    const good = runBash(command, {
      TEST_MOUNT_ROW: 'tmpfs rw,noswap,nodev,nosuid,noexec,mode=700,uid=1000,gid=1000 134217728',
    });
    assert.equal(good.status, 0, good.stderr);
    for (const row of [
      'tmpfs rw,noswap,nodev,nosuid,noexec,mode=700,uid=1000,gid=1000 268435456',
      'tmpfs rw,noswap,nodev,nosuid,noexec,mode=700,uid=0,gid=1000 134217728',
      'tmpfs rw,sw,nodev,nosuid,noexec,mode=700,uid=1000,gid=1000 134217728',
    ]) {
      const bad = runBash(command, { TEST_MOUNT_ROW: row });
      assert.notEqual(bad.status, 0);
    }
  });
});

test('release instructions reload systemd and inspect the generated Compose container ID', () => {
  assert.match(runbook, /systemctl daemon-reload/);
  assert.match(runbook, /\/usr\/bin\/docker --host=unix:\/\/\/var\/run\/docker\.sock compose --env-file \/etc\/babypark-n8n\/n8n\.env --project-directory \/opt\/babypark-n8n -f \/opt\/babypark-n8n\/compose\.yaml ps --all --quiet n8n/);
  assert.match(runbook, /config --format json/);
  assert.match(runbook, /print\("n8n image:/);
  assert.match(runbook, /print\("PostgreSQL image:/);
  assert.match(runbook, /print\("bind:/);
  assert.doesNotMatch(runbook, /\/usr\/bin\/docker --host=unix:\/\/\/var\/run\/docker\.sock inspect --format '\{\{\.Id\}\}' babypark-n8n/);
  const keyGeneration = runbook.indexOf('key_file=/etc/babypark-n8n/n8n.env');
  const positiveStart = runbook.indexOf('Then perform one positive start');
  const metadataInspection = runbook.indexOf('Immediately after the successful start');
  const workflowImport = runbook.indexOf('Before creating credentials or workflows');
  const restoreRehearsal = runbook.indexOf('## Clean PostgreSQL and encryption-key restore');
  const finalAcceptance = runbook.indexOf('After every listed gate passes');
  const enableBoot = runbook.indexOf('systemctl enable babypark-n8n.service');
  assert.ok(keyGeneration >= 0 && positiveStart > keyGeneration);
  assert.ok(metadataInspection > positiveStart);
  assert.ok(workflowImport > metadataInspection);
  assert.ok(restoreRehearsal > workflowImport);
  assert.ok(finalAcceptance > restoreRehearsal);
  assert.ok(enableBoot > finalAcceptance);
  assert.doesNotMatch(runbook.slice(workflowImport, restoreRehearsal), /systemctl enable babypark-n8n\.service/);
});

test('first install creates only a registered root-owned n8n state namespace', () => {
  assert.match(runbook, /registered `n8n_state_root` parent `\/var\/lib\/babypark-n8n`/);
  const block = blockContaining('state_root=/var/lib/babypark-n8n');
  assert.match(block, /mkdir -m 0755 -- "\$state_root"/);
  assert.match(block, /test "\$\(stat -c '%U:%G:%a' "\$state_root"\)" = root:root:755/);
  assert.match(block, /test ! -e "\$state_root\/user" && test ! -L "\$state_root\/user"/);
  assert.match(block, /test ! -e "\$state_root\/postgres" && test ! -L "\$state_root\/postgres"/);
  assert.match(block, /chown "\$postgres_uid:\$postgres_gid" "\$state_root\/postgres"/);
  assert.match(block, /test "\$\(stat -c '%u:%g:%a' "\$state_root\/user"\)" = 1000:1000:700/);
  assert.match(block, /test "\$\(stat -c '%u:%g:%a' "\$state_root\/postgres"\)" = "\$postgres_uid:\$postgres_gid:700"/);
});

test('runbook rejects Docker Engine server versions below 28.0.0 and malformed versions', () => {
  const block = localSocketDocker(blockContaining('engine_version=$(/usr/bin/docker --host=unix:///var/run/docker.sock version --format'));
  assert.match(block, /Docker Engine server must be an unsuffixed version >= 28\.0\.0/);
  assert.match(runbook, /DOCKER_CONTEXT=babypark-n8n-invalid DOCKER_HOST=tcp:\/\/127\.0\.0\.1:1 \/usr\/bin\/docker --host=unix:\/\/\/var\/run\/docker\.sock info/);

  withTempDir((temp) => {
    const fakeBin = join(temp, 'bin');
    mkdirSync(fakeBin);
    writeExecutable(join(fakeBin, 'docker'), '#!/bin/sh\n[ "$1" = --host=unix:///var/run/docker.sock ] && shift\ncase "$1" in version) printf \'%s\\n\' "$TEST_DOCKER_SERVER_VERSION";; compose) if [ "$2" = version ]; then printf \'5.8.1\\n\'; else exit 2; fi;; info) test "$DOCKER_CONTEXT" = babypark-n8n-invalid && test "$DOCKER_HOST" = tcp://127.0.0.1:1 && printf \'local-socket\\n\';; *) exit 2;; esac\n');
    for (const version of ['28.0.0', '29.1.3']) {
      const result = runBash(block, { PATH: `${fakeBin}:${process.env.PATH}`, TEST_DOCKER_SERVER_VERSION: version });
      assert.equal(result.status, 0, `${version}: ${result.stderr}`);
      assert.match(result.stdout, /version gate: PASS/);
    }
    for (const version of ['27.9.9', '28.0.0-rc.1', 'unknown']) {
      const result = runBash(block, { PATH: `${fakeBin}:${process.env.PATH}`, TEST_DOCKER_SERVER_VERSION: version });
      assert.notEqual(result.status, 0, `${version} unexpectedly passed`);
    }
  });
});

test('invalid Docker context and TCP host cannot override the pinned Unix socket', () => {
  const block = runbook.match(/^if DOCKER_CONTEXT=babypark-n8n-invalid DOCKER_HOST=tcp:\/\/127\.0\.0\.1:1 [^\n]+\n[\s\S]*?^fi$/m)?.[0];
  assert.ok(block, 'wrong-context injection check is present');
  const command = localSocketDocker(block);
  withTempDir((temp) => {
    const fakeBin = fakeDockerBin(temp, '#!/bin/sh\ntest "$1" = --host=unix:///var/run/docker.sock || exit 31\ntest "$2" = info || exit 32\ntest "$DOCKER_CONTEXT" = babypark-n8n-invalid || exit 33\ntest "$DOCKER_HOST" = tcp://127.0.0.1:1 || exit 34\nprintf local-socket\n');
    const result = runBash(command, { PATH: `${fakeBin}:${process.env.PATH}` });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /wrong-context override check: PASS/);
  });
});

test('runbook rejects Docker Compose CLI versions below 5.8.1 and malformed versions', () => {
  const block = localSocketDocker(blockContaining('Docker Compose plugin version gate: PASS'));
  assert.match(runbook, /Docker Compose plugin 5\.8\.1 or newer/);
  assert.match(block, /docker --host=unix:\/\/\/var\/run\/docker\.sock compose version --short/);

  withTempDir((temp) => {
    const fakeBin = join(temp, 'bin');
    mkdirSync(fakeBin);
    writeExecutable(join(fakeBin, 'docker'), '#!/bin/sh\n[ "$1" = --host=unix:///var/run/docker.sock ] && shift\ncase "$1" in version) printf "%s\\n" "$TEST_ENGINE_VERSION";; compose) if [ "$2" = version ]; then printf "%s\\n" "$TEST_COMPOSE_VERSION"; else exit 2; fi;; info) printf \'local-socket\\n\';; *) exit 2;; esac\n');
    const env = {
      PATH: fakeBin + ':' + process.env.PATH,
      TEST_ENGINE_VERSION: '28.0.0',
    };
    for (const version of ['5.8.1', '5.9.0', '6.0.0']) {
      const result = runBash(block, { ...env, TEST_COMPOSE_VERSION: version });
      assert.equal(result.status, 0, version + ': ' + result.stderr);
      assert.match(result.stdout, /Docker Compose plugin version gate: PASS/);
    }
    for (const version of ['5.8.0', '4.99.99', '5.8.1-rc.1', 'invalid']) {
      const result = runBash(block, { ...env, TEST_COMPOSE_VERSION: version });
      assert.notEqual(result.status, 0, version + ' unexpectedly passed');
    }
  });
});

test('runbook fails closed when Docker socket ACL inspection is absent or finds a named entry', () => {
  const block = blockContaining('acl_output=$(getfacl --omit-header');
  assert.match(block, /command -v getfacl/);
  assert.ok(block.includes("awk -F: '/^(user|group):[^:]+:/ { named=1 } END { exit named ? 1 : 0 }'"));

  withTempDir((temp) => {
    const fakeBin = join(temp, 'bin');
    mkdirSync(fakeBin);
    writeExecutable(join(fakeBin, 'getfacl'), '#!/bin/sh\nprintf \'%s\\n\' "$TEST_SOCKET_ACL"\n');

    const noNamedEntries = runBash(block, {
      PATH: `${fakeBin}:${process.env.PATH}`,
      TEST_SOCKET_ACL: 'user::rw-\ngroup::rw-\nmask::rw-\nother::---',
    });
    assert.equal(noNamedEntries.status, 0, noNamedEntries.stderr);
    assert.match(noNamedEntries.stdout, /named-ACL check: PASS \(none\)/);

    for (const acl of [
      'user::rw-\nuser:unreviewed-user:rw-\ngroup::rw-\nmask::rw-\nother::---',
      'user::rw-\ngroup::rw-\ngroup:unreviewed-group:rw-\nmask::rw-\nother::---',
    ]) {
      const result = runBash(block, { PATH: `${fakeBin}:${process.env.PATH}`, TEST_SOCKET_ACL: acl });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /unreviewed named ACL entry/);
      assert.doesNotMatch(result.stderr, /unreviewed-(user|group)/);
    }

    const emptyBin = join(temp, 'empty-bin');
    mkdirSync(emptyBin);
    symlinkSync('/bin/bash', join(emptyBin, 'bash'));
    const missingTool = runBash(block, { PATH: emptyBin });
    assert.notEqual(missingTool.status, 0);
    assert.match(missingTool.stderr, /getfacl is required/);
  });
});

test('Docker key-boundary roster includes supplementary and primary-GID users and rejects world access', () => {
  const block = blockContaining('Docker socket effective-access roster: PASS');
  assert.match(runbook, /supports only the local .*files.*source for both passwd and group/);
  assert.match(runbook, /provider-specific completeness proof/);
  assert.match(block, /open\("\/etc\/nsswitch\.conf"/);
  assert.match(block, /APPROVED_DOCKER_ADMINS/);
  assert.match(block, /getent", "passwd"/);
  assert.match(block, /primary\.add\(fields\[0\]\)/);
  assert.match(block, /supplementary \| primary/);
  assert.match(block, /8#\$socket_mode & 0007/);

  withTempDir((temp) => {
    const fakeBin = join(temp, 'bin');
    mkdirSync(fakeBin);
    writeExecutable(join(fakeBin, 'stat'), '#!/bin/sh\nprintf "%s\\n" "$TEST_SOCKET_STAT"\n');
    writeExecutable(join(fakeBin, 'getent'), '#!/bin/sh\ncase "$1" in group) printf "%s\\n" "$TEST_GROUP";; passwd) [ -n "$TEST_PASSWD" ] || exit 2; printf "%s\\n" "$TEST_PASSWD";; *) exit 2;; esac\n');
    const nsswitch = join(temp, 'nsswitch.conf');
    writeFileSync(nsswitch, 'passwd: files\ngroup: files\n');
    const checkedBlock = block.replace('"/etc/nsswitch.conf"', JSON.stringify(nsswitch));
    const env = {
      PATH: `${fakeBin}:${process.env.PATH}`,
      TEST_SOCKET_STAT: '660 root:docker 999',
      TEST_GROUP: 'docker:x:999:approved-supplementary',
      TEST_PASSWD: 'root:x:0:0:root:/root:/bin/sh\napproved-supplementary:x:1001:1001::/home/supp:/bin/sh\nunapproved-primary-only:x:1002:999::/home/primary:/bin/sh',
    };
    const approved = runBash(checkedBlock, { ...env, APPROVED_DOCKER_ADMINS: 'root,approved-supplementary,unapproved-primary-only' });
    assert.equal(approved.status, 0, approved.stderr);
    assert.match(approved.stdout, /effective-access roster: PASS/);

    const missedPrimary = runBash(checkedBlock, { ...env, APPROVED_DOCKER_ADMINS: 'root,approved-supplementary' });
    assert.notEqual(missedPrimary.status, 0);
    assert.match(missedPrimary.stderr, /unapproved effective Docker socket group member/);
    assert.doesNotMatch(missedPrimary.stderr, /unapproved-primary-only/);

    const worldAccessible = runBash(checkedBlock, {
      ...env,
      TEST_SOCKET_STAT: '666 root:docker 999',
      APPROVED_DOCKER_ADMINS: 'root,approved-supplementary,unapproved-primary-only',
    });
    assert.notEqual(worldAccessible.status, 0);
    assert.match(worldAccessible.stderr, /Refusing world access/);

    const missingRoster = runBash(checkedBlock, { ...env, APPROVED_DOCKER_ADMINS: '' });
    assert.notEqual(missingRoster.status, 0);
    assert.match(missingRoster.stderr, /exact owner-approved Docker admin roster is required/);

    const failedEnumeration = runBash(checkedBlock, {
      ...env,
      TEST_PASSWD: '',
      APPROVED_DOCKER_ADMINS: 'root,approved-supplementary,unapproved-primary-only',
    });
    assert.notEqual(failedEnumeration.status, 0);
    assert.match(failedEnumeration.stderr, /complete NSS group\/passwd enumeration is unavailable/);

    writeFileSync(nsswitch, 'passwd: files sss\ngroup: files\n');
    const partialProvider = runBash(checkedBlock, {
      ...env,
      TEST_PASSWD: 'root:x:0:0:root:/root:/bin/sh',
      APPROVED_DOCKER_ADMINS: 'root,approved-supplementary,unapproved-primary-only',
    });
    assert.notEqual(partialProvider.status, 0);
    assert.match(partialProvider.stderr, /provider-specific completeness proof is required/);
  });
});

test('runbook requires a same-L2 peer probe before accepting loopback-only reachability', () => {
  assert.match(runbook, /setting `SERVER_LAN_IP` to the target server's verified LAN address/);
  assert.match(runbook, /Do not substitute a probe from the Docker host itself/);
  assert.match(runbook, /A successful TCP connection is a STOP/);
  assert.match(runbook, /If no same-L2 peer probe is available, leave the service stopped/);
  const block = blockContaining('same-L2 n8n TCP probe: PASS');
  assert.match(runbook, /an explicit connection refusal is the only probe result accepted as PASS/);
  assert.match(runbook, /timeout, unreachable route, invalid address[\s\S]*UNVERIFIED/);
  assert.match(block, /socket\.create_connection\(\(target, 5678\), timeout=3\)/);
  assert.match(block, /except ConnectionRefusedError/);
  assert.match(block, /except \(OSError, ValueError\)/);
  assert.match(block, /STOP: n8n port 5678 accepted TCP from a same-L2 peer/);
});

test('traceability binds storage count, loopback and Docker key-boundary gates', () => {
  assert.match(traceability, /all 13 classes/);
  assert.match(traceability, /Docker Engine server `>=28\.0\.0`/);
  assert.match(traceability, /same-L2 peer TCP probe/);
  assert.match(traceability, /official PostgreSQL 16\.16 service/);
  assert.doesNotMatch(traceability, /OPEN BLOCKER/);
  assert.match(sqliteCompatibility, /62bb4c7aebe268e748cccc73cb9a4c2cd52d4524/);
  assert.match(sqliteCompatibility, /EVIDENCE — NON-NORMATIVE/);
  assert.doesNotMatch(sqliteCompatibility, /Status: \*\*OPEN BLOCKER\*\*/);
  assert.match(sqliteCompatibility, /does not expose a busy-timeout setting/);
  assert.match(sqliteCompatibility, /no custom n8n code or unsupported environment variable/);
  assert.match(sqliteCompatibility, /The owner selected official PostgreSQL/);
  assert.match(traceability, /named socket ACL entries/);
  assert.match(traceability, /missing `getfacl`/);
});

test('same-L2 TCP probe accepts explicit connection refusal and stops when a listener is reachable', async () => {
  const block = blockContaining('same-L2 n8n TCP probe: PASS');
  const source = /python3 - "\$SERVER_LAN_IP" <<'PY'\n([\s\S]*?)\nPY/.exec(block)?.[1];
  assert.ok(source);
  const server = createServer((socket) => socket.end());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  const probe = source.replaceAll('5678', String(port));
  try {
    const reachable = spawnSync('python3', ['-', '127.0.0.1'], { input: probe, encoding: 'utf8' });
    assert.notEqual(reachable.status, 0);
    assert.match(reachable.stderr, /accepted TCP from a same-L2 peer/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const closed = spawnSync('python3', ['-', '127.0.0.1'], { input: probe, encoding: 'utf8' });
  assert.equal(closed.status, 0, closed.stderr);
  assert.match(closed.stdout, /same-L2 n8n TCP probe: PASS/);
});

test('same-L2 TCP probe fails closed on timeout, unreachable network and invalid address', () => {
  const block = blockContaining('same-L2 n8n TCP probe: PASS');
  const source = /python3 - "\$SERVER_LAN_IP" <<'PY'\n([\s\S]*?)\nPY/.exec(block)?.[1];
  assert.ok(source);
  const cases = [
    ['timeout', 'TimeoutError("synthetic timeout")', /TimeoutError/],
    ['unreachable', 'OSError(101, "synthetic network unreachable")', /OSError/],
  ];
  for (const [label, errorExpression, errorPattern] of cases) {
    const injected = source.replace(
      'import socket\n',
      `import socket\nsocket.create_connection = lambda *args, **kwargs: (_ for _ in ()).throw(${errorExpression})\n`,
    );
    const result = spawnSync('python3', ['-', '192.0.2.10'], { input: injected, encoding: 'utf8' });
    assert.notEqual(result.status, 0, `${label} unexpectedly passed`);
    assert.match(result.stderr, /UNVERIFIED: same-L2 n8n TCP probe inconclusive/);
    assert.match(result.stderr, errorPattern);
    assert.doesNotMatch(result.stdout + result.stderr, /same-L2 n8n TCP probe: PASS/);
  }

  const invalid = spawnSync('python3', ['-', 'not-an-ip'], { input: source, encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /UNVERIFIED: same-L2 n8n TCP probe inconclusive \(ValueError\)/);
  assert.doesNotMatch(invalid.stdout + invalid.stderr, /same-L2 n8n TCP probe: PASS/);
});

test('Compose render pipeline fails if the producer emits valid JSON and exits nonzero', () => {
  const block = blockContaining('config --format json');
  assert.match(block, /^set -euo pipefail/m);

  withTempDir((temp) => {
    const fakeBin = fakeDockerBin(temp, '#!/bin/sh\nprintf \'{"services":{"n8n":{"image":"n8n@sha256:x","networks":{"n8n_private":null},"ports":[],"volumes":[],"mem_limit":"1200m","memswap_limit":"1200m","environment":{"DB_TYPE":"postgresdb","DB_POSTGRESDB_HOST":"postgres"}},"postgres":{"image":"postgres@sha256:p","networks":{"n8n_private":null},"ports":[],"volumes":[],"mem_limit":"512m","memswap_limit":"512m"}},"networks":{"n8n_private":{"internal":true}}}\\n\'\nexit 23\n');
    const result = runBash(localSocketDocker(block), { PATH: `${fakeBin}:${process.env.PATH}` });
    assert.equal(result.status, 23, result.stderr);
    assert.doesNotMatch(result.stdout, /N8N_ENCRYPTION_KEY/);
  });
});

function keyGenerationBlock(keyDir) {
  return blockContaining('key_file=/etc/babypark-n8n/n8n.env')
    .replaceAll('/etc/babypark-n8n', keyDir);
}

function keyGenerationBin(dir, opensslScript) {
  const fakeBin = join(dir, 'bin');
  mkdirSync(fakeBin);
  writeExecutable(join(fakeBin, 'install'), '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do case "$1" in -o|-g|-m) shift 2;; -d) shift;; *) mkdir -p -- "$1"; exit 0;; esac; done\nexit 1\n');
  writeExecutable(join(fakeBin, 'chown'), '#!/bin/sh\nexit 0\n');
  writeExecutable(join(fakeBin, 'openssl'), opensslScript);
  writeExecutable(join(fakeBin, 'stat'), '#!/bin/sh\nif [ "$1" = "-c" ] && [ "$2" = "%U:%G:%a" ]; then printf "root:root:600\\n"; else exec /usr/bin/stat "$@"; fi\n');
  return fakeBin;
}

test('key generation preserves a pre-existing key and rejects an existing symlink', () => {
  withTempDir((temp) => {
    const dir = join(temp, 'etc');
    const marker = join(temp, 'openssl-called');
    const fakeBin = keyGenerationBin(temp, '#!/bin/sh\nprintf called > "$OPENSSL_MARKER"\nprintf "%s\\n" "' + 'a'.repeat(64) + '"\n');
    const keyFile = join(dir, 'n8n.env');
    mkdirSync(dir);
    writeFileSync(keyFile, 'pre-existing matching key bytes\n');
    const result = runBash(keyGenerationBlock(dir), { OPENSSL_MARKER: marker, PATH: `${fakeBin}:${process.env.PATH}` });
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(keyFile, 'utf8'), 'pre-existing matching key bytes\n');
    assert.equal(existsSync(marker), false);
  });

  withTempDir((temp) => {
    const dir = join(temp, 'etc');
    const target = join(temp, 'target.env');
    const marker = join(temp, 'openssl-called');
    const fakeBin = keyGenerationBin(temp, '#!/bin/sh\nprintf called > "$OPENSSL_MARKER"\nprintf "%s\\n" "' + 'b'.repeat(64) + '"\n');
    mkdirSync(dir);
    writeFileSync(target, 'symlink target bytes\n');
    const keyFile = join(dir, 'n8n.env');
    symlinkSync(target, keyFile);
    const result = runBash(keyGenerationBlock(dir), { OPENSSL_MARKER: marker, PATH: `${fakeBin}:${process.env.PATH}` });
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(target, 'utf8'), 'symlink target bytes\n');
    assert.equal(existsSync(keyFile), true);
    assert.equal(existsSync(marker), false);
  });
});

test('key generation leaves no file when OpenSSL fails', () => {
  withTempDir((temp) => {
    const dir = join(temp, 'etc');
    const fakeBin = keyGenerationBin(temp, '#!/bin/sh\nexit 29\n');
    const result = runBash(keyGenerationBlock(dir), { PATH: `${fakeBin}:${process.env.PATH}` });
    assert.equal(result.status, 29);
    assert.equal(existsSync(join(dir, 'n8n.env')), false);
    assert.doesNotMatch(result.stdout + result.stderr, /N8N_ENCRYPTION_KEY=[0-9a-f]{64}/i);
  });
});

test('key generation leaves no file when OpenSSL returns malformed key material', () => {
  withTempDir((temp) => {
    const dir = join(temp, 'etc');
    const fakeBin = keyGenerationBin(temp, '#!/bin/sh\nprintf "too-short\\n"\n');
    const result = runBash(keyGenerationBlock(dir), { PATH: `${fakeBin}:${process.env.PATH}` });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(dir, 'n8n.env')), false);
  });
});

test('key generation publishes only a validated 64-hex key with mode 0600', () => {
  withTempDir((temp) => {
    const dir = join(temp, 'etc');
    const key = 'c'.repeat(64);
    const pgPassword = 'd'.repeat(64);
    const counter = join(temp, 'openssl-count');
    const fakeOpenSsl = ['#!/bin/sh', 'count=0', 'test ! -e "$OPENSSL_COUNTER" || count=$(cat "$OPENSSL_COUNTER")', 'count=$((count + 1))', 'printf "%s" "$count" > "$OPENSSL_COUNTER"', `if [ "$count" = 1 ]; then printf "%s\\n" "${key}"; else printf "%s\\n" "${pgPassword}"; fi`].join('\n');
    const fakeBin = keyGenerationBin(temp, fakeOpenSsl);
    const result = runBash(keyGenerationBlock(dir), { OPENSSL_COUNTER: counter, PATH: `${fakeBin}:${process.env.PATH}` });
    const keyFile = join(dir, 'n8n.env');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(keyFile, 'utf8'), `N8N_ENCRYPTION_KEY=${key}\nPOSTGRES_PASSWORD=${pgPassword}\n`);
    assert.equal(readFileSync(keyFile, 'utf8').match(/N8N_ENCRYPTION_KEY=/g)?.length, 1);
    assert.match(readFileSync(keyFile, 'utf8'), /^N8N_ENCRYPTION_KEY=([0-9a-f]{64})\nPOSTGRES_PASSWORD=([0-9a-f]{64})\n$/);
    assert.notEqual(key, pgPassword);
    assert.equal((statSync(keyFile).mode & 0o777), 0o600);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(key));
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(pgPassword));
  });
});

test('restore checks only the synthetic credential through the registered tmpfs', () => {
  assert.match(runbook, /BabyPark restore dummy \(synthetic\)/);
  assert.match(runbook, /--id="\$credential_id" --decrypted --output=\/vol\/restore-test\/decrypted-credentials\.json/);
  assert.match(runbook, /dummy credential decryptability: PASS/);
  assert.match(runbook, /plaintext=\/run\/babypark-n8n-runtime\/restore-test\/decrypted-credentials\.json\ntest ! -e "\$plaintext" && test ! -L "\$plaintext"/);
  assert.match(runbook, /rm -f -- "\$plaintext"\ntest ! -e "\$plaintext"/);
  assert.doesNotMatch(runbook, /--decrypted --output=\/(?:var\/lib|var\/backups)\//);
  assert.match(runbook, /Verify only the two approved workflows exist, expected node counts match, and both are `active=false`/);
  assert.match(runbook, /bpAiSellerChatwootHandoffShadowNov23/);
  assert.match(runbook, /bpAiSilenceWatchdogNov23/);
});

test('resource capture fails closed on missing, failed, stopped, and OOM samples', () => {
  const functionSource = capturePhaseFunction();
  const resourceSetup = blockContaining('resource_log="/var/backups/babypark-n8n/resource-trial-');
  assert.ok(resourceSetup.includes('capture_phase() {'));
  assert.doesNotMatch(resourceSetup, /^capture_phase\s+before-image-pull\s*$/m);
  assert.match(runbook, /using `capture_phase before-image-pull primary absent` and `capture_phase after-image-pull primary absent`/);
  assert.doesNotMatch(functionSource, /\|\|\s*true/);
  assert.ok(functionSource.includes('${compose_args[@]}" ps --all --quiet'));
  assert.match(functionSource, /State\.Status\}\} \{\{\.State\.Pid\}\} \{\{\.State\.OOMKilled\}\}/);
  assert.match(functionSource, /for event_name in max oom oom_kill oom_group_kill/);

  withTempDir((temp) => {
    const proc = join(temp, 'proc');
    const cgroupRoot = join(temp, 'cgroup');
    const fakeBin = join(temp, 'bin');
    const resourceLog = join(temp, 'resource.tsv');
    mkdirSync(fakeBin);
    for (const [file, body] of [
      ['meminfo', 'MemAvailable: 123456 kB\n'],
      ['pressure/memory', 'some avg10=0.00 avg60=0.00 avg300=0.00 total=0\n'],
      ['vmstat', 'pswpin 0\npswpout 0\n'],
      ['stat', 'cpu 1 2 3 4 5 6 7 8 9 10\n'],
      ['loadavg', '0 0 0 1/1 1\n'],
      ['diskstats', '8 0 sda 0 0 0 0 0 0 0 0 0 0 0\n'],
    ]) {
      const path = join(proc, file);
      mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
      writeFileSync(path, body);
    }
    for (const [id, pid] of [['postgres-id', '111'], ['n8n-id', '222']]) {
      const rel = `/docker/${id}`;
      const cgroupDir = join(cgroupRoot, rel);
      mkdirSync(cgroupDir, { recursive: true });
      mkdirSync(join(proc, pid), { recursive: true });
      writeFileSync(join(proc, pid, 'cgroup'), `0::${rel}\n`);
      writeFileSync(join(cgroupDir, 'memory.current'), '1000\n');
      writeFileSync(join(cgroupDir, 'memory.peak'), '2000\n');
      writeFileSync(join(cgroupDir, 'memory.events'), 'low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\noom_group_kill 0\n');
    }
    writeExecutable(join(fakeBin, 'docker'), `#!/bin/bash
test "$1" = --host=unix:///var/run/docker.sock || exit 31
shift
case "$1" in
  compose)
    case "$TEST_DOCKER_FAIL" in ps) exit 42;; esac
    case " $* " in *" ps --all --quiet "*)
      service_name="${'${!#}'}"
      if [ "$TEST_EXPECT_ABSENT" = yes ] || [ "$TEST_MISSING" = "$service_name" ]; then exit 0; fi
      if [ "$TEST_MULTIPLE" = "$service_name" ]; then printf '%s\\n' "${'${service_name}'}-id-a" "${'${service_name}'}-id-b"; exit 0; fi
      printf '%s\\n' "${'${service_name}'}-id"
      exit 0;;
    esac
    exit 43;;
  inspect)
    id="${'${!#}'}"
    service_name="${'${id%-id}'}"
    status=running; pid=111; oom=false
    [ "$service_name" = n8n ] && pid=222
    [ "$TEST_STOPPED" = "$service_name" ] && { status=exited; pid=0; }
    [ "$TEST_OOM_KILLED" = "$service_name" ] && oom=true
    printf '%s %s %s\\n' "$status" "$pid" "$oom"
    exit 0;;
  *) exit 44;;
esac
`);
    writeExecutable(join(fakeBin, 'curl'), '#!/bin/sh\nprintf "200 0.010\\n"\n');
    let script = functionSource + '\ncapture_phase resource-test primary "$TEST_EXPECTED"\n';
    script = localSocketDocker(script)
      .replaceAll('/proc', proc)
      .replaceAll('/sys/fs/cgroup', cgroupRoot);
    const baseEnv = {
      PATH: `${fakeBin}:${process.env.PATH}`,
      resource_log: resourceLog,
      CHATWOOT_TTFB_URL: 'http://127.0.0.1/',
      TEST_EXPECTED: 'running',
      TEST_EXPECT_ABSENT: '',
      TEST_DOCKER_FAIL: '',
      TEST_MISSING: '',
      TEST_STOPPED: '',
      TEST_OOM_KILLED: '',
      TEST_MULTIPLE: '',
    };
    const good = runBash(script, baseEnv);
    assert.equal(good.status, 0, good.stderr);
    assert.match(readFileSync(resourceLog, 'utf8'), /container\tpostgres\tid\tpostgres-id/);
    assert.match(readFileSync(resourceLog, 'utf8'), /container\tn8n\tid\tn8n-id/);

    const failedCases = [
      { TEST_EXPECTED: 'running', TEST_MISSING: 'postgres' },
      { TEST_EXPECTED: 'running', TEST_DOCKER_FAIL: 'ps' },
      { TEST_EXPECTED: 'running', TEST_STOPPED: 'n8n' },
      { TEST_EXPECTED: 'running', TEST_OOM_KILLED: 'n8n' },
      { TEST_EXPECTED: 'running', TEST_MULTIPLE: 'postgres' },
      { TEST_EXPECTED: 'absent', TEST_EXPECT_ABSENT: '' },
    ];
    for (const overrides of failedCases) {
      const result = runBash(script, { ...baseEnv, ...overrides });
      assert.notEqual(result.status, 0, JSON.stringify(overrides));
    }

    const oomDir = join(cgroupRoot, 'docker', 'n8n-id');
    writeFileSync(join(oomDir, 'memory.events'), 'low 0\nhigh 0\nmax 0\noom 1\noom_kill 1\noom_group_kill 0\n');
    const oomEvent = runBash(script, baseEnv);
    assert.notEqual(oomEvent.status, 0);

    const peakFile = join(cgroupRoot, 'docker', 'postgres-id', 'memory.peak');
    rmSync(peakFile);
    const missingCgroupMetric = runBash(script, baseEnv);
    assert.notEqual(missingCgroupMetric.status, 0);
    writeFileSync(peakFile, '2000\n');

    const noContainers = runBash(script, { ...baseEnv, TEST_EXPECTED: 'absent', TEST_EXPECT_ABSENT: 'yes' });
    assert.equal(noContainers.status, 0, noContainers.stderr);

    const backupMode = runBash(script, { ...baseEnv, TEST_EXPECTED: 'postgres-only', TEST_STOPPED: 'n8n' });
    assert.equal(backupMode.status, 0, backupMode.stderr);
  });
});

test('Docker pull pins the local socket and restore cleanup returns to primary n8n', () => {
  assert.match(runbook, /\/usr\/bin\/docker --host=unix:\/\/\/var\/run\/docker\.sock compose --env-file \/etc\/babypark-n8n\/n8n\.env --project-directory \/opt\/babypark-n8n -f \/opt\/babypark-n8n\/compose\.yaml pull/);
  const resourceSetup = runbook.indexOf('Before a positive start, jump to **Record resource peaks');
  const positiveStart = runbook.indexOf('Then perform one positive start');
  assert.ok(resourceSetup > 0 && resourceSetup < positiveStart);
  const restoreSection = runbook.indexOf('## Clean PostgreSQL and encryption-key restore');
  const stopPrimary = runbook.indexOf('systemctl stop babypark-n8n.service', restoreSection);
  const backupVerify = runbook.indexOf('sha256sum -c SHA256SUMS >/dev/null', restoreSection);
  const restoreStart = runbook.indexOf('up -d postgres', stopPrimary);
  const restoreDown = runbook.indexOf('compose "${restore_args\[@\]}" down --remove-orphans');
  const stateDelete = runbook.indexOf('rm -r -- "$restore_state/postgres" "$restore_state/user"');
  const runtimeDelete = runbook.indexOf('rm -r -- "$restore_runtime/storage" "$restore_runtime/events"');
  const primaryStart = runbook.indexOf('systemctl start babypark-n8n.service', restoreDown);
  assert.ok(stopPrimary >= 0 && restoreStart > stopPrimary);
  assert.ok(backupVerify < stopPrimary);
  assert.ok(restoreDown > restoreStart);
  assert.ok(stateDelete > restoreDown && runtimeDelete > stateDelete && primaryStart > runtimeDelete);
  assert.match(runbook.slice(restoreDown, primaryStart), /test -z "\$remaining"/);
  const runtimeMountRecheck = runbook.lastIndexOf('mount_row=$(findmnt --mountpoint /run/babypark-n8n-runtime --types tmpfs', restoreDown);
  assert.ok(runtimeMountRecheck > 0 && runtimeMountRecheck < restoreDown);
  assert.match(runbook.slice(runtimeMountRecheck, restoreDown), /--bytes --output FSTYPE,OPTIONS,SIZE/);
  assert.match(runbook.slice(restoreDown, stateDelete), /state_entries=\$\(find "\$restore_state"/);
  assert.match(runbook.slice(restoreDown, runtimeDelete), /runtime_entries=\$\(find "\$restore_runtime"/);
  assert.doesNotMatch(runbook.slice(restoreDown, primaryStart), /rm\s+-rf/);
  assert.doesNotMatch(runbook.slice(restoreDown, primaryStart), /compose[^\n]*\s-v(?:\s|$)/);
  assert.match(runbook.slice(primaryStart, primaryStart + 500), /systemctl is-active --quiet babypark-n8n\.service/);
  assert.ok(runbook.indexOf('exec -T postgres pg_isready -U n8n -d n8n', primaryStart) > primaryStart);
});

test('backup collision aborts without changing a verified generation', () => {
  withTempDir((temp) => {
    const backupRoot = join(temp, 'backups');
    const generation = join(backupRoot, '20261127T220000Z');
    const userDir = join(temp, 'user');
    const keyFile = join(temp, 'n8n.env');
    mkdirSync(generation, { recursive: true });
    mkdirSync(userDir);
    const fakeBin = fakeDockerBin(temp, composeBackupDockerStub());
    writeFileSync(join(userDir, 'config'), 'synthetic source');
    writeFileSync(keyFile, 'N8N_ENCRYPTION_KEY=' + 'b'.repeat(64) + '\nPOSTGRES_PASSWORD=' + 'c'.repeat(64) + '\n');
    const original = new Map([
      ['n8n.pgdump', 'previous verified PostgreSQL dump'],
      ['user-folder.tar.gz', 'previous verified archive'],
      ['n8n.env', 'previous matching environment bytes'],
      ['SHA256SUMS', 'previous verified checksums'],
    ]);
    for (const [name, bytes] of original) writeFileSync(join(generation, name), bytes);
    writeExecutable(join(fakeBin, 'date'), '#!/bin/sh\nprintf "%s\\n" 20261127T220000Z\n');

    const script = localSocketDocker(substituteBackupPaths(blockContaining('stamp=$(date'), backupRoot, userDir, keyFile));
    const result = runBash(script, { PATH: `${fakeBin}:${process.env.PATH}` });

    assert.notEqual(result.status, 0);
    assert.deepEqual(readdirSync(generation).sort(), [...original.keys()].sort());
    for (const [name, bytes] of original) assert.equal(readFileSync(join(generation, name), 'utf8'), bytes);
  });
});

test('successful backup publishes portable relative checksums only after archive verification', () => {
  withTempDir((temp) => {
    const backupRoot = join(temp, 'backups');
    const userDir = join(temp, 'user');
    const keyFile = join(temp, 'n8n.env');
    mkdirSync(backupRoot);
    mkdirSync(userDir);
    const fakeBin = fakeDockerBin(temp, composeBackupDockerStub());
    writeFileSync(join(userDir, 'config'), 'synthetic source');
    writeFileSync(keyFile, 'N8N_ENCRYPTION_KEY=' + 'd'.repeat(64) + '\nPOSTGRES_PASSWORD=' + 'e'.repeat(64) + '\n');
    writeExecutable(join(fakeBin, 'date'), '#!/bin/sh\nprintf "%s\\n" 20261127T220002Z\n');
    writeExecutable(join(fakeBin, 'install'), '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do case "$1" in -o|-g|-m) shift 2;; *) source="$1"; shift; destination="$1"; shift; break;; esac; done\ncp "$source" "$destination"\nchmod 0600 "$destination"\n');

    const script = localSocketDocker(substituteBackupPaths(blockContaining('stamp=$(date'), backupRoot, userDir, keyFile));
    const result = runBash(script, { PATH: `${fakeBin}:${process.env.PATH}` });
    const generation = join(backupRoot, '20261127T220002Z');

    assert.equal(result.status, 0, result.stderr);
    const manifest = readFileSync(join(generation, 'SHA256SUMS'), 'utf8');
    assert.deepEqual(manifest.trim().split('\n').map((line) => line.split('  ')[1]).sort(), ['n8n.env', 'n8n.pgdump', 'user-folder.tar.gz']);
    const verification = spawnSync('bash', ['-eu', '-c', 'cd "$1" && sha256sum -c SHA256SUMS >/dev/null', 'bash', generation], { encoding: 'utf8' });
    assert.equal(verification.status, 0, verification.stderr);
    assert.equal(existsSync(join(generation, 'SHA256SUMS.partial')), false);
  });
});

test('failed archive creation leaves no accepted checksum manifest', () => {
  withTempDir((temp) => {
    const backupRoot = join(temp, 'backups');
    const userDir = join(temp, 'user');
    const keyFile = join(temp, 'n8n.env');
    mkdirSync(backupRoot);
    mkdirSync(userDir);
    const fakeBin = fakeDockerBin(temp, composeBackupDockerStub());
    writeFileSync(join(userDir, 'config'), 'synthetic source');
    writeFileSync(keyFile, 'N8N_ENCRYPTION_KEY=' + 'c'.repeat(64) + '\nPOSTGRES_PASSWORD=' + 'f'.repeat(64) + '\n');
    writeExecutable(join(fakeBin, 'date'), '#!/bin/sh\nprintf "%s\\n" 20261127T220001Z\n');
    writeExecutable(join(fakeBin, 'tar'), '#!/bin/sh\nprevious=0\nfor arg do if [ "$previous" = 1 ]; then printf partial > "$arg"; exit 17; fi; if [ "$arg" = "-czf" ]; then previous=1; fi; done\nexit 18\n');

    const script = localSocketDocker(substituteBackupPaths(blockContaining('stamp=$(date'), backupRoot, userDir, keyFile));
    const result = runBash(script, { PATH: `${fakeBin}:${process.env.PATH}` });
    const generation = join(backupRoot, '20261127T220001Z');

    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(join(generation, 'user-folder.tar.gz'), 'utf8'), 'partial');
    assert.equal(existsSync(join(generation, 'SHA256SUMS')), false);
    assert.equal(existsSync(join(generation, 'SHA256SUMS.partial')), false);
    assert.equal(existsSync(join(generation, 'n8n.env')), false);
  });
});

test('restore refuses an occupied durable target without changing its files', () => {
  withTempDir((temp) => {
    const backupDir = prepareSyntheticBackup(temp);
    const restoreTarget = join(temp, 'restore-test');
    mkdirSync(restoreTarget);
    writeFileSync(join(restoreTarget, 'sentinel'), 'preserve this unknown state');
    const fakeBin = fakeDockerBin(temp, composeBackupDockerStub());
    writeExecutable(join(fakeBin, 'systemctl'), '#!/bin/sh\ncase "$1" in is-active) exit 0;; stop) exit 0;; show) printf inactive;; *) exit 2;; esac\n');
    const script = restorePreflightBlock()
      .replaceAll('/var/lib/babypark-n8n/restore-test', restoreTarget)
      .replace('REPLACE_WITH_VERIFIED_GENERATION', backupDir);
    const result = runBash(script, { PATH: `${fakeBin}:${process.env.PATH}` });

    assert.notEqual(result.status, 0);
    assert.deepEqual(readdirSync(restoreTarget), ['sentinel']);
    assert.equal(readFileSync(join(restoreTarget, 'sentinel'), 'utf8'), 'preserve this unknown state');
  });
});

test('corrupt restore archive aborts before creating restore state', () => {
  withTempDir((temp) => {
    const backupDir = prepareSyntheticBackup(temp);
    const archive = join(backupDir, 'user-folder.tar.gz');
    writeFileSync(archive, Buffer.from('not a gzip tar archive'));
    const hashes = execFileSync('sha256sum', [join(backupDir, 'n8n.pgdump'), archive, join(backupDir, 'n8n.env')], { encoding: 'utf8' })
      .trim().split('\n').map(line => `${line.slice(0, 64)}  ${line.slice(line.indexOf('  ') + 2).split('/').at(-1)}`).join('\n') + '\n';
    writeFileSync(join(backupDir, 'SHA256SUMS'), hashes);
    const restoreTarget = join(temp, 'restore-test');
    const fakeBin = fakeDockerBin(temp, composeBackupDockerStub());
    writeExecutable(join(fakeBin, 'systemctl'), '#!/bin/sh\ncase "$1" in is-active) exit 0;; stop) exit 0;; show) printf inactive;; *) exit 2;; esac\n');
    const script = restorePreflightBlock()
      .replaceAll('/var/lib/babypark-n8n/restore-test', restoreTarget)
      .replace('REPLACE_WITH_VERIFIED_GENERATION', backupDir);
    const result = runBash(script, { PATH: `${fakeBin}:${process.env.PATH}` });

    assert.notEqual(result.status, 0);
    assert.equal(existsSync(restoreTarget), false);
    assert.doesNotMatch(result.stdout + result.stderr, /restore state created/);
  });
});

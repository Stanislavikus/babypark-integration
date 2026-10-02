import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import {
  canonicalKnowledgeJson,
  canonicalKnowledgeTimestamp,
} from './canonical.mjs';
import { KnowledgeStore } from './store.mjs';

const MANIFEST_SCHEMA = 'bp.knowledge.backup/1';
const ALGORITHM = 'aes-256-gcm';

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'KnowledgeBackupError';
  error.code = code;
  error.details = details;
  throw error;
}

function requireDirectory(value, name) {
  if (typeof value !== 'string' || value === '') throw new TypeError(`${name} is required`);
  const resolved = path.resolve(value);
  let stat;
  try { stat = fs.statSync(resolved); }
  catch { fail('KNOWLEDGE_BACKUP_DIRECTORY_MISSING', `${name} does not exist`, { path: resolved }); }
  if (!stat.isDirectory()) fail('KNOWLEDGE_BACKUP_DIRECTORY_INVALID', `${name} is not a directory`);
  return resolved;
}

function requireKey(value) {
  if (!Buffer.isBuffer(value) || value.length !== 32) {
    throw new TypeError('encryptionKey must be exactly 32 bytes');
  }
  return value;
}

function requireBackupId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new TypeError('backupId must be a safe filename token');
  }
  return value;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const size = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!size) break;
      hash.update(buffer.subarray(0, size));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function fsyncFile(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try { fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}

function writeExclusive(filePath, bytes) {
  const fd = fs.openSync(filePath, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(filePath, 0o600);
}

function normalizeBackupSqlite(filePath) {
  const db = new DatabaseSync(filePath);
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    const mode = String(
      db.prepare('PRAGMA journal_mode=DELETE').get()?.journal_mode ?? ''
    ).toLowerCase();
    if (mode !== 'delete') {
      fail('KNOWLEDGE_BACKUP_JOURNAL_INVALID', 'Backup journal mode is not DELETE', { mode });
    }
    const integrity = db.prepare('PRAGMA integrity_check').all()
      .map(row => Object.values(row)[0]);
    if (integrity.length !== 1 || integrity[0] !== 'ok') {
      fail('KNOWLEDGE_BACKUP_SQLITE_INTEGRITY', 'SQLite backup integrity check failed', { integrity });
    }
  } finally {
    db.close();
  }
  for (const suffix of ['-wal','-shm']) {
    const sidecar = filePath + suffix;
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  }
  fs.chmodSync(filePath, 0o600);
  fsyncFile(filePath);
}

function semanticSnapshot(filePath) {
  const store = KnowledgeStore.openExisting(filePath, { readOnly: true });
  try {
    const meta = store.metadata();
    const stats = store.stats();
    return Object.freeze({
      schema_version: Number(meta.schema_version),
      revisions: stats.revisions,
      events: stats.events,
      event_head_hash: stats.event_head_hash,
    });
  } finally {
    store.close();
  }
}

async function encryptFile(source, destination, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  await pipeline(
    fs.createReadStream(source),
    cipher,
    fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 })
  );
  const tag = cipher.getAuthTag();
  fs.chmodSync(destination, 0o600);
  fsyncFile(destination);
  return { iv, tag };
}

async function decryptFile(source, destination, key, iv, tag) {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      fs.createReadStream(source),
      decipher,
      fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 })
    );
  } catch {
    try { if (fs.existsSync(destination)) fs.unlinkSync(destination); } catch {}
    fail('KNOWLEDGE_BACKUP_DECRYPT_FAILED', 'Encrypted backup authentication/decryption failed');
  }
  fs.chmodSync(destination, 0o600);
  fsyncFile(destination);
}

function readManifest(manifestPath) {
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch { fail('KNOWLEDGE_BACKUP_MANIFEST_INVALID', 'Backup manifest is invalid JSON'); }
  if (
    manifest?.schema !== MANIFEST_SCHEMA ||
    manifest?.encryption?.algorithm !== ALGORITHM ||
    typeof manifest?.encryption?.iv_b64 !== 'string' ||
    typeof manifest?.encryption?.tag_b64 !== 'string' ||
    typeof manifest?.encrypted_sha256 !== 'string' ||
    typeof manifest?.plaintext_sha256 !== 'string' ||
    !manifest?.semantic
  ) {
    fail('KNOWLEDGE_BACKUP_MANIFEST_INVALID', 'Backup manifest fields are invalid');
  }
  return manifest;
}

function compareSemantic(expected, actual) {
  if (canonicalKnowledgeJson(expected) !== canonicalKnowledgeJson(actual)) {
    fail('KNOWLEDGE_BACKUP_SEMANTIC_MISMATCH', 'Restored semantic snapshot differs from manifest', {
      expected,
      actual,
    });
  }
}

export async function verifyKnowledgeBackupPackage({
  encryptedPath,
  manifestPath,
  encryptionKey,
  scratchDirectory,
  scratchId = crypto.randomUUID(),
}) {
  const key = requireKey(encryptionKey);
  const scratchDir = requireDirectory(scratchDirectory, 'scratchDirectory');
  const encrypted = path.resolve(encryptedPath);
  const manifestFile = path.resolve(manifestPath);
  if (!fs.existsSync(encrypted) || !fs.existsSync(manifestFile)) {
    fail('KNOWLEDGE_BACKUP_PACKAGE_MISSING', 'Encrypted artifact or manifest is missing');
  }

  const manifest = readManifest(manifestFile);
  const encryptedSha = sha256File(encrypted);
  if (encryptedSha !== manifest.encrypted_sha256) {
    fail('KNOWLEDGE_BACKUP_ENCRYPTED_HASH_MISMATCH', 'Encrypted artifact checksum mismatch');
  }

  const iv = Buffer.from(manifest.encryption.iv_b64, 'base64');
  const tag = Buffer.from(manifest.encryption.tag_b64, 'base64');
  if (iv.length !== 12 || tag.length !== 16) {
    fail('KNOWLEDGE_BACKUP_MANIFEST_INVALID', 'AES-GCM IV/tag length is invalid');
  }

  const scratch = path.join(scratchDir, `knowledge-restore-${scratchId}.sqlite`);
  if (fs.existsSync(scratch)) fail('KNOWLEDGE_BACKUP_SCRATCH_EXISTS', 'Scratch restore path already exists');
  try {
    await decryptFile(encrypted, scratch, key, iv, tag);
    const plainSha = sha256File(scratch);
    if (plainSha !== manifest.plaintext_sha256) {
      fail('KNOWLEDGE_BACKUP_PLAINTEXT_HASH_MISMATCH', 'Restored plaintext checksum mismatch');
    }
    const semantic = semanticSnapshot(scratch);
    compareSemantic(manifest.semantic, semantic);
    return Object.freeze({
      ok: true,
      encrypted_sha256: encryptedSha,
      plaintext_sha256: plainSha,
      semantic,
    });
  } finally {
    try { if (fs.existsSync(scratch)) fs.unlinkSync(scratch); } catch {}
  }
}

export async function createKnowledgeBackup({
  sourcePath,
  localDirectory,
  offHostDirectory,
  encryptionKey,
  now = () => new Date().toISOString(),
  backupId = crypto.randomUUID(),
}) {
  const key = requireKey(encryptionKey);
  const source = path.resolve(sourcePath);
  if (!fs.existsSync(source)) fail('KNOWLEDGE_BACKUP_SOURCE_MISSING', 'knowledge.sqlite is missing');
  const localDir = requireDirectory(localDirectory, 'localDirectory');
  const offHostDir = requireDirectory(offHostDirectory, 'offHostDirectory');
  if (localDir === offHostDir) {
    fail('KNOWLEDGE_BACKUP_OFFHOST_REQUIRED', 'Off-host destination must differ from local backup directory');
  }

  const createdAt = canonicalKnowledgeTimestamp(now(), 'backup created_at_utc');
  const safeId = requireBackupId(backupId);
  const safeStamp = createdAt.replace(/[^0-9A-Za-z]/g, '');
  const base = `knowledge-${safeStamp}-${safeId}`;
  const plain = path.join(localDir, `.${base}.sqlite.tmp`);
  const encrypted = path.join(localDir, `${base}.sqlite.enc`);
  const manifestPath = path.join(localDir, `${base}.manifest.json`);
  const offEncrypted = path.join(offHostDir, path.basename(encrypted));
  const offManifest = path.join(offHostDir, path.basename(manifestPath));
  const created = [];

  for (const file of [plain, encrypted, manifestPath, offEncrypted, offManifest]) {
    if (fs.existsSync(file)) fail('KNOWLEDGE_BACKUP_DESTINATION_EXISTS', 'Backup destination already exists', { path: file });
  }

  let sourceDb;
  try {
    sourceDb = new DatabaseSync(source, { readOnly: true });
    await sqliteBackup(sourceDb, plain);
    created.push(plain);
    normalizeBackupSqlite(plain);

    const semantic = semanticSnapshot(plain);
    const plaintextSha = sha256File(plain);
    const plaintextBytes = fs.statSync(plain).size;

    const encryptedMeta = await encryptFile(plain, encrypted, key);
    created.push(encrypted);
    const encryptedSha = sha256File(encrypted);
    const encryptedBytes = fs.statSync(encrypted).size;

    const manifest = {
      schema: MANIFEST_SCHEMA,
      created_at_utc: createdAt,
      source_basename: path.basename(source),
      plaintext_sha256: plaintextSha,
      plaintext_bytes: plaintextBytes,
      encrypted_sha256: encryptedSha,
      encrypted_bytes: encryptedBytes,
      encryption: {
        algorithm: ALGORITHM,
        iv_b64: encryptedMeta.iv.toString('base64'),
        tag_b64: encryptedMeta.tag.toString('base64'),
      },
      semantic,
    };
    writeExclusive(manifestPath, canonicalKnowledgeJson(manifest));
    created.push(manifestPath);

    fs.copyFileSync(encrypted, offEncrypted, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(offEncrypted, 0o600);
    fsyncFile(offEncrypted);
    created.push(offEncrypted);

    fs.copyFileSync(manifestPath, offManifest, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(offManifest, 0o600);
    fsyncFile(offManifest);
    created.push(offManifest);

    if (sha256File(offEncrypted) !== encryptedSha ||
        fs.readFileSync(offManifest, 'utf8') !== fs.readFileSync(manifestPath, 'utf8')) {
      fail('KNOWLEDGE_BACKUP_OFFHOST_COPY_MISMATCH', 'Off-host copy verification failed');
    }

    const restore = await verifyKnowledgeBackupPackage({
      encryptedPath: offEncrypted,
      manifestPath: offManifest,
      encryptionKey: key,
      scratchDirectory: localDir,
      scratchId: `${safeId}-proof`,
    });

    fs.unlinkSync(plain);
    return Object.freeze({
      ok: true,
      local: Object.freeze({
        encrypted_path: encrypted,
        manifest_path: manifestPath,
      }),
      off_host: Object.freeze({
        encrypted_path: offEncrypted,
        manifest_path: offManifest,
      }),
      manifest: Object.freeze(manifest),
      restore_proof: restore,
    });
  } catch (error) {
    for (const file of created.reverse()) {
      try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
    }
    throw error;
  } finally {
    try { if (sourceDb) sourceDb.close(); } catch {}
    try { if (fs.existsSync(plain)) fs.unlinkSync(plain); } catch {}
  }
}

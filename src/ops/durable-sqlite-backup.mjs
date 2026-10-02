import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';

export const DURABLE_SQLITE_BACKUP_SCHEMA = 'bp.durable-sqlite-backup/1';

export class DurableBackupError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DurableBackupError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new DurableBackupError(code, message, details);
}

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError('manifest numbers must be safe integers');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort((a,b) =>
      Buffer.compare(Buffer.from(a), Buffer.from(b))
    )) out[key] = canonical(value[key]);
    return out;
  }
  throw new TypeError('manifest contains unsupported value');
}

export function canonicalBackupJson(value) {
  return JSON.stringify(canonical(value));
}

export function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
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
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function fsyncDir(dirPath) {
  const fd = fs.openSync(dirPath, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function requireUnused(filePath) {
  if (fs.existsSync(filePath)) {
    fail('BACKUP_DESTINATION_EXISTS', 'Backup destination already exists', { path: filePath });
  }
}

function parseKey(masterKey) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new TypeError('masterKey must be exactly 32 bytes');
  }
  return masterKey;
}

function deriveManifestKey(masterKey) {
  return Buffer.from(crypto.hkdfSync(
    'sha256',
    masterKey,
    Buffer.from('bp-durable-sqlite-backup-v1'),
    Buffer.from('manifest-hmac'),
    32
  ));
}

function manifestHmac(masterKey, unsigned) {
  return crypto.createHmac('sha256', deriveManifestKey(masterKey))
    .update(canonicalBackupJson(unsigned))
    .digest('hex');
}

function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' ||
      !/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

function validateSqlite(filePath) {
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all()
      .map(row => Object.values(row)[0]);
    if (integrity.length !== 1 || integrity[0] !== 'ok') {
      fail('BACKUP_SQLITE_INTEGRITY_FAILED', 'SQLite integrity check failed', { integrity });
    }
    return Object.freeze({
      integrity: 'ok',
      user_version: Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0),
    });
  } finally {
    db.close();
  }
}

function normalizeSqlite(filePath) {
  const db = new DatabaseSync(filePath);
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    const mode = String(db.prepare('PRAGMA journal_mode=DELETE').get()?.journal_mode ?? '').toLowerCase();
    if (mode !== 'delete') fail('BACKUP_JOURNAL_MODE_FAILED', 'Backup could not normalize to DELETE journal mode', { mode });
  } finally {
    db.close();
  }
  for (const suffix of ['-wal','-shm']) {
    try { fs.rmSync(filePath + suffix, { force: true }); } catch {}
  }
  fs.chmodSync(filePath, 0o600);
  fsyncFile(filePath);
}

export async function createEncryptedSqliteBackup({
  sourcePath,
  artifactPath,
  manifestPath,
  masterKey,
  keyId,
  semanticEvidence,
  createdAtUtc = new Date().toISOString(),
}) {
  parseKey(masterKey);
  if (typeof keyId !== 'string' || keyId.trim() === '') throw new TypeError('keyId is required');
  const source = path.resolve(sourcePath);
  const artifact = path.resolve(artifactPath);
  const manifestFile = path.resolve(manifestPath);
  if (!fs.existsSync(source)) fail('BACKUP_SOURCE_MISSING', 'Backup source is missing');
  requireUnused(artifact);
  requireUnused(manifestFile);
  const artifactDir = path.dirname(artifact);
  const manifestDir = path.dirname(manifestFile);
  if (!fs.statSync(artifactDir).isDirectory() || !fs.statSync(manifestDir).isDirectory()) {
    fail('BACKUP_PARENT_INVALID', 'Backup destination parent must exist');
  }

  const tmpPlain = path.join(
    artifactDir,
    `.tmp-${path.basename(artifact)}.${process.pid}.${crypto.randomUUID()}.sqlite`
  );
  let sourceDb;
  try {
    sourceDb = new DatabaseSync(source, { readOnly: true });
    await sqliteBackup(sourceDb, tmpPlain);
    normalizeSqlite(tmpPlain);
    const sqlite = validateSqlite(tmpPlain);
    const plaintext = fs.readFileSync(tmpPlain);
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    const afd = fs.openSync(artifact, 'wx', 0o600);
    try {
      fs.writeFileSync(afd, ciphertext);
      fs.fsyncSync(afd);
    } finally { fs.closeSync(afd); }
    fs.chmodSync(artifact, 0o600);

    const unsigned = {
      schema: DURABLE_SQLITE_BACKUP_SCHEMA,
      created_at_utc: new Date(createdAtUtc).toISOString(),
      cipher: 'AES-256-GCM',
      key_id: keyId,
      nonce_b64: nonce.toString('base64'),
      auth_tag_b64: tag.toString('base64'),
      artifact_filename: path.basename(artifact),
      artifact_bytes: fs.statSync(artifact).size,
      artifact_sha256: sha256File(artifact),
      plaintext_bytes: plaintext.length,
      plaintext_sha256: sha256Buffer(plaintext),
      sqlite_user_version: sqlite.user_version,
      sqlite_integrity: sqlite.integrity,
      semantic_evidence: semanticEvidence,
    };
    const signed = {
      ...unsigned,
      manifest_hmac_sha256: manifestHmac(masterKey, unsigned),
    };
    const mfd = fs.openSync(manifestFile, 'wx', 0o600);
    try {
      fs.writeFileSync(mfd, canonicalBackupJson(signed) + '\n');
      fs.fsyncSync(mfd);
    } finally { fs.closeSync(mfd); }
    fs.chmodSync(manifestFile, 0o600);
    fsyncDir(artifactDir);
    if (manifestDir !== artifactDir) fsyncDir(manifestDir);

    return Object.freeze({
      artifact,
      manifest: manifestFile,
      artifact_sha256: unsigned.artifact_sha256,
      plaintext_sha256: unsigned.plaintext_sha256,
      bytes: unsigned.artifact_bytes,
      key_id: keyId,
    });
  } catch (error) {
    try { fs.rmSync(artifact, { force: true }); } catch {}
    try { fs.rmSync(manifestFile, { force: true }); } catch {}
    throw error;
  } finally {
    if (sourceDb) sourceDb.close();
    try { fs.rmSync(tmpPlain, { force: true }); } catch {}
  }
}

export async function verifyAndRestoreEncryptedSqliteBackup({
  artifactPath,
  manifestPath,
  scratchPath,
  masterKey,
  expectedKeyId = null,
  semanticVerifier = null,
}) {
  parseKey(masterKey);
  const artifact = path.resolve(artifactPath);
  const manifestFile = path.resolve(manifestPath);
  const scratch = path.resolve(scratchPath);
  requireUnused(scratch);
  let signed;
  try { signed = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); }
  catch { fail('BACKUP_MANIFEST_INVALID', 'Backup manifest is invalid JSON'); }
  if (signed.schema !== DURABLE_SQLITE_BACKUP_SCHEMA) {
    fail('BACKUP_MANIFEST_SCHEMA_INVALID', 'Backup manifest schema is unsupported');
  }
  const { manifest_hmac_sha256: suppliedHmac, ...unsigned } = signed;
  const expectedHmac = manifestHmac(masterKey, unsigned);
  if (!safeEqualHex(suppliedHmac, expectedHmac)) {
    fail('BACKUP_MANIFEST_HMAC_INVALID', 'Backup manifest HMAC is invalid');
  }
  if (expectedKeyId !== null && signed.key_id !== expectedKeyId) {
    fail('BACKUP_KEY_ID_MISMATCH', 'Backup key id does not match expected key');
  }
  const ciphertext = fs.readFileSync(artifact);
  if (ciphertext.length !== signed.artifact_bytes ||
      sha256Buffer(ciphertext) !== signed.artifact_sha256) {
    fail('BACKUP_ARTIFACT_CHECKSUM_INVALID', 'Encrypted artifact checksum/size mismatch');
  }

  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      masterKey,
      Buffer.from(signed.nonce_b64, 'base64')
    );
    decipher.setAuthTag(Buffer.from(signed.auth_tag_b64, 'base64'));
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (plaintext.length !== signed.plaintext_bytes ||
        sha256Buffer(plaintext) !== signed.plaintext_sha256) {
      fail('BACKUP_PLAINTEXT_CHECKSUM_INVALID', 'Decrypted SQLite checksum/size mismatch');
    }
    const sfd = fs.openSync(scratch, 'wx', 0o600);
    try {
      fs.writeFileSync(sfd, plaintext);
      fs.fsyncSync(sfd);
    } finally { fs.closeSync(sfd); }
    fs.chmodSync(scratch, 0o600);
    const sqlite = validateSqlite(scratch);
    if (sqlite.user_version !== signed.sqlite_user_version) {
      fail('BACKUP_SQLITE_VERSION_MISMATCH', 'Restored SQLite user_version mismatch');
    }
    let semantic = null;
    if (semanticVerifier) {
      semantic = await semanticVerifier(scratch, signed.semantic_evidence);
    }
    return Object.freeze({
      ok: true,
      scratch,
      artifact_sha256: signed.artifact_sha256,
      plaintext_sha256: signed.plaintext_sha256,
      sqlite_integrity: sqlite.integrity,
      sqlite_user_version: sqlite.user_version,
      semantic,
      manifest: Object.freeze(signed),
    });
  } catch (error) {
    try { fs.rmSync(scratch, { force: true }); } catch {}
    throw error;
  }
}

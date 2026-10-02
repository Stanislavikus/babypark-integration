const MAX_PHRASE_CODE_UNITS = 160;

export const VOCABULARY_BINDINGS = Object.freeze({
  'vocabulary.category': Object.freeze({
    effect_family: 'vocabulary.category_resolution',
    effect_type: 'CATEGORY_BINDING',
    target_key: 'canonical_category_id',
  }),
  'vocabulary.brand': Object.freeze({
    effect_family: 'vocabulary.brand_resolution',
    effect_type: 'BRAND_BINDING',
    target_key: 'canonical_brand_id',
  }),
  'vocabulary.store': Object.freeze({
    effect_family: 'vocabulary.store_resolution',
    effect_type: 'STORE_BINDING',
    target_key: 'canonical_store_id',
  }),
});

export const CATEGORY_MATCH_MODES = Object.freeze([
  'NODE_ONLY',
  'INCLUDE_DESCENDANTS',
]);

const CATEGORY_MODES = new Set(CATEGORY_MATCH_MODES);

export class VocabularyAuthorityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'VocabularyAuthorityError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new VocabularyAuthorityError(code, message, details);
}

function text(name, value) {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.includes('\0')
  ) {
    throw new TypeError(`${name} must be non-empty text`);
  }
  return value;
}

function canonicalId(name, value) {
  const id = text(name, value);
  if (
    id !== id.trim() ||
    id.length > 256 ||
    /[\u0000-\u001f\u007f]/u.test(id)
  ) {
    fail(
      'VOCABULARY_CANONICAL_ID_INVALID',
      `${name} must be a bounded canonical ID without outer whitespace`
    );
  }
  return id;
}

function object(name, value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${name} must be a JSON object`);
  }
  return value;
}

function exactKeys(name, value, expected) {
  const actual = Object.keys(object(name, value)).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(
      'VOCABULARY_SCHEMA_INVALID',
      `${name} must contain exactly: ${wanted.join(', ')}`,
      { actual, expected: wanted }
    );
  }
}

export function normalizeVocabularyPhrase(raw) {
  text('phrase', raw);
  const normalized = raw
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();

  if (
    normalized === '' ||
    normalized.length > MAX_PHRASE_CODE_UNITS ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    fail(
      'VOCABULARY_PHRASE_INVALID',
      'Vocabulary phrase is empty, too long, or contains controls'
    );
  }
  return normalized;
}

function revisionJson(revision, field) {
  if (revision[field] !== undefined) return revision[field];
  const alias = field === 'scope_json' ? 'scope' : 'effect_value';
  return revision[alias];
}

export function validateVocabularyRevision(revision) {
  if (!revision || typeof revision !== 'object' || Array.isArray(revision)) {
    throw new TypeError('revision must be an object');
  }
  if (revision.record_type !== 'VOCABULARY_ENTRY') {
    throw new TypeError('Vocabulary validator requires VOCABULARY_ENTRY');
  }
  if (revision.schema_version !== 1) {
    fail(
      'VOCABULARY_SCHEMA_VERSION_UNSUPPORTED',
      'Vocabulary entry schema_version must be 1'
    );
  }

  const contract = VOCABULARY_BINDINGS[revision.namespace];
  if (!contract) {
    fail(
      'VOCABULARY_NAMESPACE_UNSUPPORTED',
      'Vocabulary namespace is not supported',
      { namespace: revision.namespace }
    );
  }
  if (
    revision.effect_family !== contract.effect_family ||
    revision.effect_type !== contract.effect_type
  ) {
    fail(
      'VOCABULARY_SCHEMA_INVALID',
      'Vocabulary effect family/type does not match namespace',
      {
        namespace: revision.namespace,
        effect_family: revision.effect_family,
        effect_type: revision.effect_type,
      }
    );
  }
  if (revision.subject_type !== 'phrase') {
    fail(
      'VOCABULARY_SCHEMA_INVALID',
      'Vocabulary subject_type must be phrase'
    );
  }

  const phrase = normalizeVocabularyPhrase(revision.subject_id);
  if (phrase !== revision.subject_id) {
    fail(
      'VOCABULARY_PHRASE_NOT_CANONICAL',
      'Vocabulary subject_id must already be normalized',
      { normalized_phrase: phrase }
    );
  }

  const scope = revisionJson(revision, 'scope_json');
  exactKeys('Vocabulary scope', scope, []);

  const effect = revisionJson(revision, 'effect_value_json');
  const expected = revision.namespace === 'vocabulary.category'
    ? [contract.target_key, 'match_mode']
    : [contract.target_key];
  exactKeys('Vocabulary effect_value', effect, expected);
  canonicalId(
    `effect_value.${contract.target_key}`,
    effect[contract.target_key]
  );

  if (
    revision.namespace === 'vocabulary.category' &&
    !CATEGORY_MODES.has(effect.match_mode)
  ) {
    fail(
      'VOCABULARY_CATEGORY_MATCH_MODE_INVALID',
      'Category vocabulary match_mode must be explicit',
      { match_mode: effect.match_mode }
    );
  }

  return Object.freeze({
    namespace: revision.namespace,
    phrase,
    effect_family: contract.effect_family,
    effect_type: contract.effect_type,
    target_key: contract.target_key,
    target_id: effect[contract.target_key],
    match_mode: effect.match_mode ?? null,
  });
}

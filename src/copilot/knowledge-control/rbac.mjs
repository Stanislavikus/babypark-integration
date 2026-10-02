export const KNOWLEDGE_ROLES = Object.freeze([
  'VIEWER',
  'OPERATIONAL_EDITOR',
  'COMMERCE_DRAFTER',
  'COMMERCE_APPROVER',
  'KNOWLEDGE_ADMIN',
]);

export const KNOWLEDGE_ACTIONS = Object.freeze([
  'VIEW',
  'RESOLVE',
  'DRAFT_CREATE',
  'APPROVE',
  'PUBLISH',
  'WITHDRAW',
  'REVOKE',
  'SUPERSEDE',
]);

const ROLE_SET = new Set(KNOWLEDGE_ROLES);
const ACTION_SET = new Set(KNOWLEDGE_ACTIONS);
const DIRECT_TEMPORARY = new Set([
  'store.status_override',
  'store.special_hours',
  'store.temporary_closure',
]);

export class KnowledgeAuthorizationError extends Error {
  constructor(code, message, status = 403, details = {}) {
    super(message);
    this.name = 'KnowledgeAuthorizationError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new KnowledgeAuthorizationError(code, message, 403, details);
}

function matchScope(expected, actual) {
  return expected === '*' || expected === actual;
}

function normalizeGrant(grant) {
  if (!grant || typeof grant !== 'object' || Array.isArray(grant)) {
    throw new TypeError('grant must be an object');
  }
  if (!ROLE_SET.has(grant.role)) throw new TypeError('grant.role is invalid');
  if (!Array.isArray(grant.actions) || grant.actions.length === 0 ||
      grant.actions.some(action => !ACTION_SET.has(action))) {
    throw new TypeError('grant.actions are invalid');
  }
  for (const key of ['namespace','subject_type','subject_id']) {
    if (typeof grant[key] !== 'string' || grant[key] === '') {
      throw new TypeError(`grant.${key} is required`);
    }
  }
  return Object.freeze({
    role: grant.role,
    actions: Object.freeze([...new Set(grant.actions)]),
    namespace: grant.namespace,
    subject_type: grant.subject_type,
    subject_id: grant.subject_id,
  });
}

export function normalizeActorGrants(grants) {
  if (!Array.isArray(grants)) throw new TypeError('grants must be an array');
  return Object.freeze(grants.map(normalizeGrant));
}

export function authorizeKnowledgeAction({
  actorId,
  grants,
  action,
  namespace,
  subjectType,
  subjectId,
  requireRole = null,
}) {
  if (typeof actorId !== 'string' || actorId.trim() === '') {
    throw new TypeError('actorId is required');
  }
  if (!ACTION_SET.has(action)) throw new TypeError('action is invalid');
  for (const [name,value] of [
    ['namespace', namespace],
    ['subjectType', subjectType],
    ['subjectId', subjectId],
  ]) {
    if (typeof value !== 'string' || value === '') {
      throw new TypeError(`${name} is required`);
    }
  }
  if (requireRole !== null && !ROLE_SET.has(requireRole)) {
    throw new TypeError('requireRole is invalid');
  }

  const normalized = normalizeActorGrants(grants);
  const matching = normalized.filter(grant =>
    grant.actions.includes(action) &&
    matchScope(grant.namespace, namespace) &&
    matchScope(grant.subject_type, subjectType) &&
    matchScope(grant.subject_id, subjectId) &&
    (requireRole === null || grant.role === requireRole)
  );
  if (matching.length === 0) {
    fail('KNOWLEDGE_FORBIDDEN', 'No BabyPark grant authorizes this action', {
      actor_id: actorId,
      action,
      namespace,
      subject_type: subjectType,
      subject_id: subjectId,
      required_role: requireRole,
    });
  }
  return Object.freeze({
    actor_id: actorId,
    action,
    grants: Object.freeze(matching),
  });
}

export function authorizeRevisionAction({
  actorId,
  grants,
  action,
  revision,
}) {
  if (!revision) fail('KNOWLEDGE_REVISION_NOT_FOUND', 'Revision does not exist');
  let requireRole = null;
  if (action === 'PUBLISH' && DIRECT_TEMPORARY.has(revision.namespace)) {
    requireRole = 'OPERATIONAL_EDITOR';
  }
  return authorizeKnowledgeAction({
    actorId,
    grants,
    action,
    namespace: revision.namespace,
    subjectType: revision.subject_type,
    subjectId: revision.subject_id,
    requireRole,
  });
}

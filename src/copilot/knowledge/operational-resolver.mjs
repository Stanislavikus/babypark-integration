import {
  canonicalKnowledgeJson,
  canonicalKnowledgeTimestamp,
} from './canonical.mjs';

const KYIV = 'Europe/Kyiv';
const WEEKDAYS = new Set([
  'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
]);

const localFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: KYIV,
  weekday: 'long',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export class OperationalKnowledgeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'OperationalKnowledgeError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new OperationalKnowledgeError(code, message, details);
}

function text(name, value) {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) {
    throw new TypeError(`${name} must be non-empty text`);
  }
  return value;
}

function activeAt(row, nowMs) {
  if (row.state !== 'PUBLISHED') return false;
  const from = Date.parse(row.effective_from_utc);
  const until = row.expires_at_utc === null ? null : Date.parse(row.expires_at_utc);
  return from <= nowMs && (until === null || nowMs < until);
}

function localClock(nowUtc) {
  const parts = {};
  for (const part of localFormatter.formatToParts(new Date(nowUtc))) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return {
    weekday: parts.weekday.toLowerCase(),
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function minuteOfDay(value, name) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    fail('OPERATIONAL_HOURS_INVALID', `${name} must be HH:MM`, { value });
  }
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function normalizeIntervals(value, name) {
  if (!Array.isArray(value)) {
    fail('OPERATIONAL_HOURS_INVALID', `${name} must be an array`);
  }
  const normalized = value.map((interval, index) => {
    if (!interval || typeof interval !== 'object' || Array.isArray(interval)) {
      fail('OPERATIONAL_HOURS_INVALID', `${name}[${index}] must be an object`);
    }
    const open = minuteOfDay(interval.open, `${name}[${index}].open`);
    const close = minuteOfDay(interval.close, `${name}[${index}].close`);
    if (open >= close) {
      fail(
        'OPERATIONAL_HOURS_INVALID',
        'Opening interval must close after it opens within the same civil day',
        { index, open: interval.open, close: interval.close }
      );
    }
    return Object.freeze({
      open: interval.open,
      close: interval.close,
      open_minute: open,
      close_minute: close,
    });
  });
  normalized.sort((a, b) => a.open_minute - b.open_minute || a.close_minute - b.close_minute);
  for (let i = 1; i < normalized.length; i++) {
    if (normalized[i].open_minute < normalized[i - 1].close_minute) {
      fail('OPERATIONAL_HOURS_INVALID', 'Opening intervals must not overlap');
    }
  }
  return Object.freeze(normalized);
}

function stateFromRow(row) {
  const status = row.effect_value?.status;
  if (status === 'OPEN' || status === 'CLOSED') return status;
  if (row.effect_type === 'CLOSED' && row.effect_value?.closed === true) {
    return 'CLOSED';
  }
  fail(
    'OPERATIONAL_STATE_INVALID',
    'Operating-state authority must resolve to OPEN or CLOSED',
    { revision_id: row.revision_id, namespace: row.namespace }
  );
}

function distinctOrConflict(rows, canonicalizer, effectFamily) {
  const groups = new Map();
  for (const row of rows) {
    const key = canonicalizer(row);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  if (groups.size > 1) {
    return {
      conflict: Object.freeze({
        status: 'POLICY_CONFLICT',
        effect_family: effectFamily,
        revisions: Object.freeze(rows.map(row => row.revision_id).sort()),
      }),
      rows: null,
    };
  }
  return { conflict: null, rows };
}

function evaluateIntervals(intervals, clock) {
  const current = clock.hour * 60 + clock.minute + clock.second / 60;
  for (const interval of intervals) {
    if (current >= interval.open_minute && current < interval.close_minute) {
      return Object.freeze({
        open: true,
        closes_at_local: interval.close,
      });
    }
  }
  return Object.freeze({ open: false, closes_at_local: null });
}

export function resolveStoreOperationalState(store, {
  nowUtc,
  storeId,
}) {
  if (!store || typeof store.authoritySnapshot !== 'function') {
    throw new TypeError('store must provide authoritySnapshot()');
  }
  const now = canonicalKnowledgeTimestamp(nowUtc, 'nowUtc');
  text('storeId', storeId);
  const nowMs = Date.parse(now);
  const clock = localClock(now);
  const active = store.authoritySnapshot().filter(row =>
    row.subject_type === 'store' &&
    row.subject_id === storeId &&
    activeAt(row, nowMs)
  );

  const stateOverlays = active.filter(row =>
    row.namespace === 'store.temporary_closure' ||
    row.namespace === 'store.status_override'
  );
  if (stateOverlays.length) {
    const check = distinctOrConflict(
      stateOverlays,
      row => stateFromRow(row),
      'store.operating_state'
    );
    if (check.conflict) return check.conflict;
    const state = stateFromRow(stateOverlays[0]);
    if (state === 'CLOSED') {
      return Object.freeze({
        status: 'RESOLVED',
        open: false,
        source: 'OPERATING_STATE_OVERLAY',
        revision_ids: Object.freeze(stateOverlays.map(row => row.revision_id).sort()),
        local_date: clock.date,
        local_time: `${String(clock.hour).padStart(2,'0')}:${String(clock.minute).padStart(2,'0')}`,
        closes_at_local: null,
      });
    }
  } else {
    const baselineStates = active.filter(row => row.namespace === 'store.baseline_status');
    if (baselineStates.length) {
      const check = distinctOrConflict(
        baselineStates,
        row => stateFromRow(row),
        'store.operating_state'
      );
      if (check.conflict) return check.conflict;
      if (stateFromRow(baselineStates[0]) === 'CLOSED') {
        return Object.freeze({
          status: 'RESOLVED',
          open: false,
          source: 'BASELINE_STATUS',
          revision_ids: Object.freeze(baselineStates.map(row => row.revision_id).sort()),
          local_date: clock.date,
          local_time: `${String(clock.hour).padStart(2,'0')}:${String(clock.minute).padStart(2,'0')}`,
          closes_at_local: null,
        });
      }
    }
  }

  const specials = active.filter(row => row.namespace === 'store.special_hours');
  if (specials.length) {
    const check = distinctOrConflict(
      specials,
      row => canonicalKnowledgeJson(row.effect_value),
      'store.hours'
    );
    if (check.conflict) return check.conflict;
    const intervals = normalizeIntervals(
      specials[0].effect_value?.intervals,
      'store.special_hours.intervals'
    );
    const evaluated = evaluateIntervals(intervals, clock);
    return Object.freeze({
      status: 'RESOLVED',
      open: evaluated.open,
      source: 'SPECIAL_HOURS',
      revision_ids: Object.freeze(specials.map(row => row.revision_id).sort()),
      local_date: clock.date,
      local_time: `${String(clock.hour).padStart(2,'0')}:${String(clock.minute).padStart(2,'0')}`,
      closes_at_local: evaluated.closes_at_local,
    });
  }

  const baselines = active.filter(row => row.namespace === 'store.weekly_hours');
  if (!baselines.length) {
    return Object.freeze({
      status: 'POLICY_NOT_FOUND',
      effect_family: 'store.hours',
      revisions: Object.freeze([]),
    });
  }
  const check = distinctOrConflict(
    baselines,
    row => canonicalKnowledgeJson(row.effect_value),
    'store.hours'
  );
  if (check.conflict) return check.conflict;

  const weekly = baselines[0].effect_value;
  if (!weekly || typeof weekly !== 'object' || Array.isArray(weekly)) {
    fail('OPERATIONAL_HOURS_INVALID', 'store.weekly_hours effect must be an object');
  }
  for (const key of Object.keys(weekly)) {
    if (!WEEKDAYS.has(key)) {
      fail('OPERATIONAL_HOURS_INVALID', 'Unknown weekly-hours weekday', { weekday: key });
    }
  }
  if (!(clock.weekday in weekly)) {
    fail(
      'OPERATIONAL_HOURS_INCOMPLETE',
      'Weekly-hours baseline does not define the current weekday',
      { weekday: clock.weekday }
    );
  }
  const intervals = normalizeIntervals(
    weekly[clock.weekday],
    `store.weekly_hours.${clock.weekday}`
  );
  const evaluated = evaluateIntervals(intervals, clock);
  return Object.freeze({
    status: 'RESOLVED',
    open: evaluated.open,
    source: 'WEEKLY_HOURS',
    revision_ids: Object.freeze(baselines.map(row => row.revision_id).sort()),
    local_date: clock.date,
    local_time: `${String(clock.hour).padStart(2,'0')}:${String(clock.minute).padStart(2,'0')}`,
    closes_at_local: evaluated.closes_at_local,
  });
}

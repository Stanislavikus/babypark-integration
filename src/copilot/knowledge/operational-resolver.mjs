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


const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: KYIV,
  timeZoneName: 'longOffset',
  hour: '2-digit',
  hourCycle: 'h23',
});

function offsetAt(value) {
  const part = offsetFormatter.formatToParts(new Date(value))
    .find(item => item.type === 'timeZoneName')?.value ?? '';
  const match = part.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  if (!match) {
    fail('OPERATIONAL_HOURS_DST_UNREPRESENTABLE',
      'Unable to resolve Europe/Kyiv UTC offset');
  }
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return (match[1] === '-' ? -1 : 1) * minutes;
}

function ensureStableLocalDay(now, localDate) {
  const center = Date.parse(now);
  const offsets = new Set();
  for (let delta = -18 * 60; delta <= 30 * 60; delta += 30) {
    const instant = center + delta * 60_000;
    if (localClock(instant).date === localDate) offsets.add(offsetAt(instant));
  }
  if (offsets.size !== 1) {
    fail('OPERATIONAL_HOURS_DST_UNREPRESENTABLE',
      'Today schedule crosses a Europe/Kyiv offset transition',
      { local_date: localDate, offsets: [...offsets] });
  }
}

function localMinuteBoundary(value, localDate, edge) {
  const point = localClock(value);
  if (point.date < localDate) return edge === 'start' ? 0 : null;
  if (point.date > localDate) return edge === 'start' ? null : 1440;
  if (point.second !== 0) {
    fail('OPERATIONAL_HOURS_BOUNDARY_UNREPRESENTABLE',
      'Operating-state boundary must align to a local minute',
      { boundary: value, local_date: localDate });
  }
  return point.hour * 60 + point.minute;
}

function sameDayRange(row, localDate) {
  const start = localMinuteBoundary(row.effective_from_utc, localDate, 'start');
  const end = row.expires_at_utc === null
    ? 1440
    : localMinuteBoundary(row.expires_at_utc, localDate, 'end');
  if (start === null || end === null || end <= start) return null;
  return Object.freeze({ start, end });
}

function intervalsToMask(intervals) {
  const mask = new Uint8Array(1440);
  for (const interval of intervals) {
    for (let minute = interval.open_minute; minute < interval.close_minute; minute += 1) {
      mask[minute] = 1;
    }
  }
  return mask;
}

function maskToIntervals(mask) {
  const out = [];
  let start = null;
  for (let minute = 0; minute <= 1440; minute += 1) {
    const open = minute < 1440 && mask[minute] === 1;
    if (open && start === null) start = minute;
    if (!open && start !== null) {
      const hhmm = value =>
        `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
      out.push(Object.freeze({ open: hhmm(start), close: hhmm(minute) }));
      start = null;
    }
  }
  return Object.freeze(out);
}

function publishedStoreRows(store, storeId) {
  return store.authoritySnapshot().filter(row =>
    row.subject_type === 'store' &&
    row.subject_id === storeId &&
    row.state === 'PUBLISHED'
  );
}

export function resolveStoreTodaySchedule(store, {
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
  ensureStableLocalDay(now, clock.date);

  const rows = publishedStoreRows(store, storeId);
  const active = rows.filter(row => activeAt(row, nowMs));
  const specials = active.filter(row => row.namespace === 'store.special_hours');
  const baselines = active.filter(row => row.namespace === 'store.weekly_hours');

  let baseRows;
  let baseIntervals;
  let source;
  if (specials.length) {
    const check = distinctOrConflict(
      specials,
      row => canonicalKnowledgeJson(row.effect_value),
      'store.hours'
    );
    if (check.conflict) return check.conflict;
    baseRows = specials;
    baseIntervals = normalizeIntervals(
      specials[0].effect_value?.intervals,
      'store.special_hours.intervals'
    );
    source = 'SPECIAL_HOURS';
  } else {
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
      fail('OPERATIONAL_HOURS_INVALID',
        'store.weekly_hours effect must be an object');
    }
    for (const key of Object.keys(weekly)) {
      if (!WEEKDAYS.has(key)) {
        fail('OPERATIONAL_HOURS_INVALID',
          'Unknown weekly-hours weekday', { weekday: key });
      }
    }
    if (!(clock.weekday in weekly)) {
      fail('OPERATIONAL_HOURS_INCOMPLETE',
        'Weekly-hours baseline does not define the current weekday',
        { weekday: clock.weekday });
    }
    baseRows = baselines;
    baseIntervals = normalizeIntervals(
      weekly[clock.weekday],
      `store.weekly_hours.${clock.weekday}`
    );
    source = 'WEEKLY_HOURS';
  }

  const mask = intervalsToMask(baseIntervals);
  const nowMinute = clock.hour * 60 + clock.minute;
  const overlays = rows.filter(row =>
    row.namespace === 'store.temporary_closure' ||
    row.namespace === 'store.status_override'
  );
  const baselineStates = rows.filter(row =>
    row.namespace === 'store.baseline_status'
  );
  const contributing = new Set(baseRows.map(row => row.revision_id));

  for (let minute = nowMinute; minute < 1440; minute += 1) {
    const overlayStates = [];
    const baselineStateValues = [];

    for (const row of overlays) {
      const range = sameDayRange(row, clock.date);
      if (range && minute >= range.start && minute < range.end) {
        overlayStates.push({ row, state: stateFromRow(row) });
      }
    }
    for (const row of baselineStates) {
      const range = sameDayRange(row, clock.date);
      if (range && minute >= range.start && minute < range.end) {
        baselineStateValues.push({ row, state: stateFromRow(row) });
      }
    }

    const selected = overlayStates.length ? overlayStates : baselineStateValues;
    if (!selected.length) continue;
    const states = new Set(selected.map(item => item.state));
    if (states.size > 1) {
      return Object.freeze({
        status: 'POLICY_CONFLICT',
        effect_family: 'store.operating_state',
        revisions: Object.freeze(
          selected.map(item => item.row.revision_id).sort()
        ),
      });
    }
    for (const item of selected) contributing.add(item.row.revision_id);
    if (selected[0].state === 'CLOSED') mask[minute] = 0;
  }

  const intervals = maskToIntervals(mask);
  const current = clock.hour * 60 + clock.minute + clock.second / 60;
  const openNow = baseIntervals.some(interval =>
    current >= interval.open_minute && current < interval.close_minute
  ) && mask[Math.min(1439, Math.floor(current))] === 1;

  return Object.freeze({
    status: 'RESOLVED',
    open_now: openNow,
    intervals,
    source,
    revision_ids: Object.freeze([...contributing].sort()),
  });
}

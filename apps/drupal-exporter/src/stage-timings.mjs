import { performance } from 'node:perf_hooks';

function msSince(start) {
  return Math.round((performance.now() - start) * 1000) / 1000;
}

export function startStage() {
  return performance.now();
}

export function finishStage(timings, name, start) {
  if (!timings || typeof timings !== 'object') {
    throw new TypeError('timings object is required');
  }
  if (typeof name !== 'string' || !name) {
    throw new TypeError('timing stage name is required');
  }
  timings[name] = msSince(start);
  return timings[name];
}

export async function measureAsyncStage(timings, name, fn) {
  const start = startStage();
  try {
    return await fn();
  } finally {
    finishStage(timings, name, start);
  }
}

export function measureSyncStage(timings, name, fn) {
  const start = startStage();
  try {
    return fn();
  } finally {
    finishStage(timings, name, start);
  }
}

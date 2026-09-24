const DAY_MS = 24 * 60 * 60 * 1000;

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function retentionConfig(env = process.env) {
  return {
    processedViberDays: positiveInt(
      env.GATEWAY_RETENTION_PROCESSED_VIBER_DAYS,
      30
    ),
    processedChatwootDays: positiveInt(
      env.GATEWAY_RETENTION_PROCESSED_CHATWOOT_DAYS,
      30
    ),
    outgoingViberDays: positiveInt(
      env.GATEWAY_RETENTION_OUTGOING_VIBER_DAYS,
      90
    ),
  };
}

export function retentionCutoffs(config, now = new Date()) {
  const ts = now.getTime();
  return {
    processedViberBefore: new Date(
      ts - config.processedViberDays * DAY_MS
    ).toISOString(),
    processedChatwootBefore: new Date(
      ts - config.processedChatwootDays * DAY_MS
    ).toISOString(),
    outgoingViberBefore: new Date(
      ts - config.outgoingViberDays * DAY_MS
    ).toISOString(),
  };
}


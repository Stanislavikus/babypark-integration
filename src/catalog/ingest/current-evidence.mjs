import { renderAcceptedRunAck as render } from './replay-store.mjs';

export function renderAcceptedRunAck({ key, generationId, runDigest, sourceWatermark }) {
  return render(key, {
    accepted: true, generationId, runDigest, sourceWatermark,
  });
}

export function finishPendingAgainstCurrent({ store, reader, key }) {
  return store.finishPendingAgainstCurrent(key, reader);
}

export function resolveFinalAckAgainstCurrent({ store, reader, key }) {
  return store.resolveFinalAckAgainstCurrent(key, reader);
}

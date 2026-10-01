import { IdentityStore } from './store.mjs';

export class StoreIdentityResolutionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'StoreIdentityResolutionError';
    this.code = code;
    this.details = details;
  }
}

function requireText(name, value) {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) {
    throw new TypeError(`${name} must be non-empty text`);
  }
  return value;
}

export function resolveCanonicalStore(identityStore, {
  provider,
  nativeStoreId,
}) {
  if (!(identityStore instanceof IdentityStore)) {
    throw new TypeError('identityStore must be an IdentityStore');
  }
  requireText('provider', provider);
  requireText('nativeStoreId', nativeStoreId);
  const mapping = identityStore.lookupStoreBySource({
    provider,
    nativeStoreId,
  });
  if (!mapping) {
    throw new StoreIdentityResolutionError(
      'STORE_IDENTITY_UNMAPPED',
      'Provider-native store has no reviewed canonical mapping',
      { provider, native_store_id: nativeStoreId }
    );
  }
  if (mapping.lifecycle !== 'active') {
    throw new StoreIdentityResolutionError(
      'STORE_IDENTITY_INACTIVE',
      'Provider-native store resolves to a non-active canonical store',
      {
        provider,
        native_store_id: nativeStoreId,
        store_id: mapping.store_id,
        lifecycle: mapping.lifecycle,
      }
    );
  }
  return Object.freeze({
    store_id: mapping.store_id,
    reviewed_source: mapping.reviewed_source,
  });
}

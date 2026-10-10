export function testActionDescriptor(overrides = {}) {
  const scopeOverrides = overrides.semantic_scope ?? {};
  return {
    descriptor_version: 1,
    reason: 'TEST_REASON',
    template_id: 'test_template',
    response_locale: 'uk',
    ...overrides,
    semantic_scope: {
      product: null,
      category: null,
      brand_id: null,
      store_id: null,
      money: null,
      ...scopeOverrides,
    },
  };
}

export function ensureTestEpisode(store, streamId) {
  return store.loadActiveEpisode(streamId) ?? store.beginEpisode({ streamId });
}

export function prepareTestPublicAction(store, args) {
  let episodeId = args.episodeId ?? null;
  let expectedEpisodeVersion = args.expectedEpisodeVersion ?? null;
  if (episodeId === null) {
    const episode = ensureTestEpisode(store, args.streamId);
    episodeId = episode.episode_id;
    expectedEpisodeVersion = episode.version;
  } else if (expectedEpisodeVersion === null) {
    const episode = store.getEpisode(episodeId);
    expectedEpisodeVersion = episode?.version ?? null;
  }
  return store.preparePublicAction({
    ...args,
    episodeId,
    expectedEpisodeVersion,
  });
}

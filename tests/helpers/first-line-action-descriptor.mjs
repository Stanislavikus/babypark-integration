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

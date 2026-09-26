import { BLOCKER_CODES, Blocker } from '../blockers.mjs';

export function globalTopoSortCategories(categories) {
  const byId = new Map(categories.map(c => [c.native_category_id, c]));
  const sorted = [];
  const visiting = new Set();
  const visited = new Set();

  function visit(category) {
    const id = category.native_category_id;
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Blocker(
        BLOCKER_CODES.CATEGORY_CYCLE,
        'Category hierarchy contains a cycle',
        { native_category_id: id }
      );
    }
    visiting.add(id);
    if (category.parent_native_category_id) {
      const parent = byId.get(category.parent_native_category_id);
      if (!parent) {
        throw new Blocker(
          BLOCKER_CODES.CATEGORY_PARENT_MISSING,
          'Category parent is missing',
          {
            native_category_id: id,
            parent_native_category_id: category.parent_native_category_id,
          }
        );
      }
      visit(parent);
    }
    visiting.delete(id);
    visited.add(id);
    sorted.push(category);
  }

  const ordered = [...categories].sort((a, b) => {
    const diff = Number(a.native_category_id) - Number(b.native_category_id);
    return diff !== 0 ? diff : 0;
  });

  for (const category of ordered) {
    visit(category);
  }

  return sorted;
}

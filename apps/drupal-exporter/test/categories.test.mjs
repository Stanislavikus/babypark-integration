import test from 'node:test';
import assert from 'node:assert/strict';
import { runExportPipeline } from '../src/export/pipeline.mjs';
import { globalTopoSortCategories } from '../src/canonical/ordering.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IncrementalChunkWriter } from '../src/canonical/incremental-chunks.mjs';
import {
  createFixtureDir,
  writeFixture,
  simpleProduct,
  mergeDatasets,
  testConfig,
} from './helpers/fixture-builder.mjs';
import { BLOCKER_CODES } from '../src/blockers.mjs';
import { categoryGroupId } from '../src/canonical/records.mjs';

test('category translation grouping and raw ID collision detection', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1 }),
    {
      categories: [
        { tid: 10, vid: 2, name: 'Child RU', language: 'ru', i18n_tsid: 100 },
        { tid: 11, vid: 2, name: 'Child UK', language: 'uk', i18n_tsid: 100 },
        { tid: 100, vid: 2, name: 'Collision', language: 'ru', i18n_tsid: 0 },
      ],
      category_hierarchy: [
        { tid: 10, parent: 0 },
        { tid: 11, parent: 0 },
        { tid: 100, parent: 0 },
      ],
    }
  ));

  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });

  assert.equal(categoryGroupId({ tid: 10, i18n_tsid: 100 }), '100');
  assert.ok(result.preflight.blockers.some(b => b.code === BLOCKER_CODES.CATEGORY_ID_COLLISION));
});

test('category parent conflict blocker', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1 }),
    {
      categories: [
        { tid: 10, vid: 2, name: 'Parent A', language: 'ru', i18n_tsid: 0 },
        { tid: 20, vid: 2, name: 'Parent B', language: 'ru', i18n_tsid: 0 },
        { tid: 1, vid: 2, name: 'A RU', language: 'ru', i18n_tsid: 50 },
        { tid: 2, vid: 2, name: 'A UK', language: 'uk', i18n_tsid: 50 },
      ],
      category_hierarchy: [
        { tid: 10, parent: 0 },
        { tid: 20, parent: 0 },
        { tid: 1, parent: 10 },
        { tid: 2, parent: 20 },
      ],
    }
  ));

  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.ok(result.preflight.blockers.some(b => b.code === BLOCKER_CODES.CATEGORY_PARENT_CONFLICT));
});

test('global topo ordering across chunk boundaries', () => {
  const categories = [
    {
      schema: 'bp.catalog.full-record/2',
      type: 'category', phase: 0, provider: 'drupal',
      native_category_id: '2', parent_native_category_id: '1', localized_names: { uk: 'Child' },
    },
    {
      schema: 'bp.catalog.full-record/2',
      type: 'category', phase: 0, provider: 'drupal',
      native_category_id: '1', parent_native_category_id: null, localized_names: { uk: 'Root' },
    },
  ];
  const sorted = globalTopoSortCategories(categories);
  assert.equal(sorted[0].native_category_id, '1');
  assert.equal(sorted[1].native_category_id, '2');

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'category-chunk-'));
  const writer = new IncrementalChunkWriter({ outputDir, scratch: true });
  writer.writePhase0Records(sorted);
  const result = writer.finish();
  assert.equal(result.chunks.length, 1);
  const body = JSON.parse(fs.readFileSync(path.join(outputDir, result.chunks[0].filename), 'utf8'));
  assert.equal(body.rows[0].native_category_id, '1');
  writer.cleanup();
});

import { mergeDatasets, simpleProduct } from '../helpers/fixture-builder.mjs';

export const REVIEWED_FIXTURE_MAPPINGS_YAML = `version: 1
mappings:
  - sku_key: "1003ig"
    action: exclude_product
    retain_native_product_id: "55677"
    exclude_native_product_id: "55682"
    reviewed_source: "review:fixture"
    reason: "fixture"
  - sku_key: "106-2.45.44"
    action: exclude_variant
    native_product_id: "67463"
    retain_native_variant_id: "67463|opts:255=19792"
    exclude_native_variant_id: "67463|opts:255=19789"
    reviewed_source: "review:fixture"
    reason: "fixture"
  - sku_key: "11009873-blackcabfpar"
    action: exclude_variant
    native_product_id: "133434"
    retain_native_variant_id: "133434|opts:47=33395"
    exclude_native_variant_id: "133434|opts:47=33401"
    reviewed_source: "review:fixture"
    reason: "fixture"
  - sku_key: "1412/03bo"
    action: exclude_variant
    native_product_id: "80520"
    retain_native_variant_id: "80520|opts:306=26041"
    exclude_native_variant_id: "80520|opts:306=26040"
    reviewed_source: "review:fixture"
    reason: "fixture"
  - sku_key: "154.6.01ver"
    action: exclude_variant
    native_product_id: "39988"
    retain_native_variant_id: "39988|opts:255=25587"
    exclude_native_variant_id: "39988|opts:255=12377"
    reviewed_source: "review:fixture"
    reason: "fixture"
  - sku_key: "1801blbf01"
    action: exclude_variant
    native_product_id: "42887"
    retain_native_variant_id: "42887|opts:14=9795"
    exclude_native_variant_id: "42887|opts:14=9796"
    reviewed_source: "review:fixture"
    reason: "fixture"
  - sku_key: "216.04.7ver"
    action: exclude_variant
    native_product_id: "38223"
    retain_native_variant_id: "38223|opts:255=20655"
    exclude_native_variant_id: "38223|opts:255=17828"
    reviewed_source: "review:fixture"
    reason: "fixture"
  - sku_key: "23241eu4ep"
    action: exclude_variant
    native_product_id: "62506"
    retain_native_variant_id: "62506|opts:530=20157"
    exclude_native_variant_id: "62506|opts:530=20022"
    reviewed_source: "review:fixture"
    reason: "fixture"
  - sku_key: "25199"
    action: exclude_variant
    native_product_id: "16553"
    retain_native_variant_id: "16553|opts:118=2060"
    exclude_native_variant_id: "16553|opts:118=2059"
    reviewed_source: "review:fixture"
    reason: "fixture"
  - sku_key: "2822827000"
    action: exclude_variant
    native_product_id: "48595"
    retain_native_variant_id: "48595|opts:351=27077"
    exclude_native_variant_id: "48595|opts:351=13366"
    reviewed_source: "review:fixture"
    reason: "fixture"
  - sku_key: "3110iti"
    action: exclude_variant
    native_product_id: "16680"
    retain_native_variant_id: "16680|opts:132=2036"
    exclude_native_variant_id: "16680|opts:132=2035"
    reviewed_source: "review:fixture"
    reason: "fixture"
  - sku_key: "391589"
    action: exclude_variant
    native_product_id: "39002"
    retain_native_variant_id: "39002|opts:344=16159"
    exclude_native_variant_id: "39002|opts:344=9779"
    reviewed_source: "review:fixture"
    reason: "fixture"
  - sku_key: "80210zw01"
    action: exclude_variant
    native_product_id: "12871"
    retain_native_variant_id: "12871|opts:14=2572"
    exclude_native_variant_id: "12871|opts:14=2571"
    reviewed_source: "review:fixture"
    reason: "fixture"
  - sku_key: "8710103876397"
    action: exclude_variant
    native_product_id: "114708"
    retain_native_variant_id: "114708|opts:380=12398"
    exclude_native_variant_id: "114708|opts:380=28097"
    reviewed_source: "review:fixture"
    reason: "fixture"
  - sku_key: "ab10256-ws/18f"
    action: exclude_variant
    native_product_id: "61907"
    retain_native_variant_id: "61907|opts:529=21616"
    exclude_native_variant_id: "61907|opts:529=25900"
    reviewed_source: "review:fixture"
    reason: "fixture"
  - sku_key: "abx20408/58sk"
    action: exclude_variant
    native_product_id: "71198"
    retain_native_variant_id: "71198|opts:529=25894"
    exclude_native_variant_id: "71198|opts:529=25893"
    reviewed_source: "review:fixture"
    reason: "fixture"
  - sku_key: "evo19brgrs"
    action: exclude_variant
    native_product_id: "21136"
    retain_native_variant_id: "21136|opts:26=24401"
    exclude_native_variant_id: "21136|opts:26=25350"
    reviewed_source: "review:fixture"
    reason: "fixture"
  - sku_key: "m008071"
    action: exclude_variant
    native_product_id: "49533"
    retain_native_variant_id: "49533|opts:375=11561"
    exclude_native_variant_id: "49533|opts:375=11565"
    reviewed_source: "review:fixture"
    reason: "fixture"
  - sku_key: "nio19grgrs"
    action: exclude_variant
    native_product_id: "70541"
    retain_native_variant_id: "70541|opts:26=24548"
    exclude_native_variant_id: "70541|opts:26=5504"
    reviewed_source: "review:fixture"
    reason: "fixture"
  - sku_key: "o3sumc"
    action: exclude_variant
    native_product_id: "77502"
    retain_native_variant_id: "77502|opts:452=31713"
    exclude_native_variant_id: "77502|opts:452=31539"
    reviewed_source: "review:fixture"
    reason: "fixture"
  - sku_key: "wk21-h27-003"
    action: exclude_variant
    native_product_id: "38178"
    retain_native_variant_id: "38178|opts:249=21060"
    exclude_native_variant_id: "38178|opts:249=9423"
    reviewed_source: "review:fixture"
    reason: "fixture"
`;

function withinProductCollision({
  nid,
  aid,
  oidRetain,
  oidExclude,
  sku,
  modelRetain = sku,
  modelExclude = sku,
}) {
  return mergeDatasets(
    simpleProduct({ nid, model: sku }),
    {
      product_attributes: [{ nid, aid, default_option: oidRetain }],
      product_options: [
        { nid, oid: oidRetain, price: '0.00000', weight: 1 },
        { nid, oid: oidExclude, price: '0.00000', weight: 1 },
      ],
      attributes: [{ aid, name: 'Option' }],
      attribute_options: [
        { oid: oidRetain, aid, name: 'Retain' },
        { oid: oidExclude, aid, name: 'Exclude' },
      ],
      adjustments: [
        { nid, combination: `a:1:{i:${aid};i:${oidRetain};}`, model: modelRetain, price: '0.00000' },
        { nid, combination: `a:1:{i:${aid};i:${oidExclude};}`, model: modelExclude, price: '0.00000' },
      ],
    }
  );
}

export function buildRegression20260927Fixture() {
  const parts = [
    simpleProduct({ nid: 99999, model: 'GOOD-UNRELATED' }),
    simpleProduct({ nid: 55677, model: '1003IG' }),
    simpleProduct({ nid: 55682, model: '1003IG' }),
    simpleProduct({ nid: 79252, model: '511000' }),
    simpleProduct({ nid: 139026, model: '511000' }),
    simpleProduct({ nid: 12605, model: '80401MC02' }),
    simpleProduct({ nid: 118670, model: '80401MC02' }),
    withinProductCollision({
      nid: 67463, aid: 255, oidRetain: 19792, oidExclude: 19789, sku: '106-2.45.44',
    }),
    withinProductCollision({
      nid: 133434, aid: 47, oidRetain: 33395, oidExclude: 33401, sku: '11009873-BlackCabFpar',
    }),
    withinProductCollision({
      nid: 80520, aid: 306, oidRetain: 26041, oidExclude: 26040, sku: '1412/03bo',
    }),
    withinProductCollision({
      nid: 39988, aid: 255, oidRetain: 25587, oidExclude: 12377, sku: '154.6.01ver',
    }),
    withinProductCollision({
      nid: 42887, aid: 14, oidRetain: 9795, oidExclude: 9796, sku: '1801blbf01',
    }),
    withinProductCollision({
      nid: 38223, aid: 255, oidRetain: 20655, oidExclude: 17828, sku: '216.04.7ver',
    }),
    withinProductCollision({
      nid: 62506, aid: 530, oidRetain: 20157, oidExclude: 20022, sku: '23241eu4ep',
    }),
    withinProductCollision({
      nid: 16553, aid: 118, oidRetain: 2060, oidExclude: 2059, sku: '25199',
    }),
    withinProductCollision({
      nid: 48595, aid: 351, oidRetain: 27077, oidExclude: 13366, sku: '2822827000',
    }),
    withinProductCollision({
      nid: 16680, aid: 132, oidRetain: 2036, oidExclude: 2035, sku: '3110iti',
    }),
    withinProductCollision({
      nid: 39002, aid: 344, oidRetain: 16159, oidExclude: 9779, sku: '391589',
    }),
    withinProductCollision({
      nid: 12871, aid: 14, oidRetain: 2572, oidExclude: 2571, sku: '80210ZW01',
    }),
    withinProductCollision({
      nid: 114708, aid: 380, oidRetain: 12398, oidExclude: 28097, sku: '8710103876397',
    }),
    withinProductCollision({
      nid: 61907, aid: 529, oidRetain: 21616, oidExclude: 25900, sku: 'AB10256-WS/18F',
    }),
    withinProductCollision({
      nid: 71198, aid: 529, oidRetain: 25894, oidExclude: 25893, sku: 'ABX20408/58SK',
    }),
    withinProductCollision({
      nid: 21136,
      aid: 26,
      oidRetain: 24401,
      oidExclude: 25350,
      sku: 'EVO19BRGRS',
      modelRetain: 'EVO19BRGRS',
      modelExclude: 'EVO19BRGRS ',
    }),
    withinProductCollision({
      nid: 49533, aid: 375, oidRetain: 11561, oidExclude: 11565, sku: 'm008071',
    }),
    withinProductCollision({
      nid: 70541, aid: 26, oidRetain: 24548, oidExclude: 5504, sku: 'NIO19GRGRS',
    }),
    withinProductCollision({
      nid: 77502, aid: 452, oidRetain: 31713, oidExclude: 31539, sku: 'o3sumc',
    }),
    withinProductCollision({
      nid: 38178, aid: 249, oidRetain: 21060, oidExclude: 9423, sku: 'WK21-H27-003',
    }),
  ];

  return mergeDatasets(...parts);
}

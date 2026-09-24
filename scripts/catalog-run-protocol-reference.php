<?php
/* PHP 7.0 reference for control-object canonicalization and digest v2 only. */
function bp_canonical($value) {
    if (is_array($value)) {
        $keys = array_keys($value);
        $list = ($keys === range(0, count($value) - 1));
        if (!$list) { ksort($value, SORT_STRING); }
        $parts = array();
        foreach ($value as $key => $item) {
            $encoded = bp_canonical($item);
            $parts[] = $list ? $encoded : bp_json((string)$key) . ':' . $encoded;
        }
        return ($list ? '[' : '{') . implode(',', $parts) . ($list ? ']' : '}');
    }
    return bp_json($value);
}
function bp_json($value) {
    $result = json_encode($value, JSON_UNESCAPED_SLASHES);
    if ($result === false) { throw new RuntimeException('json_encode failed'); }
    return $result;
}
function bp_dec20($value) { return is_string($value) && preg_match('/\A(?:0|[1-9][0-9]{0,19})\z/D', $value) === 1; }
function bp_dec20_compare($a, $b) {
    if (!bp_dec20($a) || !bp_dec20($b)) { throw new InvalidArgumentException('invalid DEC20'); }
    if (strlen($a) !== strlen($b)) { return strlen($a) < strlen($b) ? -1 : 1; }
    return strcmp($a, $b);
}
function bp_u64be($value) {
    if (PHP_INT_SIZE !== 8) { throw new RuntimeException('64-bit PHP required'); }
    if (!is_int($value) || $value < 0 || $value > 9007199254740991) { throw new InvalidArgumentException('invalid JS-safe integer'); }
    return pack('J', $value);
}
function bp_digest_v2($headerHash, $chunkHashes, $finalSeq, $count) {
    if (preg_match('/\A[a-f0-9]{64}\z/D', $headerHash) !== 1 || $finalSeq !== count($chunkHashes) + 1) { throw new InvalidArgumentException('invalid digest inputs'); }
    $header = hex2bin($headerHash); if ($header === false) { throw new InvalidArgumentException('invalid header hash'); }
    $chain = hash('sha256', "BP-RUN-v2\0" . $header, true);
    foreach ($chunkHashes as $index => $hash) {
        if (preg_match('/\A[a-f0-9]{64}\z/D', $hash) !== 1) { throw new InvalidArgumentException('invalid chunk hash'); }
        $binary = hex2bin($hash); if ($binary === false) { throw new InvalidArgumentException('invalid chunk hash'); }
        $chain = hash('sha256', "BP-CHUNK-v2\0" . $chain . bp_u64be($index + 1) . $binary, true);
    }
    return hash('sha256', "BP-FINAL-v2\0" . $chain . bp_u64be($finalSeq) . bp_u64be($count));
}
if (isset($argv) && realpath($argv[0]) === __FILE__ && isset($argv[1])) {
    $raw = file_get_contents($argv[1]);
    $vectors = json_decode($raw, true);
    if (!is_array($vectors) || !isset($vectors['accepted_digests'])) { throw new RuntimeException('invalid vector file'); }
    foreach ($vectors['accepted_digests'] as $vector) {
        $actual = bp_digest_v2($vector['header_sha256'], $vector['chunk_hashes'], $vector['final_seq'], $vector['count']);
        if (!hash_equals($vector['run_digest'], $actual)) { throw new RuntimeException('digest vector mismatch: '.$vector['name']); }
    }
    echo count($vectors['accepted_digests'])." digest vectors OK\n";
}

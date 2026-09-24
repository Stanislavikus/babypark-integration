<?php
/* PHP 7.0 reference for control-object canonicalization and digest v2 only. */
function bp_canonical($value) {
    if (is_array($value)) {
        if (count($value) === 0) { throw new InvalidArgumentException('ambiguous empty PHP array'); }
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
    if (!is_array($vectors) || !isset($vectors['records'])) { throw new RuntimeException('invalid vector file'); }
    $executed = 0;
    foreach ($vectors['records'] as $vector) {
        $kind = $vector['kind'];
        if ($kind === 'canonical') {
            $actual = bp_canonical($vector['structured']);
            if ($actual !== $vector['expected_utf8'] || hash('sha256', $actual) !== $vector['sha256']) throw new RuntimeException('canonical mismatch');
        } elseif ($kind === 'dec20-valid') {
            if (bp_dec20($vector['value']) !== $vector['valid']) throw new RuntimeException('DEC20 mismatch');
        } elseif ($kind === 'dec20-compare') {
            $actual = bp_dec20_compare($vector['left'], $vector['right']); $actual = $actual < 0 ? -1 : ($actual > 0 ? 1 : 0);
            if ($actual !== $vector['expected']) throw new RuntimeException('DEC20 comparison mismatch');
        } elseif ($kind === 'uint64be') {
            try { $actual = bin2hex(bp_u64be($vector['value'])); if (!$vector['valid'] || $actual !== $vector['expected_hex']) throw new RuntimeException('uint64 mismatch'); }
            catch (InvalidArgumentException $error) { if ($vector['valid']) throw $error; }
        } elseif ($kind === 'digest-v2') {
            $actual = bp_digest_v2($vector['header_sha256'], $vector['chunk_hashes'], $vector['final_seq'], $vector['count']);
            if (!hash_equals($vector['run_digest'], $actual)) throw new RuntimeException('digest mismatch');
        } elseif ($kind === 'canonical-empty-array-reject') {
            try { bp_canonical(array()); throw new RuntimeException('empty array accepted'); } catch (InvalidArgumentException $expected) {}
        } else { throw new RuntimeException('unknown vector kind: '.$kind); }
        $executed++;
    }
    echo $executed." vectors OK\n";
}

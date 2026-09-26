<?php
if ($argc !== 2) { fwrite(STDERR, "usage: php catalog-bp1-reference.php vectors.json\n"); exit(2); }
$data = json_decode(file_get_contents($argv[1]), true);
if (!is_array($data) || !isset($data['vectors']) || !is_string($data['secret'])) { fwrite(STDERR, "invalid fixture\n"); exit(1); }
foreach ($data['vectors'] as $v) {
    $body = base64_decode($v['body_base64'], true);
    $hash = hash('sha256', $body);
    $canonical = implode("\n", array('BP1', $v['method'], $v['path'], $v['audience'], $v['kid'], $v['timestamp'], $v['run_id'], (string)$v['seq'], $v['final'] ? '1' : '0', $v['content_encoding'], $hash));
    $signature = 'sha256=' . hash_hmac('sha256', $canonical, $data['secret']);
    if ($hash !== $v['body_sha256'] || $canonical !== $v['canonical'] || !hash_equals($v['signature'], $signature)) { fwrite(STDERR, 'FAIL ' . $v['name'] . "\n"); exit(1); }
    fwrite(STDOUT, 'OK ' . $v['name'] . "\n");
}

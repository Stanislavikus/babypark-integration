export function buildSenderEvalSource(cliUrl) {
  const href = typeof cliUrl === 'string' ? cliUrl : cliUrl.href;
  return `import { main } from ${JSON.stringify(href)}; main(process.argv.slice(1)).catch(error => { console.error(JSON.stringify({ code: error.code ?? 'D2B_FAILED', message: error.message, retryable: error.retryable === true })); process.exitCode = 1; });`;
}

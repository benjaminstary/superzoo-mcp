// Preload only in the stdio test child process; production has no fixture mode.
import { readFileSync } from 'node:fs';
const detail = readFileSync(new URL('../fixtures/product-detail.json', import.meta.url), 'utf8');
globalThis.fetch = async (url, init) => {
  if (String(url).endsWith('/cancel-test')) {
    console.error('fixture-started');
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        console.error('fixture-aborted');
        reject(init.signal.reason);
      }, { once: true });
    });
  }
  if (String(url) !== 'https://www.superzoo.sk/web-api/products/294-101115') throw new Error('Unexpected test URL');
  return new Response(detail);
};

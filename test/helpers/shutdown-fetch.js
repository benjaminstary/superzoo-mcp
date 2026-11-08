// Test-only upstream handles: a live timer makes leaked fetches prevent child exit.
import { readFileSync } from 'node:fs';
const detail = JSON.parse(readFileSync(new URL('../fixtures/product-detail.json', import.meta.url)));
globalThis.fetch = async (url, { signal }) => {
  const productId = new URL(url).pathname.split('/').at(-1);
  process.send?.({ event: 'fetch_started', product_id: productId });
  return new Promise((resolve, reject) => {
    const alive = setInterval(() => {}, 1000);
    let completion;
    const abort = () => {
      clearInterval(alive);
      clearTimeout(completion);
      process.send?.({ event: 'fetch_aborted', product_id: productId });
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    if (productId === 'shutdown-fast') completion = setTimeout(() => {
      clearInterval(alive);
      signal.removeEventListener('abort', abort);
      resolve(new Response(JSON.stringify({ ...detail, product: { ...detail.product, id: productId } })));
    }, 200);
  });
};

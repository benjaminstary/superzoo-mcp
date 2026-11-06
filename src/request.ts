import type { z } from 'zod';
import type { Country } from './config.js';
import { SuperzooError } from './errors.js';

type Operation = 'search' | 'product' | 'availability';
interface RequestOptions<T> {
  market: Country;
  operation: Operation;
  productId?: string;
  url: string | URL;
  schema: z.ZodType<T>;
  init?: RequestInit;
  signal?: AbortSignal;
}
interface Result<T> { data: T; checked_at: string }
interface Flight {
  controller: AbortController;
  promise: Promise<Result<unknown>>;
  waiters: number;
}
interface QueueEntry { start: () => void }

const cancelled = () => new SuperzooError('cancelled', 'Superzoo request cancelled');
const timeout = () => new SuperzooError('timeout', 'Superzoo request timed out', true);
const abortError = (signal: AbortSignal) => signal.reason instanceof SuperzooError ? signal.reason : cancelled();

// Also bounds injected fetches and stalled response bodies that do not observe abort themselves.
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(abortError(signal)); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    work.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(abortError(signal)); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

function retryDelay(value: string | null): number {
  if (value !== null) {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
    // HTTP-date is a date, not the permissive numeric strings accepted by Date.parse.
    if (/^[A-Za-z]/.test(trimmed)) {
      const date = Date.parse(trimmed);
      if (Number.isFinite(date)) return Math.max(0, date - Date.now());
    }
  }
  return 200 + Math.floor(Math.random() * 301);
}

export function createRequestPolicy({ fetchImpl = globalThis.fetch, timeoutMs = 15_000 }: {
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
} = {}) {
  let active = 0;
  const queue: QueueEntry[] = [];
  const flights = new Map<string, Flight>();
  const cache = new Map<string, { result: Result<unknown>; expires: number }>();

  function acquire(signal: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(abortError(signal)); return; }
      const release = () => {
        active--;
        queue.shift()?.start();
      };
      const entry: QueueEntry = { start: () => {
        signal.removeEventListener('abort', abort);
        active++;
        resolve(release);
      } };
      const abort = () => {
        const index = queue.indexOf(entry);
        if (index >= 0) queue.splice(index, 1);
        reject(abortError(signal));
      };
      if (active < 4) entry.start();
      else if (queue.length >= 128) reject(new SuperzooError('overloaded', 'Superzoo request queue is full', true));
      else {
        queue.push(entry);
        signal.addEventListener('abort', abort, { once: true });
      }
    });
  }

  async function retrieve<T>(options: RequestOptions<T>, signal: AbortSignal, deadline: number): Promise<Result<T>> {
    const release = await acquire(signal);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (signal.aborted) throw abortError(signal);
        let retryAfter: string | null = null;
        try {
          const headers = new Headers(options.init?.headers);
          if (!headers.has('Accept')) headers.set('Accept', 'application/json');
          const response = await abortable(fetchImpl(options.url, {
            ...options.init, headers, signal, redirect: 'error',
          }), signal);
          if (!response.ok) {
            const retryable = [429, 502, 503, 504].includes(response.status);
            retryAfter = response.headers.get('Retry-After');
            // Release error bodies without reading or logging their contents.
            void response.body?.cancel().catch(() => {});
            throw new SuperzooError(response.status === 404 ? 'not_found'
              : response.status === 429 ? 'rate_limited' : 'upstream_unavailable',
            `Superzoo returned HTTP ${response.status}`, retryable);
          }
          let data: unknown;
          try { data = await abortable(response.json(), signal); }
          catch (error) {
            if (signal.aborted) throw abortError(signal);
            // A broken body stream is a network failure; JSON syntax errors are not.
            if (error instanceof TypeError) throw error;
            throw new SuperzooError('invalid_response', 'Superzoo returned invalid JSON');
          }
          const parsed = options.schema.safeParse(data);
          if (!parsed.success) throw new SuperzooError('invalid_response', 'Superzoo returned an unexpected response structure');
          if (signal.aborted) throw abortError(signal);
          return { data: parsed.data, checked_at: new Date().toISOString() };
        } catch (error) {
          if (signal.aborted) throw abortError(signal);
          // Native fetch reports network failures (including rejected redirects) as TypeError.
          const failure = error instanceof SuperzooError ? error : error instanceof TypeError
            ? new SuperzooError('upstream_unavailable', 'Superzoo network request failed', true)
            : new SuperzooError('internal_error', 'Superzoo request failed');
          const delay = retryDelay(retryAfter);
          if (!failure.retryable || attempt === 1 || delay >= deadline - Date.now()) throw failure;
          await wait(delay, signal);
        }
      }
      throw new SuperzooError('internal_error', 'Superzoo request failed');
    } finally {
      release();
    }
  }

  function subscribe<T>(flight: Flight, signal?: AbortSignal): Promise<Result<T>> {
    flight.waiters++;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return false;
        settled = true;
        signal?.removeEventListener('abort', abort);
        flight.waiters--;
        return true;
      };
      const abort = () => {
        if (!finish()) return;
        if (flight.waiters === 0) flight.controller.abort(cancelled());
        reject(cancelled());
      };
      flight.promise.then(result => {
        if (finish()) resolve(result as Result<T>);
      }, error => { if (finish()) reject(error); });
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    });
  }

  async function request<T>(options: RequestOptions<T>): Promise<Result<T>> {
    const started = Date.now();
    let cacheHit = false;
    let status = 'ok';
    try {
      if (options.signal?.aborted) throw cancelled();
      const key = options.operation !== 'search' && options.productId !== undefined
        ? JSON.stringify([options.market, options.operation, options.productId]) : undefined;
      const cached = key === undefined ? undefined : cache.get(key);
      if (cached && key !== undefined) {
        cache.delete(key);
        if (cached.expires > Date.now()) {
          cache.set(key, cached);
          cacheHit = true;
          return structuredClone(cached.result) as Result<T>;
        }
      }
      let flight = key === undefined ? undefined : flights.get(key);
      if (!flight || flight.controller.signal.aborted) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(timeout()), timeoutMs);
        const promise = retrieve(options, controller.signal, started + timeoutMs).then(result => {
          if (key !== undefined && !controller.signal.aborted) {
            // One LRU cache across product details and raw store availability.
            cache.delete(key);
            cache.set(key, { result, expires: Date.now() + (options.operation === 'product' ? 60_000 : 15_000) });
            if (cache.size > 256) cache.delete(cache.keys().next().value!);
          }
          return result;
        }).finally(() => {
          clearTimeout(timer);
          if (key !== undefined && flights.get(key) === created) flights.delete(key);
        });
        const created: Flight = { controller, waiters: 0, promise };
        flight = created;
        if (key !== undefined) flights.set(key, flight);
      }
      return structuredClone(await subscribe<T>(flight, options.signal));
    } catch (error) {
      status = error instanceof SuperzooError ? error.code : 'internal_error';
      throw error;
    } finally {
      console.error(JSON.stringify({ market: options.market, operation: options.operation,
        status, duration_ms: Math.max(0, Date.now() - started), cache_hit: cacheHit }));
    }
  }
  return { request };
}

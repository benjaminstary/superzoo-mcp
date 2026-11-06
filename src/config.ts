import { isIP } from 'node:net';

const MARKETS = Object.freeze({
  SK: Object.freeze({ country: 'SK', name: 'Slovakia', web: 'https://www.superzoo.sk', language: 'sk', currency: 'EUR', priceLevel: '22' }),
  CZ: Object.freeze({ country: 'CZ', name: 'Czechia', web: 'https://www.superzoo.cz', language: 'cs', currency: 'CZK', priceLevel: '1' }),
  // The Polish default price level is unverified. Search only returns unrestricted candidates.
  PL: Object.freeze({ country: 'PL', name: 'Poland', web: 'https://superzoo.com.pl', language: 'pl', currency: 'PLN', priceLevel: null }),
});

export type Country = keyof typeof MARKETS;
export type Market = (typeof MARKETS)[Country];

export interface RuntimeConfig {
  country: Country;
  transport: 'stdio' | 'http';
  host: string;
  port: number;
  allowedHosts: string[];
  allowedOrigins: string[];
}

export function getMarket(country: string = 'SK'): Market {
  const key = typeof country === 'string' ? country.trim().toUpperCase() : '';
  const market = Object.hasOwn(MARKETS, key) ? MARKETS[key as Country] : undefined;
  if (!market) throw new Error('Unsupported SUPERZOO_COUNTRY. Choose SK, CZ, or PL.');
  return market;
}

function hostname(value: string): string {
  const host = value.trim().toLowerCase().replace(/^\[([^\]]+)\]$/, '$1');
  if (!isIP(host) && !/^(?=.{1,253}$)[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(host)) {
    throw new Error('HTTP hosts must be hostnames or IP addresses, without scheme, path, port, or wildcards.');
  }
  return host;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const country = getMarket(env.SUPERZOO_COUNTRY ?? 'SK').country;
  const transport = env.SUPERZOO_TRANSPORT ?? 'stdio';
  if (transport !== 'stdio' && transport !== 'http') throw new Error('SUPERZOO_TRANSPORT must be stdio or http.');
  const host = hostname(env.SUPERZOO_HOST ?? '127.0.0.1');
  const rawPort = env.SUPERZOO_PORT ?? '3000';
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
    throw new Error('SUPERZOO_PORT must be an integer from 1 to 65535.');
  }
  const defaultHosts = ['localhost', '127.0.0.1', '::1'];
  if (!['0.0.0.0', '::'].includes(host) && !defaultHosts.includes(host)) defaultHosts.push(host);
  const allowedHosts = env.SUPERZOO_ALLOWED_HOSTS === undefined ? defaultHosts
    : env.SUPERZOO_ALLOWED_HOSTS.split(',').map(hostname);
  const allowedOrigins = env.SUPERZOO_ALLOWED_ORIGINS ? env.SUPERZOO_ALLOWED_ORIGINS.split(',').map(value => {
    const url = new URL(value.trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('SUPERZOO_ALLOWED_ORIGINS must contain exact HTTP(S) origins without paths or wildcards.');
    }
    return url.origin;
  }) : [];
  return { country, transport, host, port: Number(rawPort), allowedHosts, allowedOrigins };
}

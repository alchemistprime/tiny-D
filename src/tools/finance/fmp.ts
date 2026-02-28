import { readCache, writeCache, describeRequest } from '../../utils/cache.js';
import { logger } from '../../utils/logger.js';

const BASE_URL = 'https://financialmodelingprep.com/stable';

export interface FmpResponse {
  data: unknown;
  url: string;
}

export async function callFmpApi(
  endpoint: string,
  params: Record<string, string | number | string[] | undefined>,
  options?: { cacheable?: boolean }
): Promise<FmpResponse> {
  const label = describeRequest(endpoint, params);

  if (options?.cacheable) {
    const cached = readCache(endpoint, params);
    if (cached) {
      const payload = (cached.data as Record<string, unknown>)?.payload ?? cached.data;
      return { data: payload, url: cached.url };
    }
  }

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    logger.warn(`[FMP API] call without key: ${label}`);
  }

  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = new URL(`${BASE_URL}${cleanEndpoint}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      if (Array.isArray(value)) {
        value.forEach((v) => url.searchParams.append(key, v));
      } else {
        url.searchParams.append(key, String(value));
      }
    }
  }

  if (apiKey) {
    url.searchParams.set('apikey', apiKey);
  }

  let response: Response;
  try {
    response = await fetch(url.toString());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[FMP API] network error: ${label} — ${message}`);
    throw new Error(`[FMP API] request failed for ${label}: ${message}`);
  }

  if (!response.ok) {
    const detail = `${response.status} ${response.statusText}`;
    logger.error(`[FMP API] error: ${label} — ${detail}`);
    throw new Error(`[FMP API] request failed: ${detail}`);
  }

  const data = await response.json().catch(() => {
    const detail = `invalid JSON (${response.status} ${response.statusText})`;
    logger.error(`[FMP API] parse error: ${label} — ${detail}`);
    throw new Error(`[FMP API] request failed: ${detail}`);
  });

  if (options?.cacheable) {
    writeCache(endpoint, params, { payload: data }, url.toString());
  }

  return { data, url: url.toString() };
}

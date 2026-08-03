export interface ItunesTrack {
  trackName?: string;
  artistName?: string;
  releaseDate?: string;
  primaryGenreName?: string;
  kind?: string;
}

const cache = new Map<string, { expiresAt: number; results: ItunesTrack[] }>();
const pending = new Map<string, Promise<ItunesTrack[]>>();
const queue: Array<() => void> = [];
let active = 0;
let lastStartedAt = 0;
const MAX_CONCURRENCY = 3;
const MIN_START_INTERVAL_MS = 750;

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function schedule<T>(work: () => Promise<T>) {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      active += 1;
      const delay = Math.max(0, MIN_START_INTERVAL_MS - (Date.now() - lastStartedAt));
      void wait(delay).then(async () => {
        lastStartedAt = Date.now();
        try {
          resolve(await work());
        } catch (error) {
          reject(error);
        } finally {
          active -= 1;
          drain();
        }
      });
    };
    queue.push(start);
    drain();
  });
}

function drain() {
  while (active < MAX_CONCURRENCY && queue.length) queue.shift()?.();
}

async function fetchWithRetries(url: URL) {
  const waits = [0, 900, 2_000, 4_000];
  let lastStatus = 0;
  for (let attempt = 0; attempt < waits.length; attempt += 1) {
    if (waits[attempt]) await wait(waits[attempt]);
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const payload = await response.json() as { results?: ItunesTrack[] };
      return payload.results ?? [];
    }
    lastStatus = response.status;
    if (![403, 429, 500, 502, 503].includes(response.status)) break;
  }
  throw new Error(`iTunes HTTP ${lastStatus || "desconocido"} después de reintentos`);
}

export function searchItunes(
  term: string,
  options: { limit?: number; ttlMs?: number } = {},
) {
  const limit = options.limit ?? 10;
  const key = `${term.trim().toLowerCase()}|${limit}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.results);
  const existing = pending.get(key);
  if (existing) return existing;

  const request = schedule(async () => {
    const url = new URL("https://itunes.apple.com/search");
    url.searchParams.set("term", term);
    url.searchParams.set("country", "mx");
    url.searchParams.set("media", "music");
    url.searchParams.set("entity", "song");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("explicit", "Yes");
    const results = await fetchWithRetries(url);
    cache.set(key, {
      results,
      expiresAt: Date.now() + (options.ttlMs ?? 24 * 60 * 60 * 1000),
    });
    return results;
  }).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

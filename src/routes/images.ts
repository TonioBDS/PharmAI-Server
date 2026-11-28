import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { rateLimiter, requireDevice } from '../auth.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';

/** Image proposée à l'app : vignette (affichée dans la grille) et image d'origine (récupérée au choix). */
export interface ImageResult {
  thumbnail: string;
  url: string;
  width?: number;
  height?: number;
  /** Site d'où vient l'image (affiché sous la vignette). */
  source?: string;
}

type Fetch = typeof fetch;

const BRAVE_URL = 'https://api.search.brave.com/res/v1/images/search';
const CACHE_MS = 24 * 3600 * 1000;
const CACHE_MAX = 500;
/** Langues de l'app → codes de Brave (le portugais y est régional). */
const BRAVE_LANG: Record<string, string> = { pt: 'pt-pt' };

const httpsUrl = (v: unknown): string | undefined => (typeof v === 'string' && /^https:\/\/\S+$/.test(v) && v.length <= 2048 ? v : undefined);
const size = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined);

/** Réponse de Brave Search (images) → liste simple ; tout ce qui n'est pas une adresse https est écarté. */
export function parseBrave(body: unknown): ImageResult[] {
  const results = (body as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  const out: ImageResult[] = [];
  for (const r of results as Record<string, any>[]) {
    const thumbnail = httpsUrl(r?.thumbnail?.src);
    const url = httpsUrl(r?.properties?.url) ?? thumbnail;
    if (!thumbnail || !url) continue;
    const source = typeof r?.meta_url?.hostname === 'string' ? r.meta_url.hostname.slice(0, 100) : typeof r?.source === 'string' ? r.source.slice(0, 100) : undefined;
    out.push({ thumbnail, url, width: size(r?.properties?.width), height: size(r?.properties?.height), source });
  }
  return out;
}

/**
 * Recherche d'images pour la photo d'un produit (grille de vignettes dans l'app).
 *
 * Le serveur relaie la recherche vers Brave Search avec sa propre clé (BRAVE_SEARCH_KEY),
 * pour que la clé ne soit jamais dans l'app. Sans clé, la route répond 404 et l'app garde
 * la recherche dans le navigateur.
 *
 * Confidentialité : la requête (un nom de produit) est envoyée dans le corps (jamais dans
 * l'adresse, donc jamais dans les journaux), n'est pas enregistrée, et n'est gardée qu'en
 * mémoire, 24 h au plus, pour ne pas payer deux fois la même recherche.
 */
export async function imageRoutes(app: FastifyInstance, opts: { db: Db; config: Config; fetch?: Fetch }) {
  const { db, config } = opts;
  const doFetch: Fetch = opts.fetch ?? fetch;
  const limit = rateLimiter(config.imageSearchRateLimit);
  const device = requireDevice(db);
  const cache = new Map<string, { at: number; images: ImageResult[] }>();
  let month = '';
  let used = 0;

  // Serveur ouvert (relais public pour les téléphones sans partage) ou réservé aux appareils de ses foyers
  const access = async (request: FastifyRequest, reply: FastifyReply) => {
    await limit(request, reply);
    if (reply.sent || config.imageSearchPublic) return;
    await device(request, reply);
  };

  app.post(
    '/v1/images/search',
    {
      schema: {
        body: {
          type: 'object',
          required: ['q'],
          additionalProperties: false,
          properties: {
            q: { type: 'string', minLength: 1, maxLength: 120 },
            lang: { type: 'string', pattern: '^[a-z]{2}$', default: 'fr' },
          },
        },
      },
      preHandler: access,
    },
    async (request, reply) => {
      if (!config.braveSearchKey) return reply.code(404).send({ error: 'image_search_disabled' });
      const { q, lang } = request.body as { q: string; lang: string };
      const query = q.trim().replace(/\s+/g, ' ');
      if (!query) return reply.code(400).send({ error: 'empty_query' });
      const key = `${lang}|${query.toLowerCase()}`;
      const now = Date.now();
      const hit = cache.get(key);
      if (hit && now - hit.at < CACHE_MS) return { images: hit.images };

      // Plafond mensuel : pour rester dans le crédit gratuit de Brave (ou un budget choisi)
      const thisMonth = new Date(now).toISOString().slice(0, 7);
      if (thisMonth !== month) {
        month = thisMonth;
        used = 0;
      }
      if (config.imageSearchMonthlyLimit > 0 && used >= config.imageSearchMonthlyLimit) return reply.code(429).send({ error: 'monthly_limit' });
      used += 1;

      const url = new URL(BRAVE_URL);
      url.searchParams.set('q', query);
      url.searchParams.set('count', '30');
      url.searchParams.set('search_lang', BRAVE_LANG[lang] ?? lang);
      url.searchParams.set('safesearch', 'strict');
      url.searchParams.set('spellcheck', '1');
      let res: Response;
      try {
        res = await doFetch(url, { headers: { accept: 'application/json', 'x-subscription-token': config.braveSearchKey }, signal: AbortSignal.timeout(8000) });
      } catch {
        // Jamais la requête dans les journaux : seulement la cause
        app.log.warn('recherche d’images : Brave injoignable');
        return reply.code(502).send({ error: 'upstream_unreachable' });
      }
      if (!res.ok) {
        app.log.warn({ status: res.status }, 'recherche d’images : réponse de Brave');
        return reply.code(502).send({ error: 'upstream_error', status: res.status });
      }
      const images = parseBrave(await res.json().catch(() => null));
      if (cache.size >= CACHE_MAX) for (const [k, v] of cache) if (now - v.at >= CACHE_MS || cache.size >= CACHE_MAX) cache.delete(k);
      cache.set(key, { at: now, images });
      return { images };
    },
  );
}

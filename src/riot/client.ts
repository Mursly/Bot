import { logger } from '../logger.js';
import { RiotApiError, kindFromStatus } from './errors.js';
import { RateLimiter } from './rateLimiter.js';
import {
  accountRegionFor,
  hostFor,
  matchRegionFor,
  type Platform,
} from './routing.js';
import type { AccountDto, MatchDto, TimelineDto } from './types.js';

export interface RiotClientOptions {
  apiKey: string;
  /** Injectable pour les tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Nombre de tentatives supplémentaires après un échec récupérable. */
  maxRetries?: number;
  /** Délai d'attente d'une requête, en millisecondes. */
  timeoutMs?: number;
  rateLimiter?: RateLimiter;
}

export interface MatchIdsQuery {
  /** Borne basse, en **secondes** epoch (l'API attend des secondes, pas des ms). */
  startTime?: number;
  endTime?: number;
  queue?: number;
  type?: string;
  start?: number;
  count?: number;
}

const DEFAULT_SLEEP = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Client HTTP de l'API Riot.
 *
 * Trois responsabilités : construire les URL avec le bon routage régional,
 * respecter les limites de débit, et convertir les échecs en `RiotApiError`
 * explicites.
 */
export class RiotClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly limiter: RateLimiter;

  constructor(options: RiotClientOptions) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.sleep = options.sleep ?? DEFAULT_SLEEP;
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.limiter =
      options.rateLimiter ??
      new RateLimiter({
        // Limites d'une clé de développement Riot.
        windows: [
          { limit: 20, intervalMs: 1_000 },
          { limit: 100, intervalMs: 120_000 },
        ],
        ...(options.now ? { now: options.now } : {}),
        ...(options.sleep ? { sleep: options.sleep } : {}),
      });
  }

  // --- ACCOUNT-V1 ---------------------------------------------------------

  /** Résout un Riot ID « Pseudo#TAG » en compte (donc en PUUID). */
  async getAccountByRiotId(platform: Platform, gameName: string, tagLine: string): Promise<AccountDto> {
    const host = hostFor(accountRegionFor(platform));
    const path = `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    return this.request<AccountDto>(host, path);
  }

  async getAccountByPuuid(platform: Platform, puuid: string): Promise<AccountDto> {
    const host = hostFor(accountRegionFor(platform));
    return this.request<AccountDto>(host, `/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`);
  }

  // --- MATCH-V5 -----------------------------------------------------------

  async getMatchIds(platform: Platform, puuid: string, query: MatchIdsQuery = {}): Promise<string[]> {
    const host = hostFor(matchRegionFor(platform));
    const path = `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids`;
    return this.request<string[]>(host, path, query as Record<string, unknown>);
  }

  async getMatch(platform: Platform, matchId: string): Promise<MatchDto> {
    const host = hostFor(matchRegionFor(platform));
    return this.request<MatchDto>(host, `/lol/match/v5/matches/${encodeURIComponent(matchId)}`);
  }

  /**
   * Timeline d'une partie.
   * Elle n'est pas disponible pour tous les modes de jeu : un 404 est traité
   * comme une absence normale (`null`) et non comme une erreur.
   */
  async getTimeline(platform: Platform, matchId: string): Promise<TimelineDto | null> {
    const host = hostFor(matchRegionFor(platform));
    try {
      return await this.request<TimelineDto>(host, `/lol/match/v5/matches/${encodeURIComponent(matchId)}/timeline`);
    } catch (error) {
      if (error instanceof RiotApiError && error.kind === 'not_found') {
        logger.debug(`Timeline indisponible pour ${matchId}`);
        return null;
      }
      throw error;
    }
  }

  /** Vérifie que la clé répond, pour un diagnostic clair au démarrage. */
  async checkKey(platform: Platform): Promise<void> {
    const host = hostFor(accountRegionFor(platform));
    try {
      await this.request(host, '/riot/account/v1/accounts/by-riot-id/Ezreal/0000');
    } catch (error) {
      // 404 = la clé fonctionne, c'est le compte fictif qui n'existe pas.
      if (error instanceof RiotApiError && error.kind === 'not_found') return;
      throw error;
    }
  }

  // --- Transport ----------------------------------------------------------

  private async request<T>(host: string, path: string, query?: Record<string, unknown>): Promise<T> {
    const url = new URL(host + path);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
      }
    }

    let lastError: RiotApiError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      await this.limiter.acquire();

      let response: Response;
      try {
        response = await this.fetchImpl(url.toString(), {
          headers: { 'X-Riot-Token': this.apiKey, Accept: 'application/json' },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (cause) {
        lastError = new RiotApiError('network', `Échec réseau sur ${path}`, { cause });
        if (attempt < this.maxRetries) {
          await this.sleep(backoffMs(attempt));
          continue;
        }
        throw lastError;
      }

      if (response.ok) {
        return (await response.json()) as T;
      }

      const kind = kindFromStatus(response.status);
      const retryAfter = parseRetryAfter(response.headers.get('Retry-After'));
      lastError = new RiotApiError(kind, `HTTP ${response.status} sur ${path}`, {
        status: response.status,
        ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
      });

      if (kind === 'rate_limited') {
        // Riot indique combien de temps attendre : on suit cette consigne plutôt
        // que notre propre backoff.
        const wait = retryAfter ?? 5;
        this.limiter.setCooldown(wait);
        logger.warn(`Limite de débit Riot atteinte, pause de ${wait}s`, { path });
        if (attempt < this.maxRetries) {
          await this.sleep(wait * 1000);
          continue;
        }
      } else if (lastError.isRetryable && attempt < this.maxRetries) {
        await this.sleep(backoffMs(attempt));
        continue;
      }

      throw lastError;
    }

    throw lastError ?? new RiotApiError('unknown', `Échec de la requête ${path}`);
  }
}

/** Backoff exponentiel 1s, 2s, 4s… plafonné à 30s. */
export function backoffMs(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** attempt);
}

/**
 * Retry-After peut être un nombre de secondes ou une date HTTP.
 * Les deux formes sont acceptées par la spécification HTTP ; Riot utilise la
 * première, mais accepter la seconde ne coûte rien.
 */
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

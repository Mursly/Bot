import { logger } from '../logger.js';

/**
 * Data Dragon — le CDN de ressources statiques officiel de Riot.
 *
 * Les portraits de champions y sont accessibles sans clé d'API :
 *   https://ddragon.leagueoflegends.com/cdn/<version>/img/champion/<Champion>.png
 *
 * La liste des versions publiées est donnée par
 *   https://ddragon.leagueoflegends.com/api/versions.json
 * dont le premier élément est la plus récente. On la récupère au besoin et on
 * la met en cache : elle ne change qu'à chaque patch.
 */

const VERSIONS_URL = 'https://ddragon.leagueoflegends.com/api/versions.json';
const CDN_BASE = 'https://ddragon.leagueoflegends.com/cdn';

/**
 * Version de repli utilisée si le CDN est injoignable. Elle peut être en retard
 * sur le patch courant ; les portraits des champions déjà sortis restent servis,
 * ce qui suffit pour ne jamais casser l'affichage.
 */
const FALLBACK_VERSION = '15.18.1';

export interface DataDragonOptions {
  fetchImpl?: typeof fetch;
  /** Durée de validité du cache de version, en millisecondes (12 h par défaut). */
  cacheTtlMs?: number;
  now?: () => number;
}

export class DataDragon {
  private readonly fetchImpl: typeof fetch;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private cachedVersion: string | null = null;
  private cachedAt = 0;
  private inFlight: Promise<string> | null = null;
  private championIds: Set<string> | null = null;
  private championIdsVersion: string | null = null;
  private championsInFlight: Promise<Set<string> | null> | null = null;

  constructor(options: DataDragonOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.cacheTtlMs = options.cacheTtlMs ?? 12 * 60 * 60 * 1000;
    this.now = options.now ?? (() => Date.now());
  }

  async getLatestVersion(): Promise<string> {
    const now = this.now();
    if (this.cachedVersion && now - this.cachedAt < this.cacheTtlMs) return this.cachedVersion;
    if (this.inFlight) return this.inFlight;

    this.inFlight = (async () => {
      try {
        const response = await this.fetchImpl(VERSIONS_URL, { signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const versions = (await response.json()) as unknown;
        if (!Array.isArray(versions) || typeof versions[0] !== 'string') {
          throw new Error('Réponse versions.json inattendue');
        }
        this.cachedVersion = versions[0];
        this.cachedAt = this.now();
        return this.cachedVersion;
      } catch (error) {
        logger.warn('Version Data Dragon indisponible, utilisation de la version de repli', error);
        // On ne met pas à jour cachedAt : une nouvelle tentative aura lieu plus tard.
        return this.cachedVersion ?? FALLBACK_VERSION;
      } finally {
        this.inFlight = null;
      }
    })();

    return this.inFlight;
  }

  /**
   * Liste des identifiants de champions du patch courant.
   * Sert à ne jamais produire d'URL de portrait pointant vers un fichier absent.
   * Renvoie `null` si le CDN est injoignable — on reste alors permissif.
   */
  private async getChampionIds(version: string): Promise<Set<string> | null> {
    if (this.championIds && this.championIdsVersion === version) return this.championIds;
    if (this.championsInFlight) return this.championsInFlight;

    this.championsInFlight = (async () => {
      try {
        const response = await this.fetchImpl(`${CDN_BASE}/${version}/data/en_US/champion.json`, {
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as { data?: Record<string, unknown> };
        if (!body.data) throw new Error('champion.json inattendu');
        this.championIds = new Set(Object.keys(body.data));
        this.championIdsVersion = version;
        return this.championIds;
      } catch (error) {
        logger.warn('Liste des champions Data Dragon indisponible', error);
        return null;
      } finally {
        this.championsInFlight = null;
      }
    })();

    return this.championsInFlight;
  }

  /**
   * URL du portrait carré d'un champion, à partir du `championName` de MATCH-V5.
   *
   * MATCH-V5 renvoie déjà l'identifiant Data Dragon (« Nunu », « Kaisa »,
   * « MonkeyKing »…), tous alphanumériques. La normalisation n'est qu'un filet
   * de sécurité, et l'identifiant est vérifié contre la liste officielle du
   * patch : un champion inconnu ne produit pas d'URL plutôt qu'une image morte.
   */
  async championSquareUrl(championName: string): Promise<string | null> {
    const key = normalizeChampionKey(championName);
    if (!key) return null;

    const version = await this.getLatestVersion();
    const known = await this.getChampionIds(version);
    if (known && !known.has(key)) {
      logger.warn(`Champion « ${championName} » absent de Data Dragon ${version} : aucun portrait affiché.`);
      return null;
    }

    return `${CDN_BASE}/${version}/img/champion/${key}.png`;
  }
}

/**
 * MATCH-V5 renvoie déjà la clé Data Dragon dans `championName`
 * (« MonkeyKing », « Nunu&Willump », « FiddleSticks »…). On se contente de
 * retirer les caractères qui n'existent pas dans les noms de fichiers du CDN.
 */
export function normalizeChampionKey(championName: string | undefined | null): string | null {
  if (!championName) return null;
  const cleaned = championName.replace(/[^A-Za-z0-9]/g, '');
  return cleaned.length > 0 ? cleaned : null;
}

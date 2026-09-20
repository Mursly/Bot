import type { Db } from './db.js';
import type { Platform } from '../riot/routing.js';

export interface TrackedPlayer {
  guildId: string;
  gameName: string;
  tagLine: string;
  riotId: string;
  puuid: string;
  platform: Platform;
  channelId: string;
  sinceMs: number;
  queueFilter: string[] | null;
  createdAt: number;
  updatedAt: number;
  lastCheckedAt: number | null;
  lastError: string | null;
}

export interface ProcessedMatch {
  guildId: string;
  matchId: string;
  puuid: string;
  channelId: string | null;
  messageId: string | null;
  gameEndMs: number | null;
  processedAt: number;
  published: boolean;
  statsJson: string | null;
  reportJson: string | null;
}

interface TrackedRow {
  guild_id: string;
  game_name: string;
  tag_line: string;
  puuid: string;
  platform: string;
  channel_id: string;
  since_ms: number;
  queue_filter: string | null;
  created_at: number;
  updated_at: number;
  last_checked_at: number | null;
  last_error: string | null;
}

interface ProcessedRow {
  guild_id: string;
  match_id: string;
  puuid: string;
  channel_id: string | null;
  message_id: string | null;
  game_end_ms: number | null;
  processed_at: number;
  published: number;
  stats_json: string | null;
  report_json: string | null;
}

function toTracked(row: TrackedRow): TrackedPlayer {
  return {
    guildId: row.guild_id,
    gameName: row.game_name,
    tagLine: row.tag_line,
    riotId: `${row.game_name}#${row.tag_line}`,
    puuid: row.puuid,
    platform: row.platform as Platform,
    channelId: row.channel_id,
    sinceMs: row.since_ms,
    queueFilter: row.queue_filter ? row.queue_filter.split(',').filter(Boolean) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastCheckedAt: row.last_checked_at,
    lastError: row.last_error,
  };
}

function toProcessed(row: ProcessedRow): ProcessedMatch {
  return {
    guildId: row.guild_id,
    matchId: row.match_id,
    puuid: row.puuid,
    channelId: row.channel_id,
    messageId: row.message_id,
    gameEndMs: row.game_end_ms,
    processedAt: row.processed_at,
    published: row.published === 1,
    statsJson: row.stats_json,
    reportJson: row.report_json,
  };
}

export interface SetTrackingInput {
  guildId: string;
  gameName: string;
  tagLine: string;
  puuid: string;
  platform: Platform;
  channelId: string;
  sinceMs: number;
  queueFilter: string[] | null;
}

/**
 * Accès aux données. Toutes les écritures passent par ici afin que la logique
 * de dédoublonnage reste au même endroit.
 */
export class Repository {
  constructor(private readonly db: Db) {}

  // --- Suivi --------------------------------------------------------------

  setTracking(input: SetTrackingInput, now = Date.now()): TrackedPlayer {
    this.db
      .prepare(
        `INSERT INTO tracked_players
           (guild_id, game_name, tag_line, puuid, platform, channel_id, since_ms,
            queue_filter, created_at, updated_at, last_checked_at, last_error)
         VALUES (@guild_id, @game_name, @tag_line, @puuid, @platform, @channel_id, @since_ms,
                 @queue_filter, @now, @now, NULL, NULL)
         ON CONFLICT(guild_id) DO UPDATE SET
           game_name    = excluded.game_name,
           tag_line     = excluded.tag_line,
           puuid        = excluded.puuid,
           platform     = excluded.platform,
           channel_id   = excluded.channel_id,
           since_ms     = excluded.since_ms,
           queue_filter = excluded.queue_filter,
           updated_at   = excluded.updated_at,
           last_error   = NULL`,
      )
      .run({
        guild_id: input.guildId,
        game_name: input.gameName,
        tag_line: input.tagLine,
        puuid: input.puuid,
        platform: input.platform,
        channel_id: input.channelId,
        since_ms: input.sinceMs,
        queue_filter: input.queueFilter && input.queueFilter.length > 0 ? input.queueFilter.join(',') : null,
        now,
      });

    const tracked = this.getTracking(input.guildId);
    if (!tracked) throw new Error('Le suivi vient d’être écrit mais reste introuvable.');
    return tracked;
  }

  getTracking(guildId: string): TrackedPlayer | null {
    const row = this.db.prepare('SELECT * FROM tracked_players WHERE guild_id = ?').get(guildId) as
      | TrackedRow
      | undefined;
    return row ? toTracked(row) : null;
  }

  listTracking(): TrackedPlayer[] {
    const rows = this.db.prepare('SELECT * FROM tracked_players').all() as TrackedRow[];
    return rows.map(toTracked);
  }

  deleteTracking(guildId: string): boolean {
    return this.db.prepare('DELETE FROM tracked_players WHERE guild_id = ?').run(guildId).changes > 0;
  }

  markChecked(guildId: string, now = Date.now(), error: string | null = null): void {
    this.db
      .prepare('UPDATE tracked_players SET last_checked_at = ?, last_error = ? WHERE guild_id = ?')
      .run(now, error, guildId);
  }

  // --- Parties ------------------------------------------------------------

  /**
   * Réserve une partie pour publication.
   *
   * L'insertion `OR IGNORE` sur la clé primaire (guild_id, match_id) est la
   * garantie anti-doublon : si la ligne existe déjà — y compris à cause d'un
   * redémarrage au milieu du traitement — `changes` vaut 0 et l'appelant sait
   * qu'il ne doit rien republier.
   */
  claimMatch(guildId: string, matchId: string, puuid: string, gameEndMs: number | null, now = Date.now()): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO processed_matches
           (guild_id, match_id, puuid, game_end_ms, processed_at, published)
         VALUES (?, ?, ?, ?, ?, 0)`,
      )
      .run(guildId, matchId, puuid, gameEndMs, now);
    return result.changes > 0;
  }

  /** Libère une réservation dont la publication a échoué, pour réessayer plus tard. */
  releaseMatch(guildId: string, matchId: string): void {
    this.db
      .prepare('DELETE FROM processed_matches WHERE guild_id = ? AND match_id = ? AND published = 0')
      .run(guildId, matchId);
  }

  markPublished(
    guildId: string,
    matchId: string,
    details: { channelId: string; messageId: string; statsJson: string; reportJson: string },
    now = Date.now(),
  ): void {
    this.db
      .prepare(
        `UPDATE processed_matches
            SET channel_id = ?, message_id = ?, stats_json = ?, report_json = ?, published = 1, processed_at = ?
          WHERE guild_id = ? AND match_id = ?`,
      )
      .run(details.channelId, details.messageId, details.statsJson, details.reportJson, now, guildId, matchId);
  }

  /**
   * Marque une partie comme définitivement traitée sans publication (mode non
   * suivi, partie antérieure au début du suivi…). La ligne reste en base pour
   * que la partie ne soit plus jamais réexaminée.
   */
  markSkipped(guildId: string, matchId: string, reason: string, now = Date.now()): void {
    this.db
      .prepare(
        `UPDATE processed_matches
            SET published = 1, message_id = NULL, report_json = ?, processed_at = ?
          WHERE guild_id = ? AND match_id = ?`,
      )
      .run(JSON.stringify({ skipped: reason }), now, guildId, matchId);
  }

  isProcessed(guildId: string, matchId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 AS present FROM processed_matches WHERE guild_id = ? AND match_id = ?')
      .get(guildId, matchId);
    return row !== undefined;
  }

  getLastPublishedMatch(guildId: string): ProcessedMatch | null {
    const row = this.db
      .prepare(
        `SELECT * FROM processed_matches
          WHERE guild_id = ? AND published = 1 AND message_id IS NOT NULL
          ORDER BY COALESCE(game_end_ms, processed_at) DESC
          LIMIT 1`,
      )
      .get(guildId) as ProcessedRow | undefined;
    return row ? toProcessed(row) : null;
  }

  countPublished(guildId: string): number {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) AS total FROM processed_matches WHERE guild_id = ? AND published = 1 AND message_id IS NOT NULL',
      )
      .get(guildId) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  /** Supprime les réservations jamais publiées, pour qu'un redémarrage puisse réessayer. */
  clearUnpublished(): number {
    return this.db.prepare('DELETE FROM processed_matches WHERE published = 0').run().changes;
  }

  // --- Cache d'analyses ---------------------------------------------------

  getCachedAnalysis(cacheKey: string): string | null {
    const row = this.db.prepare('SELECT payload FROM analysis_cache WHERE cache_key = ?').get(cacheKey) as
      | { payload: string }
      | undefined;
    return row?.payload ?? null;
  }

  putCachedAnalysis(
    cacheKey: string,
    details: { matchId: string; puuid: string; source: string; payload: string },
    now = Date.now(),
  ): void {
    this.db
      .prepare(
        `INSERT INTO analysis_cache (cache_key, match_id, puuid, source, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at`,
      )
      .run(cacheKey, details.matchId, details.puuid, details.source, details.payload, now);
  }
}

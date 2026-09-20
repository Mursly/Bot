import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

const SCHEMA_VERSION = 1;

/**
 * Ouvre (et crée au besoin) la base SQLite.
 *
 * Le mode WAL est activé : il permet au poller d'écrire pendant qu'une commande
 * slash lit, sans blocage. `foreign_keys` est activé par principe même si le
 * schéma actuel n'en utilise pas encore.
 */
export function openDatabase(path: string): Db {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const current = Number(db.pragma('user_version', { simple: true }) ?? 0);
  if (current >= SCHEMA_VERSION) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS tracked_players (
      guild_id        TEXT PRIMARY KEY,
      game_name       TEXT NOT NULL,
      tag_line        TEXT NOT NULL,
      puuid           TEXT NOT NULL,
      platform        TEXT NOT NULL,
      channel_id      TEXT NOT NULL,
      -- Horodatage (ms) à partir duquel les parties sont publiées. Il est posé
      -- au moment de /suivre pour ne jamais republier l'historique du joueur.
      since_ms        INTEGER NOT NULL,
      queue_filter    TEXT,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL,
      last_checked_at INTEGER,
      last_error      TEXT
    );

    -- Table de dédoublonnage : la clé primaire garantit qu'une partie ne peut
    -- être publiée qu'une fois par serveur, y compris après un redémarrage.
    CREATE TABLE IF NOT EXISTS processed_matches (
      guild_id     TEXT NOT NULL,
      match_id     TEXT NOT NULL,
      puuid        TEXT NOT NULL,
      channel_id   TEXT,
      message_id   TEXT,
      game_end_ms  INTEGER,
      processed_at INTEGER NOT NULL,
      published    INTEGER NOT NULL DEFAULT 0,
      stats_json   TEXT,
      report_json  TEXT,
      PRIMARY KEY (guild_id, match_id)
    );

    CREATE INDEX IF NOT EXISTS idx_processed_recent
      ON processed_matches (guild_id, processed_at DESC);

    -- Cache d'analyses : évite de repayer l'IA pour une même partie.
    CREATE TABLE IF NOT EXISTS analysis_cache (
      cache_key  TEXT PRIMARY KEY,
      match_id   TEXT NOT NULL,
      puuid      TEXT NOT NULL,
      source     TEXT NOT NULL,
      payload    TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

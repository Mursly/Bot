import 'dotenv/config';
import { isPlatform, type Platform } from './riot/routing.js';
import type { LogLevel } from './logger.js';

export interface AppConfig {
  discordToken: string;
  discordClientId: string;
  discordGuildId: string | null;
  riotApiKey: string;
  anthropicApiKey: string | null;
  anthropicModel: string;
  anthropicMaxTokens: number;
  pollIntervalSeconds: number;
  databasePath: string;
  logLevel: LogLevel;
  defaultPlatform: Platform;
}

export class ConfigError extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super(`Configuration incomplète : ${missing.join(', ')}`);
    this.name = 'ConfigError';
    this.missing = missing;
  }
}

/** Intervalle minimum entre deux sondages, pour ne pas maltraiter l'API Riot. */
const MIN_POLL_SECONDS = 30;
const DEFAULT_POLL_SECONDS = 90;

function readString(name: string): string | null {
  const value = process.env[name];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readInt(name: string, fallback: number): number {
  const raw = readString(name);
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const previous = process.env;
  if (env !== process.env) process.env = env;
  try {
    const missing: string[] = [];

    const discordToken = readString('DISCORD_TOKEN');
    if (!discordToken) missing.push('DISCORD_TOKEN');

    const discordClientId = readString('DISCORD_CLIENT_ID');
    if (!discordClientId) missing.push('DISCORD_CLIENT_ID');

    const riotApiKey = readString('RIOT_API_KEY');
    if (!riotApiKey) missing.push('RIOT_API_KEY');

    if (missing.length > 0) throw new ConfigError(missing);

    const rawPlatform = (readString('DEFAULT_PLATFORM') ?? 'euw1').toLowerCase();
    const defaultPlatform: Platform = isPlatform(rawPlatform) ? rawPlatform : 'euw1';

    const rawLevel = (readString('LOG_LEVEL') ?? 'info').toLowerCase();
    const logLevel: LogLevel =
      rawLevel === 'debug' || rawLevel === 'info' || rawLevel === 'warn' || rawLevel === 'error' ? rawLevel : 'info';

    const pollIntervalSeconds = Math.max(MIN_POLL_SECONDS, readInt('POLL_INTERVAL_SECONDS', DEFAULT_POLL_SECONDS));

    return {
      discordToken: discordToken as string,
      discordClientId: discordClientId as string,
      discordGuildId: readString('DISCORD_GUILD_ID'),
      riotApiKey: riotApiKey as string,
      anthropicApiKey: readString('ANTHROPIC_API_KEY'),
      anthropicModel: readString('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-5',
      anthropicMaxTokens: Math.max(200, readInt('ANTHROPIC_MAX_TOKENS', 700)),
      pollIntervalSeconds,
      databasePath: readString('DATABASE_PATH') ?? './data/ezreal.sqlite',
      logLevel,
      defaultPlatform,
    };
  } finally {
    if (env !== previous) process.env = previous;
  }
}

/** Message d'aide affiché quand il manque des variables d'environnement. */
export function describeMissing(error: ConfigError): string {
  const help: Record<string, string> = {
    DISCORD_TOKEN: "Jeton du bot — portail développeur Discord, onglet « Bot » → « Reset Token ».",
    DISCORD_CLIENT_ID: "Identifiant de l'application — onglet « General Information » → « Application ID ».",
    RIOT_API_KEY: 'Clé API Riot — https://developer.riotgames.com/ (une clé de développement expire au bout de 24 h).',
  };
  const lines = error.missing.map((name) => `  - ${name} : ${help[name] ?? 'valeur manquante'}`);
  return [
    "Ezreal ne peut pas démarrer : des variables d'environnement sont manquantes.",
    ...lines,
    '',
    'Copiez le fichier .env.example en .env puis remplissez ces valeurs.',
  ].join('\n');
}

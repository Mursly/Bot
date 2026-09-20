import { describeQueue, isRankedQueue, isSummonersRift, queueInfo } from '../riot/queues.js';
import type { InfoDto, MatchDto, ParticipantDto } from '../riot/types.js';

/**
 * Tous les chiffres affichés ou transmis à l'IA sont calculés ici, en TypeScript.
 * Le modèle de langage ne fait jamais d'arithmétique : il reçoit des valeurs
 * déjà calculées et se contente de les mettre en mots.
 */

export type RoleKey = 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY';

export const ROLE_LABELS: Record<RoleKey, string> = {
  TOP: 'Top',
  JUNGLE: 'Jungle',
  MIDDLE: 'Mid',
  BOTTOM: 'ADC',
  UTILITY: 'Support',
};

export interface MatchStats {
  matchId: string;
  puuid: string;
  riotId: string;
  championName: string;

  /** `null` quand Riot ne fournit pas de position exploitable (ARAM, Arena…). */
  role: RoleKey | null;
  roleLabel: string | null;

  queueId: number | undefined;
  queueLabel: string;
  gameMode: string | undefined;
  summonersRift: boolean;
  ranked: boolean;

  win: boolean;
  /** Partie annulée avant la 4e minute : ni victoire ni défaite exploitable. */
  remake: boolean;
  surrendered: boolean;

  durationSeconds: number;
  durationMinutes: number;
  durationLabel: string;
  gameEndTimestamp: number | undefined;

  kills: number;
  deaths: number;
  assists: number;
  /** `null` = aucune mort (le ratio serait une division par zéro). */
  kda: number | null;

  cs: number;
  csPerMinute: number;

  /** Part des éliminations de l'équipe (0-1). `null` si l'équipe n'a tué personne. */
  killParticipation: number | null;
  teamKills: number;
  teamDeaths: number;

  damageToChampions: number | undefined;
  damagePerMinute: number | null;
  /** Part des dégâts aux champions de l'équipe (0-1). */
  damageShare: number | null;

  visionScore: number | undefined;
  visionPerMinute: number | null;
  wardsPlaced: number | undefined;
  controlWardsPlaced: number | undefined;
  wardsKilled: number | undefined;

  goldEarned: number | undefined;
  goldPerMinute: number | null;

  soloKills: number | undefined;
  turretTakedowns: number | undefined;
  dragonTakedowns: number | undefined;
  baronTakedowns: number | undefined;
  healShieldOnTeammates: number | undefined;

  /** Temps passé mort, et sa part sur la durée totale de la partie (0-1). */
  timeSpentDeadSeconds: number | undefined;
  deathTimeShare: number | null;

  teamObjectives: { dragons: number; barons: number; heralds: number; towers: number } | null;
  enemyObjectives: { dragons: number; barons: number; heralds: number; towers: number } | null;

  championPortraitName: string;
}

/**
 * Durée de la partie en secondes.
 *
 * Particularité documentée de MATCH-V5 : `gameDuration` est exprimée en
 * secondes lorsque `gameEndTimestamp` est renseigné, et en millisecondes sur
 * les parties antérieures au patch 11.20. On s'appuie donc sur la présence de
 * `gameEndTimestamp` pour trancher, avec un repli sur l'écart entre début et
 * fin de partie.
 */
export function resolveDurationSeconds(info: Pick<InfoDto, 'gameDuration' | 'gameEndTimestamp' | 'gameStartTimestamp'>): number {
  const { gameDuration, gameEndTimestamp, gameStartTimestamp } = info;

  if (typeof gameDuration === 'number' && gameDuration > 0) {
    if (gameEndTimestamp !== undefined) return Math.round(gameDuration);
    return Math.round(gameDuration / 1000);
  }

  if (typeof gameEndTimestamp === 'number' && typeof gameStartTimestamp === 'number' && gameEndTimestamp > gameStartTimestamp) {
    return Math.round((gameEndTimestamp - gameStartTimestamp) / 1000);
  }

  return 0;
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes} min ${String(rest).padStart(2, '0')} s`;
}

export function normalizeRole(participant: ParticipantDto): RoleKey | null {
  const candidates = [participant.teamPosition, participant.individualPosition];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const upper = candidate.toUpperCase();
    if (upper === 'TOP' || upper === 'JUNGLE' || upper === 'MIDDLE' || upper === 'BOTTOM' || upper === 'UTILITY') {
      return upper;
    }
  }
  return null;
}

/**
 * Une partie « remake » est annulée très tôt (déconnexion d'un joueur).
 * Le drapeau Riot fait foi ; en son absence, une partie de moins de 5 minutes
 * est traitée comme telle.
 */
export function detectRemake(participant: ParticipantDto, durationSeconds: number): boolean {
  if (typeof participant.gameEndedInEarlySurrender === 'boolean') {
    return participant.gameEndedInEarlySurrender;
  }
  return durationSeconds > 0 && durationSeconds < 300;
}

function ratio(numerator: number | undefined, denominator: number): number | null {
  if (numerator === undefined || !Number.isFinite(numerator)) return null;
  if (denominator <= 0) return null;
  return numerator / denominator;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function findParticipant(match: MatchDto, puuid: string): ParticipantDto | undefined {
  return match.info.participants.find((participant) => participant.puuid === puuid);
}

export function computeMatchStats(match: MatchDto, puuid: string): MatchStats {
  const me = findParticipant(match, puuid);
  if (!me) {
    throw new Error(`Le joueur ${puuid} ne figure pas dans la partie ${match.metadata.matchId}`);
  }

  const info = match.info;
  const durationSeconds = resolveDurationSeconds(info);
  // Une durée nulle rendrait toute moyenne « par minute » absurde : on la
  // neutralise plutôt que de produire des Infinity.
  const durationMinutes = durationSeconds > 0 ? durationSeconds / 60 : 0;

  const allies = info.participants.filter((participant) => participant.teamId === me.teamId);
  const teamKills = allies.reduce((sum, participant) => sum + (participant.kills ?? 0), 0);
  const teamDeaths = allies.reduce((sum, participant) => sum + (participant.deaths ?? 0), 0);
  const teamDamage = allies.reduce((sum, participant) => sum + (participant.totalDamageDealtToChampions ?? 0), 0);

  const cs = (me.totalMinionsKilled ?? 0) + (me.neutralMinionsKilled ?? 0);
  const remake = detectRemake(me, durationSeconds);
  const role = normalizeRole(me);

  const myTeam = info.teams?.find((team) => team.teamId === me.teamId);
  const otherTeam = info.teams?.find((team) => team.teamId !== me.teamId);

  const objectivesOf = (team: typeof myTeam) =>
    team?.objectives
      ? {
          dragons: team.objectives.dragon?.kills ?? 0,
          barons: team.objectives.baron?.kills ?? 0,
          heralds: team.objectives.riftHerald?.kills ?? 0,
          towers: team.objectives.tower?.kills ?? 0,
        }
      : null;

  const killParticipation = teamKills > 0 ? (me.kills + me.assists) / teamKills : null;
  const damageShare = teamDamage > 0 ? ratio(me.totalDamageDealtToChampions, teamDamage) : null;

  const riotId =
    me.riotIdGameName && me.riotIdTagline
      ? `${me.riotIdGameName}#${me.riotIdTagline}`
      : (me.summonerName ?? 'Joueur inconnu');

  return {
    matchId: match.metadata.matchId,
    puuid,
    riotId,
    championName: me.championName,

    role,
    roleLabel: role ? ROLE_LABELS[role] : null,

    queueId: info.queueId,
    queueLabel: describeQueue(info.queueId, info.gameMode),
    gameMode: info.gameMode,
    summonersRift: isSummonersRift(info.queueId, info.mapId),
    ranked: isRankedQueue(info.queueId),

    win: me.win === true,
    remake,
    surrendered: me.gameEndedInSurrender === true && !remake,

    durationSeconds,
    durationMinutes: round(durationMinutes, 2),
    durationLabel: formatDuration(durationSeconds),
    gameEndTimestamp: info.gameEndTimestamp,

    kills: me.kills,
    deaths: me.deaths,
    assists: me.assists,
    kda: me.deaths > 0 ? round((me.kills + me.assists) / me.deaths, 2) : null,

    cs,
    csPerMinute: durationMinutes > 0 ? round(cs / durationMinutes, 1) : 0,

    killParticipation: killParticipation === null ? null : round(killParticipation, 3),
    teamKills,
    teamDeaths,

    damageToChampions: me.totalDamageDealtToChampions,
    damagePerMinute: round0(ratio(me.totalDamageDealtToChampions, durationMinutes)),
    damageShare: damageShare === null ? null : round(damageShare, 3),

    visionScore: me.visionScore,
    visionPerMinute: round2(ratio(me.visionScore, durationMinutes)),
    wardsPlaced: me.wardsPlaced,
    controlWardsPlaced: me.detectorWardsPlaced ?? me.visionWardsBoughtInGame,
    wardsKilled: me.wardsKilled,

    goldEarned: me.goldEarned,
    goldPerMinute: round0(ratio(me.goldEarned, durationMinutes)),

    soloKills: me.challenges?.soloKills,
    turretTakedowns: me.turretTakedowns,
    dragonTakedowns: me.dragonKills,
    baronTakedowns: me.baronKills,
    healShieldOnTeammates:
      me.totalHealsOnTeammates === undefined && me.totalDamageShieldedOnTeammates === undefined
        ? undefined
        : (me.totalHealsOnTeammates ?? 0) + (me.totalDamageShieldedOnTeammates ?? 0),

    timeSpentDeadSeconds: me.totalTimeSpentDead,
    deathTimeShare: round3(ratio(me.totalTimeSpentDead, durationSeconds)),

    teamObjectives: objectivesOf(myTeam),
    enemyObjectives: objectivesOf(otherTeam),

    championPortraitName: me.championName,
  };
}

function round0(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}

function round2(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

function round3(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 1000;
}

/** Repères d'affichage : « 7,2 » plutôt que « 7.2 » en français. */
export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return value.toFixed(decimals).replace('.', ',');
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return `${Math.round(value * 100)} %`;
}

export function formatInteger(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return Math.round(value).toLocaleString('fr-FR');
}

export { queueInfo };

import type { EventTimelineDto, FrameTimelineDto, MatchDto, TimelineDto } from '../riot/types.js';
import type { RoleKey } from './stats.js';

/**
 * Extraction de faits **vérifiables** depuis la timeline MATCH-V5.
 *
 * Règle de conception : on ne produit ici que des observations directement
 * lisibles dans les données (un compteur, un horodatage, un écart). Aucune
 * interprétation causale n'est faite à ce niveau. En particulier, une mort
 * survenue juste avant la prise d'un objectif par l'équipe adverse est
 * enregistrée comme une **proximité temporelle**, jamais comme une cause :
 * la timeline ne dit pas qui était où ni pourquoi.
 */

export interface ObjectiveEvent {
  /** « DRAGON » | « BARON_NASHOR » | « RIFTHERALD » | « HORDE » | « ATAKHAN » */
  type: string;
  subType: string | undefined;
  secondsIntoGame: number;
  byMyTeam: boolean;
}

export interface DeathBeforeObjective {
  deathSeconds: number;
  objectiveType: string;
  objectiveSeconds: number;
  gapSeconds: number;
}

export interface TimelineFacts {
  available: boolean;
  /** Minute du dernier relevé exploitable (utile pour savoir jusqu'où les repères valent). */
  lastFrameMinute: number | null;

  csAt10: number | null;
  csAt14: number | null;
  goldAt10: number | null;
  goldAt15: number | null;
  levelAt10: number | null;

  laneOpponentChampion: string | null;
  csDiffAt10: number | null;
  goldDiffAt10: number | null;

  deathSecondsList: number[];
  firstDeathSeconds: number | null;
  deathsBefore10Min: number;
  deathsBetween10And20Min: number;
  deathsAfter20Min: number;

  wardsPlacedFromTimeline: number | null;

  objectives: ObjectiveEvent[];
  /**
   * Morts suivies de près par la prise d'un objectif adverse.
   * Proximité temporelle uniquement — voir la note en tête de fichier.
   */
  deathsShortlyBeforeEnemyObjective: DeathBeforeObjective[];
}

export const EMPTY_TIMELINE_FACTS: TimelineFacts = {
  available: false,
  lastFrameMinute: null,
  csAt10: null,
  csAt14: null,
  goldAt10: null,
  goldAt15: null,
  levelAt10: null,
  laneOpponentChampion: null,
  csDiffAt10: null,
  goldDiffAt10: null,
  deathSecondsList: [],
  firstDeathSeconds: null,
  deathsBefore10Min: 0,
  deathsBetween10And20Min: 0,
  deathsAfter20Min: 0,
  wardsPlacedFromTimeline: null,
  objectives: [],
  deathsShortlyBeforeEnemyObjective: [],
};

/** Fenêtre, en secondes, dans laquelle une mort est jugée « proche » d'un objectif. */
const OBJECTIVE_PROXIMITY_SECONDS = 45;

const ELITE_MONSTERS = new Set(['DRAGON', 'BARON_NASHOR', 'RIFTHERALD', 'HORDE', 'ATAKHAN']);

/**
 * Retrouve le frame correspondant à une minute donnée.
 * Renvoie `null` si la partie s'est terminée avant : on préfère une donnée
 * absente à une donnée extrapolée.
 */
export function frameAtMinute(frames: FrameTimelineDto[], minute: number, frameIntervalMs = 60_000): FrameTimelineDto | null {
  const targetMs = minute * 60_000;
  const tolerance = Math.max(frameIntervalMs / 2, 1);
  let best: FrameTimelineDto | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (const frame of frames) {
    const timestamp = frame.timestamp;
    if (typeof timestamp !== 'number') continue;
    const delta = Math.abs(timestamp - targetMs);
    if (delta <= tolerance && delta < bestDelta) {
      best = frame;
      bestDelta = delta;
    }
  }
  return best;
}

function participantIdFor(match: MatchDto, timeline: TimelineDto, puuid: string): number | null {
  const fromTimeline = timeline.info.participants?.find((entry) => entry.puuid === puuid)?.participantId;
  if (typeof fromTimeline === 'number') return fromTimeline;
  const fromMatch = match.info.participants.find((entry) => entry.puuid === puuid)?.participantId;
  return typeof fromMatch === 'number' ? fromMatch : null;
}

function frameCs(frame: FrameTimelineDto | null, participantId: number): number | null {
  const entry = frame?.participantFrames?.[String(participantId)];
  if (!entry) return null;
  const minions = entry.minionsKilled ?? 0;
  const jungle = entry.jungleMinionsKilled ?? 0;
  return minions + jungle;
}

function frameGold(frame: FrameTimelineDto | null, participantId: number): number | null {
  const entry = frame?.participantFrames?.[String(participantId)];
  return typeof entry?.totalGold === 'number' ? entry.totalGold : null;
}

/** Adversaire direct : même position, équipe opposée. */
function findLaneOpponent(match: MatchDto, puuid: string, role: RoleKey | null) {
  if (!role) return null;
  const me = match.info.participants.find((participant) => participant.puuid === puuid);
  if (!me) return null;
  return (
    match.info.participants.find(
      (participant) =>
        participant.teamId !== me.teamId && (participant.teamPosition ?? '').toUpperCase() === role,
    ) ?? null
  );
}

export function extractTimelineFacts(
  match: MatchDto,
  timeline: TimelineDto | null,
  puuid: string,
  role: RoleKey | null,
): TimelineFacts {
  if (!timeline?.info?.frames?.length) return { ...EMPTY_TIMELINE_FACTS };

  const participantId = participantIdFor(match, timeline, puuid);
  if (participantId === null) return { ...EMPTY_TIMELINE_FACTS };

  const me = match.info.participants.find((participant) => participant.puuid === puuid);
  const myTeamId = me?.teamId;

  const frames = timeline.info.frames;
  const frameIntervalMs = timeline.info.frameInterval ?? 60_000;

  const frame10 = frameAtMinute(frames, 10, frameIntervalMs);
  const frame14 = frameAtMinute(frames, 14, frameIntervalMs);
  const frame15 = frameAtMinute(frames, 15, frameIntervalMs);

  const lastTimestamp = frames.reduce((max, frame) => Math.max(max, frame.timestamp ?? 0), 0);

  const opponent = findLaneOpponent(match, puuid, role);
  const opponentId = opponent?.participantId;

  const csAt10 = frameCs(frame10, participantId);
  const goldAt10 = frameGold(frame10, participantId);
  const opponentCsAt10 = opponentId !== undefined ? frameCs(frame10, opponentId) : null;
  const opponentGoldAt10 = opponentId !== undefined ? frameGold(frame10, opponentId) : null;

  const deathSecondsList: number[] = [];
  let wardsPlaced = 0;
  const objectives: ObjectiveEvent[] = [];

  const teamOfParticipant = (id: number | undefined): number | undefined => {
    if (id === undefined) return undefined;
    return match.info.participants.find((participant) => participant.participantId === id)?.teamId;
  };

  for (const frame of frames) {
    for (const event of frame.events ?? []) {
      const seconds = typeof event.timestamp === 'number' ? Math.round(event.timestamp / 1000) : null;
      if (seconds === null) continue;

      if (event.type === 'CHAMPION_KILL' && event.victimId === participantId) {
        deathSecondsList.push(seconds);
      }

      if (event.type === 'WARD_PLACED' && event.creatorId === participantId) {
        // Les pièges de Teemo sont comptés comme des balises par le jeu : on les
        // exclut pour ne pas gonfler artificiellement un chiffre de vision.
        if (event.wardType !== 'TEEMO_MUSHROOM') wardsPlaced += 1;
      }

      if (event.type === 'ELITE_MONSTER_KILL') {
        const monsterType = typeof event.monsterType === 'string' ? event.monsterType : undefined;
        if (!monsterType || !ELITE_MONSTERS.has(monsterType)) continue;
        const killerTeam =
          typeof event.killerTeamId === 'number' ? event.killerTeamId : teamOfParticipant(event.killerId);
        objectives.push({
          type: monsterType,
          subType: typeof event.monsterSubType === 'string' ? event.monsterSubType : undefined,
          secondsIntoGame: seconds,
          byMyTeam: killerTeam !== undefined && killerTeam === myTeamId,
        });
      }
    }
  }

  deathSecondsList.sort((a, b) => a - b);

  const deathsShortlyBeforeEnemyObjective: DeathBeforeObjective[] = [];
  for (const objective of objectives) {
    if (objective.byMyTeam) continue;
    for (const deathSeconds of deathSecondsList) {
      const gap = objective.secondsIntoGame - deathSeconds;
      if (gap > 0 && gap <= OBJECTIVE_PROXIMITY_SECONDS) {
        deathsShortlyBeforeEnemyObjective.push({
          deathSeconds,
          objectiveType: objective.type,
          objectiveSeconds: objective.secondsIntoGame,
          gapSeconds: gap,
        });
      }
    }
  }

  const level10 = frame10?.participantFrames?.[String(participantId)]?.level;

  return {
    available: true,
    lastFrameMinute: lastTimestamp > 0 ? Math.round(lastTimestamp / 60_000) : null,

    csAt10,
    csAt14: frameCs(frame14, participantId),
    goldAt10,
    goldAt15: frameGold(frame15, participantId),
    levelAt10: typeof level10 === 'number' ? level10 : null,

    laneOpponentChampion: opponent?.championName ?? null,
    csDiffAt10: csAt10 !== null && opponentCsAt10 !== null ? csAt10 - opponentCsAt10 : null,
    goldDiffAt10: goldAt10 !== null && opponentGoldAt10 !== null ? goldAt10 - opponentGoldAt10 : null,

    deathSecondsList,
    firstDeathSeconds: deathSecondsList[0] ?? null,
    deathsBefore10Min: deathSecondsList.filter((seconds) => seconds < 600).length,
    deathsBetween10And20Min: deathSecondsList.filter((seconds) => seconds >= 600 && seconds < 1200).length,
    deathsAfter20Min: deathSecondsList.filter((seconds) => seconds >= 1200).length,

    wardsPlacedFromTimeline: wardsPlaced,

    objectives,
    deathsShortlyBeforeEnemyObjective,
  };
}

/** « 12:34 » — format habituel des horodatages de partie. */
export function formatGameClock(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, '0')}`;
}

export const OBJECTIVE_LABELS: Record<string, string> = {
  DRAGON: 'un dragon',
  BARON_NASHOR: 'le Baron Nashor',
  RIFTHERALD: 'le Héraut de la Faille',
  HORDE: 'les Grubs du Néant',
  ATAKHAN: 'Atakhan',
};

export type { EventTimelineDto };

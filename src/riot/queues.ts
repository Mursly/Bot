/**
 * Identification du mode de jeu.
 *
 * Riot publie la liste complète des files sur
 * https://static.developer.riotgames.com/docs/lol/queues.json — mais on ne
 * dépend pas de ce fichier au démarrage : seules les files réellement
 * fréquentées sont nommées ici, et tout identifiant inconnu retombe sur le
 * champ `gameMode` de la partie plutôt que d'afficher un numéro brut.
 */

export interface QueueInfo {
  id: number;
  /** Libellé français affiché dans Discord. */
  label: string;
  /** Clé courte, utilisée par le filtre de modes suivis. */
  key: string;
  /** Une file classée se prête à des conseils plus exigeants. */
  ranked: boolean;
  /** Summoner's Rift 5c5 : les repères de farm et de vision y ont du sens. */
  summonersRift: boolean;
}

export const QUEUES: QueueInfo[] = [
  { id: 420, label: 'Classée Solo/Duo', key: 'soloq', ranked: true, summonersRift: true },
  { id: 440, label: 'Classée Flex', key: 'flex', ranked: true, summonersRift: true },
  { id: 400, label: 'Normale (Draft)', key: 'draft', ranked: false, summonersRift: true },
  { id: 430, label: 'Normale (Aveugle)', key: 'blind', ranked: false, summonersRift: true },
  { id: 490, label: 'Normale (Rapide)', key: 'quickplay', ranked: false, summonersRift: true },
  { id: 450, label: 'ARAM', key: 'aram', ranked: false, summonersRift: false },
  { id: 700, label: 'Clash', key: 'clash', ranked: true, summonersRift: true },
  { id: 720, label: 'Clash ARAM', key: 'aramclash', ranked: false, summonersRift: false },
  { id: 830, label: 'Coop vs IA (Intro)', key: 'bot', ranked: false, summonersRift: true },
  { id: 840, label: 'Coop vs IA (Débutant)', key: 'bot', ranked: false, summonersRift: true },
  { id: 850, label: 'Coop vs IA (Intermédiaire)', key: 'bot', ranked: false, summonersRift: true },
  { id: 870, label: 'Coop vs IA (Intro)', key: 'bot', ranked: false, summonersRift: true },
  { id: 880, label: 'Coop vs IA (Débutant)', key: 'bot', ranked: false, summonersRift: true },
  { id: 890, label: 'Coop vs IA (Intermédiaire)', key: 'bot', ranked: false, summonersRift: true },
  { id: 900, label: 'URF', key: 'urf', ranked: false, summonersRift: true },
  { id: 1020, label: 'Un pour tous', key: 'oneforall', ranked: false, summonersRift: true },
  { id: 1300, label: 'Raid du Nexus', key: 'nexusblitz', ranked: false, summonersRift: false },
  { id: 1700, label: 'Arena', key: 'arena', ranked: false, summonersRift: false },
  { id: 1710, label: 'Arena', key: 'arena', ranked: false, summonersRift: false },
  { id: 1900, label: 'URF (Pick classique)', key: 'urf', ranked: false, summonersRift: true },
  { id: 2300, label: 'Brawl', key: 'brawl', ranked: false, summonersRift: false },
];

const BY_ID = new Map(QUEUES.map((queue) => [queue.id, queue]));

/** Clés utilisables dans le filtre de modes (`/suivre`, option « modes »). */
export const QUEUE_KEYS = [...new Set(QUEUES.map((queue) => queue.key))].sort();

export function queueInfo(queueId: number | undefined): QueueInfo | undefined {
  if (queueId === undefined) return undefined;
  return BY_ID.get(queueId);
}

/** Libellé lisible du mode : file connue, sinon `gameMode`, sinon « Mode inconnu ». */
export function describeQueue(queueId: number | undefined, gameMode: string | undefined): string {
  const known = queueInfo(queueId);
  if (known) return known.label;
  if (gameMode && gameMode !== 'CLASSIC') return prettifyGameMode(gameMode);
  if (queueId !== undefined) return `Mode ${queueId}`;
  return 'Mode inconnu';
}

function prettifyGameMode(gameMode: string): string {
  const map: Record<string, string> = {
    CLASSIC: 'Faille de l’invocateur',
    ARAM: 'ARAM',
    URF: 'URF',
    CHERRY: 'Arena',
    NEXUSBLITZ: 'Raid du Nexus',
    ONEFORALL: 'Un pour tous',
    TUTORIAL: 'Tutoriel',
    PRACTICETOOL: 'Outil d’entraînement',
    STRAWBERRY: 'Odyssée',
    BRAWL: 'Brawl',
  };
  return map[gameMode] ?? gameMode;
}

/**
 * Détermine si les repères « Faille de l'invocateur » (CS/min, vision, rôle)
 * sont pertinents. En ARAM ou en Arena, juger un joueur sur son farm n'aurait
 * aucun sens.
 */
export function isSummonersRift(queueId: number | undefined, mapId: number | undefined): boolean {
  const known = queueInfo(queueId);
  if (known) return known.summonersRift;
  // mapId 11 = Faille de l'invocateur.
  return mapId === 11;
}

export function isRankedQueue(queueId: number | undefined): boolean {
  return queueInfo(queueId)?.ranked ?? false;
}

/** Normalise une liste de modes séparés par des virgules en clés valides. */
export function parseQueueFilter(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  const keys = raw
    .split(/[,;\s]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
  const valid = keys.filter((key) => QUEUE_KEYS.includes(key));
  return valid.length > 0 ? [...new Set(valid)] : null;
}

/** Une partie passe-t-elle le filtre de modes suivis ? (`null` = tout suivre) */
export function matchesQueueFilter(queueId: number | undefined, filter: string[] | null): boolean {
  if (!filter || filter.length === 0) return true;
  const key = queueInfo(queueId)?.key;
  return key !== undefined && filter.includes(key);
}

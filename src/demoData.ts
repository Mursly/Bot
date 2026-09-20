import type { FrameTimelineDto, MatchDto, ParticipantDto, TimelineDto } from './riot/types.js';

/**
 * Jeux de données de démonstration — **entièrement fictifs**.
 *
 * Rien ici ne provient de l'API Riot. Les identifiants sont volontairement
 * reconnaissables (« DEMO_… », « JoueurFictif#DEMO ») pour qu'on ne puisse pas
 * les confondre avec de vraies parties, et tout message produit à partir de ces
 * données porte un bandeau d'avertissement.
 */

export const DEMO_PUUID = 'demo-puuid-0000000000000000000000000000000000000000000000000000000000000000';

const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const;

function makeParticipant(overrides: Partial<ParticipantDto> & { participantId: number; teamId: number }): ParticipantDto {
  const base: ParticipantDto = {
    puuid: `demo-filler-${overrides.participantId}`,
    participantId: overrides.participantId,
    teamId: overrides.teamId,
    win: overrides.win ?? false,
    championName: 'Garen',
    kills: 3,
    deaths: 3,
    assists: 5,
    totalMinionsKilled: 120,
    neutralMinionsKilled: 0,
    goldEarned: 10_000,
    totalDamageDealtToChampions: 14_000,
    visionScore: 18,
    wardsPlaced: 8,
    wardsKilled: 2,
    detectorWardsPlaced: 1,
    totalTimeSpentDead: 90,
    gameEndedInEarlySurrender: false,
    gameEndedInSurrender: false,
    teamPosition: ROLES[(overrides.participantId - 1) % 5],
  };
  return { ...base, ...overrides };
}

function buildMatch(options: {
  matchId: string;
  queueId: number;
  mapId: number;
  gameMode: string;
  durationSeconds: number;
  me: Partial<ParticipantDto>;
  /** Éliminations des 4 autres joueurs de l'équipe du joueur suivi. */
  allyKills: number[];
  enemyLaner?: Partial<ParticipantDto>;
}): MatchDto {
  const win = options.me.win ?? false;
  const endTimestamp = Date.UTC(2026, 0, 15, 20, 30, 0);

  const me = makeParticipant({
    participantId: 1,
    teamId: 100,
    puuid: DEMO_PUUID,
    riotIdGameName: 'JoueurFictif',
    riotIdTagline: 'DEMO',
    win,
    ...options.me,
  });

  const allies = options.allyKills.map((kills, index) =>
    makeParticipant({
      participantId: index + 2,
      teamId: 100,
      win,
      kills,
      deaths: 4,
      assists: 6,
      totalDamageDealtToChampions: 12_000,
      teamPosition: ROLES[(index + 1) % 5],
    }),
  );

  const enemies = Array.from({ length: 5 }, (_, index) =>
    makeParticipant({
      participantId: index + 6,
      teamId: 200,
      win: !win,
      kills: 4,
      deaths: 4,
      assists: 6,
      teamPosition: ROLES[index % 5],
      ...(index === 0 && options.enemyLaner ? options.enemyLaner : {}),
    }),
  );

  const participants = [me, ...allies, ...enemies];
  const teamKills = (teamId: number) =>
    participants.filter((p) => p.teamId === teamId).reduce((sum, p) => sum + p.kills, 0);

  return {
    metadata: { dataVersion: '2', matchId: options.matchId, participants: participants.map((p) => p.puuid) },
    info: {
      gameCreation: endTimestamp - options.durationSeconds * 1000 - 60_000,
      gameStartTimestamp: endTimestamp - options.durationSeconds * 1000,
      gameEndTimestamp: endTimestamp,
      // `gameEndTimestamp` étant présent, cette valeur est en secondes.
      gameDuration: options.durationSeconds,
      gameMode: options.gameMode,
      gameType: 'MATCHED_GAME',
      gameVersion: '16.18.1',
      mapId: options.mapId,
      queueId: options.queueId,
      platformId: 'EUW1',
      participants,
      teams: [
        {
          teamId: 100,
          win,
          objectives: {
            champion: { kills: teamKills(100) },
            dragon: { first: win, kills: win ? 3 : 1 },
            baron: { first: win, kills: win ? 1 : 0 },
            riftHerald: { first: win, kills: 1 },
            tower: { first: win, kills: win ? 9 : 3 },
          },
        },
        {
          teamId: 200,
          win: !win,
          objectives: {
            champion: { kills: teamKills(200) },
            dragon: { first: !win, kills: win ? 1 : 3 },
            baron: { first: !win, kills: win ? 0 : 1 },
            riftHerald: { first: !win, kills: 1 },
            tower: { first: !win, kills: win ? 3 : 9 },
          },
        },
      ],
    },
  };
}

/** Victoire nette d'un ADC : farm élevé, peu de morts. */
export const DEMO_MATCH_WIN: MatchDto = buildMatch({
  matchId: 'DEMO_0000000001',
  queueId: 420,
  mapId: 11,
  gameMode: 'CLASSIC',
  durationSeconds: 1_842, // 30 min 42 s
  allyKills: [4, 6, 2, 1],
  me: {
    championName: 'Ezreal',
    teamPosition: 'BOTTOM',
    win: true,
    kills: 11,
    deaths: 2,
    assists: 9,
    totalMinionsKilled: 248,
    neutralMinionsKilled: 12,
    goldEarned: 17_450,
    totalDamageDealtToChampions: 34_820,
    visionScore: 26,
    wardsPlaced: 12,
    wardsKilled: 4,
    detectorWardsPlaced: 3,
    totalTimeSpentDead: 54,
    challenges: { soloKills: 2 },
  },
  enemyLaner: { championName: 'Caitlyn', teamPosition: 'BOTTOM' },
});

/** Défaite avec beaucoup de morts et un farm en retrait. */
export const DEMO_MATCH_LOSS: MatchDto = buildMatch({
  matchId: 'DEMO_0000000002',
  queueId: 420,
  mapId: 11,
  gameMode: 'CLASSIC',
  durationSeconds: 1_512, // 25 min 12 s
  allyKills: [3, 2, 5, 1],
  me: {
    championName: 'Yasuo',
    teamPosition: 'MIDDLE',
    win: false,
    kills: 2,
    deaths: 9,
    assists: 3,
    totalMinionsKilled: 96,
    neutralMinionsKilled: 8,
    goldEarned: 9_120,
    totalDamageDealtToChampions: 11_240,
    visionScore: 9,
    wardsPlaced: 3,
    wardsKilled: 0,
    detectorWardsPlaced: 0,
    totalTimeSpentDead: 268,
  },
  enemyLaner: { championName: 'Ahri', teamPosition: 'MIDDLE' },
});

/** Support en ARAM : ni farm ni vision ne doivent être jugés. */
export const DEMO_MATCH_ARAM: MatchDto = buildMatch({
  matchId: 'DEMO_0000000003',
  queueId: 450,
  mapId: 12,
  gameMode: 'ARAM',
  durationSeconds: 1_104, // 18 min 24 s
  allyKills: [8, 6, 5, 4],
  me: {
    championName: 'Soraka',
    teamPosition: '',
    individualPosition: 'Invalid',
    win: true,
    kills: 2,
    deaths: 6,
    assists: 20,
    totalMinionsKilled: 41,
    neutralMinionsKilled: 0,
    goldEarned: 8_900,
    totalDamageDealtToChampions: 9_800,
    visionScore: 3,
    totalHealsOnTeammates: 14_200,
    totalDamageShieldedOnTeammates: 0,
    totalTimeSpentDead: 142,
  },
});

/** Partie annulée avant la 4ᵉ minute. */
export const DEMO_MATCH_REMAKE: MatchDto = buildMatch({
  matchId: 'DEMO_0000000004',
  queueId: 420,
  mapId: 11,
  gameMode: 'CLASSIC',
  durationSeconds: 197, // 3 min 17 s
  allyKills: [0, 0, 0, 0],
  me: {
    championName: 'Jinx',
    teamPosition: 'BOTTOM',
    win: false,
    kills: 0,
    deaths: 0,
    assists: 0,
    totalMinionsKilled: 14,
    neutralMinionsKilled: 0,
    goldEarned: 1_200,
    totalDamageDealtToChampions: 420,
    visionScore: 1,
    totalTimeSpentDead: 0,
    gameEndedInEarlySurrender: true,
  },
});

/**
 * Timeline fictive associée à DEMO_MATCH_LOSS : retard pris sur la voie,
 * morts réparties, et un dragon adverse peu après l'une d'elles.
 */
export function buildDemoTimeline(matchId = 'DEMO_0000000002'): TimelineDto {
  const frames: FrameTimelineDto[] = [];

  for (let minute = 0; minute <= 25; minute += 1) {
    const frame: FrameTimelineDto = {
      timestamp: minute * 60_000,
      events: [],
      participantFrames: {
        // Joueur suivi : progression de farm volontairement lente.
        '1': {
          participantId: 1,
          level: Math.min(18, 1 + Math.floor(minute / 1.8)),
          totalGold: 500 + minute * 290,
          minionsKilled: Math.round(minute * 3.8),
          jungleMinionsKilled: 0,
        },
        // Adversaire direct : farm et or plus réguliers.
        '6': {
          participantId: 6,
          level: Math.min(18, 1 + Math.floor(minute / 1.6)),
          totalGold: 500 + minute * 380,
          minionsKilled: Math.round(minute * 6.4),
          jungleMinionsKilled: 0,
        },
      },
    };
    frames.push(frame);
  }

  const push = (minute: number, event: Record<string, unknown>) => {
    const frame = frames[minute];
    if (frame) frame.events?.push(event as never);
  };

  // Morts du joueur suivi.
  for (const seconds of [223, 512, 744, 981, 1_133, 1_208, 1_301, 1_388, 1_454]) {
    push(Math.floor(seconds / 60), {
      type: 'CHAMPION_KILL',
      timestamp: seconds * 1000,
      victimId: 1,
      killerId: 6,
    });
  }

  // Balises posées par le joueur suivi.
  for (const seconds of [180, 640, 1_020]) {
    push(Math.floor(seconds / 60), {
      type: 'WARD_PLACED',
      timestamp: seconds * 1000,
      creatorId: 1,
      wardType: 'YELLOW_TRINKET',
    });
  }

  // Objectifs : un dragon adverse 31 s après la mort de 12:24.
  push(12, {
    type: 'ELITE_MONSTER_KILL',
    timestamp: 775 * 1000,
    monsterType: 'DRAGON',
    monsterSubType: 'FIRE_DRAGON',
    killerId: 6,
    killerTeamId: 200,
  });
  push(21, {
    type: 'ELITE_MONSTER_KILL',
    timestamp: 1_290 * 1000,
    monsterType: 'BARON_NASHOR',
    killerId: 7,
    killerTeamId: 200,
  });

  return {
    metadata: { dataVersion: '2', matchId, participants: [] },
    info: {
      frameInterval: 60_000,
      frames,
      participants: [
        { participantId: 1, puuid: DEMO_PUUID },
        { participantId: 6, puuid: 'demo-filler-6' },
      ],
    },
  };
}

export const DEMO_SCENARIOS = [
  { label: 'Victoire — ADC sur la Faille', match: DEMO_MATCH_WIN, timeline: null },
  { label: 'Défaite — Mid, timeline disponible', match: DEMO_MATCH_LOSS, timeline: buildDemoTimeline() },
  { label: 'ARAM — pas de repères de voie', match: DEMO_MATCH_ARAM, timeline: null },
  { label: 'Remake — partie annulée', match: DEMO_MATCH_REMAKE, timeline: null },
] as const;

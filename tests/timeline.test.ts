import { describe, expect, it } from 'vitest';
import { extractTimelineFacts, frameAtMinute, formatGameClock } from '../src/analysis/timeline.js';
import { buildDemoTimeline, DEMO_MATCH_LOSS, DEMO_MATCH_WIN, DEMO_PUUID } from '../src/demoData.js';
import type { TimelineDto } from '../src/riot/types.js';

describe('frameAtMinute', () => {
  const frames = [0, 1, 2, 3].map((minute) => ({ timestamp: minute * 60_000, participantFrames: {} }));

  it('retrouve le frame de la minute demandée', () => {
    expect(frameAtMinute(frames, 2)?.timestamp).toBe(120_000);
  });

  it('renvoie null si la partie s’est terminée avant, au lieu d’extrapoler', () => {
    expect(frameAtMinute(frames, 10)).toBeNull();
  });
});

describe('extractTimelineFacts', () => {
  const timeline = buildDemoTimeline();
  const facts = extractTimelineFacts(DEMO_MATCH_LOSS, timeline, DEMO_PUUID, 'MIDDLE');

  it('signale l’absence de timeline sans planter', () => {
    const absent = extractTimelineFacts(DEMO_MATCH_WIN, null, DEMO_PUUID, 'BOTTOM');
    expect(absent.available).toBe(false);
    expect(absent.csAt10).toBeNull();
    expect(absent.deathSecondsList).toEqual([]);
    expect(absent.deathsShortlyBeforeEnemyObjective).toEqual([]);
  });

  it('lit le CS et l’or à la 10ᵉ minute', () => {
    expect(facts.available).toBe(true);
    expect(facts.csAt10).toBe(38); // round(10 * 3.8)
    expect(facts.goldAt10).toBe(500 + 10 * 290);
  });

  it('calcule l’écart avec l’adversaire de voie', () => {
    expect(facts.laneOpponentChampion).toBe('Ahri');
    expect(facts.csDiffAt10).toBe(38 - 64);
    expect(facts.goldDiffAt10).toBe(3400 - 4300);
  });

  it('recense les morts et leur répartition dans le temps', () => {
    expect(facts.deathSecondsList).toHaveLength(9);
    expect(facts.firstDeathSeconds).toBe(223);
    expect(facts.deathsBefore10Min).toBe(2);
    expect(facts.deathsBetween10And20Min).toBe(3);
    expect(facts.deathsAfter20Min).toBe(4);
    // La somme des tranches doit couvrir toutes les morts.
    expect(facts.deathsBefore10Min + facts.deathsBetween10And20Min + facts.deathsAfter20Min).toBe(9);
  });

  it('compte les balises posées par le joueur suivi uniquement', () => {
    expect(facts.wardsPlacedFromTimeline).toBe(3);
  });

  it('attribue les objectifs à la bonne équipe', () => {
    expect(facts.objectives).toHaveLength(2);
    expect(facts.objectives.every((objective) => objective.byMyTeam === false)).toBe(true);
    expect(facts.objectives[0]?.type).toBe('DRAGON');
  });

  it('relève les morts proches d’un objectif adverse sans affirmer de lien de cause', () => {
    const proches = facts.deathsShortlyBeforeEnemyObjective;
    expect(proches.length).toBeGreaterThan(0);
    // Dragon à 775 s, mort à 744 s -> 31 s d'écart.
    expect(proches.some((entry) => entry.deathSeconds === 744 && entry.gapSeconds === 31)).toBe(true);
    // Toutes les proximités retenues doivent rester dans la fenêtre d'une minute.
    for (const entry of proches) {
      expect(entry.gapSeconds).toBeGreaterThan(0);
      expect(entry.gapSeconds).toBeLessThanOrEqual(45);
    }
  });

  it('ignore les pièges de Teemo dans le décompte de vision', () => {
    const custom: TimelineDto = {
      metadata: { matchId: 'X', participants: [] },
      info: {
        frameInterval: 60_000,
        participants: [{ participantId: 1, puuid: DEMO_PUUID }],
        frames: [
          {
            timestamp: 0,
            participantFrames: {},
            events: [
              { type: 'WARD_PLACED', timestamp: 1000, creatorId: 1, wardType: 'YELLOW_TRINKET' },
              { type: 'WARD_PLACED', timestamp: 2000, creatorId: 1, wardType: 'TEEMO_MUSHROOM' },
            ],
          },
        ],
      },
    };
    const result = extractTimelineFacts(DEMO_MATCH_LOSS, custom, DEMO_PUUID, 'MIDDLE');
    expect(result.wardsPlacedFromTimeline).toBe(1);
  });

  it('reste exploitable quand la timeline est vide de frames', () => {
    const empty: TimelineDto = {
      metadata: { matchId: 'X', participants: [] },
      info: { frameInterval: 60_000, frames: [], participants: [] },
    };
    const result = extractTimelineFacts(DEMO_MATCH_LOSS, empty, DEMO_PUUID, 'MIDDLE');
    expect(result.available).toBe(false);
  });

  it('n’invente pas d’adversaire de voie quand le rôle est inconnu', () => {
    const result = extractTimelineFacts(DEMO_MATCH_LOSS, timeline, DEMO_PUUID, null);
    expect(result.laneOpponentChampion).toBeNull();
    expect(result.csDiffAt10).toBeNull();
  });
});

describe('formatGameClock', () => {
  it('formate en mm:ss', () => {
    expect(formatGameClock(744)).toBe('12:24');
    expect(formatGameClock(60)).toBe('1:00');
    expect(formatGameClock(5)).toBe('0:05');
  });
});

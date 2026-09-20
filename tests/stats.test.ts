import { describe, expect, it } from 'vitest';
import {
  computeMatchStats,
  detectRemake,
  formatDuration,
  formatNumber,
  formatPercent,
  normalizeRole,
  resolveDurationSeconds,
} from '../src/analysis/stats.js';
import { DEMO_MATCH_ARAM, DEMO_MATCH_LOSS, DEMO_MATCH_REMAKE, DEMO_MATCH_WIN, DEMO_PUUID } from '../src/demoData.js';
import type { MatchDto, ParticipantDto } from '../src/riot/types.js';

describe('resolveDurationSeconds', () => {
  it('traite gameDuration comme des secondes quand gameEndTimestamp est présent', () => {
    expect(resolveDurationSeconds({ gameDuration: 1842, gameEndTimestamp: 1_700_000_000_000 })).toBe(1842);
  });

  it('traite gameDuration comme des millisecondes quand gameEndTimestamp est absent', () => {
    // Comportement des parties antérieures au patch 11.20.
    expect(resolveDurationSeconds({ gameDuration: 1_842_000 })).toBe(1842);
  });

  it('retombe sur l’écart début/fin quand gameDuration manque', () => {
    expect(
      resolveDurationSeconds({ gameStartTimestamp: 1_000_000, gameEndTimestamp: 1_000_000 + 900_000 }),
    ).toBe(900);
  });

  it('renvoie 0 plutôt qu’une valeur inventée quand rien n’est exploitable', () => {
    expect(resolveDurationSeconds({})).toBe(0);
  });
});

describe('formatDuration', () => {
  it('formate en minutes et secondes', () => {
    expect(formatDuration(1842)).toBe('30 min 42 s');
    expect(formatDuration(197)).toBe('3 min 17 s');
    expect(formatDuration(60)).toBe('1 min 00 s');
    expect(formatDuration(0)).toBe('0 min 00 s');
  });
});

describe('normalizeRole', () => {
  const base = { puuid: 'x', participantId: 1, teamId: 100, win: true, championName: 'A', kills: 0, deaths: 0, assists: 0 };

  it('lit teamPosition en priorité', () => {
    expect(normalizeRole({ ...base, teamPosition: 'UTILITY', individualPosition: 'BOTTOM' } as ParticipantDto)).toBe('UTILITY');
  });

  it('retombe sur individualPosition', () => {
    expect(normalizeRole({ ...base, teamPosition: '', individualPosition: 'JUNGLE' } as ParticipantDto)).toBe('JUNGLE');
  });

  it('renvoie null quand aucune position n’est exploitable (ARAM)', () => {
    expect(normalizeRole({ ...base, teamPosition: '', individualPosition: 'Invalid' } as ParticipantDto)).toBeNull();
  });
});

describe('detectRemake', () => {
  const base = { puuid: 'x', participantId: 1, teamId: 100, win: false, championName: 'A', kills: 0, deaths: 0, assists: 0 };

  it('fait confiance au drapeau Riot', () => {
    expect(detectRemake({ ...base, gameEndedInEarlySurrender: true } as ParticipantDto, 1800)).toBe(true);
    expect(detectRemake({ ...base, gameEndedInEarlySurrender: false } as ParticipantDto, 120)).toBe(false);
  });

  it('retombe sur la durée quand le drapeau est absent', () => {
    expect(detectRemake(base as ParticipantDto, 180)).toBe(true);
    expect(detectRemake(base as ParticipantDto, 1200)).toBe(false);
  });
});

describe('computeMatchStats', () => {
  it('calcule le CS, le CS/min et le KDA', () => {
    const stats = computeMatchStats(DEMO_MATCH_WIN, DEMO_PUUID);
    expect(stats.cs).toBe(248 + 12);
    // 260 CS / (1842 / 60) minutes = 8,47 -> arrondi à 8,5
    expect(stats.csPerMinute).toBe(8.5);
    expect(stats.kda).toBe(10);
    expect(stats.durationLabel).toBe('30 min 42 s');
    expect(stats.win).toBe(true);
    expect(stats.remake).toBe(false);
  });

  it('calcule la participation aux éliminations à partir des kills de l’équipe', () => {
    const stats = computeMatchStats(DEMO_MATCH_WIN, DEMO_PUUID);
    // 11 kills + 9 assists = 20, équipe = 11 + 4 + 6 + 2 + 1 = 24
    expect(stats.teamKills).toBe(24);
    expect(stats.killParticipation).toBeCloseTo(20 / 24, 3);
  });

  it('ne dépasse jamais 100 % de participation sur des données cohérentes', () => {
    for (const match of [DEMO_MATCH_WIN, DEMO_MATCH_LOSS, DEMO_MATCH_ARAM]) {
      const stats = computeMatchStats(match, DEMO_PUUID);
      if (stats.killParticipation !== null) expect(stats.killParticipation).toBeLessThanOrEqual(1);
    }
  });

  it('calcule la part des dégâts de l’équipe', () => {
    const stats = computeMatchStats(DEMO_MATCH_WIN, DEMO_PUUID);
    const teamDamage = DEMO_MATCH_WIN.info.participants
      .filter((p) => p.teamId === 100)
      .reduce((sum, p) => sum + (p.totalDamageDealtToChampions ?? 0), 0);
    expect(stats.damageShare).toBeCloseTo(34_820 / teamDamage, 3);
  });

  it('renvoie null pour le KDA quand il n’y a aucune mort (pas de division par zéro)', () => {
    const stats = computeMatchStats(DEMO_MATCH_REMAKE, DEMO_PUUID);
    expect(stats.deaths).toBe(0);
    expect(stats.kda).toBeNull();
  });

  it('identifie un remake et ne le compte pas comme une défaite', () => {
    const stats = computeMatchStats(DEMO_MATCH_REMAKE, DEMO_PUUID);
    expect(stats.remake).toBe(true);
    expect(stats.win).toBe(false);
  });

  it('marque une partie ARAM comme hors Faille et sans rôle', () => {
    const stats = computeMatchStats(DEMO_MATCH_ARAM, DEMO_PUUID);
    expect(stats.summonersRift).toBe(false);
    expect(stats.role).toBeNull();
    expect(stats.roleLabel).toBeNull();
    expect(stats.queueLabel).toBe('ARAM');
  });

  it('survit à des champs optionnels absents', () => {
    const minimal: MatchDto = {
      metadata: { matchId: 'EUW1_TEST', participants: ['p1'] },
      info: {
        gameDuration: 1500,
        gameEndTimestamp: 1_700_000_000_000,
        queueId: 420,
        mapId: 11,
        participants: [
          {
            puuid: 'p1',
            participantId: 1,
            teamId: 100,
            win: true,
            championName: 'Ezreal',
            kills: 5,
            deaths: 3,
            assists: 7,
          },
        ],
      },
    };

    const stats = computeMatchStats(minimal, 'p1');
    expect(stats.cs).toBe(0);
    expect(stats.visionScore).toBeUndefined();
    expect(stats.visionPerMinute).toBeNull();
    expect(stats.damageToChampions).toBeUndefined();
    expect(stats.damageShare).toBeNull();
    expect(stats.goldPerMinute).toBeNull();
    expect(stats.teamObjectives).toBeNull();
    expect(stats.killParticipation).toBeCloseTo(12 / 5, 3);
  });

  it('renvoie null pour la participation quand l’équipe n’a tué personne', () => {
    const stats = computeMatchStats(DEMO_MATCH_REMAKE, DEMO_PUUID);
    expect(stats.teamKills).toBe(0);
    expect(stats.killParticipation).toBeNull();
  });

  it('lève une erreur explicite si le joueur n’est pas dans la partie', () => {
    expect(() => computeMatchStats(DEMO_MATCH_WIN, 'inconnu')).toThrow(/ne figure pas dans la partie/);
  });

  it('neutralise les moyennes par minute quand la durée est nulle', () => {
    const broken: MatchDto = {
      metadata: { matchId: 'EUW1_ZERO', participants: [] },
      info: {
        participants: [
          {
            puuid: 'p1',
            participantId: 1,
            teamId: 100,
            win: false,
            championName: 'Ezreal',
            kills: 0,
            deaths: 0,
            assists: 0,
            totalMinionsKilled: 10,
            visionScore: 4,
          },
        ],
      },
    };
    const stats = computeMatchStats(broken, 'p1');
    expect(stats.durationSeconds).toBe(0);
    expect(stats.csPerMinute).toBe(0);
    expect(Number.isFinite(stats.csPerMinute)).toBe(true);
    expect(stats.visionPerMinute).toBeNull();
  });
});

describe('formatage français', () => {
  it('utilise la virgule décimale et gère les valeurs absentes', () => {
    expect(formatNumber(8.47, 1)).toBe('8,5');
    expect(formatNumber(null)).toBe('n/a');
    expect(formatNumber(undefined, 2)).toBe('n/a');
    expect(formatPercent(0.6667)).toBe('67 %');
    expect(formatPercent(null)).toBe('n/a');
  });
});

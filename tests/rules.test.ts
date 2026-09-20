import { describe, expect, it } from 'vitest';
import { buildContext } from '../src/analysis/facts.js';
import { buildRuleReport, type CoachReport } from '../src/analysis/rules.js';
import { computeMatchStats } from '../src/analysis/stats.js';
import { extractTimelineFacts, EMPTY_TIMELINE_FACTS } from '../src/analysis/timeline.js';
import {
  buildDemoTimeline,
  DEMO_MATCH_ARAM,
  DEMO_MATCH_LOSS,
  DEMO_MATCH_REMAKE,
  DEMO_MATCH_WIN,
  DEMO_PUUID,
} from '../src/demoData.js';
import type { MatchDto } from '../src/riot/types.js';

function report(match: MatchDto, timeline: ReturnType<typeof buildDemoTimeline> | null = null): CoachReport {
  const stats = computeMatchStats(match, DEMO_PUUID);
  const facts = timeline ? extractTimelineFacts(match, timeline, DEMO_PUUID, stats.role) : { ...EMPTY_TIMELINE_FACTS };
  return buildRuleReport(buildContext(stats, facts));
}

function allText(coachReport: CoachReport): string {
  return [
    ...coachReport.positives.flatMap((note) => [note.observation, note.interpretation, note.advice]),
    ...coachReport.improvements.flatMap((note) => [note.observation, note.interpretation, note.advice]),
    coachReport.objective ?? '',
    ...coachReport.caveats,
  ].join(' \n ');
}

describe('format du bilan', () => {
  it('respecte les quotas : 2 points positifs, 3 axes, 1 objectif', () => {
    for (const match of [DEMO_MATCH_WIN, DEMO_MATCH_LOSS, DEMO_MATCH_ARAM]) {
      const result = report(match, match === DEMO_MATCH_LOSS ? buildDemoTimeline() : null);
      expect(result.positives.length).toBeLessThanOrEqual(2);
      expect(result.improvements.length).toBeLessThanOrEqual(3);
      expect(typeof result.objective === 'string' || result.objective === null).toBe(true);
    }
  });

  it('remplit toujours les trois temps : observation, interprétation, conseil', () => {
    const result = report(DEMO_MATCH_LOSS, buildDemoTimeline());
    for (const note of [...result.positives, ...result.improvements]) {
      expect(note.observation.length).toBeGreaterThan(0);
      expect(note.interpretation.length).toBeGreaterThan(0);
      expect(note.advice.length).toBeGreaterThan(0);
    }
  });

  it('classe les axes du plus important au moins important', () => {
    const result = report(DEMO_MATCH_LOSS, buildDemoTimeline());
    // 9 morts : c'est le sujet qui doit ressortir en premier.
    expect(result.improvements[0]?.observation).toMatch(/9 morts/);
  });
});

describe('adaptation au contexte', () => {
  it('ne reproche jamais son farm à un support', () => {
    const support: MatchDto = structuredClone(DEMO_MATCH_LOSS);
    const me = support.info.participants[0]!;
    me.teamPosition = 'UTILITY';
    me.championName = 'Nami';
    me.totalMinionsKilled = 18;
    me.neutralMinionsKilled = 0;

    const result = report(support, null);
    const text = allText(result);
    expect(text).not.toMatch(/CS par minute/);
    expect(result.improvements.some((note) => note.observation.includes('CS en'))).toBe(false);
  });

  it('évalue bien le farm d’un ADC', () => {
    const adc: MatchDto = structuredClone(DEMO_MATCH_LOSS);
    adc.info.participants[0]!.teamPosition = 'BOTTOM';
    const result = report(adc, null);
    expect(result.improvements.some((note) => note.observation.includes('CS par minute'))).toBe(true);
  });

  it('n’applique pas les repères de voie en ARAM', () => {
    const result = report(DEMO_MATCH_ARAM, null);
    const text = allText(result);
    expect(text).not.toMatch(/CS par minute/);
    expect(text).not.toMatch(/Score de vision/);
    expect(result.caveats.some((caveat) => caveat.includes('ARAM'))).toBe(true);
  });

  it('donne en ARAM un conseil adapté au mode, pas un conseil de voie', () => {
    const aram: MatchDto = structuredClone(DEMO_MATCH_ARAM);
    aram.info.participants[0]!.deaths = 12;
    const result = report(aram, null);
    const deaths = result.improvements.find((note) => note.observation.includes('morts'));
    expect(deaths).toBeDefined();
    expect(deaths?.advice).not.toMatch(/hors de ta voie/);
  });

  it('tolère plus de morts en ARAM que sur la Faille', () => {
    const aram: MatchDto = structuredClone(DEMO_MATCH_ARAM);
    aram.info.participants[0]!.deaths = 7;
    aram.info.participants[0]!.totalTimeSpentDead = 60;
    const aramResult = report(aram, null);
    expect(aramResult.improvements.some((note) => note.observation.includes('morts'))).toBe(false);

    const rift: MatchDto = structuredClone(DEMO_MATCH_LOSS);
    rift.info.participants[0]!.deaths = 7;
    const riftResult = report(rift, null);
    expect(riftResult.improvements.some((note) => note.observation.includes('morts'))).toBe(true);
  });

  it('ne produit aucune analyse pour un remake', () => {
    const result = report(DEMO_MATCH_REMAKE, null);
    expect(result.positives).toHaveLength(0);
    expect(result.improvements).toHaveLength(0);
    expect(result.objective).toBeNull();
    expect(result.caveats[0]).toMatch(/remake/i);
  });

  it('se tait sur les moyennes par minute quand la partie est trop courte', () => {
    const court: MatchDto = structuredClone(DEMO_MATCH_LOSS);
    court.info.gameDuration = 600; // 10 minutes
    const result = report(court, null);
    expect(result.caveats.some((caveat) => caveat.includes('Partie courte'))).toBe(true);
    expect(result.improvements.some((note) => note.observation.includes('CS par minute'))).toBe(false);
  });
});

describe('honnêteté de l’analyse', () => {
  it('ne force aucun compliment ni critique sur une partie sans relief', () => {
    const neutre: MatchDto = structuredClone(DEMO_MATCH_WIN);
    const me = neutre.info.participants[0]!;
    // Valeurs volontairement ordinaires : rien ne doit ressortir.
    me.kills = 4;
    me.deaths = 4;
    me.assists = 8;
    me.totalMinionsKilled = 200;
    me.neutralMinionsKilled = 0;
    me.totalDamageDealtToChampions = 18_000;
    me.visionScore = 22;
    me.totalTimeSpentDead = 120;
    me.challenges = {};

    const result = report(neutre, null);
    expect(result.positives.length + result.improvements.length).toBeLessThanOrEqual(2);
  });

  it('présente la proximité mort/objectif comme un enchaînement, jamais comme une cause', () => {
    const stats = computeMatchStats(DEMO_MATCH_LOSS, DEMO_PUUID);
    const facts = extractTimelineFacts(DEMO_MATCH_LOSS, buildDemoTimeline(), DEMO_PUUID, stats.role);
    expect(facts.deathsShortlyBeforeEnemyObjective.length).toBeGreaterThan(0);

    // On isole la règle en neutralisant les sujets plus prioritaires.
    const calme: MatchDto = structuredClone(DEMO_MATCH_LOSS);
    const me = calme.info.participants[0]!;
    me.deaths = 3;
    me.totalTimeSpentDead = 60;
    me.totalMinionsKilled = 200;
    me.totalDamageDealtToChampions = 25_000;
    me.visionScore = 30;

    const result = report(calme, buildDemoTimeline());
    const objectifs = result.improvements.find((note) => note.observation.includes('objectif') || note.observation.includes('Baron') || note.observation.includes('dragon'));
    if (objectifs) {
      expect(objectifs.interpretation).toMatch(/ne dit pas que ta mort a causé/);
    }
  });

  it('n’emploie jamais de conseil vague', () => {
    const interdits = [/\bjoue mieux\b/i, /^meurs moins$/i, /\bfais plus de CS\b/i, /\bsois meilleur\b/i];
    for (const match of [DEMO_MATCH_WIN, DEMO_MATCH_LOSS, DEMO_MATCH_ARAM]) {
      const text = allText(report(match, match === DEMO_MATCH_LOSS ? buildDemoTimeline() : null));
      for (const motif of interdits) expect(text).not.toMatch(motif);
    }
  });

  it('ne cite jamais de moyenne par rang, de patch ni d’objet « optimal »', () => {
    const interdits = [/moyenne.{0,20}rang/i, /\bpatch\b/i, /\bmeta\b/i, /objet.{0,15}optimal/i, /\bDiamant\b/i, /\bOr\b\s+(II|III|IV)/];
    for (const match of [DEMO_MATCH_WIN, DEMO_MATCH_LOSS, DEMO_MATCH_ARAM, DEMO_MATCH_REMAKE]) {
      const text = allText(report(match, match === DEMO_MATCH_LOSS ? buildDemoTimeline() : null));
      for (const motif of interdits) expect(text).not.toMatch(motif);
    }
  });

  it('ne prétend jamais avoir regardé la partie', () => {
    const interdits = [/j'ai vu/i, /en regardant le replay/i, /on voit que tu/i, /ton placement était/i];
    const text = allText(report(DEMO_MATCH_LOSS, buildDemoTimeline()));
    for (const motif of interdits) expect(text).not.toMatch(motif);
  });

  it('annonce les données manquantes plutôt que de les combler', () => {
    const result = report(DEMO_MATCH_WIN, null);
    expect(result.caveats.some((caveat) => caveat.includes('minute par minute'))).toBe(true);
  });
});

describe('objectif pour la prochaine partie', () => {
  it('propose un objectif chiffré dérivé du principal axe', () => {
    const result = report(DEMO_MATCH_LOSS, buildDemoTimeline());
    expect(result.objective).toMatch(/7 morts/);
    expect(result.objective).toMatch(/\d/);
  });

  it('propose un objectif de maintien quand rien ne ressort', () => {
    const result = report(DEMO_MATCH_WIN, null);
    expect(result.improvements).toHaveLength(0);
    expect(result.objective).toMatch(/Rien de marquant/);
  });
});

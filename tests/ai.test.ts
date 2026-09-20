import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisService, extractJsonObject, safeParseReport } from '../src/analysis/ai.js';
import { buildContext, buildPromptPayload } from '../src/analysis/facts.js';
import { buildRuleReport } from '../src/analysis/rules.js';
import { computeMatchStats } from '../src/analysis/stats.js';
import { extractTimelineFacts } from '../src/analysis/timeline.js';
import { buildDemoTimeline, DEMO_MATCH_LOSS, DEMO_MATCH_REMAKE, DEMO_PUUID } from '../src/demoData.js';
import { openDatabase, type Db } from '../src/storage/db.js';
import { Repository } from '../src/storage/repository.js';

let db: Db;
let repository: Repository;

beforeEach(() => {
  db = openDatabase(':memory:');
  repository = new Repository(db);
});

afterEach(() => {
  db.close();
});

function contextFor(match = DEMO_MATCH_LOSS, withTimeline = true) {
  const stats = computeMatchStats(match, DEMO_PUUID);
  const facts = extractTimelineFacts(match, withTimeline ? buildDemoTimeline() : null, DEMO_PUUID, stats.role);
  return buildContext(stats, facts);
}

const VALID_RESPONSE = {
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        positives: [{ observation: 'o1', interpretation: 'i1', advice: 'a1' }],
        improvements: [
          { observation: 'o2', interpretation: 'i2', advice: 'a2' },
          { observation: 'o3', interpretation: 'i3', advice: 'a3' },
        ],
        objective: 'Objectif rédigé par le modèle.',
      }),
    },
  ],
};

describe('extractJsonObject', () => {
  it('lit du JSON pur', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('accepte un bloc de code markdown', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('accepte du texte autour', () => {
    expect(extractJsonObject('Voici : {"a":1} voilà.')).toEqual({ a: 1 });
  });

  it('renvoie null sur du JSON invalide ou vide', () => {
    expect(extractJsonObject('pas du json')).toBeNull();
    expect(extractJsonObject('{cassé')).toBeNull();
    expect(extractJsonObject('')).toBeNull();
  });
});

describe('safeParseReport', () => {
  const fallback = buildRuleReport(contextFor());

  it('accepte une réponse bien formée et plafonne les listes', () => {
    const raw = JSON.stringify({
      positives: Array.from({ length: 5 }, (_, i) => ({ observation: `o${i}`, interpretation: 'i', advice: 'a' })),
      improvements: Array.from({ length: 6 }, (_, i) => ({ observation: `o${i}`, interpretation: 'i', advice: 'a' })),
      objective: 'objectif',
    });
    const parsed = safeParseReport(raw, fallback);
    expect(parsed?.positives).toHaveLength(2);
    expect(parsed?.improvements).toHaveLength(3);
    expect(parsed?.source).toBe('ai');
  });

  it('rejette les remarques incomplètes', () => {
    const raw = JSON.stringify({
      positives: [{ observation: 'o', advice: 'a' }],
      improvements: [{ observation: 'o', interpretation: 'i', advice: 'a' }],
      objective: 'x',
    });
    const parsed = safeParseReport(raw, fallback);
    expect(parsed?.positives).toHaveLength(0);
    expect(parsed?.improvements).toHaveLength(1);
  });

  it('conserve les limites calculées par le code, que le modèle ne peut pas modifier', () => {
    const raw = JSON.stringify({
      positives: [],
      improvements: [{ observation: 'o', interpretation: 'i', advice: 'a' }],
      objective: 'x',
      caveats: ['limite inventée par le modèle'],
    });
    const parsed = safeParseReport(raw, fallback);
    expect(parsed?.caveats).toEqual(fallback.caveats);
  });

  it('renvoie null sur une réponse vide ou illisible', () => {
    expect(safeParseReport('pas du json', fallback)).toBeNull();
    expect(safeParseReport(JSON.stringify({ positives: [], improvements: [] }), fallback)).toBeNull();
  });
});

describe('buildPromptPayload', () => {
  const payload = buildPromptPayload(contextFor());

  it('ne transmet que des valeurs déjà calculées', () => {
    expect(payload.statistiques.cs_par_minute).toBe(computeMatchStats(DEMO_MATCH_LOSS, DEMO_PUUID).csPerMinute);
    expect(payload.statistiques.morts).toBe(9);
    expect(payload.partie.duree_lisible).toBe('25 min 12 s');
  });

  it('accompagne chaque proximité mort/objectif d’un avertissement explicite', () => {
    const deroule = payload.deroule as Record<string, unknown>;
    const proches = deroule.morts_peu_avant_un_objectif_adverse as { avertissement: string }[];
    expect(proches.length).toBeGreaterThan(0);
    for (const entry of proches) {
      expect(entry.avertissement).toMatch(/proximité temporelle/i);
      expect(entry.avertissement).toMatch(/ne disent pas/i);
    }
  });

  it('précise que les repères internes ne sont pas des moyennes par rang', () => {
    expect(String(payload.reperes_internes.note)).toMatch(/ne sont pas des moyennes par rang/i);
  });

  it('liste explicitement les données absentes', () => {
    const sansTimeline = buildPromptPayload(contextFor(DEMO_MATCH_LOSS, false));
    expect(sansTimeline.donnees_absentes.some((entry) => entry.includes('timeline'))).toBe(true);
    expect((sansTimeline.deroule as { disponible: boolean }).disponible).toBe(false);
  });
});

describe('AnalysisService', () => {
  it('sans clé, utilise l’analyse par règles et n’appelle rien', async () => {
    const service = new AnalysisService(repository, { model: 'test', maxTokens: 500 });
    expect(service.aiEnabled).toBe(false);

    const result = await service.analyze(contextFor());
    expect(result.source).toBe('rules');
    expect(result.fromCache).toBe(false);
    expect(result.improvements.length).toBeGreaterThan(0);
  });

  it('utilise la réponse du modèle quand elle est valide', async () => {
    const create = vi.fn(async () => VALID_RESPONSE);
    const service = new AnalysisService(repository, {
      model: 'test',
      maxTokens: 500,
      client: { create } as never,
    });

    const result = await service.analyze(contextFor());
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.source).toBe('ai');
    expect(result.objective).toBe('Objectif rédigé par le modèle.');
    expect(result.improvements).toHaveLength(2);
  });

  it('transmet le modèle et la longueur configurés', async () => {
    const create = vi.fn(async () => VALID_RESPONSE);
    const service = new AnalysisService(repository, {
      model: 'modele-choisi',
      maxTokens: 1234,
      client: { create } as never,
    });

    await service.analyze(contextFor());
    const call = create.mock.calls[0]?.[0] as unknown as { model: string; max_tokens: number; system: string };
    expect(call.model).toBe('modele-choisi');
    expect(call.max_tokens).toBe(1234);
    expect(call.system).toMatch(/Tu ne disposes QUE des données JSON fournies/);
  });

  it('met l’analyse en cache pour ne pas repayer la même partie', async () => {
    const create = vi.fn(async () => VALID_RESPONSE);
    const service = new AnalysisService(repository, {
      model: 'test',
      maxTokens: 500,
      client: { create } as never,
    });

    const first = await service.analyze(contextFor());
    expect(first.fromCache).toBe(false);

    const second = await service.analyze(contextFor());
    expect(second.fromCache).toBe(true);
    expect(second.objective).toBe('Objectif rédigé par le modèle.');
    // Un seul appel facturé pour deux analyses.
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('sépare le cache par modèle', async () => {
    const create = vi.fn(async () => VALID_RESPONSE);
    const base = { maxTokens: 500, client: { create } as never };

    await new AnalysisService(repository, { ...base, model: 'modele-a' }).analyze(contextFor());
    await new AnalysisService(repository, { ...base, model: 'modele-b' }).analyze(contextFor());
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('retombe sur les règles si l’IA échoue', async () => {
    const create = vi.fn(async () => {
      throw new Error('502 Bad Gateway');
    });
    const service = new AnalysisService(repository, {
      model: 'test',
      maxTokens: 500,
      client: { create } as never,
    });

    const result = await service.analyze(contextFor());
    expect(result.source).toBe('rules');
    expect(result.improvements.length).toBeGreaterThan(0);
  });

  it('retombe sur les règles si la réponse est inexploitable, et ne met rien en cache', async () => {
    const create = vi.fn(async () => ({ content: [{ type: 'text', text: 'je ne sais pas' }] }));
    const service = new AnalysisService(repository, {
      model: 'test',
      maxTokens: 500,
      client: { create } as never,
    });

    const result = await service.analyze(contextFor());
    expect(result.source).toBe('rules');

    await service.analyze(contextFor());
    // Aucune mise en cache d'une réponse invalide : le modèle est réinterrogé.
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('n’appelle jamais l’IA pour un remake', async () => {
    const create = vi.fn(async () => VALID_RESPONSE);
    const service = new AnalysisService(repository, {
      model: 'test',
      maxTokens: 500,
      client: { create } as never,
    });

    const result = await service.analyze(contextFor(DEMO_MATCH_REMAKE, false));
    expect(create).not.toHaveBeenCalled();
    expect(result.source).toBe('rules');
  });

  it('borne les sujets que le modèle peut traiter', async () => {
    const create = vi.fn(async () => VALID_RESPONSE);
    const service = new AnalysisService(repository, {
      model: 'test',
      maxTokens: 500,
      client: { create } as never,
    });

    await service.analyze(contextFor());
    const call = create.mock.calls[0]?.[0] as unknown as { messages: { content: string }[] };
    const content = call.messages[0]?.content ?? '';
    expect(content).toMatch(/sujets_amelioration_autorises/);
    expect(content).toMatch(/tu ne dois pas en ajouter de nouveaux/);
    expect(content).toMatch(/Ne recalcule rien/);
  });
});

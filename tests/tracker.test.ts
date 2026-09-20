import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIEmbed } from 'discord.js';
import { AnalysisService } from '../src/analysis/ai.js';
import { ANALYSIS_PENDING_TEXT } from '../src/discord/embed.js';
import { RiotApiError } from '../src/riot/errors.js';
import type { RiotClient } from '../src/riot/client.js';
import type { DataDragon } from '../src/riot/ddragon.js';
import type { MatchDto, TimelineDto } from '../src/riot/types.js';
import { openDatabase, type Db } from '../src/storage/db.js';
import { Repository, type TrackedPlayer } from '../src/storage/repository.js';
import { Tracker, type Publisher } from '../src/tracker.js';
import {
  buildDemoTimeline,
  DEMO_MATCH_ARAM,
  DEMO_MATCH_LOSS,
  DEMO_MATCH_WIN,
  DEMO_PUUID,
} from '../src/demoData.js';

const GUILD = '111';
const CHANNEL = '222';
const SINCE = Date.UTC(2026, 0, 1);

let db: Db;
let repository: Repository;

beforeEach(() => {
  db = openDatabase(':memory:');
  repository = new Repository(db);
});

afterEach(() => {
  db.close();
});

/** Publisher en mémoire : enregistre chaque envoi et chaque modification. */
function fakePublisher() {
  const published: { channelId: string; embed: APIEmbed; messageId: string }[] = [];
  const edited: { messageId: string; embed: APIEmbed }[] = [];
  let counter = 0;

  const publisher: Publisher = {
    async publish(channelId, embed) {
      counter += 1;
      const messageId = `msg-${counter}`;
      published.push({ channelId, embed, messageId });
      return messageId;
    },
    async edit(_channelId, messageId, embed) {
      edited.push({ messageId, embed });
    },
  };

  return { publisher, published, edited };
}

function fakeRiot(options: {
  matchIds: string[];
  matches: Record<string, MatchDto>;
  timelines?: Record<string, TimelineDto | null>;
  onMatchIds?: () => void;
}) {
  const calls = { matchIds: 0, match: 0, timeline: 0 };
  const client = {
    async getMatchIds() {
      calls.matchIds += 1;
      options.onMatchIds?.();
      return options.matchIds;
    },
    async getMatch(_platform: string, matchId: string) {
      calls.match += 1;
      const match = options.matches[matchId];
      if (!match) throw new RiotApiError('not_found', `partie ${matchId} absente`);
      return match;
    },
    async getTimeline(_platform: string, matchId: string) {
      calls.timeline += 1;
      return options.timelines?.[matchId] ?? null;
    },
  };
  return { client: client as unknown as RiotClient, calls };
}

const fakeDataDragon = {
  async championSquareUrl(championName: string) {
    return `https://ddragon.test/${championName}.png`;
  },
} as unknown as DataDragon;

function trackPlayer(overrides: Partial<TrackedPlayer> = {}): TrackedPlayer {
  return repository.setTracking({
    guildId: GUILD,
    gameName: 'JoueurFictif',
    tagLine: 'DEMO',
    puuid: DEMO_PUUID,
    platform: 'euw1',
    channelId: CHANNEL,
    sinceMs: SINCE,
    queueFilter: null,
    ...overrides,
  });
}

function makeTracker(riot: RiotClient, publisher: Publisher, analysis?: AnalysisService, maxMatchesPerPoll = 5) {
  return new Tracker({
    riot,
    dataDragon: fakeDataDragon,
    repository,
    analysis: analysis ?? new AnalysisService(repository, { model: 'test', maxTokens: 400 }),
    publisher,
    maxMatchesPerPoll,
  });
}

describe('publication d’une nouvelle partie', () => {
  it('publie une partie complète en un seul message quand l’IA est absente', async () => {
    const tracked = trackPlayer();
    const { client } = fakeRiot({ matchIds: ['DEMO_0000000001'], matches: { DEMO_0000000001: DEMO_MATCH_WIN } });
    const { publisher, published, edited } = fakePublisher();

    const outcome = await makeTracker(client, publisher).pollPlayer(tracked);

    expect(outcome.published).toBe(1);
    expect(published).toHaveLength(1);
    // Sans IA, aucun état d'attente et aucune seconde notification.
    expect(edited).toHaveLength(0);
    expect(published[0]?.channelId).toBe(CHANNEL);
    expect(published[0]?.embed.title).toContain('Victoire');

    const fields = published[0]?.embed.fields ?? [];
    expect(fields.some((field) => field.value === ANALYSIS_PENDING_TEXT)).toBe(false);
  });

  it('avec IA : publie d’abord le résultat puis complète le MÊME message', async () => {
    const tracked = trackPlayer();
    const { client } = fakeRiot({
      matchIds: ['DEMO_0000000002'],
      matches: { DEMO_0000000002: DEMO_MATCH_LOSS },
      timelines: { DEMO_0000000002: buildDemoTimeline() },
    });
    const { publisher, published, edited } = fakePublisher();

    const create = vi.fn(async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            positives: [],
            improvements: [{ observation: 'o', interpretation: 'i', advice: 'a' }],
            objective: 'Objectif IA',
          }),
        },
      ],
    }));
    const analysis = new AnalysisService(repository, { model: 'test', maxTokens: 400, client: { create } as never });

    await makeTracker(client, publisher, analysis).pollPlayer(tracked);

    // Un seul message publié, puis modifié : une seule notification.
    expect(published).toHaveLength(1);
    expect(edited).toHaveLength(1);
    expect(edited[0]?.messageId).toBe(published[0]?.messageId);

    const pendingField = (published[0]?.embed.fields ?? []).find((field) => field.value === ANALYSIS_PENDING_TEXT);
    expect(pendingField).toBeDefined();

    const finalFields = edited[0]?.embed.fields ?? [];
    expect(finalFields.some((field) => field.value === ANALYSIS_PENDING_TEXT)).toBe(false);
    expect(finalFields.some((field) => field.value.includes('Objectif IA'))).toBe(true);
  });

  it('publie les parties de la plus ancienne à la plus récente', async () => {
    const tracked = trackPlayer();
    // L'API Riot renvoie la plus récente en premier.
    const { client } = fakeRiot({
      matchIds: ['DEMO_0000000002', 'DEMO_0000000001'],
      matches: { DEMO_0000000001: DEMO_MATCH_WIN, DEMO_0000000002: DEMO_MATCH_LOSS },
    });
    const { publisher, published } = fakePublisher();

    await makeTracker(client, publisher).pollPlayer(tracked);

    expect(published).toHaveLength(2);
    expect(published[0]?.embed.title).toContain('Victoire');
    expect(published[1]?.embed.title).toContain('Défaite');
  });

  it('enregistre le bilan pour /derniere', async () => {
    const tracked = trackPlayer();
    const { client } = fakeRiot({ matchIds: ['DEMO_0000000001'], matches: { DEMO_0000000001: DEMO_MATCH_WIN } });
    const { publisher } = fakePublisher();

    await makeTracker(client, publisher).pollPlayer(tracked);

    const last = repository.getLastPublishedMatch(GUILD);
    expect(last?.matchId).toBe('DEMO_0000000001');
    expect(last?.messageId).toBe('msg-1');
    expect(JSON.parse(last?.statsJson ?? '{}').championName).toBe('Ezreal');
    expect(JSON.parse(last?.reportJson ?? '{}').source).toBe('rules');
  });
});

describe('prévention des doublons', () => {
  it('ne republie jamais une partie déjà publiée', async () => {
    const tracked = trackPlayer();
    const { client } = fakeRiot({ matchIds: ['DEMO_0000000001'], matches: { DEMO_0000000001: DEMO_MATCH_WIN } });
    const { publisher, published } = fakePublisher();
    const tracker = makeTracker(client, publisher);

    await tracker.pollPlayer(tracked);
    await tracker.pollPlayer(tracked);
    await tracker.pollPlayer(tracked);

    expect(published).toHaveLength(1);
    expect(repository.countPublished(GUILD)).toBe(1);
  });

  it('survit à un redémarrage sans republier l’historique', async () => {
    const tracked = trackPlayer();
    const { client } = fakeRiot({ matchIds: ['DEMO_0000000001'], matches: { DEMO_0000000001: DEMO_MATCH_WIN } });
    const first = fakePublisher();

    await makeTracker(client, first.publisher).pollPlayer(tracked);
    expect(first.published).toHaveLength(1);

    // Redémarrage : nouveau Tracker, nouveau publisher, même base.
    repository.clearUnpublished();
    const second = fakePublisher();
    const reloaded = repository.getTracking(GUILD)!;
    await makeTracker(client, second.publisher).pollPlayer(reloaded);

    expect(second.published).toHaveLength(0);
    expect(repository.countPublished(GUILD)).toBe(1);
  });

  it('retente une partie dont la publication a échoué', async () => {
    const tracked = trackPlayer();
    const { client } = fakeRiot({ matchIds: ['DEMO_0000000001'], matches: { DEMO_0000000001: DEMO_MATCH_WIN } });

    const failing: Publisher = {
      async publish() {
        throw new Error('Discord indisponible');
      },
      async edit() {},
    };

    const outcome = await makeTracker(client, failing).pollPlayer(tracked);
    expect(outcome.published).toBe(0);
    expect(outcome.error).toBeTruthy();
    // La réservation est libérée pour permettre une nouvelle tentative.
    expect(repository.isProcessed(GUILD, 'DEMO_0000000001')).toBe(false);

    const retry = fakePublisher();
    await makeTracker(client, retry.publisher).pollPlayer(tracked);
    expect(retry.published).toHaveLength(1);
  });
});

describe('filtres', () => {
  it('ignore les parties antérieures au début du suivi', async () => {
    // La partie de démonstration se termine en janvier 2026 ; on démarre le
    // suivi après.
    const tracked = trackPlayer({ sinceMs: Date.UTC(2026, 5, 1) });
    const { client } = fakeRiot({ matchIds: ['DEMO_0000000001'], matches: { DEMO_0000000001: DEMO_MATCH_WIN } });
    const { publisher, published } = fakePublisher();

    const outcome = await makeTracker(client, publisher).pollPlayer(tracked);

    expect(published).toHaveLength(0);
    expect(outcome.skipped).toBe(1);
    // Elle est marquée comme traitée : elle ne sera pas réexaminée.
    expect(repository.isProcessed(GUILD, 'DEMO_0000000001')).toBe(true);
    expect(repository.countPublished(GUILD)).toBe(0);
  });

  it('respecte le filtre de modes', async () => {
    const tracked = trackPlayer({ queueFilter: ['soloq'] });
    const { client } = fakeRiot({
      matchIds: ['DEMO_0000000003', 'DEMO_0000000001'],
      matches: { DEMO_0000000001: DEMO_MATCH_WIN, DEMO_0000000003: DEMO_MATCH_ARAM },
    });
    const { publisher, published } = fakePublisher();

    const outcome = await makeTracker(client, publisher).pollPlayer(tracked);

    expect(published).toHaveLength(1);
    expect(published[0]?.embed.description).toContain('Classée Solo/Duo');
    expect(outcome.skipped).toBe(1);
    expect(repository.isProcessed(GUILD, 'DEMO_0000000003')).toBe(true);
  });

  it('ne publie pas tout l’historique d’un coup après une longue coupure', async () => {
    const tracked = trackPlayer();
    const matchIds = Array.from({ length: 8 }, (_, i) => `DEMO_M${i}`);
    const matches = Object.fromEntries(matchIds.map((id) => [id, DEMO_MATCH_WIN]));
    const { client } = fakeRiot({ matchIds, matches });
    const { publisher, published } = fakePublisher();

    const outcome = await makeTracker(client, publisher, undefined, 3).pollPlayer(tracked);

    expect(published).toHaveLength(3);
    expect(outcome.skipped).toBe(5);
    // Toutes les parties restent marquées comme traitées.
    for (const id of matchIds) expect(repository.isProcessed(GUILD, id)).toBe(true);
  });
});

describe('robustesse', () => {
  it('publie même sans timeline disponible', async () => {
    const tracked = trackPlayer();
    const { client } = fakeRiot({
      matchIds: ['DEMO_0000000002'],
      matches: { DEMO_0000000002: DEMO_MATCH_LOSS },
      timelines: { DEMO_0000000002: null },
    });
    const { publisher, published } = fakePublisher();

    await makeTracker(client, publisher).pollPlayer(tracked);

    expect(published).toHaveLength(1);
    const limites = (published[0]?.embed.fields ?? []).find((field) => field.name.includes('Limites'));
    expect(limites?.value).toMatch(/minute par minute/);
  });

  it('publie même si la timeline provoque une erreur', async () => {
    const tracked = trackPlayer();
    const client = {
      async getMatchIds() {
        return ['DEMO_0000000001'];
      },
      async getMatch() {
        return DEMO_MATCH_WIN;
      },
      async getTimeline() {
        throw new RiotApiError('server_error', 'timeline en panne');
      },
    } as unknown as RiotClient;
    const { publisher, published } = fakePublisher();

    await makeTracker(client, publisher).pollPlayer(tracked);
    expect(published).toHaveLength(1);
  });

  it('remonte un message lisible quand la clé Riot est refusée', async () => {
    const tracked = trackPlayer();
    const client = {
      async getMatchIds() {
        throw new RiotApiError('forbidden', 'HTTP 403');
      },
    } as unknown as RiotClient;
    const { publisher, published } = fakePublisher();

    const outcome = await makeTracker(client, publisher).pollPlayer(tracked);

    expect(published).toHaveLength(0);
    expect(outcome.error).toMatch(/clé/i);
    expect(repository.getTracking(GUILD)?.lastError).toMatch(/clé/i);
  });

  it('efface le dernier incident après un passage réussi', async () => {
    const tracked = trackPlayer();
    repository.markChecked(GUILD, Date.now(), 'ancienne erreur');

    const { client } = fakeRiot({ matchIds: [], matches: {} });
    const { publisher } = fakePublisher();
    await makeTracker(client, publisher).pollPlayer(repository.getTracking(GUILD)!);

    expect(repository.getTracking(GUILD)?.lastError).toBeNull();
    expect(tracked.riotId).toBe('JoueurFictif#DEMO');
  });

  it('conserve le message publié si la modification finale échoue', async () => {
    const tracked = trackPlayer();
    const { client } = fakeRiot({ matchIds: ['DEMO_0000000001'], matches: { DEMO_0000000001: DEMO_MATCH_WIN } });

    const published: string[] = [];
    const publisher: Publisher = {
      async publish() {
        published.push('msg-1');
        return 'msg-1';
      },
      async edit() {
        throw new Error('message supprimé');
      },
    };

    const create = vi.fn(async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ positives: [], improvements: [], objective: 'Objectif IA' }),
        },
      ],
    }));
    const analysis = new AnalysisService(repository, { model: 'test', maxTokens: 400, client: { create } as never });

    const outcome = await makeTracker(client, publisher, analysis).pollPlayer(tracked);

    expect(outcome.published).toBe(1);
    expect(published).toHaveLength(1);
    // Le bilan par règles reste disponible pour /derniere.
    expect(repository.getLastPublishedMatch(GUILD)?.reportJson).toBeTruthy();
  });
});

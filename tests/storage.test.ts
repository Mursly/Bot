import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/storage/db.js';
import { Repository } from '../src/storage/repository.js';

let db: Db;
let repository: Repository;

const GUILD = '111111111111111111';
const PUUID = 'puuid-abc';

beforeEach(() => {
  db = openDatabase(':memory:');
  repository = new Repository(db);
});

afterEach(() => {
  db.close();
});

function track(overrides: Partial<Parameters<Repository['setTracking']>[0]> = {}) {
  return repository.setTracking({
    guildId: GUILD,
    gameName: 'JoueurFictif',
    tagLine: 'DEMO',
    puuid: PUUID,
    platform: 'euw1',
    channelId: '222222222222222222',
    sinceMs: 1_700_000_000_000,
    queueFilter: null,
    ...overrides,
  });
}

describe('suivi des joueurs', () => {
  it('enregistre puis relit un suivi', () => {
    const tracked = track();
    expect(tracked.riotId).toBe('JoueurFictif#DEMO');

    const read = repository.getTracking(GUILD);
    expect(read?.puuid).toBe(PUUID);
    expect(read?.platform).toBe('euw1');
    expect(read?.queueFilter).toBeNull();
  });

  it('remplace le suivi existant au lieu d’en créer un second', () => {
    track();
    track({ gameName: 'AutreJoueur', tagLine: 'EUW', channelId: '333' });

    expect(repository.listTracking()).toHaveLength(1);
    expect(repository.getTracking(GUILD)?.riotId).toBe('AutreJoueur#EUW');
    expect(repository.getTracking(GUILD)?.channelId).toBe('333');
  });

  it('conserve le filtre de modes sous forme de liste', () => {
    const tracked = track({ queueFilter: ['soloq', 'flex'] });
    expect(tracked.queueFilter).toEqual(['soloq', 'flex']);
    expect(repository.getTracking(GUILD)?.queueFilter).toEqual(['soloq', 'flex']);
  });

  it('supprime un suivi', () => {
    track();
    expect(repository.deleteTracking(GUILD)).toBe(true);
    expect(repository.getTracking(GUILD)).toBeNull();
    expect(repository.deleteTracking(GUILD)).toBe(false);
  });

  it('mémorise la dernière vérification et le dernier incident', () => {
    track();
    repository.markChecked(GUILD, 1_700_000_100_000, 'Clé API invalide');
    const read = repository.getTracking(GUILD);
    expect(read?.lastCheckedAt).toBe(1_700_000_100_000);
    expect(read?.lastError).toBe('Clé API invalide');

    repository.markChecked(GUILD, 1_700_000_200_000, null);
    expect(repository.getTracking(GUILD)?.lastError).toBeNull();
  });
});

describe('prévention des doublons', () => {
  it('ne laisse réserver une partie qu’une seule fois', () => {
    expect(repository.claimMatch(GUILD, 'EUW1_1', PUUID, null)).toBe(true);
    expect(repository.claimMatch(GUILD, 'EUW1_1', PUUID, null)).toBe(false);
    expect(repository.claimMatch(GUILD, 'EUW1_1', PUUID, null)).toBe(false);
  });

  it('isole les serveurs entre eux : deux serveurs peuvent suivre la même partie', () => {
    expect(repository.claimMatch(GUILD, 'EUW1_1', PUUID, null)).toBe(true);
    expect(repository.claimMatch('999', 'EUW1_1', PUUID, null)).toBe(true);
  });

  it('marque une partie comme traitée dès la réservation', () => {
    expect(repository.isProcessed(GUILD, 'EUW1_1')).toBe(false);
    repository.claimMatch(GUILD, 'EUW1_1', PUUID, null);
    expect(repository.isProcessed(GUILD, 'EUW1_1')).toBe(true);
  });

  it('libère une réservation non publiée pour permettre une nouvelle tentative', () => {
    repository.claimMatch(GUILD, 'EUW1_1', PUUID, null);
    repository.releaseMatch(GUILD, 'EUW1_1');
    expect(repository.isProcessed(GUILD, 'EUW1_1')).toBe(false);
    expect(repository.claimMatch(GUILD, 'EUW1_1', PUUID, null)).toBe(true);
  });

  it('ne libère jamais une partie déjà publiée', () => {
    repository.claimMatch(GUILD, 'EUW1_1', PUUID, null);
    repository.markPublished(GUILD, 'EUW1_1', {
      channelId: '222',
      messageId: 'msg-1',
      statsJson: '{}',
      reportJson: '{}',
    });

    repository.releaseMatch(GUILD, 'EUW1_1');
    expect(repository.isProcessed(GUILD, 'EUW1_1')).toBe(true);
    expect(repository.claimMatch(GUILD, 'EUW1_1', PUUID, null)).toBe(false);
  });
});

describe('reprise après redémarrage', () => {
  it('conserve le suivi et les parties publiées quand la base est rouverte', () => {
    const file = `${process.env.TMPDIR ?? '/tmp'}/ezreal-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`;

    const first = openDatabase(file);
    const repo1 = new Repository(first);
    repo1.setTracking({
      guildId: GUILD,
      gameName: 'JoueurFictif',
      tagLine: 'DEMO',
      puuid: PUUID,
      platform: 'euw1',
      channelId: '222',
      sinceMs: 1_700_000_000_000,
      queueFilter: ['soloq'],
    });
    repo1.claimMatch(GUILD, 'EUW1_PUBLISHED', PUUID, null);
    repo1.markPublished(GUILD, 'EUW1_PUBLISHED', {
      channelId: '222',
      messageId: 'msg-1',
      statsJson: '{"matchId":"EUW1_PUBLISHED"}',
      reportJson: '{"source":"rules"}',
    });
    // Partie réservée mais interrompue avant publication (simulation d'un crash).
    repo1.claimMatch(GUILD, 'EUW1_INTERRUPTED', PUUID, null);
    first.close();

    const second = openDatabase(file);
    const repo2 = new Repository(second);

    // Le suivi survit.
    expect(repo2.getTracking(GUILD)?.riotId).toBe('JoueurFictif#DEMO');
    expect(repo2.getTracking(GUILD)?.queueFilter).toEqual(['soloq']);

    // La partie déjà publiée ne sera pas republiée.
    expect(repo2.isProcessed(GUILD, 'EUW1_PUBLISHED')).toBe(true);

    // La partie interrompue est remise en file par le nettoyage de démarrage.
    expect(repo2.clearUnpublished()).toBe(1);
    expect(repo2.isProcessed(GUILD, 'EUW1_INTERRUPTED')).toBe(false);
    expect(repo2.isProcessed(GUILD, 'EUW1_PUBLISHED')).toBe(true);

    second.close();
  });
});

describe('dernière partie publiée', () => {
  it('renvoie la plus récente selon la date de fin de partie', () => {
    for (const [matchId, endMs] of [
      ['EUW1_A', 1_700_000_000_000],
      ['EUW1_C', 1_700_000_900_000],
      ['EUW1_B', 1_700_000_500_000],
    ] as const) {
      repository.claimMatch(GUILD, matchId, PUUID, endMs);
      repository.markPublished(GUILD, matchId, {
        channelId: '222',
        messageId: `msg-${matchId}`,
        statsJson: JSON.stringify({ matchId }),
        reportJson: '{}',
      });
    }

    expect(repository.getLastPublishedMatch(GUILD)?.matchId).toBe('EUW1_C');
    expect(repository.countPublished(GUILD)).toBe(3);
  });

  it('ignore les parties écartées (mode non suivi) dans /derniere', () => {
    repository.claimMatch(GUILD, 'EUW1_SKIP', PUUID, 1_700_000_900_000);
    repository.markSkipped(GUILD, 'EUW1_SKIP', 'mode non suivi (ARAM)');

    repository.claimMatch(GUILD, 'EUW1_OK', PUUID, 1_700_000_100_000);
    repository.markPublished(GUILD, 'EUW1_OK', {
      channelId: '222',
      messageId: 'msg-ok',
      statsJson: '{}',
      reportJson: '{}',
    });

    // La partie écartée est plus récente mais ne doit jamais remonter.
    expect(repository.getLastPublishedMatch(GUILD)?.matchId).toBe('EUW1_OK');
    expect(repository.countPublished(GUILD)).toBe(1);
    // Elle reste toutefois marquée comme traitée : on ne la réexaminera pas.
    expect(repository.isProcessed(GUILD, 'EUW1_SKIP')).toBe(true);
  });

  it('renvoie null quand rien n’a été publié', () => {
    expect(repository.getLastPublishedMatch(GUILD)).toBeNull();
    expect(repository.countPublished(GUILD)).toBe(0);
  });
});

describe('cache d’analyses', () => {
  it('stocke et relit une analyse', () => {
    expect(repository.getCachedAnalysis('clé')).toBeNull();
    repository.putCachedAnalysis('clé', { matchId: 'EUW1_1', puuid: PUUID, source: 'ai', payload: '{"a":1}' });
    expect(repository.getCachedAnalysis('clé')).toBe('{"a":1}');
  });

  it('remplace une entrée existante plutôt que d’échouer', () => {
    repository.putCachedAnalysis('clé', { matchId: 'EUW1_1', puuid: PUUID, source: 'ai', payload: 'v1' });
    repository.putCachedAnalysis('clé', { matchId: 'EUW1_1', puuid: PUUID, source: 'ai', payload: 'v2' });
    expect(repository.getCachedAnalysis('clé')).toBe('v2');
  });
});

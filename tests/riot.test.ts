import { describe, expect, it, vi } from 'vitest';
import { backoffMs, parseRetryAfter, RiotClient } from '../src/riot/client.js';
import { RiotApiError } from '../src/riot/errors.js';
import { RateLimiter } from '../src/riot/rateLimiter.js';
import { accountRegionFor, isPlatform, matchRegionFor, PLATFORMS } from '../src/riot/routing.js';
import { DataDragon, normalizeChampionKey } from '../src/riot/ddragon.js';
import {
  describeQueue,
  isSummonersRift,
  matchesQueueFilter,
  parseQueueFilter,
  queueInfo,
} from '../src/riot/queues.js';

describe('routage régional', () => {
  it('route MATCH-V5 vers la bonne région', () => {
    expect(matchRegionFor('euw1')).toBe('europe');
    expect(matchRegionFor('eun1')).toBe('europe');
    expect(matchRegionFor('tr1')).toBe('europe');
    expect(matchRegionFor('me1')).toBe('europe');
    expect(matchRegionFor('na1')).toBe('americas');
    expect(matchRegionFor('br1')).toBe('americas');
    expect(matchRegionFor('kr')).toBe('asia');
    expect(matchRegionFor('jp1')).toBe('asia');
    expect(matchRegionFor('oc1')).toBe('sea');
    expect(matchRegionFor('vn2')).toBe('sea');
  });

  it('replie « sea » sur « asia » pour ACCOUNT-V1, qui ne l’expose pas', () => {
    expect(accountRegionFor('oc1')).toBe('asia');
    expect(accountRegionFor('sg2')).toBe('asia');
    expect(accountRegionFor('vn2')).toBe('asia');
    expect(accountRegionFor('euw1')).toBe('europe');
  });

  it('couvre toutes les plateformes déclarées', () => {
    for (const platform of PLATFORMS) {
      expect(matchRegionFor(platform)).toBeDefined();
      expect(['americas', 'europe', 'asia']).toContain(accountRegionFor(platform));
    }
  });

  it('valide les identifiants de plateforme', () => {
    expect(isPlatform('euw1')).toBe(true);
    expect(isPlatform('EUW')).toBe(false);
    expect(isPlatform('inconnu')).toBe(false);
  });
});

describe('parseRetryAfter', () => {
  it('lit un nombre de secondes', () => {
    expect(parseRetryAfter('10')).toBe(10);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('lit aussi une date HTTP', () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    expect(parseRetryAfter(future)).toBeGreaterThanOrEqual(4);
  });

  it('renvoie undefined quand l’en-tête est absent ou illisible', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('bientôt')).toBeUndefined();
  });
});

describe('backoffMs', () => {
  it('croît exponentiellement et reste plafonné', () => {
    expect(backoffMs(0)).toBe(1000);
    expect(backoffMs(1)).toBe(2000);
    expect(backoffMs(2)).toBe(4000);
    expect(backoffMs(20)).toBe(30_000);
  });
});

describe('RateLimiter', () => {
  it('laisse passer les requêtes sous la limite sans attendre', async () => {
    const sleep = vi.fn(async () => {});
    const limiter = new RateLimiter({ windows: [{ limit: 3, intervalMs: 1000 }], now: () => 0, sleep });
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('attend quand la fenêtre est saturée', async () => {
    let clock = 0;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });
    const limiter = new RateLimiter({ windows: [{ limit: 2, intervalMs: 1000 }], now: () => clock, sleep });

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('respecte la contrainte la plus stricte parmi plusieurs fenêtres', async () => {
    let clock = 0;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });
    const limiter = new RateLimiter({
      windows: [
        { limit: 20, intervalMs: 1_000 },
        { limit: 2, intervalMs: 120_000 },
      ],
      now: () => clock,
      sleep,
    });

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    // C'est la fenêtre de 2 minutes qui bloque, pas celle d'une seconde.
    expect(sleep).toHaveBeenCalledWith(120_000);
  });

  it('échoue clairement plutôt que de boucler si l’horloge n’avance jamais', async () => {
    const limiter = new RateLimiter({
      windows: [{ limit: 1, intervalMs: 1000 }],
      now: () => 0,
      sleep: async () => {},
    });
    await limiter.acquire();
    await expect(limiter.acquire()).rejects.toThrow(/l’horloge n’avance pas|l'horloge n'avance pas/);
  });

  it('applique une pause imposée par Retry-After', async () => {
    let clock = 0;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });
    const limiter = new RateLimiter({ windows: [{ limit: 100, intervalMs: 1000 }], now: () => clock, sleep });

    limiter.setCooldown(7);
    await limiter.acquire();

    expect(sleep).toHaveBeenCalledWith(7000);
  });
});

function fakeResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

/**
 * Limiteur de test : horloge et attente factices, mais l'horloge avance
 * réellement à chaque attente — sans quoi aucune pause ne pourrait s'écouler.
 */
function testLimiter() {
  let clock = 0;
  return new RateLimiter({
    windows: [{ limit: 1000, intervalMs: 1000 }],
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
  });
}

function makeClient(fetchImpl: typeof fetch, maxRetries = 3) {
  return new RiotClient({
    apiKey: 'CLÉ-DE-TEST',
    fetchImpl,
    maxRetries,
    sleep: async () => {},
    rateLimiter: testLimiter(),
  });
}

describe('RiotClient', () => {
  it('construit l’URL ACCOUNT-V1 avec la région de routage et la clé en en-tête', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(
        'https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/JoueurFictif/DEMO',
      );
      expect((init?.headers as Record<string, string>)['X-Riot-Token']).toBe('CLÉ-DE-TEST');
      return fakeResponse(200, { puuid: 'p1', gameName: 'JoueurFictif', tagLine: 'DEMO' });
    }) as unknown as typeof fetch;

    const account = await makeClient(fetchImpl).getAccountByRiotId('euw1', 'JoueurFictif', 'DEMO');
    expect(account.puuid).toBe('p1');
  });

  it('encode les caractères spéciaux d’un Riot ID', async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      seen.push(String(url));
      return fakeResponse(200, { puuid: 'p1' });
    }) as unknown as typeof fetch;

    await makeClient(fetchImpl).getAccountByRiotId('euw1', 'Pseudo Avec Espace', 'EUW');
    expect(seen[0]).toContain('Pseudo%20Avec%20Espace');
  });

  it('transmet startTime et count sur la liste des parties', async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      seen.push(String(url));
      return fakeResponse(200, ['EUW1_1']);
    }) as unknown as typeof fetch;

    await makeClient(fetchImpl).getMatchIds('kr', 'p1', { startTime: 1_700_000_000, count: 20 });
    expect(seen[0]).toContain('https://asia.api.riotgames.com/lol/match/v5/matches/by-puuid/p1/ids');
    expect(seen[0]).toContain('startTime=1700000000');
    expect(seen[0]).toContain('count=20');
  });

  it('traduit un 404 en erreur « joueur introuvable »', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(404, {})) as unknown as typeof fetch;
    await expect(makeClient(fetchImpl).getAccountByRiotId('euw1', 'Inconnu', 'XXX')).rejects.toMatchObject({
      kind: 'not_found',
    });
    await expect(makeClient(fetchImpl).getAccountByRiotId('euw1', 'Inconnu', 'XXX')).rejects.toThrow(RiotApiError);
  });

  it('traduit un 403 en erreur de clé, sans réessayer', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(403, {})) as unknown as typeof fetch;
    const error = await makeClient(fetchImpl)
      .getMatch('euw1', 'EUW1_1')
      .catch((caught: unknown) => caught as RiotApiError);

    expect(error.kind).toBe('forbidden');
    expect(error.userMessage).toMatch(/clé/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('respecte Retry-After sur un 429 puis réussit', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) return fakeResponse(429, {}, { 'Retry-After': '3' });
      return fakeResponse(200, { metadata: { matchId: 'EUW1_1' }, info: { participants: [] } });
    }) as unknown as typeof fetch;

    const sleeps: number[] = [];
    const client = new RiotClient({
      apiKey: 'k',
      fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      rateLimiter: testLimiter(),
    });

    const match = await client.getMatch('euw1', 'EUW1_1');
    expect(match.metadata.matchId).toBe('EUW1_1');
    expect(sleeps).toContain(3000);
  });

  it('réessaie une erreur serveur puis abandonne avec une erreur claire', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(503, {})) as unknown as typeof fetch;
    const error = await makeClient(fetchImpl, 2)
      .getMatch('euw1', 'EUW1_1')
      .catch((caught: unknown) => caught as RiotApiError);

    expect(error.kind).toBe('server_error');
    expect(error.isRetryable).toBe(true);
    // 1 tentative initiale + 2 reprises.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('traite un échec réseau comme récupérable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;

    const error = await makeClient(fetchImpl, 1)
      .getMatch('euw1', 'EUW1_1')
      .catch((caught: unknown) => caught as RiotApiError);

    expect(error.kind).toBe('network');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('traite une timeline absente (404) comme une absence, pas une erreur', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(404, {})) as unknown as typeof fetch;
    await expect(makeClient(fetchImpl).getTimeline('euw1', 'EUW1_1')).resolves.toBeNull();
  });

  it('considère la clé comme valide si le compte fictif de test renvoie 404', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(404, {})) as unknown as typeof fetch;
    await expect(makeClient(fetchImpl).checkKey('euw1')).resolves.toBeUndefined();
  });

  it('signale une clé invalide au démarrage', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(401, {})) as unknown as typeof fetch;
    await expect(makeClient(fetchImpl).checkKey('euw1')).rejects.toMatchObject({ kind: 'unauthorized' });
  });
});

describe('modes de jeu', () => {
  it('nomme les files connues', () => {
    expect(describeQueue(420, 'CLASSIC')).toBe('Classée Solo/Duo');
    expect(describeQueue(450, 'ARAM')).toBe('ARAM');
    expect(queueInfo(420)?.ranked).toBe(true);
    expect(queueInfo(450)?.ranked).toBe(false);
  });

  it('retombe sur gameMode puis sur l’identifiant pour une file inconnue', () => {
    expect(describeQueue(99999, 'CHERRY')).toBe('Arena');
    expect(describeQueue(99999, 'CLASSIC')).toBe('Mode 99999');
    expect(describeQueue(undefined, undefined)).toBe('Mode inconnu');
  });

  it('distingue la Faille des autres cartes', () => {
    expect(isSummonersRift(420, 11)).toBe(true);
    expect(isSummonersRift(450, 12)).toBe(false);
    expect(isSummonersRift(1700, 30)).toBe(false);
    // File inconnue : on se fie à la carte.
    expect(isSummonersRift(99999, 11)).toBe(true);
  });

  it('analyse un filtre de modes', () => {
    expect(parseQueueFilter('soloq,flex')).toEqual(['soloq', 'flex']);
    expect(parseQueueFilter(' SoloQ ; aram ')).toEqual(['soloq', 'aram']);
    expect(parseQueueFilter('soloq,soloq')).toEqual(['soloq']);
    expect(parseQueueFilter('nimportequoi')).toBeNull();
    expect(parseQueueFilter('')).toBeNull();
    expect(parseQueueFilter(null)).toBeNull();
  });

  it('applique le filtre de modes', () => {
    expect(matchesQueueFilter(420, null)).toBe(true);
    expect(matchesQueueFilter(420, ['soloq'])).toBe(true);
    expect(matchesQueueFilter(450, ['soloq'])).toBe(false);
    // File inconnue : elle ne peut pas satisfaire un filtre explicite.
    expect(matchesQueueFilter(99999, ['soloq'])).toBe(false);
    expect(matchesQueueFilter(99999, null)).toBe(true);
  });
});

describe('normalizeChampionKey', () => {
  it('laisse intacts les identifiants renvoyés par MATCH-V5', () => {
    // MATCH-V5 fournit directement l'identifiant Data Dragon, toujours
    // alphanumérique : « Nunu & Willump » y est « Nunu », « Kai'Sa » est
    // « Kaisa » et « Wukong » est « MonkeyKing ».
    for (const id of ['Ezreal', 'Nunu', 'Kaisa', 'MonkeyKing', 'Velkoz', 'RekSai']) {
      expect(normalizeChampionKey(id)).toBe(id);
    }
  });

  it('sert de filet de sécurité si un nom décoré arrivait malgré tout', () => {
    expect(normalizeChampionKey("Kai'Sa")).toBe('KaiSa');
    expect(normalizeChampionKey('Nunu & Willump')).toBe('NunuWillump');
  });

  it('renvoie null plutôt qu’une URL cassée', () => {
    expect(normalizeChampionKey('')).toBeNull();
    expect(normalizeChampionKey(undefined)).toBeNull();
    expect(normalizeChampionKey('???')).toBeNull();
  });
});

describe('DataDragon', () => {
  const versions = ['16.18.1', '16.17.1'];
  const championJson = { data: { Ezreal: {}, Nunu: {}, Kaisa: {}, MonkeyKing: {} } };

  function fakeCdn() {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      const href = String(url);
      calls.push(href);
      const body = href.endsWith('versions.json') ? versions : championJson;
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  }

  it('construit l’URL du portrait avec la version la plus récente', async () => {
    const { fetchImpl } = fakeCdn();
    const dd = new DataDragon({ fetchImpl });
    expect(await dd.championSquareUrl('Ezreal')).toBe(
      'https://ddragon.leagueoflegends.com/cdn/16.18.1/img/champion/Ezreal.png',
    );
  });

  it('met la version et la liste des champions en cache', async () => {
    const { fetchImpl, calls } = fakeCdn();
    const dd = new DataDragon({ fetchImpl });
    await dd.championSquareUrl('Ezreal');
    await dd.championSquareUrl('Nunu');
    await dd.championSquareUrl('Kaisa');
    // Une seule récupération de versions.json et une seule de champion.json.
    expect(calls.filter((c) => c.endsWith('versions.json'))).toHaveLength(1);
    expect(calls.filter((c) => c.endsWith('champion.json'))).toHaveLength(1);
  });

  it('n’affiche aucun portrait pour un champion absent du patch', async () => {
    const { fetchImpl } = fakeCdn();
    const dd = new DataDragon({ fetchImpl });
    expect(await dd.championSquareUrl('ChampionInexistant')).toBeNull();
  });

  it('reste permissif si le CDN est injoignable', async () => {
    const fetchImpl = (async () => {
      throw new Error('réseau coupé');
    }) as unknown as typeof fetch;
    const dd = new DataDragon({ fetchImpl });
    const url = await dd.championSquareUrl('Ezreal');
    // Version de repli, et aucune validation possible : on produit quand même
    // une URL plutôt que de perdre le portrait.
    expect(url).toMatch(/\/img\/champion\/Ezreal\.png$/);
  });
});

/**
 * Routage régional de l'API Riot.
 *
 * Riot distingue deux familles d'hôtes :
 *  - les « plateformes » (euw1, na1, kr…) pour les API liées à un serveur de jeu ;
 *  - les « régions de routage » (europe, americas, asia, sea) pour ACCOUNT-V1
 *    et MATCH-V5.
 *
 * Ezreal n'utilise que des API routées par région, mais demande la plateforme à
 * l'utilisateur car c'est la notion qu'un joueur connaît (« je joue sur EUW »).
 *
 * Nuance importante : MATCH-V5 accepte « sea », alors qu'ACCOUNT-V1 ne l'expose
 * pas — les plateformes océaniennes et d'Asie du Sud-Est doivent y être routées
 * vers « asia ». Les deux tables ci-dessous encodent cette différence.
 */

export const PLATFORMS = [
  'br1',
  'eun1',
  'euw1',
  'jp1',
  'kr',
  'la1',
  'la2',
  'me1',
  'na1',
  'oc1',
  'ru',
  'sg2',
  'tr1',
  'tw2',
  'vn2',
] as const;

export type Platform = (typeof PLATFORMS)[number];

export type MatchRegion = 'americas' | 'europe' | 'asia' | 'sea';
export type AccountRegion = 'americas' | 'europe' | 'asia';

/** Libellés affichés dans Discord. */
export const PLATFORM_LABELS: Record<Platform, string> = {
  br1: 'Brésil (BR)',
  eun1: 'Europe Nord & Est (EUNE)',
  euw1: 'Europe de l’Ouest (EUW)',
  jp1: 'Japon (JP)',
  kr: 'Corée (KR)',
  la1: 'Amérique latine Nord (LAN)',
  la2: 'Amérique latine Sud (LAS)',
  me1: 'Moyen-Orient (ME)',
  na1: 'Amérique du Nord (NA)',
  oc1: 'Océanie (OCE)',
  ru: 'Russie (RU)',
  sg2: 'Singapour / Malaisie / Indonésie (SG)',
  tr1: 'Turquie (TR)',
  tw2: 'Taïwan (TW)',
  vn2: 'Vietnam (VN)',
};

const MATCH_REGION_BY_PLATFORM: Record<Platform, MatchRegion> = {
  br1: 'americas',
  la1: 'americas',
  la2: 'americas',
  na1: 'americas',
  eun1: 'europe',
  euw1: 'europe',
  me1: 'europe',
  ru: 'europe',
  tr1: 'europe',
  jp1: 'asia',
  kr: 'asia',
  oc1: 'sea',
  sg2: 'sea',
  tw2: 'sea',
  vn2: 'sea',
};

export function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}

/** Région de routage à utiliser pour MATCH-V5. */
export function matchRegionFor(platform: Platform): MatchRegion {
  return MATCH_REGION_BY_PLATFORM[platform];
}

/**
 * Région de routage à utiliser pour ACCOUNT-V1.
 * ACCOUNT-V1 n'expose pas « sea » : on y replie les plateformes SEA sur « asia ».
 */
export function accountRegionFor(platform: Platform): AccountRegion {
  const region = MATCH_REGION_BY_PLATFORM[platform];
  return region === 'sea' ? 'asia' : region;
}

export function hostFor(region: MatchRegion | AccountRegion | Platform): string {
  return `https://${region}.api.riotgames.com`;
}

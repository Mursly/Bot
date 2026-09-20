import { formatGameClock, OBJECTIVE_LABELS, type TimelineFacts } from './timeline.js';
import type { MatchStats, RoleKey } from './stats.js';

/**
 * Le « dossier de faits ».
 *
 * C'est le seul objet transmis au modèle de langage. Il ne contient que des
 * valeurs calculées par le code, plus des repères internes explicitement
 * identifiés comme tels. Le modèle n'a donc jamais à calculer quoi que ce soit,
 * ni à deviner un contexte.
 */

export interface RoleExpectation {
  /** Repère bas : en dessous, il y a généralement de la marge de progression. */
  low: number;
  /** Repère haut : au-dessus, c'est un point fort sur cette partie. */
  good: number;
}

/**
 * Repères internes d'Ezreal, par rôle.
 *
 * Ce ne sont PAS des moyennes par rang — Riot ne publie pas ces chiffres via
 * l'API et Ezreal n'en invente pas. Ce sont des seuils de travail, utilisés
 * uniquement pour décider s'il y a matière à commenter. Ils ne sont jamais
 * présentés au joueur comme une norme ni comme une comparaison.
 */
export const CS_EXPECTATIONS: Record<RoleKey, RoleExpectation | null> = {
  TOP: { low: 5.5, good: 7.5 },
  MIDDLE: { low: 5.5, good: 7.5 },
  BOTTOM: { low: 6, good: 8 },
  JUNGLE: { low: 4, good: 6 },
  // Un support ne farme pas : le juger au CS n'aurait aucun sens.
  UTILITY: null,
};

export const KP_EXPECTATIONS: Record<RoleKey, RoleExpectation> = {
  TOP: { low: 0.45, good: 0.6 },
  MIDDLE: { low: 0.5, good: 0.65 },
  BOTTOM: { low: 0.5, good: 0.65 },
  JUNGLE: { low: 0.55, good: 0.7 },
  UTILITY: { low: 0.55, good: 0.7 },
};

export const VISION_EXPECTATIONS: Record<RoleKey, RoleExpectation> = {
  TOP: { low: 0.5, good: 0.9 },
  MIDDLE: { low: 0.5, good: 0.9 },
  BOTTOM: { low: 0.5, good: 0.9 },
  JUNGLE: { low: 0.8, good: 1.3 },
  UTILITY: { low: 1.2, good: 2 },
};

/** Part des dégâts de l'équipe attendue d'un rôle de « carry ». */
export const DAMAGE_SHARE_EXPECTATIONS: Record<RoleKey, RoleExpectation | null> = {
  TOP: { low: 0.15, good: 0.25 },
  MIDDLE: { low: 0.2, good: 0.3 },
  BOTTOM: { low: 0.2, good: 0.32 },
  JUNGLE: { low: 0.14, good: 0.24 },
  UTILITY: null,
};

export interface AnalysisContext {
  stats: MatchStats;
  timeline: TimelineFacts;
  /** Les repères de farm / vision / lane ne valent que sur la Faille. */
  laneMetricsRelevant: boolean;
  /** Une partie très courte rend les moyennes par minute peu fiables. */
  durationReliable: boolean;
  /** Liste des données attendues mais absentes, à annoncer honnêtement. */
  missingData: string[];
}

export function buildContext(stats: MatchStats, timeline: TimelineFacts): AnalysisContext {
  const missingData: string[] = [];
  if (!timeline.available) missingData.push('timeline (déroulé minute par minute) indisponible pour cette partie');
  if (stats.role === null) missingData.push('rôle non identifiable pour cette partie');
  if (stats.visionScore === undefined) missingData.push('score de vision non fourni');
  if (stats.damageToChampions === undefined) missingData.push('dégâts aux champions non fournis');
  if (stats.killParticipation === null) missingData.push("participation aux éliminations non calculable (aucune élimination d'équipe)");

  return {
    stats,
    timeline,
    laneMetricsRelevant: stats.summonersRift && stats.role !== null,
    durationReliable: stats.durationSeconds >= 12 * 60,
    missingData,
  };
}

/** Objet strictement factuel envoyé au modèle. Aucune phrase rédigée ici. */
export interface PromptPayload {
  partie: Record<string, unknown>;
  joueur: Record<string, unknown>;
  statistiques: Record<string, unknown>;
  deroule: Record<string, unknown>;
  reperes_internes: Record<string, unknown>;
  donnees_absentes: string[];
}

export function buildPromptPayload(context: AnalysisContext): PromptPayload {
  const { stats, timeline } = context;
  const role = stats.role;

  const reperes: Record<string, unknown> = {};
  if (role) {
    const cs = CS_EXPECTATIONS[role];
    if (cs && context.laneMetricsRelevant) reperes.cs_par_minute = cs;
    reperes.participation_eliminations = KP_EXPECTATIONS[role];
    if (context.laneMetricsRelevant) reperes.vision_par_minute = VISION_EXPECTATIONS[role];
    const damage = DAMAGE_SHARE_EXPECTATIONS[role];
    if (damage) reperes.part_degats_equipe = damage;
  }

  return {
    partie: {
      identifiant: stats.matchId,
      mode: stats.queueLabel,
      classee: stats.ranked,
      faille_de_l_invocateur: stats.summonersRift,
      duree_secondes: stats.durationSeconds,
      duree_lisible: stats.durationLabel,
      resultat: stats.remake ? 'remake' : stats.win ? 'victoire' : 'defaite',
      remake: stats.remake,
      abandon: stats.surrendered,
      duree_suffisante_pour_moyennes: context.durationReliable,
    },
    joueur: {
      riot_id: stats.riotId,
      champion: stats.championName,
      role: stats.roleLabel,
      role_identifiable: role !== null,
    },
    statistiques: {
      kills: stats.kills,
      morts: stats.deaths,
      assists: stats.assists,
      kda: stats.kda,
      cs_total: stats.cs,
      cs_par_minute: stats.csPerMinute,
      participation_eliminations: stats.killParticipation,
      eliminations_equipe: stats.teamKills,
      morts_equipe: stats.teamDeaths,
      degats_champions: stats.damageToChampions ?? null,
      part_degats_equipe: stats.damageShare,
      degats_par_minute: stats.damagePerMinute,
      score_vision: stats.visionScore ?? null,
      vision_par_minute: stats.visionPerMinute,
      balises_posees: stats.wardsPlaced ?? null,
      balises_de_controle: stats.controlWardsPlaced ?? null,
      balises_detruites: stats.wardsKilled ?? null,
      or_total: stats.goldEarned ?? null,
      or_par_minute: stats.goldPerMinute,
      temps_mort_secondes: stats.timeSpentDeadSeconds ?? null,
      part_du_temps_mort: stats.deathTimeShare,
      kills_solo: stats.soloKills ?? null,
      tourelles: stats.turretTakedowns ?? null,
      soins_et_boucliers_allies: stats.healShieldOnTeammates ?? null,
      objectifs_equipe: stats.teamObjectives,
      objectifs_adverses: stats.enemyObjectives,
    },
    deroule: timeline.available
      ? {
          disponible: true,
          cs_a_10_min: timeline.csAt10,
          cs_a_14_min: timeline.csAt14,
          or_a_10_min: timeline.goldAt10,
          or_a_15_min: timeline.goldAt15,
          niveau_a_10_min: timeline.levelAt10,
          adversaire_de_voie: timeline.laneOpponentChampion,
          ecart_cs_a_10_min: timeline.csDiffAt10,
          ecart_or_a_10_min: timeline.goldDiffAt10,
          horodatage_des_morts: timeline.deathSecondsList.map(formatGameClock),
          premiere_mort: timeline.firstDeathSeconds === null ? null : formatGameClock(timeline.firstDeathSeconds),
          morts_avant_10_min: timeline.deathsBefore10Min,
          morts_entre_10_et_20_min: timeline.deathsBetween10And20Min,
          morts_apres_20_min: timeline.deathsAfter20Min,
          objectifs: timeline.objectives.map((objective) => ({
            objectif: OBJECTIVE_LABELS[objective.type] ?? objective.type,
            minute: formatGameClock(objective.secondsIntoGame),
            pris_par_mon_equipe: objective.byMyTeam,
          })),
          morts_peu_avant_un_objectif_adverse: timeline.deathsShortlyBeforeEnemyObjective.map((entry) => ({
            mort_a: formatGameClock(entry.deathSeconds),
            objectif: OBJECTIVE_LABELS[entry.objectiveType] ?? entry.objectiveType,
            objectif_a: formatGameClock(entry.objectiveSeconds),
            ecart_secondes: entry.gapSeconds,
            avertissement:
              "proximité temporelle uniquement : les données ne disent pas que cette mort a causé la perte de l'objectif",
          })),
        }
      : { disponible: false },
    reperes_internes: {
      ...reperes,
      note:
        "Seuils de travail internes à Ezreal, destinés uniquement à choisir les sujets à aborder. Ce ne sont pas des moyennes par rang et ils ne doivent jamais être cités comme une norme ou une comparaison.",
    },
    donnees_absentes: context.missingData,
  };
}

import type { AnalysisContext } from './facts.js';
import {
  CS_EXPECTATIONS,
  DAMAGE_SHARE_EXPECTATIONS,
  KP_EXPECTATIONS,
  VISION_EXPECTATIONS,
} from './facts.js';
import { formatGameClock, OBJECTIVE_LABELS } from './timeline.js';
import { formatNumber, formatPercent } from './stats.js';

/**
 * Analyse par règles — le socle factuel d'Ezreal.
 *
 * Elle sert à la fois de repli quand l'IA est absente ou en échec, et de garde-fou :
 * les sujets retenus ici sont les seuls que l'IA est autorisée à développer.
 *
 * Chaque remarque suit la même construction :
 *   observation vérifiable → interprétation prudente → conseil applicable.
 *
 * Deux principes non négociables :
 *  - on ne commente que ce que les données montrent ; aucune action de jeu,
 *    aucun placement et aucune cause de mort ne sont inventés ;
 *  - on ne force ni compliment ni critique : si rien ne ressort, les listes
 *    restent courtes, voire vides.
 */

export interface CoachNote {
  /** Fait brut, directement lisible dans les données. */
  observation: string;
  /** Lecture prudente de ce fait — jamais présentée comme une certitude. */
  interpretation: string;
  /** Action concrète et vérifiable pour la prochaine partie. */
  advice: string;
}

export interface CoachReport {
  positives: CoachNote[];
  improvements: CoachNote[];
  objective: string | null;
  /** Limites explicites de l'analyse (données manquantes, partie trop courte…). */
  caveats: string[];
  source: 'rules' | 'ai';
}

interface Candidate extends CoachNote {
  /** Plus le score est élevé, plus la remarque est prioritaire. */
  score: number;
  /** Sujet, utilisé pour construire l'objectif de la prochaine partie. */
  topic: string;
}

const MAX_POSITIVES = 2;
const MAX_IMPROVEMENTS = 3;

export function buildRuleReport(context: AnalysisContext): CoachReport {
  const { stats } = context;

  if (stats.remake) {
    return {
      positives: [],
      improvements: [],
      objective: null,
      caveats: [
        "Partie annulée (remake) : trop courte pour en tirer quoi que ce soit. Elle n'est pas comptée comme une défaite.",
      ],
      source: 'rules',
    };
  }

  const improvements = collectImprovements(context)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_IMPROVEMENTS);

  const positives = collectPositives(context)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_POSITIVES);

  return {
    positives: positives.map(strip),
    improvements: improvements.map(strip),
    objective: buildObjective(context, improvements[0]),
    caveats: buildCaveats(context),
    source: 'rules',
  };
}

function strip(candidate: Candidate): CoachNote {
  return { observation: candidate.observation, interpretation: candidate.interpretation, advice: candidate.advice };
}

function buildCaveats(context: AnalysisContext): string[] {
  const caveats: string[] = [];
  if (!context.timeline.available) {
    caveats.push(
      "Le déroulé minute par minute n'est pas disponible pour cette partie : l'analyse se limite aux totaux de fin de partie.",
    );
  }
  if (!context.durationReliable && !context.stats.remake) {
    caveats.push(
      `Partie courte (${context.stats.durationLabel}) : les moyennes par minute y sont très sensibles et sont à prendre avec prudence.`,
    );
  }
  if (context.stats.role === null && context.stats.summonersRift) {
    caveats.push("Le rôle n'a pas pu être identifié : les repères par poste n'ont pas été appliqués.");
  }
  if (!context.stats.summonersRift) {
    caveats.push(
      `Mode ${context.stats.queueLabel} : les repères de farm, de vision et de voie ne s'y appliquent pas et n'ont pas été utilisés.`,
    );
  }
  return caveats;
}

// --- Axes d'amélioration --------------------------------------------------

function collectImprovements(context: AnalysisContext): Candidate[] {
  const { stats, timeline } = context;
  const candidates: Candidate[] = [];
  const minutes = stats.durationMinutes;

  // 1. Les morts — le sujet qui pèse le plus lourd quand il ressort.
  const deathsPer10 = minutes > 0 ? (stats.deaths / minutes) * 10 : 0;
  const deathShare = stats.deathTimeShare;
  // En ARAM ou en Arena, les combats sont permanents et les morts font partie
  // du format : les mêmes seuils que sur la Faille y seraient injustes.
  const deathThreshold = stats.summonersRift ? 6 : 10;
  const deathShareThreshold = stats.summonersRift ? 0.14 : 0.22;
  const deathsPer10Threshold = stats.summonersRift ? 2.5 : 4.5;
  if (
    stats.deaths >= deathThreshold ||
    (deathShare !== null && deathShare >= deathShareThreshold) ||
    (minutes >= 15 && deathsPer10 >= deathsPer10Threshold)
  ) {
    const details: string[] = [`${stats.deaths} morts en ${stats.durationLabel}`];
    if (timeline.available && timeline.firstDeathSeconds !== null) {
      details.push(`première mort à ${formatGameClock(timeline.firstDeathSeconds)}`);
    }
    if (timeline.available && timeline.deathsBefore10Min > 0) {
      details.push(`${timeline.deathsBefore10Min} avant la 10ᵉ minute`);
    }
    if (deathShare !== null && stats.timeSpentDeadSeconds !== undefined) {
      details.push(
        `${Math.round(stats.timeSpentDeadSeconds / 60)} min passées mortes, soit ${formatPercent(deathShare)} de la partie`,
      );
    }

    candidates.push({
      topic: 'morts',
      score: 100 + stats.deaths * 3 + (deathShare ?? 0) * 100,
      observation: details.join(', ') + '.',
      interpretation:
        "Le nombre de morts est le point qui ressort le plus de cette partie. Les données disent combien de fois et quand tu es mort, pas pourquoi : elles ne décrivent ni ton placement ni le déroulé des combats.",
      advice: stats.summonersRift
        ? "Prends un repère vérifiable pour la prochaine partie : avant chaque déplacement hors de ta voie, regarde la minimap et compte les adversaires visibles. S'il en manque plus de deux, reste sur une position que tu peux quitter. Fixe-toi aussi un seuil de retour en base — par exemple sous 35 % de vie sans sort de déplacement disponible — et tiens-t'y."
        : "Sur ce mode, le repère utile est le timing plutôt que la carte : attends que tes sorts principaux soient disponibles avant d'engager, et recule dès que l'un d'eux part sans toucher. Fixe-toi comme consigne de ne jamais initier un combat seul après une mort.",
    });
  }

  // 2. Écart pris sur la voie avant la 10ᵉ minute (nécessite la timeline).
  if (context.laneMetricsRelevant && timeline.available && stats.role !== 'JUNGLE') {
    const csDiff = timeline.csDiffAt10;
    const goldDiff = timeline.goldDiffAt10;
    if ((csDiff !== null && csDiff <= -15) || (goldDiff !== null && goldDiff <= -700)) {
      const parts: string[] = [];
      if (csDiff !== null) parts.push(`${Math.abs(csDiff)} CS de retard`);
      if (goldDiff !== null && goldDiff < 0) parts.push(`${Math.abs(goldDiff)} po d'écart`);
      const opponent = timeline.laneOpponentChampion ? ` sur ${timeline.laneOpponentChampion}` : '';

      candidates.push({
        topic: 'phase de voie',
        score: 85 + Math.abs(csDiff ?? 0),
        observation: `À la 10ᵉ minute : ${parts.join(' et ')}${opponent}.`,
        interpretation:
          "Le début de partie s'est joué en défaveur sur ta voie. Les données ne disent pas d'où vient cet écart — pression du jungler adverse, échange perdu, retour en base subi : plusieurs explications restent possibles.",
        advice:
          "Sur la prochaine partie, garde un objectif chiffré sur les 10 premières minutes plutôt que de chercher un combat : vise un palier de CS à la 10ᵉ minute et note-le après la partie. Si tu es poussé sous ta tourelle, entraîne-toi à récupérer les vagues sous tourelle plutôt qu'à forcer un retour sur la voie.",
      });
    }
  }

  // 3. Farm — jamais appliqué à un support ni hors de la Faille.
  const csExpectation = stats.role ? CS_EXPECTATIONS[stats.role] : null;
  if (context.laneMetricsRelevant && csExpectation && context.durationReliable && stats.csPerMinute < csExpectation.low) {
    const at10 = timeline.available && timeline.csAt10 !== null ? ` (${timeline.csAt10} CS à la 10ᵉ minute)` : '';
    candidates.push({
      topic: 'farm',
      score: 70 + (csExpectation.low - stats.csPerMinute) * 10,
      observation: `${stats.cs} CS en ${stats.durationLabel}, soit ${formatNumber(stats.csPerMinute, 1)} CS par minute${at10}.`,
      interpretation:
        "Le farm est resté en retrait de ce que la durée de la partie permettait. C'est la ressource la plus régulière du jeu : elle ne dépend pas des combats et se travaille indépendamment du reste.",
      advice:
        "Choisis un palier à atteindre et vérifie-le en jeu : regarde ton compteur de CS à chaque retour en base et compare-le au nombre de minutes écoulées. Avant de rejoindre un combat à l'autre bout de la carte, demande-toi si la vague devant toi ne vaut pas plus.",
    });
  }

  // 4. Participation aux éliminations.
  const kpExpectation = stats.role ? KP_EXPECTATIONS[stats.role] : null;
  if (kpExpectation && stats.killParticipation !== null && stats.killParticipation < kpExpectation.low && stats.teamKills >= 5) {
    candidates.push({
      topic: 'participation aux éliminations',
      score: 60 + (kpExpectation.low - stats.killParticipation) * 100,
      observation: `Tu as participé à ${stats.kills + stats.assists} des ${stats.teamKills} éliminations de ton équipe, soit ${formatPercent(stats.killParticipation)}.`,
      interpretation:
        "Une part importante des combats de ton équipe s'est déroulée sans toi. Les données ne disent pas si tu étais occupé ailleurs utilement ou simplement absent de la carte.",
      advice:
        "Repère les moments où ton équipe se regroupe naturellement — les objectifs neutres — et place-toi à proximité avant leur apparition plutôt qu'après. Concrètement : à partir de 30 secondes avant un dragon, arrête de pousser la vague opposée et rapproche-toi.",
    });
  }

  // 5. Part des dégâts, pour les rôles censés en infliger.
  const damageExpectation = stats.role ? DAMAGE_SHARE_EXPECTATIONS[stats.role] : null;
  if (
    context.laneMetricsRelevant &&
    damageExpectation &&
    stats.damageShare !== null &&
    stats.damageShare < damageExpectation.low &&
    context.durationReliable
  ) {
    candidates.push({
      topic: 'dégâts en combat',
      score: 50 + (damageExpectation.low - stats.damageShare) * 100,
      observation: `${formatNumber(stats.damageToChampions ?? null)} dégâts aux champions, soit ${formatPercent(stats.damageShare)} du total de ton équipe.`,
      interpretation:
        "Ta contribution aux combats est restée faible pour ton poste. Cela peut venir d'un retard pris plus tôt comme d'une présence limitée en combat : les données ne permettent pas de trancher.",
      advice:
        "Travaille la durée pendant laquelle tu infliges des dégâts plutôt que le pic : cherche à rester à portée d'attaque le plus longtemps possible en combat, quitte à commencer par cibler l'adversaire le plus proche plutôt que le plus intéressant.",
    });
  }

  // 6. Vision.
  const visionExpectation = stats.role ? VISION_EXPECTATIONS[stats.role] : null;
  if (
    context.laneMetricsRelevant &&
    visionExpectation &&
    stats.visionPerMinute !== null &&
    stats.visionPerMinute < visionExpectation.low &&
    context.durationReliable
  ) {
    const control =
      stats.controlWardsPlaced !== undefined ? `, dont ${stats.controlWardsPlaced} balise(s) de contrôle` : '';
    candidates.push({
      topic: 'vision',
      score: 40 + (visionExpectation.low - stats.visionPerMinute) * 20,
      observation: `Score de vision de ${formatNumber(stats.visionScore ?? null)} sur ${stats.durationLabel} (${formatNumber(stats.visionPerMinute, 2)} par minute)${control}.`,
      interpretation:
        "La vision posée et retirée est restée limitée. C'est une des rares contributions qui ne dépend pas du niveau mécanique et qui reste utile même dans une partie mal engagée.",
      advice:
        "Prends l'habitude de vider ta balise de surveillance avant chaque retour en base : elle se recharge de toute façon, et une balise non posée est une balise perdue. Achète au moins une balise de contrôle à chaque passage en boutique.",
    });
  }

  // 7. Morts survenues peu avant un objectif adverse — proximité temporelle,
  //    jamais présentée comme une cause.
  if (timeline.available && timeline.deathsShortlyBeforeEnemyObjective.length > 0) {
    const first = timeline.deathsShortlyBeforeEnemyObjective[0];
    if (first) {
      const count = timeline.deathsShortlyBeforeEnemyObjective.length;
      const label = OBJECTIVE_LABELS[first.objectiveType] ?? first.objectiveType;
      candidates.push({
        topic: 'moments autour des objectifs',
        score: 45 + count * 5,
        observation:
          count === 1
            ? `Tu es mort à ${formatGameClock(first.deathSeconds)}, et l'équipe adverse a pris ${label} ${first.gapSeconds} secondes plus tard.`
            : `À ${count} reprises, une de tes morts est survenue moins d'une minute avant la prise d'un objectif par l'équipe adverse (la première à ${formatGameClock(first.deathSeconds)}, suivie de ${label}).`,
        interpretation:
          "Ce sont des moments à revoir en priorité si tu regardes le replay. Attention : la timeline établit seulement l'enchaînement dans le temps. Elle ne dit pas que ta mort a causé la perte de l'objectif, ni où se trouvaient les autres joueurs.",
        advice:
          "Repère dans le replay les 30 secondes qui précèdent ces morts et regarde une seule chose : le minuteur de l'objectif était-il visible à l'écran ? Si oui, l'axe de travail est d'anticiper l'apparition plutôt que de la subir.",
      });
    }
  }

  return candidates;
}

// --- Points positifs ------------------------------------------------------

function collectPositives(context: AnalysisContext): Candidate[] {
  const { stats, timeline } = context;
  const candidates: Candidate[] = [];
  const minutes = stats.durationMinutes;

  if (stats.deaths <= 2 && minutes >= 20) {
    candidates.push({
      topic: 'survie',
      score: 90 - stats.deaths * 10,
      observation: `Seulement ${stats.deaths} mort${stats.deaths > 1 ? 's' : ''} sur ${stats.durationLabel}.`,
      interpretation:
        "Tu as très peu donné d'avantage à l'adversaire. C'est l'un des indicateurs les plus stables d'une partie maîtrisée.",
      advice: 'À conserver : ce niveau de prudence te laisse la marge nécessaire pour prendre des initiatives quand elles se présentent.',
    });
  }

  const kpExpectation = stats.role ? KP_EXPECTATIONS[stats.role] : null;
  if (kpExpectation && stats.killParticipation !== null && stats.killParticipation >= kpExpectation.good && stats.teamKills >= 5) {
    candidates.push({
      topic: 'présence',
      score: 80 + stats.killParticipation * 10,
      observation: `${formatPercent(stats.killParticipation)} de participation aux éliminations (${stats.kills + stats.assists} sur ${stats.teamKills}).`,
      interpretation: 'Tu étais présent sur la grande majorité des combats de ton équipe.',
      advice: 'À conserver. Le point de vigilance associé est de ne pas laisser filer tes vagues pour tenir ce rythme.',
    });
  }

  const csExpectation = stats.role ? CS_EXPECTATIONS[stats.role] : null;
  if (context.laneMetricsRelevant && csExpectation && context.durationReliable && stats.csPerMinute >= csExpectation.good) {
    candidates.push({
      topic: 'farm',
      score: 75 + stats.csPerMinute,
      observation: `${stats.cs} CS en ${stats.durationLabel}, soit ${formatNumber(stats.csPerMinute, 1)} CS par minute.`,
      interpretation: 'Le farm a été tenu de façon régulière sur toute la partie.',
      advice: 'À conserver : cette régularité est ce qui te permet de rester utile même quand les combats tournent mal.',
    });
  }

  if (context.laneMetricsRelevant && timeline.available) {
    const csDiff = timeline.csDiffAt10;
    const goldDiff = timeline.goldDiffAt10;
    if ((csDiff !== null && csDiff >= 15) || (goldDiff !== null && goldDiff >= 700)) {
      const parts: string[] = [];
      if (csDiff !== null && csDiff > 0) parts.push(`${csDiff} CS d'avance`);
      if (goldDiff !== null && goldDiff > 0) parts.push(`${goldDiff} po d'avance`);
      candidates.push({
        topic: 'phase de voie',
        score: 78,
        observation: `À la 10ᵉ minute : ${parts.join(' et ')}${timeline.laneOpponentChampion ? ` sur ${timeline.laneOpponentChampion}` : ''}.`,
        interpretation: 'Le début de partie a tourné à ton avantage sur ta voie.',
        advice: "À conserver. L'étape suivante est de transformer cette avance ailleurs sur la carte avant qu'elle ne s'efface.",
      });
    }
  }

  const visionExpectation = stats.role ? VISION_EXPECTATIONS[stats.role] : null;
  if (
    context.laneMetricsRelevant &&
    visionExpectation &&
    stats.visionPerMinute !== null &&
    stats.visionPerMinute >= visionExpectation.good &&
    context.durationReliable
  ) {
    candidates.push({
      topic: 'vision',
      score: 70,
      observation: `Score de vision de ${formatNumber(stats.visionScore ?? null)} (${formatNumber(stats.visionPerMinute, 2)} par minute).`,
      interpretation: "Tu as fourni à ton équipe une information de carte nettement au-dessus de ce que ton poste demande.",
      advice: 'À conserver.',
    });
  }

  const damageExpectation = stats.role ? DAMAGE_SHARE_EXPECTATIONS[stats.role] : null;
  if (
    context.laneMetricsRelevant &&
    damageExpectation &&
    stats.damageShare !== null &&
    stats.damageShare >= damageExpectation.good &&
    context.durationReliable
  ) {
    candidates.push({
      topic: 'dégâts',
      score: 72,
      observation: `${formatNumber(stats.damageToChampions ?? null)} dégâts aux champions, soit ${formatPercent(stats.damageShare)} du total de ton équipe.`,
      interpretation: 'Tu as porté une part importante des dégâts de ton équipe en combat.',
      advice: 'À conserver.',
    });
  }

  if (stats.role === 'UTILITY' && stats.healShieldOnTeammates !== undefined && stats.healShieldOnTeammates >= 8000) {
    candidates.push({
      topic: 'soutien',
      score: 68,
      observation: `${formatNumber(stats.healShieldOnTeammates)} points de soins et de boucliers apportés à tes alliés.`,
      interpretation: "Ton apport de soutien en combat est significatif ; c'est le cœur du poste.",
      advice: 'À conserver.',
    });
  }

  if (stats.soloKills !== undefined && stats.soloKills >= 2) {
    candidates.push({
      topic: 'duels',
      score: 60 + stats.soloKills,
      observation: `${stats.soloKills} éliminations obtenues en duel, sans aide.`,
      interpretation: 'Tu as gagné plusieurs affrontements à un contre un.',
      advice: 'À conserver.',
    });
  }

  return candidates;
}

// --- Objectif pour la prochaine partie ------------------------------------

function buildObjective(context: AnalysisContext, top: Candidate | undefined): string | null {
  const { stats, timeline } = context;

  if (!top) {
    return "Rien de marquant à corriger sur cette partie : rejoue-la à l'identique en gardant le même niveau d'exigence, et regarde si le résultat se répète.";
  }

  switch (top.topic) {
    case 'morts': {
      const target = Math.max(2, stats.deaths - 2);
      return `Prochaine partie : viser au maximum ${target} morts. Compte-les à la fin et compare avec les ${stats.deaths} de cette partie.`;
    }
    case 'farm': {
      const target = Math.ceil(stats.csPerMinute + 1);
      const at10 = timeline.csAt10;
      if (at10 !== null) {
        return `Prochaine partie : atteindre ${at10 + 15} CS à la 10ᵉ minute (tu en avais ${at10}). Regarde ton compteur à 10:00 et note le chiffre.`;
      }
      return `Prochaine partie : viser ${target} CS par minute, soit environ ${Math.round(target * stats.durationMinutes)} CS sur une partie de même durée.`;
    }
    case 'phase de voie':
      return "Prochaine partie : sur les 10 premières minutes, ne chercher aucun échange que tu n'as pas préparé. Objectif unique : terminer la 10ᵉ minute sans retard de CS sur ton adversaire direct.";
    case 'participation aux éliminations': {
      const target = Math.min(0.75, (stats.killParticipation ?? 0) + 0.12);
      return `Prochaine partie : viser ${formatPercent(target)} de participation aux éliminations, en te rapprochant systématiquement des objectifs neutres 30 secondes avant leur apparition.`;
    }
    case 'vision': {
      const current = stats.visionScore;
      const target = current !== undefined ? Math.round(current * 1.3) + 5 : null;
      return target === null
        ? 'Prochaine partie : vider systématiquement ta balise de surveillance avant chaque retour en base.'
        : `Prochaine partie : viser un score de vision de ${target} (tu étais à ${current}), en vidant ta balise de surveillance avant chaque retour en base.`;
    }
    case 'dégâts en combat':
      return "Prochaine partie : sur chaque combat d'équipe, chercher à rester en vie et à portée jusqu'à la fin de l'affrontement plutôt qu'à réussir une seule action décisive.";
    case 'moments autour des objectifs':
      return "Prochaine partie : à partir de 45 secondes avant chaque dragon ou baron, arrêter toute action isolée et rejoindre la zone de l'objectif.";
    default:
      return top.advice;
  }
}

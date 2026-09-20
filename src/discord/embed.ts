import type { APIEmbed, APIEmbedField } from 'discord.js';
import type { CoachReport } from '../analysis/rules.js';
import { formatInteger, formatNumber, formatPercent, type MatchStats } from '../analysis/stats.js';

/**
 * Rendu du message Discord.
 *
 * Les limites appliquées ici viennent de la documentation Discord :
 * titre 256, description 4096, 25 champs, nom de champ 256, valeur de champ
 * 1024, pied de page 2048, et surtout un total de 6000 caractères cumulés sur
 * l'ensemble des embeds d'un message. Dépasser l'une d'elles fait échouer
 * l'envoi avec un « Bad Request », donc tout est tronqué en amont.
 *
 * La mise en page vise la lecture sur téléphone : peu de champs en ligne
 * (ils s'empilent sur mobile), des libellés courts, et l'analyse en champs
 * pleine largeur.
 */

export const DISCORD_LIMITS = {
  title: 256,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
  footerText: 2048,
  authorName: 256,
  fieldsPerEmbed: 25,
  totalPerMessage: 6000,
} as const;

const COLOR_WIN = 0x2ecc71;
const COLOR_LOSS = 0xe74c3c;
const COLOR_REMAKE = 0x95a5a6;

export const ANALYSIS_PENDING_TEXT = '⏳ Ezreal rédige son analyse… le message sera complété dans quelques instants.';

/** Tronque proprement, en coupant sur un espace quand c'est possible. */
export function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, max);
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base}…`;
}

/** Somme des caractères comptabilisés par Discord dans la limite des 6000. */
export function embedCharacterCount(embed: APIEmbed): number {
  let total = 0;
  total += embed.title?.length ?? 0;
  total += embed.description?.length ?? 0;
  total += embed.footer?.text?.length ?? 0;
  total += embed.author?.name?.length ?? 0;
  for (const field of embed.fields ?? []) {
    total += field.name.length + field.value.length;
  }
  return total;
}

function resultLine(stats: MatchStats): string {
  if (stats.remake) return '⚪ Partie annulée (remake)';
  return stats.win ? '🟢 Victoire' : '🔴 Défaite';
}

function statFields(stats: MatchStats): APIEmbedField[] {
  const fields: APIEmbedField[] = [];

  const kdaLine = stats.kda === null ? 'KDA parfait' : `KDA ${formatNumber(stats.kda, 2)}`;
  fields.push({
    name: '⚔️ K / D / A',
    value: `**${stats.kills} / ${stats.deaths} / ${stats.assists}**\n${kdaLine}`,
    inline: true,
  });

  // Le farm n'a de sens que sur la Faille ; on l'omet ailleurs plutôt que
  // d'afficher un chiffre trompeur.
  if (stats.summonersRift) {
    fields.push({
      name: '🌾 Farm',
      value: `**${formatInteger(stats.cs)} CS**\n${formatNumber(stats.csPerMinute, 1)} / min`,
      inline: true,
    });
  }

  fields.push({
    name: '🤝 Participation',
    value:
      stats.killParticipation === null
        ? '**n/a**\naucune élimination'
        : `**${formatPercent(stats.killParticipation)}**\n${stats.kills + stats.assists} sur ${stats.teamKills}`,
    inline: true,
  });

  if (stats.damageToChampions !== undefined) {
    fields.push({
      name: '💥 Dégâts aux champions',
      value: `**${formatInteger(stats.damageToChampions)}**\n${
        stats.damageShare === null ? 'part inconnue' : `${formatPercent(stats.damageShare)} de l’équipe`
      }`,
      inline: true,
    });
  }

  if (stats.visionScore !== undefined) {
    fields.push({
      name: '👁️ Vision',
      value: `**${formatInteger(stats.visionScore)}**\n${
        stats.visionPerMinute === null ? '—' : `${formatNumber(stats.visionPerMinute, 2)} / min`
      }`,
      inline: true,
    });
  }

  if (stats.goldEarned !== undefined) {
    fields.push({
      name: '💰 Or',
      value: `**${formatInteger(stats.goldEarned)}**\n${
        stats.goldPerMinute === null ? '—' : `${formatInteger(stats.goldPerMinute)} / min`
      }`,
      inline: true,
    });
  }

  return fields;
}

interface Note {
  observation: string;
  interpretation: string;
  advice: string;
}

function renderNote(note: Note): string {
  return `${note.observation}\n${note.interpretation}\n➜ *${note.advice}*`;
}

/**
 * Une remarque par champ.
 *
 * Regrouper plusieurs remarques dans un seul champ les ferait tronquer à
 * 1024 caractères, souvent en plein milieu d'une phrase. Un champ par remarque
 * donne à chacune son propre budget et s'empile proprement sur mobile.
 */
function noteFields(notes: Note[], icon: string, singular: string): APIEmbedField[] {
  return notes.map((note, index) => ({
    name: notes.length === 1 ? `${icon} ${singular}` : `${icon} ${singular} ${index + 1}/${notes.length}`,
    value: clamp(renderNote(note), DISCORD_LIMITS.fieldValue),
    inline: false,
  }));
}

export interface BuildEmbedOptions {
  stats: MatchStats;
  /** `null` tant que l'analyse n'est pas prête. */
  report: CoachReport | null;
  portraitUrl: string | null;
  /** Bandeau « données fictives » du mode démonstration. */
  demo?: boolean;
}

export function buildMatchEmbed(options: BuildEmbedOptions): APIEmbed {
  const { stats, report, portraitUrl, demo = false } = options;

  const roleSuffix = stats.roleLabel ? ` · ${stats.roleLabel}` : '';
  const title = clamp(`${resultLine(stats)} — ${stats.championName}${roleSuffix}`, DISCORD_LIMITS.title);

  const descriptionParts = [`**${stats.queueLabel}** · ${stats.durationLabel}`];
  if (stats.surrendered) descriptionParts.push('_Partie terminée par un abandon._');
  if (demo) {
    descriptionParts.push('⚠️ **Mode démonstration — données entièrement fictives, ce n’est pas une vraie partie.**');
  }

  const fields: APIEmbedField[] = [];

  if (!stats.remake) {
    fields.push(...statFields(stats));
  } else {
    fields.push({
      name: 'ℹ️ Partie annulée',
      value: "Cette partie s’est arrêtée avant la 4ᵉ minute. Elle n’est comptée ni comme une victoire ni comme une défaite.",
      inline: false,
    });
  }

  if (report === null) {
    fields.push({ name: '🧠 Analyse', value: ANALYSIS_PENDING_TEXT, inline: false });
  } else {
    fields.push(...noteFields(report.positives, '✅', 'Ce que tu as bien fait'));
    fields.push(...noteFields(report.improvements, '🎯', 'Axe d’amélioration'));
    if (report.objective) {
      fields.push({
        name: '📌 Objectif pour la prochaine partie',
        value: clamp(report.objective, DISCORD_LIMITS.fieldValue),
        inline: false,
      });
    }
    if (report.caveats.length > 0) {
      fields.push({
        name: 'ℹ️ Limites de cette analyse',
        value: clamp(report.caveats.map((caveat) => `• ${caveat}`).join('\n'), DISCORD_LIMITS.fieldValue),
        inline: false,
      });
    }
    if (report.positives.length === 0 && report.improvements.length === 0 && !report.objective && !stats.remake) {
      fields.push({
        name: '🧠 Analyse',
        value: "Rien de suffisamment net ne ressort des données de cette partie. Ezreal préfère ne rien commenter plutôt que d’inventer un reproche ou un compliment.",
        inline: false,
      });
    }
  }

  const footerSource = report?.source === 'ai' ? 'analyse rédigée par IA' : 'analyse automatique par règles';
  const embed: APIEmbed = {
    color: stats.remake ? COLOR_REMAKE : stats.win ? COLOR_WIN : COLOR_LOSS,
    author: { name: clamp(stats.riotId, DISCORD_LIMITS.authorName) },
    title,
    description: clamp(descriptionParts.join('\n'), DISCORD_LIMITS.description),
    fields: fields.slice(0, DISCORD_LIMITS.fieldsPerEmbed).map((field) => ({
      name: clamp(field.name, DISCORD_LIMITS.fieldName),
      value: clamp(field.value, DISCORD_LIMITS.fieldValue),
      inline: field.inline ?? false,
    })),
    footer: {
      text: clamp(
        `Ezreal · ${footerSource} · données Riot Games${demo ? ' (simulées)' : ''}`,
        DISCORD_LIMITS.footerText,
      ),
    },
  };

  if (portraitUrl) embed.thumbnail = { url: portraitUrl };
  if (stats.gameEndTimestamp) embed.timestamp = new Date(stats.gameEndTimestamp).toISOString();

  return enforceTotalBudget(embed);
}

/**
 * Garantit le plafond global de 6000 caractères.
 * On retire d'abord les informations les moins essentielles (les limites de
 * l'analyse), puis on tronque les champs restants en partant de la fin.
 */
export function enforceTotalBudget(embed: APIEmbed): APIEmbed {
  const result: APIEmbed = { ...embed, fields: [...(embed.fields ?? [])] };

  if (embedCharacterCount(result) <= DISCORD_LIMITS.totalPerMessage) return result;

  const caveatIndex = (result.fields ?? []).findIndex((field) => field.name.includes('Limites'));
  if (caveatIndex >= 0) {
    result.fields?.splice(caveatIndex, 1);
    if (embedCharacterCount(result) <= DISCORD_LIMITS.totalPerMessage) return result;
  }

  const fields = result.fields ?? [];
  for (let index = fields.length - 1; index >= 0; index -= 1) {
    const excess = embedCharacterCount(result) - DISCORD_LIMITS.totalPerMessage;
    if (excess <= 0) break;
    const field = fields[index];
    if (!field) continue;
    const keep = Math.max(1, field.value.length - excess);
    fields[index] = { ...field, value: clamp(field.value, keep) };
  }

  return result;
}

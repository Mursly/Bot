import type { APIEmbed } from 'discord.js';
import { buildContext } from './analysis/facts.js';
import { buildRuleReport } from './analysis/rules.js';
import { computeMatchStats } from './analysis/stats.js';
import { extractTimelineFacts } from './analysis/timeline.js';
import { DEMO_PUUID, DEMO_SCENARIOS } from './demoData.js';
import { buildMatchEmbed, embedCharacterCount, DISCORD_LIMITS } from './discord/embed.js';
import { FALLBACK_VERSION } from './riot/ddragon.js';

/**
 * Mode démonstration.
 *
 * Il rend dans le terminal exactement les embeds qui seraient publiés, à partir
 * de données **entièrement fictives** et sans aucun appel à Riot, à Discord ou
 * à Anthropic. Rien n'est publié : l'objectif est de vérifier la mise en forme
 * et le contenu de l'analyse, pas de simuler de vraies parties.
 *
 *   npm run demo            rendu texte des scénarios
 *   npm run demo -- --json  embeds au format JSON brut
 */

function renderEmbedAsText(embed: APIEmbed): string {
  const lines: string[] = [];
  if (embed.author?.name) lines.push(`┌ ${embed.author.name}`);
  if (embed.title) lines.push(`│ ${embed.title}`);
  if (embed.description) {
    for (const line of embed.description.split('\n')) lines.push(`│ ${line}`);
  }
  if (embed.thumbnail?.url) lines.push(`│ [portrait] ${embed.thumbnail.url}`);
  lines.push('│');

  for (const field of embed.fields ?? []) {
    lines.push(`│ ── ${field.name}${field.inline ? '  (en ligne)' : ''}`);
    for (const line of field.value.split('\n')) lines.push(`│    ${line}`);
    lines.push('│');
  }
  if (embed.footer?.text) lines.push(`└ ${embed.footer.text}`);
  return lines.join('\n');
}

async function main(): Promise<void> {
  const asJson = process.argv.includes('--json');

  console.log('═'.repeat(78));
  console.log('  MODE DÉMONSTRATION — toutes les données ci-dessous sont INVENTÉES.');
  console.log('  Aucune requête n’est envoyée à Riot, Discord ou Anthropic.');
  console.log('  Aucun message n’est publié.');
  console.log('═'.repeat(78));

  for (const scenario of DEMO_SCENARIOS) {
    const stats = computeMatchStats(scenario.match, DEMO_PUUID);
    const timelineFacts = extractTimelineFacts(scenario.match, scenario.timeline, DEMO_PUUID, stats.role);
    const context = buildContext(stats, timelineFacts);
    const report = buildRuleReport(context);

    // Le portrait est construit sans appel réseau : le mode démonstration ne
    // contacte aucun service, et la version exacte du patch n'a pas d'importance
    // pour vérifier la mise en forme.
    const portraitUrl = `https://ddragon.leagueoflegends.com/cdn/${FALLBACK_VERSION}/img/champion/${stats.championPortraitName}.png`;
    const embed = buildMatchEmbed({ stats, report, portraitUrl, demo: true });

    console.log(`\n\n### ${scenario.label}  —  ${stats.matchId}\n`);
    if (asJson) {
      console.log(JSON.stringify(embed, null, 2));
    } else {
      console.log(renderEmbedAsText(embed));
    }

    const total = embedCharacterCount(embed);
    const tooLongFields = (embed.fields ?? []).filter((field) => field.value.length > DISCORD_LIMITS.fieldValue);
    console.log(
      `\n   [contrôle] ${total}/${DISCORD_LIMITS.totalPerMessage} caractères · ` +
        `${embed.fields?.length ?? 0}/${DISCORD_LIMITS.fieldsPerEmbed} champs · ` +
        `${tooLongFields.length === 0 ? 'toutes les limites Discord sont respectées' : '⚠️ champ trop long'}`,
    );
  }

  console.log(`\n${'═'.repeat(78)}`);
  console.log('  Fin de la démonstration. Rappel : ces parties n’ont jamais eu lieu.');
  console.log('═'.repeat(78));
}

main().catch((error: unknown) => {
  console.error('Échec du mode démonstration', error);
  process.exit(1);
});

import {
  type APIEmbed,
  type ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { AnalysisService } from '../analysis/ai.js';
import type { CoachReport } from '../analysis/rules.js';
import type { MatchStats } from '../analysis/stats.js';
import { logger } from '../logger.js';
import { RiotApiError } from '../riot/errors.js';
import { parseQueueFilter, QUEUE_KEYS } from '../riot/queues.js';
import { isPlatform, PLATFORM_LABELS, type Platform } from '../riot/routing.js';
import type { RiotClient } from '../riot/client.js';
import type { DataDragon } from '../riot/ddragon.js';
import type { Repository } from '../storage/repository.js';
import { buildMatchEmbed } from './embed.js';
import { parseRiotId } from './commands.js';

export interface HandlerDeps {
  repository: Repository;
  riot: RiotClient;
  dataDragon: DataDragon;
  analysis: AnalysisService;
  defaultPlatform: Platform;
  pollIntervalSeconds: number;
}

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

/** Permissions dont Ezreal a besoin dans le salon de publication. */
const REQUIRED_CHANNEL_PERMISSIONS = [
  { flag: PermissionFlagsBits.ViewChannel, label: 'Voir le salon' },
  { flag: PermissionFlagsBits.SendMessages, label: 'Envoyer des messages' },
  { flag: PermissionFlagsBits.EmbedLinks, label: 'Intégrer des liens' },
] as const;

export async function handleSuivre(
  interaction: ChatInputCommandInteraction,
  deps: HandlerDeps,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: 'Cette commande s’utilise sur un serveur.', ...EPHEMERAL });
    return;
  }

  // Discord filtre déjà via les permissions par défaut de la commande, mais un
  // administrateur peut avoir assoupli ce réglage : on revérifie ici.
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: 'Il faut la permission « Gérer le serveur » pour modifier le suivi.',
      ...EPHEMERAL,
    });
    return;
  }

  await interaction.deferReply(EPHEMERAL);

  const rawPlayer = interaction.options.getString('joueur', true);
  const parsed = parseRiotId(rawPlayer);
  if (!parsed) {
    await interaction.editReply(
      `❌ « ${rawPlayer} » n’est pas un Riot ID valide.\n` +
        'Format attendu : **Pseudo#TAG** (par exemple `Faker#KR1`). ' +
        'Le Riot ID complet est visible en haut du client League of Legends, ou sur account.riotgames.com.',
    );
    return;
  }

  const rawRegion = interaction.options.getString('region') ?? deps.defaultPlatform;
  const platform: Platform = isPlatform(rawRegion) ? rawRegion : deps.defaultPlatform;

  const channel = interaction.options.getChannel('salon', true);
  const guildChannel = interaction.guild.channels.cache.get(channel.id) ?? (await interaction.guild.channels.fetch(channel.id));
  if (!guildChannel || !guildChannel.isTextBased()) {
    await interaction.editReply('❌ Ce salon n’accepte pas les messages. Choisissez un salon textuel.');
    return;
  }

  const me = interaction.guild.members.me;
  if (me) {
    const permissions = guildChannel.permissionsFor(me);
    const missing = REQUIRED_CHANNEL_PERMISSIONS.filter((entry) => !permissions?.has(entry.flag));
    if (missing.length > 0) {
      await interaction.editReply(
        `❌ Ezreal ne peut pas publier dans <#${channel.id}>.\n` +
          `Permissions manquantes : **${missing.map((entry) => entry.label).join('**, **')}**.`,
      );
      return;
    }
  }

  const queueFilter = parseQueueFilter(interaction.options.getString('modes'));
  const rawModes = interaction.options.getString('modes');
  if (rawModes && !queueFilter) {
    await interaction.editReply(
      `❌ Aucun mode reconnu dans « ${rawModes} ».\nModes disponibles : ${QUEUE_KEYS.map((key) => `\`${key}\``).join(', ')}.`,
    );
    return;
  }

  let puuid: string;
  try {
    const account = await deps.riot.getAccountByRiotId(platform, parsed.gameName, parsed.tagLine);
    puuid = account.puuid;
  } catch (error) {
    const message =
      error instanceof RiotApiError ? error.userMessage : 'Erreur inattendue en interrogeant l’API Riot.';
    await interaction.editReply(`❌ ${message}`);
    return;
  }

  const now = Date.now();
  const tracked = deps.repository.setTracking(
    {
      guildId: interaction.guildId,
      gameName: parsed.gameName,
      tagLine: parsed.tagLine,
      puuid,
      platform,
      channelId: channel.id,
      // Point de départ : seules les parties commencées après cet instant
      // seront publiées. L'historique existant est ignoré.
      sinceMs: now,
      queueFilter,
    },
    now,
  );

  const modeLine = tracked.queueFilter ? tracked.queueFilter.join(', ') : 'tous les modes';
  await interaction.editReply(
    [
      `✅ Ezreal suit désormais **${tracked.riotId}** (${PLATFORM_LABELS[platform]}).`,
      `📢 Publication dans <#${channel.id}> · modes suivis : **${modeLine}**.`,
      `🔎 Vérification toutes les ${deps.pollIntervalSeconds} secondes.`,
      '',
      'ℹ️ Seules les parties **commencées à partir de maintenant** seront publiées : l’historique existant est ignoré.',
      'Une partie apparaît une fois que Riot a fini de la traiter, ce qui prend généralement quelques minutes après la fin.',
    ].join('\n'),
  );
}

export async function handleArreter(interaction: ChatInputCommandInteraction, deps: HandlerDeps): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'Cette commande s’utilise sur un serveur.', ...EPHEMERAL });
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: 'Il faut la permission « Gérer le serveur » pour modifier le suivi.',
      ...EPHEMERAL,
    });
    return;
  }

  const existing = deps.repository.getTracking(interaction.guildId);
  if (!existing) {
    await interaction.reply({ content: 'Aucun joueur n’est suivi sur ce serveur.', ...EPHEMERAL });
    return;
  }

  deps.repository.deleteTracking(interaction.guildId);
  await interaction.reply({
    content: `🛑 Suivi de **${existing.riotId}** arrêté. Les parties déjà publiées restent dans <#${existing.channelId}>.`,
    ...EPHEMERAL,
  });
}

export async function handleStatut(interaction: ChatInputCommandInteraction, deps: HandlerDeps): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'Cette commande s’utilise sur un serveur.', ...EPHEMERAL });
    return;
  }

  const tracked = deps.repository.getTracking(interaction.guildId);
  if (!tracked) {
    await interaction.reply({
      content: 'Aucun joueur suivi. Utilisez `/suivre` pour en configurer un.',
      ...EPHEMERAL,
    });
    return;
  }

  const published = deps.repository.countPublished(interaction.guildId);
  const lastCheck = tracked.lastCheckedAt
    ? `<t:${Math.floor(tracked.lastCheckedAt / 1000)}:R>`
    : 'pas encore effectuée';

  const lines = [
    `👤 **Joueur suivi :** ${tracked.riotId}`,
    `🌍 **Région :** ${PLATFORM_LABELS[tracked.platform]}`,
    `📢 **Salon :** <#${tracked.channelId}>`,
    `🎮 **Modes suivis :** ${tracked.queueFilter ? tracked.queueFilter.join(', ') : 'tous'}`,
    `🕒 **Suivi démarré :** <t:${Math.floor(tracked.sinceMs / 1000)}:f>`,
    `🔎 **Dernière vérification :** ${lastCheck} (toutes les ${deps.pollIntervalSeconds} s)`,
    `📊 **Parties publiées :** ${published}`,
    `🧠 **Analyse :** ${deps.analysis.aiEnabled ? 'rédigée par IA (repli automatique sur les règles)' : 'par règles (aucune clé Anthropic configurée)'}`,
  ];

  if (tracked.lastError) {
    lines.push('', `⚠️ **Dernier incident :** ${tracked.lastError}`);
  } else {
    lines.push('', '✅ Service opérationnel.');
  }

  await interaction.reply({ content: lines.join('\n'), ...EPHEMERAL });
}

export async function handleDerniere(interaction: ChatInputCommandInteraction, deps: HandlerDeps): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'Cette commande s’utilise sur un serveur.', ...EPHEMERAL });
    return;
  }

  const tracked = deps.repository.getTracking(interaction.guildId);
  const last = deps.repository.getLastPublishedMatch(interaction.guildId);

  if (!last?.statsJson) {
    await interaction.reply({
      content: tracked
        ? `Aucune partie de **${tracked.riotId}** n’a encore été publiée. Ezreal publiera la prochaine dès que Riot l’aura traitée.`
        : 'Aucun joueur suivi. Utilisez `/suivre` pour en configurer un.',
      ...EPHEMERAL,
    });
    return;
  }

  await interaction.deferReply();

  let embed: APIEmbed;
  try {
    const stats = JSON.parse(last.statsJson) as MatchStats;
    const report = last.reportJson ? (JSON.parse(last.reportJson) as CoachReport) : null;
    const portraitUrl = await deps.dataDragon.championSquareUrl(stats.championPortraitName);
    embed = buildMatchEmbed({ stats, report, portraitUrl });
  } catch (error) {
    logger.error('Bilan enregistré illisible', error);
    await interaction.editReply('❌ Le bilan enregistré est illisible. Il sera régénéré à la prochaine partie.');
    return;
  }

  await interaction.editReply({ embeds: [embed] });
}

export async function handleAide(interaction: ChatInputCommandInteraction, deps: HandlerDeps): Promise<void> {
  const embed: APIEmbed = {
    color: 0x3498db,
    title: '🏹 Ezreal — mode d’emploi',
    description:
      'Ezreal surveille les parties d’un joueur League of Legends et publie un bilan commenté après chacune d’elles.',
    fields: [
      {
        name: '⚙️ Commandes',
        value: [
          '`/suivre joueur:Pseudo#TAG salon:#salon [region] [modes]` — configure le suivi *(permission « Gérer le serveur »)*',
          '`/arreter` — arrête le suivi *(permission « Gérer le serveur »)*',
          '`/statut` — joueur suivi, salon et état du service',
          '`/derniere` — réaffiche le bilan de la dernière partie',
          '`/aide` — ce message',
        ].join('\n'),
      },
      {
        name: '⏱️ Quand la partie apparaît-elle ?',
        value:
          `Ezreal interroge Riot toutes les ${deps.pollIntervalSeconds} secondes, mais une partie n’est lisible qu’une fois traitée par Riot. ` +
          'Comptez généralement quelques minutes après la fin : ce n’est pas instantané.',
      },
      {
        name: '🎮 Filtrer les modes suivis',
        value:
          'Option `modes` de `/suivre`, séparée par des virgules. Sans elle, tous les modes sont suivis.\n' +
          `Valeurs acceptées : ${QUEUE_KEYS.map((key) => `\`${key}\``).join(', ')}.`,
      },
      {
        name: '🧠 Ce que l’analyse fait — et ne fait pas',
        value: [
          'Tous les chiffres sont calculés à partir des données officielles Riot (statistiques de fin de partie et déroulé minute par minute).',
          "Ezreal **n’a pas regardé la partie** : il ne sait ni où tu étais placé, ni pourquoi tu es mort, ni ce que tu as raté.",
          'Quand les données ne suffisent pas à conclure, il le dit au lieu d’inventer.',
        ].join('\n'),
      },
      {
        name: '🚫 Ce qu’Ezreal ne dira jamais',
        value:
          'Aucune moyenne par rang, aucun classement, aucune recommandation d’objets « optimale », et jamais qu’une de tes morts a causé la perte d’un objectif : les données ne permettent pas de l’établir.',
      },
    ],
    footer: { text: 'Ezreal · données Riot Games · non affilié à Riot Games' },
  };

  await interaction.reply({ embeds: [embed], ...EPHEMERAL });
}

import {
  ChannelType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { PLATFORMS, PLATFORM_LABELS } from '../riot/routing.js';

/**
 * Définition des commandes slash.
 *
 * Les commandes qui modifient la configuration (/suivre et /arreter) sont
 * réservées aux membres disposant de la permission « Gérer le serveur ».
 * Discord applique ce filtre côté serveur ; le code le revérifie malgré tout
 * à l'exécution, car un administrateur peut assouplir ce réglage.
 *
 * Toutes les commandes sont limitées au contexte « serveur » : le suivi
 * s'attache à un serveur et à un salon, il n'a pas de sens en message privé.
 */

const REGION_CHOICES = PLATFORMS.map((platform) => ({
  name: PLATFORM_LABELS[platform],
  value: platform,
}));

export const suivreCommand = new SlashCommandBuilder()
  .setName('suivre')
  .setDescription('Suivre un joueur League of Legends et publier ses parties dans un salon.')
  .setContexts(InteractionContextType.Guild)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((option) =>
    option
      .setName('joueur')
      .setDescription('Riot ID complet, au format Pseudo#TAG (exemple : Faker#KR1)')
      .setRequired(true)
      .setMaxLength(50),
  )
  .addChannelOption((option) =>
    option
      .setName('salon')
      .setDescription('Salon où publier les résultats de parties')
      .setRequired(true)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
  )
  .addStringOption((option) =>
    option
      .setName('region')
      .setDescription('Région du compte (EUW par défaut)')
      .setRequired(false)
      .addChoices(...REGION_CHOICES),
  )
  .addStringOption((option) =>
    option
      .setName('modes')
      // Discord plafonne la description d'une option à 100 caractères : la liste
      // complète des modes est donnée par /aide, pas ici.
      .setDescription('Modes à suivre, séparés par des virgules (ex. soloq,flex). Vide = tous les modes.')
      .setRequired(false)
      .setMaxLength(200),
  );

export const arreterCommand = new SlashCommandBuilder()
  .setName('arreter')
  .setDescription('Arrêter le suivi du joueur sur ce serveur.')
  .setContexts(InteractionContextType.Guild)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export const statutCommand = new SlashCommandBuilder()
  .setName('statut')
  .setDescription('Afficher le joueur suivi, le salon de publication et l’état du service.')
  .setContexts(InteractionContextType.Guild);

export const derniereCommand = new SlashCommandBuilder()
  .setName('derniere')
  .setDescription('Afficher le bilan de la dernière partie publiée.')
  .setContexts(InteractionContextType.Guild);

export const aideCommand = new SlashCommandBuilder()
  .setName('aide')
  .setDescription('Expliquer le fonctionnement d’Ezreal.')
  .setContexts(InteractionContextType.Guild);

export const commands = [
  suivreCommand,
  arreterCommand,
  statutCommand,
  derniereCommand,
  aideCommand,
];

export const commandsJson = commands.map((command) => command.toJSON());

/** Découpe un Riot ID « Pseudo#TAG ». Renvoie `null` si le format est invalide. */
export function parseRiotId(raw: string): { gameName: string; tagLine: string } | null {
  const trimmed = raw.trim();
  const hashIndex = trimmed.lastIndexOf('#');
  if (hashIndex <= 0 || hashIndex === trimmed.length - 1) return null;

  const gameName = trimmed.slice(0, hashIndex).trim();
  const tagLine = trimmed.slice(hashIndex + 1).trim();

  // Contraintes Riot : pseudo de 3 à 16 caractères, tag de 3 à 5.
  if (gameName.length < 3 || gameName.length > 16) return null;
  if (tagLine.length < 3 || tagLine.length > 5) return null;
  if (!/^[\p{L}\p{N} _.-]+$/u.test(gameName)) return null;
  if (!/^[\p{L}\p{N}]+$/u.test(tagLine)) return null;

  return { gameName, tagLine };
}

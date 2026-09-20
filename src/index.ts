import { Client, Events, GatewayIntentBits } from 'discord.js';
import { AnalysisService } from './analysis/ai.js';
import { ConfigError, describeMissing, loadConfig } from './config.js';
import { commandsJson } from './discord/commands.js';
import {
  handleAide,
  handleArreter,
  handleDerniere,
  handleStatut,
  handleSuivre,
  type HandlerDeps,
} from './discord/handlers.js';
import { DiscordPublisher } from './discord/publisher.js';
import { logger, setLogLevel } from './logger.js';
import { Poller } from './poller.js';
import { RiotClient } from './riot/client.js';
import { DataDragon } from './riot/ddragon.js';
import { RiotApiError } from './riot/errors.js';
import { openDatabase } from './storage/db.js';
import { Repository } from './storage/repository.js';
import { Tracker } from './tracker.js';

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  const db = openDatabase(config.databasePath);
  const repository = new Repository(db);

  // Une partie réservée mais jamais publiée vient d'un arrêt en cours de
  // traitement : on la libère pour qu'elle soit retentée.
  const released = repository.clearUnpublished();
  if (released > 0) logger.info(`${released} partie(s) interrompue(s) remise(s) en file après redémarrage.`);

  const riot = new RiotClient({ apiKey: config.riotApiKey });
  const dataDragon = new DataDragon();
  const analysis = new AnalysisService(repository, {
    apiKey: config.anthropicApiKey ?? undefined,
    model: config.anthropicModel,
    maxTokens: config.anthropicMaxTokens,
  });

  logger.info(
    analysis.aiEnabled
      ? `Analyse IA activée (modèle ${config.anthropicModel}, ${config.anthropicMaxTokens} tokens max).`
      : 'Aucune clé Anthropic : Ezreal utilisera l’analyse par règles.',
  );

  // Vérification précoce de la clé Riot : mieux vaut un message clair au
  // démarrage qu'un échec silencieux au premier sondage.
  try {
    await riot.checkKey(config.defaultPlatform);
    logger.info('Clé API Riot valide.');
  } catch (error) {
    if (error instanceof RiotApiError && (error.kind === 'unauthorized' || error.kind === 'forbidden')) {
      logger.error(`Clé API Riot refusée. ${error.userMessage}`);
      process.exit(1);
    }
    logger.warn('Impossible de vérifier la clé Riot au démarrage, Ezreal continue.', error);
  }

  // Seul l'intent « Guilds » est demandé : Ezreal n'a besoin ni du contenu des
  // messages ni de la liste des membres.
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  const tracker = new Tracker({
    riot,
    dataDragon,
    repository,
    analysis,
    publisher: new DiscordPublisher(client),
  });
  const poller = new Poller(repository, tracker, config.pollIntervalSeconds);

  const deps: HandlerDeps = {
    repository,
    riot,
    dataDragon,
    analysis,
    defaultPlatform: config.defaultPlatform,
    pollIntervalSeconds: config.pollIntervalSeconds,
  };

  client.once(Events.ClientReady, (ready) => {
    logger.info(`Connecté à Discord en tant que ${ready.user.tag} (${ready.guilds.cache.size} serveur(s)).`);
    logger.info(`Commandes disponibles : ${commandsJson.map((command) => `/${command.name}`).join(', ')}`);
    poller.start();
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      switch (interaction.commandName) {
        case 'suivre':
          await handleSuivre(interaction, deps);
          break;
        case 'arreter':
          await handleArreter(interaction, deps);
          break;
        case 'statut':
          await handleStatut(interaction, deps);
          break;
        case 'derniere':
          await handleDerniere(interaction, deps);
          break;
        case 'aide':
          await handleAide(interaction, deps);
          break;
        default:
          logger.warn(`Commande inconnue : ${interaction.commandName}`);
      }
    } catch (error) {
      logger.error(`Erreur pendant la commande /${interaction.commandName}`, error);
      const content = '❌ Une erreur inattendue est survenue. Réessayez dans un instant.';
      try {
        if (interaction.deferred || interaction.replied) await interaction.editReply(content);
        else await interaction.reply({ content, flags: 64 });
      } catch {
        // L'interaction a peut-être expiré : rien de plus à tenter.
      }
    }
  });

  const shutdown = (signal: string) => {
    logger.info(`Signal ${signal} reçu, arrêt d’Ezreal…`);
    poller.stop();
    void client.destroy().finally(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await client.login(config.discordToken);
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(describeMissing(error));
    process.exit(1);
  }
  logger.error('Démarrage impossible', error);
  process.exit(1);
});

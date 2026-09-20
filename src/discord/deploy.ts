import { REST, Routes } from 'discord.js';
import { ConfigError, describeMissing, loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { commandsJson } from './commands.js';

/**
 * Publication des commandes slash.
 *
 * Avec DISCORD_GUILD_ID, les commandes sont enregistrées sur ce seul serveur et
 * sont disponibles immédiatement — c'est le mode recommandé pour tester.
 * Sans cette variable, elles sont publiées globalement ; Discord peut alors
 * mettre jusqu'à une heure à les propager.
 */
export async function deployCommands(): Promise<void> {
  const config = loadConfig();
  const rest = new REST({ version: '10' }).setToken(config.discordToken);

  if (config.discordGuildId) {
    await rest.put(Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId), {
      body: commandsJson,
    });
    logger.info(`${commandsJson.length} commandes publiées sur le serveur ${config.discordGuildId} (effet immédiat).`);
  } else {
    await rest.put(Routes.applicationCommands(config.discordClientId), { body: commandsJson });
    logger.info(`${commandsJson.length} commandes publiées globalement (propagation jusqu’à 1 h).`);
  }
}

const isDirectRun = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (isDirectRun) {
  deployCommands().catch((error: unknown) => {
    if (error instanceof ConfigError) {
      console.error(describeMissing(error));
      process.exit(1);
    }
    logger.error('Échec de la publication des commandes', error);
    process.exit(1);
  });
}

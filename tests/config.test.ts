import { describe, expect, it } from 'vitest';
import { ConfigError, describeMissing, loadConfig } from '../src/config.js';

/** Environnement minimal valide. */
function baseEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    DISCORD_TOKEN: 'jeton',
    DISCORD_CLIENT_ID: '123456789',
    RIOT_API_KEY: 'RGAPI-xxxx',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe('loadConfig', () => {
  it('charge une configuration minimale avec les valeurs par défaut', () => {
    const config = loadConfig(baseEnv());
    expect(config.discordToken).toBe('jeton');
    expect(config.defaultPlatform).toBe('euw1');
    expect(config.pollIntervalSeconds).toBe(90);
    expect(config.anthropicApiKey).toBeNull();
    expect(config.anthropicMaxTokens).toBe(700);
    expect(config.logLevel).toBe('info');
    expect(config.databasePath).toBe('./data/ezreal.sqlite');
  });

  it('signale toutes les variables manquantes d’un coup', () => {
    try {
      loadConfig({} as NodeJS.ProcessEnv);
      expect.unreachable('loadConfig aurait dû échouer');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const missing = (error as ConfigError).missing;
      expect(missing).toEqual(['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'RIOT_API_KEY']);
      const help = describeMissing(error as ConfigError);
      expect(help).toContain('developer.riotgames.com');
      expect(help).toContain('.env.example');
      // Le message d'aide ne doit jamais demander de coller une clé quelque part.
      expect(help).not.toMatch(/collez|copiez.{0,20}clé.{0,20}ici/i);
    }
  });

  it('traite une variable vide comme absente', () => {
    expect(() => loadConfig(baseEnv({ RIOT_API_KEY: '   ' }))).toThrow(ConfigError);
  });

  it('impose un intervalle de sondage minimum pour ménager l’API Riot', () => {
    expect(loadConfig(baseEnv({ POLL_INTERVAL_SECONDS: '5' })).pollIntervalSeconds).toBe(30);
    expect(loadConfig(baseEnv({ POLL_INTERVAL_SECONDS: '120' })).pollIntervalSeconds).toBe(120);
    // Valeur illisible : on retombe sur la valeur par défaut.
    expect(loadConfig(baseEnv({ POLL_INTERVAL_SECONDS: 'souvent' })).pollIntervalSeconds).toBe(90);
  });

  it('valide la région par défaut', () => {
    expect(loadConfig(baseEnv({ DEFAULT_PLATFORM: 'kr' })).defaultPlatform).toBe('kr');
    expect(loadConfig(baseEnv({ DEFAULT_PLATFORM: 'KR' })).defaultPlatform).toBe('kr');
    expect(loadConfig(baseEnv({ DEFAULT_PLATFORM: 'mars' })).defaultPlatform).toBe('euw1');
  });

  it('valide le niveau de journalisation', () => {
    expect(loadConfig(baseEnv({ LOG_LEVEL: 'debug' })).logLevel).toBe('debug');
    expect(loadConfig(baseEnv({ LOG_LEVEL: 'bavard' })).logLevel).toBe('info');
  });

  it('rend le modèle et la longueur de réponse configurables', () => {
    const config = loadConfig(
      baseEnv({ ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_MODEL: 'modele-x', ANTHROPIC_MAX_TOKENS: '1500' }),
    );
    expect(config.anthropicApiKey).toBe('sk-test');
    expect(config.anthropicModel).toBe('modele-x');
    expect(config.anthropicMaxTokens).toBe(1500);
  });

  it('ne modifie pas l’environnement du processus', () => {
    const before = { ...process.env };
    loadConfig(baseEnv({ DEFAULT_PLATFORM: 'kr' }));
    expect(process.env.DEFAULT_PLATFORM).toBe(before.DEFAULT_PLATFORM);
    expect(process.env.DISCORD_TOKEN).toBe(before.DISCORD_TOKEN);
  });
});

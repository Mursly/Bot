import { describe, expect, it } from 'vitest';
import type { APIEmbed } from 'discord.js';
import { buildContext } from '../src/analysis/facts.js';
import { buildRuleReport } from '../src/analysis/rules.js';
import { computeMatchStats } from '../src/analysis/stats.js';
import { extractTimelineFacts, EMPTY_TIMELINE_FACTS } from '../src/analysis/timeline.js';
import {
  ANALYSIS_PENDING_TEXT,
  buildMatchEmbed,
  clamp,
  DISCORD_LIMITS,
  embedCharacterCount,
  enforceTotalBudget,
} from '../src/discord/embed.js';
import { parseRiotId } from '../src/discord/commands.js';
import {
  buildDemoTimeline,
  DEMO_MATCH_ARAM,
  DEMO_MATCH_LOSS,
  DEMO_MATCH_REMAKE,
  DEMO_MATCH_WIN,
  DEMO_PUUID,
} from '../src/demoData.js';
import type { MatchDto } from '../src/riot/types.js';

function embedFor(match: MatchDto, withTimeline = false, withReport = true): APIEmbed {
  const stats = computeMatchStats(match, DEMO_PUUID);
  const facts = withTimeline
    ? extractTimelineFacts(match, buildDemoTimeline(), DEMO_PUUID, stats.role)
    : { ...EMPTY_TIMELINE_FACTS };
  const report = withReport ? buildRuleReport(buildContext(stats, facts)) : null;
  return buildMatchEmbed({ stats, report, portraitUrl: 'https://example.invalid/champion.png' });
}

/** Vérifie chaque limite documentée par Discord. */
function expectWithinDiscordLimits(embed: APIEmbed): void {
  expect(embed.title?.length ?? 0).toBeLessThanOrEqual(DISCORD_LIMITS.title);
  expect(embed.description?.length ?? 0).toBeLessThanOrEqual(DISCORD_LIMITS.description);
  expect(embed.footer?.text?.length ?? 0).toBeLessThanOrEqual(DISCORD_LIMITS.footerText);
  expect(embed.author?.name?.length ?? 0).toBeLessThanOrEqual(DISCORD_LIMITS.authorName);
  expect(embed.fields?.length ?? 0).toBeLessThanOrEqual(DISCORD_LIMITS.fieldsPerEmbed);
  for (const field of embed.fields ?? []) {
    expect(field.name.length).toBeLessThanOrEqual(DISCORD_LIMITS.fieldName);
    expect(field.value.length).toBeLessThanOrEqual(DISCORD_LIMITS.fieldValue);
    expect(field.name.length).toBeGreaterThan(0);
    expect(field.value.length).toBeGreaterThan(0);
  }
  expect(embedCharacterCount(embed)).toBeLessThanOrEqual(DISCORD_LIMITS.totalPerMessage);
}

describe('clamp', () => {
  it('ne touche pas à un texte assez court', () => {
    expect(clamp('bonjour', 20)).toBe('bonjour');
  });

  it('tronque en ajoutant une ellipse', () => {
    const result = clamp('a'.repeat(50), 10);
    expect(result.length).toBeLessThanOrEqual(10);
    expect(result.endsWith('…')).toBe(true);
  });

  it('coupe de préférence sur un espace', () => {
    expect(clamp('un deux trois quatre cinq', 14)).toBe('un deux trois…');
  });
});

describe('buildMatchEmbed', () => {
  it('respecte toutes les limites Discord sur chaque scénario', () => {
    expectWithinDiscordLimits(embedFor(DEMO_MATCH_WIN));
    expectWithinDiscordLimits(embedFor(DEMO_MATCH_LOSS, true));
    expectWithinDiscordLimits(embedFor(DEMO_MATCH_ARAM));
    expectWithinDiscordLimits(embedFor(DEMO_MATCH_REMAKE));
    expectWithinDiscordLimits(embedFor(DEMO_MATCH_LOSS, true, false));
  });

  it('affiche la victoire en vert et la défaite en rouge', () => {
    expect(embedFor(DEMO_MATCH_WIN).color).toBe(0x2ecc71);
    expect(embedFor(DEMO_MATCH_LOSS).color).toBe(0xe74c3c);
    expect(embedFor(DEMO_MATCH_REMAKE).color).toBe(0x95a5a6);
  });

  it('affiche le résultat, le champion, le rôle, le mode et la durée', () => {
    const embed = embedFor(DEMO_MATCH_WIN);
    expect(embed.title).toContain('🟢 Victoire');
    expect(embed.title).toContain('Ezreal');
    expect(embed.title).toContain('ADC');
    expect(embed.description).toContain('Classée Solo/Duo');
    expect(embed.description).toContain('30 min 42 s');
    expect(embed.author?.name).toBe('JoueurFictif#DEMO');
  });

  it('inclut le portrait du champion', () => {
    expect(embedFor(DEMO_MATCH_WIN).thumbnail?.url).toBe('https://example.invalid/champion.png');
  });

  it('affiche KDA, farm, participation, dégâts et vision', () => {
    const fields = embedFor(DEMO_MATCH_WIN).fields ?? [];
    const names = fields.map((field) => field.name).join(' ');
    expect(names).toContain('K / D / A');
    expect(names).toContain('Farm');
    expect(names).toContain('Participation');
    expect(names).toContain('Dégâts aux champions');
    expect(names).toContain('Vision');

    const kda = fields.find((field) => field.name.includes('K / D / A'));
    expect(kda?.value).toContain('11 / 2 / 9');
  });

  it('n’affiche pas de farm hors de la Faille', () => {
    const names = (embedFor(DEMO_MATCH_ARAM).fields ?? []).map((field) => field.name).join(' ');
    expect(names).not.toContain('Farm');
  });

  it('omet les champs dont la donnée est absente plutôt que d’afficher « n/a »', () => {
    const minimal: MatchDto = {
      metadata: { matchId: 'EUW1_MIN', participants: [] },
      info: {
        gameDuration: 1500,
        gameEndTimestamp: 1_700_000_000_000,
        queueId: 420,
        mapId: 11,
        participants: [
          {
            puuid: 'p1',
            participantId: 1,
            teamId: 100,
            win: true,
            championName: 'Ezreal',
            teamPosition: 'BOTTOM',
            kills: 5,
            deaths: 3,
            assists: 7,
          },
        ],
      },
    };
    const stats = computeMatchStats(minimal, 'p1');
    const embed = buildMatchEmbed({
      stats,
      report: buildRuleReport(buildContext(stats, { ...EMPTY_TIMELINE_FACTS })),
      portraitUrl: null,
    });
    const names = (embed.fields ?? []).map((field) => field.name).join(' ');
    expect(names).not.toContain('Vision');
    expect(names).not.toContain('Dégâts aux champions');
    expect(embed.thumbnail).toBeUndefined();
    expectWithinDiscordLimits(embed);
  });

  it('affiche un état d’attente tant que l’analyse n’est pas prête', () => {
    const embed = embedFor(DEMO_MATCH_LOSS, true, false);
    const analyse = (embed.fields ?? []).find((field) => field.name.includes('Analyse'));
    expect(analyse?.value).toBe(ANALYSIS_PENDING_TEXT);
  });

  it('découpe chaque remarque dans son propre champ pour ne rien tronquer', () => {
    const embed = embedFor(DEMO_MATCH_LOSS, true);
    const axes = (embed.fields ?? []).filter((field) => field.name.includes('Axe d’amélioration'));
    expect(axes.length).toBeGreaterThanOrEqual(2);
    for (const field of axes) {
      // Une remarque complète se termine par le conseil en italique, pas par une ellipse.
      expect(field.value.endsWith('…')).toBe(false);
      expect(field.value).toContain('➜');
    }
  });

  it('signale explicitement le mode démonstration', () => {
    const stats = computeMatchStats(DEMO_MATCH_WIN, DEMO_PUUID);
    const embed = buildMatchEmbed({ stats, report: null, portraitUrl: null, demo: true });
    expect(embed.description).toContain('données entièrement fictives');
    expect(embed.footer?.text).toContain('simulées');
  });

  it('indique la source de l’analyse dans le pied de page', () => {
    const stats = computeMatchStats(DEMO_MATCH_WIN, DEMO_PUUID);
    const rules = buildRuleReport(buildContext(stats, { ...EMPTY_TIMELINE_FACTS }));
    expect(buildMatchEmbed({ stats, report: rules, portraitUrl: null }).footer?.text).toContain('par règles');
    expect(
      buildMatchEmbed({ stats, report: { ...rules, source: 'ai' }, portraitUrl: null }).footer?.text,
    ).toContain('IA');
  });
});

describe('enforceTotalBudget', () => {
  it('ramène un embed trop long sous la limite des 6000 caractères', () => {
    const gros: APIEmbed = {
      title: 'T'.repeat(200),
      description: 'D'.repeat(2000),
      fields: [
        { name: 'A', value: 'x'.repeat(1000), inline: false },
        { name: 'B', value: 'y'.repeat(1000), inline: false },
        { name: 'C', value: 'z'.repeat(1000), inline: false },
        { name: 'ℹ️ Limites de cette analyse', value: 'w'.repeat(1000), inline: false },
        { name: 'E', value: 'v'.repeat(1000), inline: false },
      ],
    };
    expect(embedCharacterCount(gros)).toBeGreaterThan(DISCORD_LIMITS.totalPerMessage);

    const reduit = enforceTotalBudget(gros);
    expect(embedCharacterCount(reduit)).toBeLessThanOrEqual(DISCORD_LIMITS.totalPerMessage);
    // Les limites de l'analyse sont sacrifiées en premier.
    expect((reduit.fields ?? []).some((field) => field.name.includes('Limites'))).toBe(false);
  });

  it('laisse intact un embed déjà conforme', () => {
    const petit: APIEmbed = { title: 'Titre', fields: [{ name: 'A', value: 'court', inline: false }] };
    expect(enforceTotalBudget(petit)).toEqual(petit);
  });
});

describe('parseRiotId', () => {
  it('accepte un Riot ID valide', () => {
    expect(parseRiotId('JoueurFictif#DEMO')).toEqual({ gameName: 'JoueurFictif', tagLine: 'DEMO' });
    expect(parseRiotId('  Faker#KR1  ')).toEqual({ gameName: 'Faker', tagLine: 'KR1' });
    expect(parseRiotId('Nom Avec Espaces#EUW')).toEqual({ gameName: 'Nom Avec Espaces', tagLine: 'EUW' });
    expect(parseRiotId('Éloïse#EUW')).toEqual({ gameName: 'Éloïse', tagLine: 'EUW' });
  });

  it('refuse un identifiant contenant plusieurs #', () => {
    // Le séparateur est le dernier # ; le pseudo restant contiendrait alors un
    // caractère interdit par Riot, donc l'identifiant est rejeté.
    expect(parseRiotId('Pseudo#Avec#TAG')).toBeNull();
  });

  it('refuse les formats invalides', () => {
    expect(parseRiotId('SansTag')).toBeNull();
    expect(parseRiotId('#TAG')).toBeNull();
    expect(parseRiotId('Pseudo#')).toBeNull();
    expect(parseRiotId('ab#EUW')).toBeNull();
    expect(parseRiotId('Pseudo#AB')).toBeNull();
    expect(parseRiotId('Pseudo#TROPLONG')).toBeNull();
    expect(parseRiotId('Pseudo#TA G')).toBeNull();
    expect(parseRiotId('')).toBeNull();
  });
});

describe('définition des commandes slash', () => {
  it('respecte les limites Discord sur les noms, descriptions et options', async () => {
    const { commandsJson } = await import('../src/discord/commands.js');

    expect(commandsJson.length).toBeGreaterThan(0);
    for (const command of commandsJson) {
      // Nom : minuscules, 1-32 caractères. Description : 1-100 caractères.
      expect(command.name).toMatch(/^[\w-]{1,32}$/u);
      expect(command.name).toBe(command.name.toLowerCase());
      expect(command.description?.length ?? 0).toBeGreaterThan(0);
      expect(command.description?.length ?? 0).toBeLessThanOrEqual(100);

      const options = (command as { options?: { name: string; description: string; choices?: unknown[] }[] }).options ?? [];
      expect(options.length).toBeLessThanOrEqual(25);
      for (const option of options) {
        expect(option.name).toMatch(/^[\w-]{1,32}$/u);
        expect(option.description.length).toBeGreaterThan(0);
        expect(option.description.length).toBeLessThanOrEqual(100);
        const choices = (option.choices ?? []) as { name: string; value: string }[];
        expect(choices.length).toBeLessThanOrEqual(25);
        for (const choice of choices) {
          expect(choice.name.length).toBeLessThanOrEqual(100);
          expect(String(choice.value).length).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it('réserve les commandes de configuration à la permission « Gérer le serveur »', async () => {
    const { commandsJson } = await import('../src/discord/commands.js');
    const restreintes = ['suivre', 'arreter'];
    for (const command of commandsJson) {
      const permissions = (command as { default_member_permissions?: string | null }).default_member_permissions;
      if (restreintes.includes(command.name)) {
        // 32 = ManageGuild
        expect(permissions).toBe('32');
      } else {
        expect(permissions ?? null).toBeNull();
      }
    }
  });
});

import type { APIEmbed } from 'discord.js';
import type { AnalysisService } from './analysis/ai.js';
import { buildContext } from './analysis/facts.js';
import type { CoachReport } from './analysis/rules.js';
import { computeMatchStats, type MatchStats } from './analysis/stats.js';
import { extractTimelineFacts } from './analysis/timeline.js';
import { buildMatchEmbed } from './discord/embed.js';
import { logger } from './logger.js';
import { RiotApiError } from './riot/errors.js';
import { matchesQueueFilter } from './riot/queues.js';
import type { RiotClient } from './riot/client.js';
import type { DataDragon } from './riot/ddragon.js';
import type { MatchDto } from './riot/types.js';
import type { Repository, TrackedPlayer } from './storage/repository.js';

/**
 * Orchestration : détection des nouvelles parties, calcul, publication, analyse.
 *
 * La publication Discord passe par l'interface `Publisher`, ce qui permet de
 * tester toute cette logique sans connexion à Discord.
 */

export interface Publisher {
  /** Publie l'embed et renvoie l'identifiant du message créé. */
  publish(channelId: string, embed: APIEmbed): Promise<string>;
  /** Complète le message déjà publié, pour ne pas déclencher une 2ᵉ notification. */
  edit(channelId: string, messageId: string, embed: APIEmbed): Promise<void>;
}

export interface TrackerOptions {
  riot: RiotClient;
  dataDragon: DataDragon;
  repository: Repository;
  analysis: AnalysisService;
  publisher: Publisher;
  /** Nombre maximum de parties publiées lors d'un même passage. */
  maxMatchesPerPoll?: number;
}

export interface PollOutcome {
  checked: number;
  published: number;
  skipped: number;
  error: string | null;
}

/**
 * Après une longue coupure, on ne republie pas tout d'un coup : les parties en
 * trop sont marquées comme traitées, sans notification.
 */
const DEFAULT_MAX_PER_POLL = 5;

export class Tracker {
  private readonly riot: RiotClient;
  private readonly dataDragon: DataDragon;
  private readonly repository: Repository;
  private readonly analysis: AnalysisService;
  private readonly publisher: Publisher;
  private readonly maxMatchesPerPoll: number;

  constructor(options: TrackerOptions) {
    this.riot = options.riot;
    this.dataDragon = options.dataDragon;
    this.repository = options.repository;
    this.analysis = options.analysis;
    this.publisher = options.publisher;
    this.maxMatchesPerPoll = options.maxMatchesPerPoll ?? DEFAULT_MAX_PER_POLL;
  }

  /** Vérifie les nouvelles parties d'un joueur suivi et publie celles qui manquent. */
  async pollPlayer(tracked: TrackedPlayer, now = Date.now()): Promise<PollOutcome> {
    const outcome: PollOutcome = { checked: 0, published: 0, skipped: 0, error: null };

    let matchIds: string[];
    try {
      matchIds = await this.riot.getMatchIds(tracked.platform, tracked.puuid, {
        // L'API attend des secondes epoch, pas des millisecondes.
        startTime: Math.floor(tracked.sinceMs / 1000),
        count: 20,
      });
    } catch (error) {
      const message = error instanceof RiotApiError ? error.userMessage : 'Erreur inattendue côté Riot.';
      this.repository.markChecked(tracked.guildId, now, message);
      logger.warn(`Échec de la récupération des parties de ${tracked.riotId}`, error);
      return { ...outcome, error: message };
    }

    // L'API renvoie les parties de la plus récente à la plus ancienne ; on les
    // traite dans l'ordre chronologique pour que le salon reste lisible.
    const pending = matchIds.filter((matchId) => !this.repository.isProcessed(tracked.guildId, matchId)).reverse();
    outcome.checked = pending.length;

    const overflow = Math.max(0, pending.length - this.maxMatchesPerPoll);
    for (const matchId of pending.slice(0, overflow)) {
      if (this.repository.claimMatch(tracked.guildId, matchId, tracked.puuid, null, now)) {
        this.repository.markSkipped(tracked.guildId, matchId, 'rattrapage : trop de parties en attente', now);
        outcome.skipped += 1;
      }
    }

    for (const matchId of pending.slice(overflow)) {
      try {
        const result = await this.processMatch(tracked, matchId, now);
        if (result === 'published') outcome.published += 1;
        else outcome.skipped += 1;
      } catch (error) {
        // La réservation est libérée : la partie sera retentée au passage suivant.
        this.repository.releaseMatch(tracked.guildId, matchId);
        outcome.error = error instanceof RiotApiError ? error.userMessage : 'Erreur lors du traitement de la partie.';
        logger.warn(`Échec du traitement de la partie ${matchId}`, error);
        break;
      }
    }

    this.repository.markChecked(tracked.guildId, now, outcome.error);
    return outcome;
  }

  private async processMatch(tracked: TrackedPlayer, matchId: string, now: number): Promise<'published' | 'skipped'> {
    // Réservation atomique : si une autre exécution — ou une précédente,
    // interrompue par un redémarrage — a déjà pris cette partie, on ne
    // republie pas.
    if (!this.repository.claimMatch(tracked.guildId, matchId, tracked.puuid, null, now)) {
      return 'skipped';
    }

    const match = await this.riot.getMatch(tracked.platform, matchId);
    const stats = computeMatchStats(match, tracked.puuid);

    // Deuxième garde-fou sur la date : le filtre `startTime` porte sur le début
    // de la partie, mais une partie lancée juste avant /suivre ne doit pas non
    // plus être publiée.
    const startedAt = match.info.gameStartTimestamp ?? match.info.gameCreation;
    if (typeof startedAt === 'number' && startedAt < tracked.sinceMs) {
      this.repository.markSkipped(tracked.guildId, matchId, 'partie antérieure au début du suivi', now);
      return 'skipped';
    }

    if (!matchesQueueFilter(stats.queueId, tracked.queueFilter)) {
      this.repository.markSkipped(tracked.guildId, matchId, `mode non suivi (${stats.queueLabel})`, now);
      return 'skipped';
    }

    await this.publishMatch(tracked, match, stats, now);
    return 'published';
  }

  private async publishMatch(
    tracked: TrackedPlayer,
    match: MatchDto,
    stats: MatchStats,
    now: number,
  ): Promise<void> {
    const matchId = stats.matchId;
    const portraitUrl = await this.dataDragon.championSquareUrl(stats.championPortraitName);

    // La timeline est un bonus : son absence n'empêche jamais la publication.
    let timeline = null;
    try {
      timeline = await this.riot.getTimeline(tracked.platform, matchId);
    } catch (error) {
      logger.warn(`Timeline non récupérée pour ${matchId}`, error);
    }

    const context = buildContext(stats, extractTimelineFacts(match, timeline, tracked.puuid, stats.role));
    const save = (messageId: string, report: CoachReport) =>
      this.repository.markPublished(
        tracked.guildId,
        matchId,
        {
          channelId: tracked.channelId,
          messageId,
          statsJson: JSON.stringify(stats),
          reportJson: JSON.stringify(report),
        },
        now,
      );

    // Sans IA, l'analyse est immédiate : on publie le message complet d'un coup
    // plutôt que d'afficher inutilement un état « en cours ».
    if (!this.analysis.aiEnabled) {
      const report = this.analysis.baseReport(context);
      const messageId = await this.publisher.publish(
        tracked.channelId,
        buildMatchEmbed({ stats, report, portraitUrl }),
      );
      save(messageId, report);
      return;
    }

    // Avec IA : le résultat part immédiatement, puis le MÊME message est
    // complété — une seule notification pour le joueur.
    const messageId = await this.publisher.publish(
      tracked.channelId,
      buildMatchEmbed({ stats, report: null, portraitUrl }),
    );

    // On enregistre dès maintenant l'analyse par règles : si le bot s'arrête
    // avant la fin de la rédaction IA, /derniere reste exploitable.
    const fallback = this.analysis.baseReport(context);
    save(messageId, fallback);

    const report = await this.analysis.analyze(context);

    try {
      await this.publisher.edit(tracked.channelId, messageId, buildMatchEmbed({ stats, report, portraitUrl }));
      save(messageId, report);
    } catch (error) {
      // Le résultat est déjà visible : on ne casse rien, on signale simplement.
      logger.warn(`Impossible de compléter le message de la partie ${matchId}`, error);
    }
  }
}

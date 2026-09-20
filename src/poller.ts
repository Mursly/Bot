import { logger } from './logger.js';
import type { Repository } from './storage/repository.js';
import type { Tracker } from './tracker.js';

/**
 * Boucle de sondage.
 *
 * Un seul passage à la fois : `running` évite qu'un cycle lent (analyse IA,
 * attente d'une limite de débit) ne se chevauche avec le suivant.
 */
export class Poller {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly repository: Repository,
    private readonly tracker: Tracker,
    private readonly intervalSeconds: number,
  ) {}

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    logger.info(`Surveillance des parties démarrée (toutes les ${this.intervalSeconds} s).`);
    // `unref()` n'est pas appelé : c'est ce minuteur qui maintient le service en vie.
    this.timer = setInterval(() => void this.tick(), this.intervalSeconds * 1000);
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      const tracked = this.repository.listTracking();
      for (const player of tracked) {
        if (this.stopped) break;
        try {
          const outcome = await this.tracker.pollPlayer(player);
          if (outcome.published > 0 || outcome.skipped > 0) {
            logger.info(
              `${player.riotId} : ${outcome.published} partie(s) publiée(s), ${outcome.skipped} ignorée(s).`,
            );
          }
        } catch (error) {
          // Un serveur en échec ne doit jamais empêcher les autres d'être traités.
          logger.error(`Erreur pendant le suivi de ${player.riotId}`, error);
        }
      }
    } finally {
      this.running = false;
    }
  }
}

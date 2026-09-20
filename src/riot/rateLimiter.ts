export interface RateWindow {
  /** Nombre de requêtes autorisées sur la fenêtre. */
  limit: number;
  /** Durée de la fenêtre en millisecondes. */
  intervalMs: number;
}

export interface RateLimiterOptions {
  windows: RateWindow[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Limiteur de débit à fenêtres glissantes.
 *
 * Les clés de développement Riot sont plafonnées à 20 requêtes / seconde et
 * 100 requêtes / 2 minutes. Plutôt que d'attendre le 429 pour ralentir, on
 * s'auto-limite : c'est la contrainte la plus stricte parmi toutes les fenêtres
 * qui décide du moment du prochain appel.
 *
 * `setCooldown()` permet d'ajouter par-dessus une pause imposée par Riot via
 * l'en-tête Retry-After.
 */
export class RateLimiter {
  private readonly windows: RateWindow[];
  private readonly timestamps: number[][];
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private cooldownUntil = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(options: RateLimiterOptions) {
    this.windows = options.windows;
    this.timestamps = options.windows.map(() => []);
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Impose une pause avant le prochain appel (typiquement après un 429). */
  setCooldown(seconds: number): void {
    const until = this.now() + Math.max(0, seconds) * 1000;
    if (until > this.cooldownUntil) this.cooldownUntil = until;
  }

  /**
   * Attend qu'un créneau soit disponible puis le consomme.
   * Les appels sont sérialisés afin que deux requêtes concurrentes ne se voient
   * pas attribuer le même créneau.
   */
  async acquire(): Promise<void> {
    const run = this.chain.then(() => this.acquireOne());
    // La chaîne ne doit jamais rester en échec, sinon tous les appels suivants
    // seraient rejetés en cascade.
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async acquireOne(): Promise<void> {
    // Garde-fou : si l'horloge injectée n'avance jamais (mauvaise configuration
    // de test, sleep qui ne dort pas), la boucle tournerait indéfiniment sans
    // jamais rendre la main au reste du programme. On préfère une erreur claire
    // à un blocage impossible à interrompre.
    let stalledIterations = 0;
    let lastSeen = -1;

    for (;;) {
      const now = this.now();
      if (now === lastSeen) {
        stalledIterations += 1;
        if (stalledIterations > 100) {
          throw new Error(
            "RateLimiter : l'horloge n'avance pas entre deux attentes, la limitation de débit ne peut pas progresser.",
          );
        }
      } else {
        stalledIterations = 0;
        lastSeen = now;
      }

      this.prune(now);

      const waits: number[] = [];
      if (this.cooldownUntil > now) waits.push(this.cooldownUntil - now);

      for (const [index, window] of this.windows.entries()) {
        const slot = this.timestamps[index];
        if (slot && slot.length >= window.limit) {
          const oldest = slot[0] ?? now;
          waits.push(oldest + window.intervalMs - now);
        }
      }

      const wait = waits.length > 0 ? Math.max(...waits) : 0;
      if (wait <= 0) {
        const stamp = this.now();
        for (const slot of this.timestamps) slot.push(stamp);
        return;
      }
      await this.sleep(wait);
    }
  }

  private prune(now: number): void {
    for (const [index, window] of this.windows.entries()) {
      const slot = this.timestamps[index];
      if (!slot) continue;
      const cutoff = now - window.intervalMs;
      while (slot.length > 0 && (slot[0] ?? 0) <= cutoff) slot.shift();
    }
  }
}

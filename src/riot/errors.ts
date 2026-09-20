export type RiotErrorKind =
  | 'not_found'
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'server_error'
  | 'bad_request'
  | 'network'
  | 'unknown';

/**
 * Erreur normalisée de l'API Riot.
 *
 * `userMessage` est rédigé en français et destiné à être affiché tel quel dans
 * Discord : il doit rester compréhensible par quelqu'un qui n'a jamais lu la
 * documentation Riot.
 */
export class RiotApiError extends Error {
  readonly kind: RiotErrorKind;
  readonly status: number | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly userMessage: string;

  constructor(
    kind: RiotErrorKind,
    message: string,
    options: { status?: number; retryAfterSeconds?: number; userMessage?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'RiotApiError';
    this.kind = kind;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.userMessage = options.userMessage ?? defaultUserMessage(kind);
  }

  /** Une erreur temporaire mérite une nouvelle tentative ; une erreur de configuration non. */
  get isRetryable(): boolean {
    return this.kind === 'rate_limited' || this.kind === 'server_error' || this.kind === 'network';
  }
}

function defaultUserMessage(kind: RiotErrorKind): string {
  switch (kind) {
    case 'not_found':
      return "Ce joueur est introuvable côté Riot. Vérifiez l'orthographe du Riot ID (Pseudo#TAG) et la région.";
    case 'unauthorized':
      return "La clé d'API Riot est invalide ou expirée. Les clés de développement expirent au bout de 24 h et doivent être régénérées sur developer.riotgames.com.";
    case 'forbidden':
      return "La clé d'API Riot a été refusée. Elle est peut-être expirée, ou elle n'autorise pas cet endpoint.";
    case 'rate_limited':
      return "Les limites de l'API Riot sont atteintes. Ezreal réessaiera automatiquement dans quelques instants.";
    case 'server_error':
      return "Le service Riot est momentanément indisponible. Ezreal réessaiera automatiquement.";
    case 'bad_request':
      return 'La requête envoyée à Riot est invalide. Vérifiez le Riot ID et la région choisis.';
    case 'network':
      return "Impossible de joindre l'API Riot (problème réseau). Ezreal réessaiera automatiquement.";
    default:
      return "Une erreur inattendue est survenue en interrogeant l'API Riot.";
  }
}

export function kindFromStatus(status: number): RiotErrorKind {
  if (status === 400) return 'bad_request';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  return 'unknown';
}

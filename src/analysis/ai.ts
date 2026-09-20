import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger.js';
import type { Repository } from '../storage/repository.js';
import { buildPromptPayload, type AnalysisContext } from './facts.js';
import { buildRuleReport, type CoachNote, type CoachReport } from './rules.js';

/**
 * Rédaction de l'analyse par un modèle Anthropic — entièrement facultative.
 *
 * Le modèle ne reçoit que des faits déjà calculés et ne fait aucun calcul.
 * Il ne choisit pas non plus les sujets : la liste des sujets autorisés vient
 * de l'analyse par règles. Son travail se limite à reformuler ces éléments
 * dans un français naturel de coach.
 *
 * En l'absence de clé, en cas d'erreur, de dépassement de délai ou de réponse
 * invalide, Ezreal retombe silencieusement sur l'analyse par règles : une
 * notification n'est jamais perdue à cause de l'IA.
 */

/** À incrémenter dès que le prompt change, pour invalider le cache. */
const PROMPT_VERSION = 'v1';

const SYSTEM_PROMPT = `Tu es Ezreal, un coach League of Legends francophone. Tu rédiges le bilan d'UNE partie pour le joueur suivi.

RÈGLES ABSOLUES — toute violation rend ta réponse inutilisable :
1. Tu ne disposes QUE des données JSON fournies. Tu n'as pas regardé le replay et tu ne dois jamais laisser croire le contraire.
2. N'invente JAMAIS une action de jeu, un placement, un sort raté, une rotation, un choix d'objet ou la cause d'une mort. Si la donnée n'est pas dans le JSON, elle n'existe pas.
3. Ne calcule rien. Tous les chiffres nécessaires sont déjà dans le JSON : reprends-les tels quels. N'en déduis aucun nouveau.
4. N'invente aucune moyenne par rang, aucun classement, aucune référence au patch courant, aucune recommandation d'objet ou de runes « optimale ».
5. Les seuils de "reperes_internes" servent uniquement à savoir quoi aborder. Ne les cite jamais au joueur, ne les présente jamais comme une norme ni comme une comparaison avec d'autres joueurs.
6. Distingue les faits des hypothèses. Quand une explication est possible sans être établie, écris-le explicitement ("les données ne disent pas si…", "plusieurs explications restent possibles").
7. Une mort survenue avant la prise d'un objectif adverse est une simple proximité dans le temps. Ne dis JAMAIS qu'elle a causé la perte de l'objectif.
8. Ne force ni compliment ni critique. Si la liste de sujets fournie est courte, ta réponse est courte.
9. Pas de conseil vague du type « joue mieux », « meurs moins », « fais plus de CS ». Chaque conseil doit décrire une action concrète et vérifiable.
10. Adapte le ton et le contenu au rôle, au champion, au mode et à la durée indiqués. Ne juge jamais un support sur son farm.

STYLE : tutoiement, ton de coach bienveillant et direct, pas de jargon inutile, pas d'emoji. Phrases courtes. Chaque remarque suit la logique : observation vérifiable → interprétation prudente → conseil applicable.

FORMAT DE SORTIE : uniquement un objet JSON valide, sans texte autour, sans bloc de code markdown :
{
  "positives": [{"observation": "...", "interpretation": "...", "advice": "..."}],
  "improvements": [{"observation": "...", "interpretation": "...", "advice": "..."}],
  "objective": "..."
}
Au maximum 2 entrées dans "positives" et 3 dans "improvements", classées de la plus importante à la moins importante. "objective" est un unique objectif concret et mesurable pour la prochaine partie.`;

export interface AiOptions {
  apiKey?: string | undefined;
  model: string;
  maxTokens: number;
  timeoutMs?: number;
  /** Injectable pour les tests. */
  client?: Pick<Anthropic['messages'], 'create'>;
}

export interface AnalysisResult extends CoachReport {
  /** Vrai si le contenu vient du cache (aucun appel facturé). */
  fromCache: boolean;
}

export class AnalysisService {
  private readonly repository: Repository;
  private readonly options: AiOptions;
  private readonly messages: Pick<Anthropic['messages'], 'create'> | null;

  constructor(repository: Repository, options: AiOptions) {
    this.repository = repository;
    this.options = options;

    if (options.client) {
      this.messages = options.client;
    } else if (options.apiKey) {
      const anthropic = new Anthropic({ apiKey: options.apiKey, timeout: options.timeoutMs ?? 30_000 });
      this.messages = anthropic.messages;
    } else {
      this.messages = null;
    }
  }

  get aiEnabled(): boolean {
    return this.messages !== null;
  }

  /**
   * Analyse par règles seule — immédiate, sans appel réseau.
   * C'est elle qui est publiée en premier pendant que l'IA rédige.
   */
  baseReport(context: AnalysisContext): CoachReport {
    return buildRuleReport(context);
  }

  async analyze(context: AnalysisContext): Promise<AnalysisResult> {
    const ruleReport = buildRuleReport(context);

    // Un remake ne mérite pas d'analyse : inutile d'appeler (et de payer) l'IA.
    if (context.stats.remake || !this.messages) {
      return { ...ruleReport, fromCache: false };
    }

    const cacheKey = this.cacheKey(context);
    const cached = this.repository.getCachedAnalysis(cacheKey);
    if (cached) {
      const parsed = safeParseReport(cached, ruleReport);
      if (parsed) {
        logger.debug(`Analyse servie depuis le cache pour ${context.stats.matchId}`);
        return { ...parsed, fromCache: true };
      }
    }

    try {
      const payload = buildPromptPayload(context);
      const allowedTopics = {
        sujets_positifs_autorises: ruleReport.positives,
        sujets_amelioration_autorises: ruleReport.improvements,
        objectif_propose: ruleReport.objective,
        limites_a_mentionner_si_utile: ruleReport.caveats,
      };

      const userContent = [
        "Voici les données de la partie, déjà calculées par le code. Ne recalcule rien.",
        '```json',
        JSON.stringify(payload, null, 2),
        '```',
        '',
        "Voici les sujets retenus par l'analyse automatique. Tu dois t'en tenir à ces sujets : tu peux en retirer, en fusionner ou les reformuler, mais tu ne dois pas en ajouter de nouveaux.",
        '```json',
        JSON.stringify(allowedTopics, null, 2),
        '```',
        '',
        'Rédige le bilan en respectant strictement le format JSON demandé.',
      ].join('\n');

      const response = await this.messages.create({
        model: this.options.model,
        max_tokens: this.options.maxTokens,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      });

      const text = extractText(response);
      const report = safeParseReport(text, ruleReport);
      if (!report) {
        logger.warn("Réponse de l'IA inexploitable, repli sur l'analyse par règles", { matchId: context.stats.matchId });
        return { ...ruleReport, fromCache: false };
      }

      this.repository.putCachedAnalysis(cacheKey, {
        matchId: context.stats.matchId,
        puuid: context.stats.puuid,
        source: 'ai',
        payload: JSON.stringify(report),
      });

      return { ...report, fromCache: false };
    } catch (error) {
      logger.warn("Échec de l'analyse IA, repli sur l'analyse par règles", error);
      return { ...ruleReport, fromCache: false };
    }
  }

  private cacheKey(context: AnalysisContext): string {
    return [context.stats.matchId, context.stats.puuid, this.options.model, PROMPT_VERSION].join('|');
  }
}

function extractText(response: unknown): string {
  const content = (response as { content?: unknown })?.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block): block is { type: string; text: string } => {
      const candidate = block as { type?: unknown; text?: unknown };
      return candidate.type === 'text' && typeof candidate.text === 'string';
    })
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/**
 * Extrait le premier objet JSON d'une réponse.
 * Le modèle est censé répondre en JSON pur, mais une clôture en bloc markdown
 * reste possible : on l'accepte plutôt que de perdre l'analyse.
 */
export function extractJsonObject(raw: string): unknown | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

function asNote(value: unknown): CoachNote | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const observation = typeof record.observation === 'string' ? record.observation.trim() : '';
  const interpretation = typeof record.interpretation === 'string' ? record.interpretation.trim() : '';
  const advice = typeof record.advice === 'string' ? record.advice.trim() : '';
  // Une remarque incomplète casserait la logique observation → interprétation →
  // conseil : on la rejette plutôt que d'afficher un bloc bancal.
  if (!observation || !interpretation || !advice) return null;
  return { observation, interpretation, advice };
}

/**
 * Valide la réponse du modèle.
 * En cas de doute, on renvoie `null` et l'appelant utilise l'analyse par règles.
 */
export function safeParseReport(raw: string, fallback: CoachReport): CoachReport | null {
  const parsed = extractJsonObject(raw);
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;

  const positives = Array.isArray(record.positives)
    ? record.positives.map(asNote).filter((note): note is CoachNote => note !== null).slice(0, 2)
    : [];
  const improvements = Array.isArray(record.improvements)
    ? record.improvements.map(asNote).filter((note): note is CoachNote => note !== null).slice(0, 3)
    : [];
  const objective = typeof record.objective === 'string' && record.objective.trim() ? record.objective.trim() : null;

  // Une réponse totalement vide n'apporte rien de plus que le repli par règles.
  if (positives.length === 0 && improvements.length === 0 && objective === null) return null;

  return {
    positives,
    improvements,
    objective: objective ?? fallback.objective,
    caveats: fallback.caveats,
    source: 'ai',
  };
}

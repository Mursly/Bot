import { type APIEmbed, type Client, DiscordAPIError, type TextBasedChannel } from 'discord.js';
import type { Publisher } from '../tracker.js';

/**
 * Erreur de publication traduite en français.
 * `userMessage` est destiné à être affiché tel quel à l'utilisateur.
 */
export class PublishError extends Error {
  readonly userMessage: string;
  constructor(message: string, userMessage: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'PublishError';
    this.userMessage = userMessage;
  }
}

function describeDiscordError(error: unknown, channelId: string): string {
  if (error instanceof DiscordAPIError) {
    switch (Number(error.code)) {
      case 10003:
        return `Le salon <#${channelId}> n’existe plus. Relancez /suivre avec un autre salon.`;
      case 50001:
        return `Ezreal n’a pas accès au salon <#${channelId}>. Vérifiez la permission « Voir le salon ».`;
      case 50013:
        return `Ezreal n’a pas le droit d’écrire dans <#${channelId}>. Il lui faut « Envoyer des messages » et « Intégrer des liens ».`;
      default:
        return `Discord a refusé la publication dans <#${channelId}> (code ${error.code}).`;
    }
  }
  return `Publication impossible dans <#${channelId}>.`;
}

export class DiscordPublisher implements Publisher {
  constructor(private readonly client: Client) {}

  private async resolveChannel(channelId: string): Promise<TextBasedChannel> {
    let channel;
    try {
      channel = await this.client.channels.fetch(channelId);
    } catch (error) {
      throw new PublishError(`Salon ${channelId} introuvable`, describeDiscordError(error, channelId), error);
    }
    if (!channel || !channel.isTextBased() || !('send' in channel)) {
      throw new PublishError(
        `Salon ${channelId} inutilisable`,
        `Le salon <#${channelId}> n’accepte pas les messages d’Ezreal. Choisissez un salon textuel classique.`,
      );
    }
    return channel;
  }

  async publish(channelId: string, embed: APIEmbed): Promise<string> {
    const channel = await this.resolveChannel(channelId);
    try {
      const message = await (channel as { send: (payload: unknown) => Promise<{ id: string }> }).send({
        embeds: [embed],
      });
      return message.id;
    } catch (error) {
      throw new PublishError(`Envoi impossible dans ${channelId}`, describeDiscordError(error, channelId), error);
    }
  }

  async edit(channelId: string, messageId: string, embed: APIEmbed): Promise<void> {
    const channel = await this.resolveChannel(channelId);
    const message = await (
      channel as { messages: { fetch: (id: string) => Promise<{ edit: (payload: unknown) => Promise<unknown> }> } }
    ).messages.fetch(messageId);
    await message.edit({ embeds: [embed] });
  }
}

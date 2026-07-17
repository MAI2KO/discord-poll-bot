import {
  ChannelType,
  Client,
  Message,
  PermissionsBitField,
  PollLayoutType,
  TextChannel
} from "discord.js";
import { addHours, calculateNextPostAt, PollDatabase } from "./db";
import { PollConfig } from "./types";

interface ResetPollOptions {
  advanceSchedule?: boolean;
}

export class PollChannelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PollChannelError";
  }
}

export async function resetPoll(
  client: Client,
  db: PollDatabase,
  config: PollConfig,
  options: ResetPollOptions = {}
): Promise<Message<true>> {
  if (!config.channelId) {
    throw new PollChannelError("Poll channel is not configured.");
  }

  const channel = await fetchTextChannel(client, config.channelId);

  if (config.currentPollMessageId) {
    await deleteCurrentPoll(channel, config.currentPollMessageId);
    await db.clearPollVotes(config.guildId, config.currentPollMessageId);
  }

  let message: Message;
  try {
    message = await channel.send({
      poll: {
        question: { text: config.question },
        answers: config.options.map((option) => ({ text: option })),
        duration: config.durationHours,
        allowMultiselect: false,
        layoutType: PollLayoutType.Default
      }
    });
  } catch (error) {
    const reason = getPollChannelFailureReason(error);
    if (reason) {
      throw new PollChannelError(reason);
    }

    throw error;
  }

  const postedAt = new Date();
  const nextPostAt =
    options.advanceSchedule === false
      ? new Date(config.nextPostAtUtc ?? calculateNextPostAt(postedAt, config.pollTimeHourUtc))
      : addHours(postedAt, config.frequencyHours);
  await db.markPollPosted(config.guildId, message.id, postedAt, nextPostAt);
  return message as Message<true>;
}

export async function deleteSavedPoll(client: Client, db: PollDatabase, config: PollConfig): Promise<boolean> {
  if (!config.channelId || !config.currentPollMessageId) {
    await db.clearCurrentPoll(config.guildId);
    return false;
  }

  const channel = await fetchTextChannel(client, config.channelId);
  if (!channel) {
    await db.clearCurrentPoll(config.guildId);
    return false;
  }

  const deleted = await deleteCurrentPoll(channel, config.currentPollMessageId);
  await db.clearPollVotes(config.guildId, config.currentPollMessageId);
  await db.clearCurrentPoll(config.guildId);
  return deleted;
}

export async function fetchTextChannel(client: Client, channelId: string): Promise<TextChannel> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) {
      throw new PollChannelError("Configured channel was not found.");
    }

    if (channel.type !== ChannelType.GuildText) {
      throw new PollChannelError("Configured channel is not a text channel.");
    }

    const me = channel.guild.members.me;
    if (!me) {
      throw new PollChannelError("Bot member could not be found in the configured channel's guild.");
    }

    const permissions = channel.permissionsFor(me);
    const required = [
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.ReadMessageHistory,
      PermissionsBitField.Flags.ManageMessages
    ];

    if (!permissions || !required.every((permission) => permissions.has(permission))) {
      throw new PollChannelError(`Missing required permissions in #${channel.name}.`);
    }

    return channel;
  } catch (error) {
    const reason = getPollChannelFailureReason(error);
    if (reason) {
      throw new PollChannelError(reason);
    }

    throw error;
  }
}

export function isPollChannelError(error: unknown): error is PollChannelError {
  return error instanceof PollChannelError;
}

function getPollChannelFailureReason(error: unknown): string | null {
  if (error instanceof PollChannelError) {
    return error.message;
  }

  if (hasDiscordErrorCode(error, 50001)) {
    return "Configured poll channel is inaccessible: Discord returned Missing Access.";
  }

  if (hasDiscordErrorCode(error, 10003)) {
    return "Configured poll channel no longer exists: Discord returned Unknown Channel.";
  }

  return null;
}

function hasDiscordErrorCode(error: unknown, code: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

async function deleteCurrentPoll(channel: TextChannel, messageId: string | null): Promise<boolean> {
  if (!messageId) {
    return false;
  }

  try {
    const message = await channel.messages.fetch(messageId);
    await message.delete();
    return true;
  } catch (error) {
    console.warn(`Could not delete previous poll message ${messageId}:`, error);
    return false;
  }
}

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

export async function resetPoll(
  client: Client,
  db: PollDatabase,
  config: PollConfig,
  options: ResetPollOptions = {}
): Promise<Message<true>> {
  if (!config.channelId) {
    throw new Error("Poll channel is not configured.");
  }

  const channel = await fetchTextChannel(client, config.channelId);
  if (!channel) {
    throw new Error("Configured channel was not found or is not a text channel.");
  }

  if (config.currentPollMessageId) {
    await deleteCurrentPoll(channel, config.currentPollMessageId);
    db.clearPollVotes(config.guildId, config.currentPollMessageId);
  }

  const message = await channel.send({
    poll: {
      question: { text: config.question },
      answers: config.options.map((option) => ({ text: option })),
      duration: config.durationHours,
      allowMultiselect: false,
      layoutType: PollLayoutType.Default
    }
  });

  const postedAt = new Date();
  const nextPostAt =
    options.advanceSchedule === false
      ? new Date(config.nextPostAtUtc ?? calculateNextPostAt(postedAt, config.pollTimeHourUtc))
      : addHours(postedAt, config.frequencyHours);
  db.markPollPosted(config.guildId, message.id, postedAt, nextPostAt);
  return message as Message<true>;
}

export async function deleteSavedPoll(client: Client, db: PollDatabase, config: PollConfig): Promise<boolean> {
  if (!config.channelId || !config.currentPollMessageId) {
    db.clearCurrentPoll(config.guildId);
    return false;
  }

  const channel = await fetchTextChannel(client, config.channelId);
  if (!channel) {
    db.clearCurrentPoll(config.guildId);
    return false;
  }

  const deleted = await deleteCurrentPoll(channel, config.currentPollMessageId);
  db.clearPollVotes(config.guildId, config.currentPollMessageId);
  db.clearCurrentPoll(config.guildId);
  return deleted;
}

export async function fetchTextChannel(client: Client, channelId: string): Promise<TextChannel | null> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      return null;
    }

    const me = channel.guild.members.me;
    if (!me) {
      return null;
    }

    const permissions = channel.permissionsFor(me);
    const required = [
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.ReadMessageHistory,
      PermissionsBitField.Flags.ManageMessages
    ];

    if (!permissions || !required.every((permission) => permissions.has(permission))) {
      throw new Error(`Missing required permissions in #${channel.name}.`);
    }

    return channel;
  } catch (error) {
    console.error(`Failed to fetch channel ${channelId}:`, error);
    return null;
  }
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

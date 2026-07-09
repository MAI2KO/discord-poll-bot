import "dotenv/config";
import {
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder
} from "discord.js";
import { calculateNextPostAt, PollDatabase } from "./db";
import { deleteSavedPoll, resetPoll } from "./polls";
import { DURATION_CHOICES, FREQUENCY_CHOICES } from "./types";

const timeChoices = Array.from({ length: 24 }, (_, hour) => ({
  name: `${hour.toString().padStart(2, "0")}:00 UTC`,
  value: hour
}));

const frequencyChoices = FREQUENCY_CHOICES.map((hours) => ({
  name: `Every ${hours} ${hours === 1 ? "hour" : "hours"}`,
  value: hours
}));

const durationChoices = DURATION_CHOICES.map((hours) => ({
  name: `${hours} ${hours === 1 ? "hour" : "hours"}`,
  value: hours
}));

export const slashCommands = [
  new SlashCommandBuilder()
    .setName("poll-setup")
    .setDescription("Set the text channel for recurring polls.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("The text channel where polls will be posted.")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("poll-question")
    .setDescription("Set the question for future polls.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option.setName("question").setDescription("Question text, up to 300 characters.").setMaxLength(300).setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("poll-options")
    .setDescription("Set between 2 and 10 poll answer options.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("poll-time")
    .setDescription("Set the UTC hour when the recurring poll cycle starts.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((option) =>
      option.setName("time").setDescription("UTC time of day.").addChoices(...timeChoices).setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("poll-frequency")
    .setDescription("Set how often the old poll is replaced.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((option) =>
      option.setName("frequency").setDescription("Poll replacement frequency.").addChoices(...frequencyChoices).setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("poll-duration")
    .setDescription("Set how long each Discord poll remains open.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((option) =>
      option.setName("duration").setDescription("Native Discord poll duration.").addChoices(...durationChoices).setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("poll-post-now")
    .setDescription("Delete the current poll and post a fresh one now.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("poll-delete")
    .setDescription("Delete the current poll and clear the saved message ID.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("poll-status")
    .setDescription("Show the current recurring poll configuration.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map((command) => command.toJSON());

for (let index = 1; index <= 10; index += 1) {
  const command = slashCommands.find((entry) => entry.name === "poll-options");
  if (command && "options" in command) {
    command.options ??= [];
    command.options.push({
      type: 3,
      name: `option_${index}`,
      description: `Poll option ${index}.`,
      required: false,
      max_length: 55
    });
  }
}

export async function handleCommand(interaction: ChatInputCommandInteraction, client: Client, db: PollDatabase): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "This command can only be used in a Discord server.", ephemeral: true });
    return;
  }

  if (!isAdminInteraction(interaction)) {
    await interaction.reply({ content: "You need Manage Guild or Administrator permission to use this command.", ephemeral: true });
    return;
  }

  try {
    switch (interaction.commandName) {
      case "poll-setup":
        await handleSetup(interaction, db);
        break;
      case "poll-question":
        await handleQuestion(interaction, db);
        break;
      case "poll-options":
        await handleOptions(interaction, db);
        break;
      case "poll-time":
        await handleTime(interaction, db);
        break;
      case "poll-frequency":
        await handleFrequency(interaction, db);
        break;
      case "poll-duration":
        await handleDuration(interaction, db);
        break;
      case "poll-post-now":
        await handlePostNow(interaction, client, db);
        break;
      case "poll-delete":
        await handleDelete(interaction, client, db);
        break;
      case "poll-status":
        await handleStatus(interaction, db);
        break;
      default:
        await interaction.reply({ content: "Unknown command.", ephemeral: true });
    }
  } catch (error) {
    console.error(`Command ${interaction.commandName} failed:`, error);
    const content = error instanceof Error ? error.message : "Something went wrong while running that command.";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(content);
    } else {
      await interaction.reply({ content, ephemeral: true });
    }
  }
}

async function handleSetup(interaction: ChatInputCommandInteraction, db: PollDatabase): Promise<void> {
  const channel = interaction.options.getChannel("channel", true, [ChannelType.GuildText]);
  const config = db.updateChannel(interaction.guildId!, channel.id);
  await interaction.reply({
    content: `Poll channel set to <#${config.channelId}>. Next scheduled poll: ${formatDate(config.nextPostAtUtc)}.`,
    ephemeral: true
  });
}

async function handleQuestion(interaction: ChatInputCommandInteraction, db: PollDatabase): Promise<void> {
  const question = interaction.options.getString("question", true).trim();
  if (!question) {
    throw new Error("Question cannot be blank.");
  }

  db.updateQuestion(interaction.guildId!, question);
  await interaction.reply({ content: "Poll question updated. This affects the next poll.", ephemeral: true });
}

async function handleOptions(interaction: ChatInputCommandInteraction, db: PollDatabase): Promise<void> {
  const options = Array.from({ length: 10 }, (_, index) => interaction.options.getString(`option_${index + 1}`))
    .filter((option): option is string => option !== null)
    .map((option) => option.trim());

  validateOptions(options);
  db.updateOptions(interaction.guildId!, options);
  await interaction.reply({ content: "Poll options updated. This affects the next poll.", ephemeral: true });
}

async function handleTime(interaction: ChatInputCommandInteraction, db: PollDatabase): Promise<void> {
  const hour = interaction.options.getInteger("time", true);
  if (hour < 0 || hour > 23) {
    throw new Error("Poll time must be one of the listed UTC hour choices.");
  }

  const config = db.updatePollTime(interaction.guildId!, hour);
  await interaction.reply({
    content: `Poll time set to ${hour.toString().padStart(2, "0")}:00 UTC. Next scheduled poll: ${formatDate(config.nextPostAtUtc)}.`,
    ephemeral: true
  });
}

async function handleFrequency(interaction: ChatInputCommandInteraction, db: PollDatabase): Promise<void> {
  const frequency = interaction.options.getInteger("frequency", true);
  if (!FREQUENCY_CHOICES.includes(frequency as (typeof FREQUENCY_CHOICES)[number])) {
    throw new Error("Poll frequency must be one of the listed choices.");
  }

  const config = db.updateFrequency(interaction.guildId!, frequency);
  await interaction.reply({
    content: `Poll frequency set to every ${frequency} ${frequency === 1 ? "hour" : "hours"}. Next scheduled poll: ${formatDate(config.nextPostAtUtc)}.`,
    ephemeral: true
  });
}

async function handleDuration(interaction: ChatInputCommandInteraction, db: PollDatabase): Promise<void> {
  const duration = interaction.options.getInteger("duration", true);
  if (!DURATION_CHOICES.includes(duration as (typeof DURATION_CHOICES)[number])) {
    throw new Error("Poll duration must be one of the listed choices.");
  }

  db.updateDuration(interaction.guildId!, duration);
  await interaction.reply({ content: `Poll duration set to ${duration} ${duration === 1 ? "hour" : "hours"}.`, ephemeral: true });
}

async function handlePostNow(interaction: ChatInputCommandInteraction, client: Client, db: PollDatabase): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const config = db.getOrCreateGuildConfig(interaction.guildId!);
  const message = await resetPoll(client, db, config, { advanceSchedule: false });
  await interaction.editReply(`Posted a fresh poll: ${message.url}`);
}

async function handleDelete(interaction: ChatInputCommandInteraction, client: Client, db: PollDatabase): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const config = db.getOrCreateGuildConfig(interaction.guildId!);
  const deleted = await deleteSavedPoll(client, db, config);
  await interaction.editReply(deleted ? "Deleted the current poll and cleared the saved message ID." : "No current poll message was available to delete.");
}

async function handleStatus(interaction: ChatInputCommandInteraction, db: PollDatabase): Promise<void> {
  const config = db.getOrCreateGuildConfig(interaction.guildId!);
  const warning =
    config.durationHours > config.frequencyHours
      ? "\nWarning: poll duration is longer than poll frequency, so a poll may be deleted before Discord naturally closes it."
      : "";

  const lines = [
    `Channel: ${config.channelId ? `<#${config.channelId}>` : "not configured"}`,
    `Question: ${config.question}`,
    `Options: ${config.options.join(", ")}`,
    `Poll time UTC: ${config.pollTimeHourUtc.toString().padStart(2, "0")}:00`,
    `Poll frequency: every ${config.frequencyHours} ${config.frequencyHours === 1 ? "hour" : "hours"}`,
    `Poll duration: ${config.durationHours} ${config.durationHours === 1 ? "hour" : "hours"}`,
    `Current poll message ID: ${config.currentPollMessageId ?? "none"}`,
    `Next scheduled poll time: ${formatDate(config.nextPostAtUtc ?? calculateNextPostAt(new Date(), config.pollTimeHourUtc).toISOString())}${warning}`
  ];

  await interaction.reply({ content: lines.join("\n"), ephemeral: true });
}

function validateOptions(options: string[]): void {
  if (options.length < 2) {
    throw new Error("At least 2 options are required.");
  }

  if (options.length > 10) {
    throw new Error("Maximum 10 options are allowed.");
  }

  if (options.some((option) => option.length === 0)) {
    throw new Error("Options cannot be blank.");
  }

  if (options.some((option) => option.length > 55)) {
    throw new Error("Each option must be 55 characters or fewer.");
  }

  const unique = new Set(options.map((option) => option.toLocaleLowerCase()));
  if (unique.size !== options.length) {
    throw new Error("Duplicate options are not allowed.");
  }
}

function isAdminInteraction(interaction: ChatInputCommandInteraction): boolean {
  const permissions = interaction.memberPermissions;
  return Boolean(permissions?.has(PermissionFlagsBits.ManageGuild) || permissions?.has(PermissionFlagsBits.Administrator));
}

function formatDate(value: string | null): string {
  return value ? `${value} UTC` : "not scheduled";
}

async function registerCommands(): Promise<void> {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.CLIENT_ID;

  if (!token || !clientId) {
    throw new Error("DISCORD_TOKEN and CLIENT_ID are required to register commands.");
  }

  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: slashCommands });
  console.log(`Registered ${slashCommands.length} slash commands.`);
}

if (require.main === module) {
  registerCommands().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

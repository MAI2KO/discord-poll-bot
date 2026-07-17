import "dotenv/config";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { handleCommand } from "./commands";
import { PollDatabase } from "./db";
import { PollScheduler } from "./scheduler";

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error("DISCORD_TOKEN is required.");
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const db = new PollDatabase(databaseUrl);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const scheduler = new PollScheduler(client, db);

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}.`);
  await cleanupStaleGuildData();
  scheduler.start();
});

client.on(Events.GuildDelete, async (guild) => {
  try {
    await db.deleteGuildData(guild.id);
    console.log(`Deleted config for guild ${guild.id} after bot was removed from the guild.`);
  } catch (error) {
    console.error(`Failed to delete config for guild ${guild.id} after bot was removed from the guild:`, error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  await handleCommand(interaction, client, db);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown(): void {
  scheduler.stop();
  client.destroy();
  void db.close().finally(() => {
    process.exit(0);
  });
}

async function cleanupStaleGuildData(): Promise<void> {
  let configs;
  try {
    configs = await db.getAllGuildConfigs();
  } catch (error) {
    console.error("Failed to fetch saved guild configs for startup cleanup:", error);
    return;
  }

  for (const config of configs) {
    if (client.guilds.cache.has(config.guildId)) {
      continue;
    }

    try {
      await db.deleteGuildData(config.guildId);
      console.log(`Cleaned up stale config for guild ${config.guildId} because the bot is no longer in that guild.`);
    } catch (error) {
      console.error(`Failed to clean up stale config for guild ${config.guildId}:`, error);
    }
  }
}

async function main(): Promise<void> {
  await db.initialize();
  await client.login(token);
}

main().catch((error) => {
  console.error("Failed to start bot:", error);
  process.exit(1);
});

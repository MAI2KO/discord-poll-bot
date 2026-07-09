import "dotenv/config";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { handleCommand } from "./commands";
import { PollDatabase } from "./db";
import { PollScheduler } from "./scheduler";

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error("DISCORD_TOKEN is required.");
}

const databasePath = process.env.DATABASE_PATH ?? "./data/bot.sqlite";
const db = new PollDatabase(databasePath);

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const scheduler = new PollScheduler(client, db);

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}.`);
  scheduler.start();
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
  process.exit(0);
}

client.login(token).catch((error) => {
  console.error("Failed to log in:", error);
  process.exit(1);
});

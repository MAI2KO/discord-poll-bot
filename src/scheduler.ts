import { Client } from "discord.js";
import { PollDatabase } from "./db";
import { isPollChannelError, resetPoll } from "./polls";

export class PollScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly client: Client,
    private readonly db: PollDatabase
  ) {}

  start(): void {
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, 60_000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    const now = new Date();

    try {
      for (const config of await this.db.getDueConfigs(now)) {
        const latest = await this.db.getGuildConfig(config.guildId);
        if (!latest?.nextPostAtUtc || latest.nextPostAtUtc > now.toISOString()) {
          continue;
        }

        try {
          await resetPoll(this.client, this.db, latest, { advanceSchedule: true });
          console.log(`Posted scheduled poll for guild ${latest.guildId}.`);
        } catch (error) {
          if (isPollChannelError(error)) {
            await this.db.pauseSchedule(latest.guildId, error.message, new Date());
            console.warn(`Paused scheduled polls for guild ${latest.guildId}: ${error.message}`);
            continue;
          }

          console.error(`Failed to post scheduled poll for guild ${latest.guildId}:`, error);
        }
      }
    } finally {
      this.running = false;
    }
  }
}

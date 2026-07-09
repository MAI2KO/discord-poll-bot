import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_DURATION_HOURS,
  DEFAULT_FREQUENCY_HOURS,
  DEFAULT_OPTIONS,
  DEFAULT_POLL_TIME_HOUR_UTC,
  DEFAULT_QUESTION,
  PollConfig,
  PollConfigRow
} from "./types";

export class PollDatabase {
  private readonly db: Database.Database;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  getOrCreateGuildConfig(guildId: string): PollConfig {
    const existing = this.getGuildConfig(guildId);
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO poll_configs (
          guild_id, channel_id, question, options_json, poll_time_hour_utc,
          frequency_hours, duration_hours, current_poll_message_id,
          last_posted_at_utc, next_post_at_utc, created_at, updated_at
        ) VALUES (
          @guildId, NULL, @question, @optionsJson, @pollTimeHourUtc,
          @frequencyHours, @durationHours, NULL, NULL, NULL, @now, @now
        )`
      )
      .run({
        guildId,
        question: DEFAULT_QUESTION,
        optionsJson: JSON.stringify(DEFAULT_OPTIONS),
        pollTimeHourUtc: DEFAULT_POLL_TIME_HOUR_UTC,
        frequencyHours: DEFAULT_FREQUENCY_HOURS,
        durationHours: DEFAULT_DURATION_HOURS,
        now
      });

    return this.getOrCreateGuildConfig(guildId);
  }

  getGuildConfig(guildId: string): PollConfig | null {
    const row = this.db
      .prepare("SELECT * FROM poll_configs WHERE guild_id = ?")
      .get(guildId) as PollConfigRow | undefined;

    return row ? rowToConfig(row) : null;
  }

  getDueConfigs(now: Date): PollConfig[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM poll_configs
         WHERE channel_id IS NOT NULL
           AND next_post_at_utc IS NOT NULL
           AND next_post_at_utc <= ?
         ORDER BY next_post_at_utc ASC`
      )
      .all(now.toISOString()) as PollConfigRow[];

    return rows.map(rowToConfig);
  }

  getAllConfigs(): PollConfig[] {
    const rows = this.db.prepare("SELECT * FROM poll_configs ORDER BY guild_id ASC").all() as PollConfigRow[];
    return rows.map(rowToConfig);
  }

  updateChannel(guildId: string, channelId: string): PollConfig {
    const config = this.getOrCreateGuildConfig(guildId);
    const nextPostAtUtc = config.nextPostAtUtc ?? calculateNextPostAt(new Date(), config.pollTimeHourUtc).toISOString();
    this.patchConfig(guildId, {
      channel_id: channelId,
      next_post_at_utc: nextPostAtUtc
    });
    return this.getOrCreateGuildConfig(guildId);
  }

  updateQuestion(guildId: string, question: string): PollConfig {
    this.getOrCreateGuildConfig(guildId);
    this.patchConfig(guildId, { question });
    return this.getOrCreateGuildConfig(guildId);
  }

  updateOptions(guildId: string, options: string[]): PollConfig {
    this.getOrCreateGuildConfig(guildId);
    this.patchConfig(guildId, { options_json: JSON.stringify(options) });
    return this.getOrCreateGuildConfig(guildId);
  }

  updatePollTime(guildId: string, pollTimeHourUtc: number): PollConfig {
    this.getOrCreateGuildConfig(guildId);
    this.patchConfig(guildId, {
      poll_time_hour_utc: pollTimeHourUtc,
      next_post_at_utc: calculateNextPostAt(new Date(), pollTimeHourUtc).toISOString()
    });
    return this.getOrCreateGuildConfig(guildId);
  }

  updateFrequency(guildId: string, frequencyHours: number): PollConfig {
    const config = this.getOrCreateGuildConfig(guildId);
    const anchor = config.lastPostedAtUtc ? new Date(config.lastPostedAtUtc) : new Date();
    const nextPostAtUtc = addHours(anchor, frequencyHours);
    this.patchConfig(guildId, {
      frequency_hours: frequencyHours,
      next_post_at_utc: nextPostAtUtc.toISOString()
    });
    return this.getOrCreateGuildConfig(guildId);
  }

  updateDuration(guildId: string, durationHours: number): PollConfig {
    this.getOrCreateGuildConfig(guildId);
    this.patchConfig(guildId, { duration_hours: durationHours });
    return this.getOrCreateGuildConfig(guildId);
  }

  markPollPosted(guildId: string, messageId: string, postedAt: Date, nextPostAt: Date): PollConfig {
    this.patchConfig(guildId, {
      current_poll_message_id: messageId,
      last_posted_at_utc: postedAt.toISOString(),
      next_post_at_utc: nextPostAt.toISOString()
    });
    return this.getOrCreateGuildConfig(guildId);
  }

  clearCurrentPoll(guildId: string): PollConfig {
    this.getOrCreateGuildConfig(guildId);
    this.patchConfig(guildId, { current_poll_message_id: null });
    return this.getOrCreateGuildConfig(guildId);
  }

  private patchConfig(guildId: string, values: Record<string, string | number | null>): void {
    const assignments = Object.keys(values).map((key) => `${key} = @${key}`);
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE poll_configs
         SET ${assignments.join(", ")}, updated_at = @updated_at
         WHERE guild_id = @guild_id`
      )
      .run({ ...values, updated_at: updatedAt, guild_id: guildId });
  }

  private migrate(): void {
    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS poll_configs (
          guild_id TEXT PRIMARY KEY,
          channel_id TEXT,
          question TEXT NOT NULL,
          options_json TEXT NOT NULL,
          poll_time_hour_utc INTEGER NOT NULL,
          frequency_hours INTEGER NOT NULL,
          duration_hours INTEGER NOT NULL,
          current_poll_message_id TEXT,
          last_posted_at_utc TEXT,
          next_post_at_utc TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`
      )
      .run();
  }
}

export function calculateNextPostAt(from: Date, pollTimeHourUtc: number): Date {
  const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), pollTimeHourUtc, 0, 0, 0));
  if (next <= from) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function rowToConfig(row: PollConfigRow): PollConfig {
  return {
    guildId: row.guild_id,
    channelId: row.channel_id,
    question: row.question,
    options: parseOptions(row.options_json),
    pollTimeHourUtc: row.poll_time_hour_utc,
    frequencyHours: row.frequency_hours,
    durationHours: row.duration_hours,
    currentPollMessageId: row.current_poll_message_id,
    lastPostedAtUtc: row.last_posted_at_utc,
    nextPostAtUtc: row.next_post_at_utc,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseOptions(optionsJson: string): string[] {
  try {
    const parsed = JSON.parse(optionsJson);
    return Array.isArray(parsed) && parsed.every((option) => typeof option === "string") ? parsed : DEFAULT_OPTIONS;
  } catch {
    return DEFAULT_OPTIONS;
  }
}

import { Pool, PoolClient } from "pg";
import {
  DEFAULT_DURATION_HOURS,
  DEFAULT_FREQUENCY_HOURS,
  DEFAULT_OPTIONS,
  DEFAULT_POLL_TIME_HOUR_UTC,
  DEFAULT_QUESTION,
  PollConfig,
  PollConfigRow
} from "./types";

type ConfigPatch = Partial<{
  channel_id: string | null;
  expected_role_id: string | null;
  question: string;
  options_json: string;
  poll_time_hour_utc: number;
  frequency_hours: number;
  duration_hours: number;
  current_poll_message_id: string | null;
  last_posted_at_utc: Date | string | null;
  next_post_at_utc: Date | string | null;
}>;

export class PollDatabase {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl
    });
  }

  async initialize(): Promise<void> {
    await this.migrate();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async getOrCreateGuildConfig(guildId: string): Promise<PollConfig> {
    const existing = await this.getGuildConfig(guildId);
    if (existing) {
      return existing;
    }

    await this.pool.query(
      `INSERT INTO poll_configs (
        guild_id, channel_id, expected_role_id, question, options_json, poll_time_hour_utc,
        frequency_hours, duration_hours, current_poll_message_id,
        last_posted_at_utc, next_post_at_utc
      ) VALUES (
        $1, NULL, NULL, $2, $3, $4, $5, $6, NULL, NULL, NULL
      )
      ON CONFLICT (guild_id) DO NOTHING`,
      [
        guildId,
        DEFAULT_QUESTION,
        JSON.stringify(DEFAULT_OPTIONS),
        DEFAULT_POLL_TIME_HOUR_UTC,
        DEFAULT_FREQUENCY_HOURS,
        DEFAULT_DURATION_HOURS
      ]
    );

    const created = await this.getGuildConfig(guildId);
    if (!created) {
      throw new Error("Failed to create poll configuration.");
    }

    return created;
  }

  async getGuildConfig(guildId: string): Promise<PollConfig | null> {
    const result = await this.pool.query<PollConfigRow>("SELECT * FROM poll_configs WHERE guild_id = $1", [guildId]);
    return result.rows[0] ? rowToConfig(result.rows[0]) : null;
  }

  async getDueConfigs(now: Date): Promise<PollConfig[]> {
    const result = await this.pool.query<PollConfigRow>(
      `SELECT * FROM poll_configs
       WHERE channel_id IS NOT NULL
         AND next_post_at_utc IS NOT NULL
         AND next_post_at_utc <= $1
       ORDER BY next_post_at_utc ASC`,
      [now]
    );

    return result.rows.map(rowToConfig);
  }

  async updateChannel(guildId: string, channelId: string): Promise<PollConfig> {
    const config = await this.getOrCreateGuildConfig(guildId);
    const nextPostAtUtc = config.nextPostAtUtc ?? calculateNextPostAt(new Date(), config.pollTimeHourUtc).toISOString();
    await this.patchConfig(guildId, {
      channel_id: channelId,
      next_post_at_utc: nextPostAtUtc
    });
    return this.getOrCreateGuildConfig(guildId);
  }

  async updateExpectedRole(guildId: string, roleId: string): Promise<PollConfig> {
    await this.getOrCreateGuildConfig(guildId);
    await this.patchConfig(guildId, { expected_role_id: roleId });
    return this.getOrCreateGuildConfig(guildId);
  }

  async updateQuestion(guildId: string, question: string): Promise<PollConfig> {
    await this.getOrCreateGuildConfig(guildId);
    await this.patchConfig(guildId, { question });
    return this.getOrCreateGuildConfig(guildId);
  }

  async updateOptions(guildId: string, options: string[]): Promise<PollConfig> {
    await this.getOrCreateGuildConfig(guildId);
    await this.patchConfig(guildId, { options_json: JSON.stringify(options) });
    return this.getOrCreateGuildConfig(guildId);
  }

  async updatePollTime(guildId: string, pollTimeHourUtc: number): Promise<PollConfig> {
    await this.getOrCreateGuildConfig(guildId);
    await this.patchConfig(guildId, {
      poll_time_hour_utc: pollTimeHourUtc,
      next_post_at_utc: calculateNextPostAt(new Date(), pollTimeHourUtc).toISOString()
    });
    return this.getOrCreateGuildConfig(guildId);
  }

  async updateFrequency(guildId: string, frequencyHours: number): Promise<PollConfig> {
    const config = await this.getOrCreateGuildConfig(guildId);
    const anchor = config.lastPostedAtUtc ? new Date(config.lastPostedAtUtc) : new Date();
    const nextPostAtUtc = addHours(anchor, frequencyHours);
    await this.patchConfig(guildId, {
      frequency_hours: frequencyHours,
      next_post_at_utc: nextPostAtUtc.toISOString()
    });
    return this.getOrCreateGuildConfig(guildId);
  }

  async updateDuration(guildId: string, durationHours: number): Promise<PollConfig> {
    await this.getOrCreateGuildConfig(guildId);
    await this.patchConfig(guildId, { duration_hours: durationHours });
    return this.getOrCreateGuildConfig(guildId);
  }

  async markPollPosted(guildId: string, messageId: string, postedAt: Date, nextPostAt: Date): Promise<PollConfig> {
    await this.patchConfig(guildId, {
      current_poll_message_id: messageId,
      last_posted_at_utc: postedAt,
      next_post_at_utc: nextPostAt
    });
    return this.getOrCreateGuildConfig(guildId);
  }

  async clearCurrentPoll(guildId: string): Promise<PollConfig> {
    await this.getOrCreateGuildConfig(guildId);
    await this.patchConfig(guildId, { current_poll_message_id: null });
    return this.getOrCreateGuildConfig(guildId);
  }

  async clearPollVotes(guildId: string, pollMessageId: string): Promise<void> {
    await this.pool.query("DELETE FROM poll_votes WHERE guild_id = $1 AND poll_message_id = $2", [guildId, pollMessageId]);
  }

  async replacePollVotes(guildId: string, pollMessageId: string, votes: Array<{ userId: string; answerId: number }>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM poll_votes WHERE guild_id = $1 AND poll_message_id = $2", [guildId, pollMessageId]);

      for (const vote of votes) {
        await client.query(
          `INSERT INTO poll_votes (
            guild_id, poll_message_id, user_id, answer_id
          ) VALUES (
            $1, $2, $3, $4
          )
          ON CONFLICT (guild_id, poll_message_id, user_id)
          DO UPDATE SET answer_id = EXCLUDED.answer_id, updated_at = NOW()`,
          [guildId, pollMessageId, vote.userId, vote.answerId]
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  private async patchConfig(guildId: string, values: ConfigPatch): Promise<void> {
    const entries = Object.entries(values);
    if (entries.length === 0) {
      return;
    }

    const assignments = entries.map(([key], index) => `${key} = $${index + 2}`);
    const params = [guildId, ...entries.map(([, value]) => value)];
    await this.pool.query(
      `UPDATE poll_configs
       SET ${assignments.join(", ")}, updated_at = NOW()
       WHERE guild_id = $1`,
      params
    );
  }

  private async migrate(): Promise<void> {
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS poll_configs (
        guild_id TEXT PRIMARY KEY,
        channel_id TEXT,
        question TEXT NOT NULL,
        options_json TEXT NOT NULL,
        poll_time_hour_utc INTEGER NOT NULL,
        frequency_hours INTEGER NOT NULL,
        duration_hours INTEGER NOT NULL,
        current_poll_message_id TEXT,
        expected_role_id TEXT,
        last_posted_at_utc TIMESTAMPTZ,
        next_post_at_utc TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`
    );

    await this.pool.query("ALTER TABLE poll_configs ADD COLUMN IF NOT EXISTS expected_role_id TEXT");

    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS poll_votes (
        guild_id TEXT NOT NULL,
        poll_message_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        answer_id INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (guild_id, poll_message_id, user_id)
      )`
    );
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

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch (error) {
    console.error("Failed to roll back database transaction:", error);
  }
}

function rowToConfig(row: PollConfigRow): PollConfig {
  return {
    guildId: row.guild_id,
    channelId: row.channel_id,
    expectedRoleId: row.expected_role_id,
    question: row.question,
    options: parseOptions(row.options_json),
    pollTimeHourUtc: row.poll_time_hour_utc,
    frequencyHours: row.frequency_hours,
    durationHours: row.duration_hours,
    currentPollMessageId: row.current_poll_message_id,
    lastPostedAtUtc: formatTimestamp(row.last_posted_at_utc),
    nextPostAtUtc: formatTimestamp(row.next_post_at_utc),
    createdAt: formatRequiredTimestamp(row.created_at),
    updatedAt: formatRequiredTimestamp(row.updated_at)
  };
}

function formatTimestamp(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function formatRequiredTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseOptions(optionsJson: string): string[] {
  try {
    const parsed = JSON.parse(optionsJson);
    return Array.isArray(parsed) && parsed.every((option) => typeof option === "string") ? parsed : DEFAULT_OPTIONS;
  } catch {
    return DEFAULT_OPTIONS;
  }
}

export const DEFAULT_QUESTION = "Have you completed the task?";
export const DEFAULT_OPTIONS = ["1", "2", "3", "4"];
export const DEFAULT_POLL_TIME_HOUR_UTC = 8;
export const DEFAULT_FREQUENCY_HOURS = 24;
export const DEFAULT_DURATION_HOURS = 24;

export const FREQUENCY_CHOICES = [1, 2, 4, 6, 8, 12, 24, 48, 72, 96, 120, 144, 168] as const;
export const DURATION_CHOICES = FREQUENCY_CHOICES;

export interface PollConfig {
  guildId: string;
  channelId: string | null;
  expectedRoleId: string | null;
  question: string;
  options: string[];
  pollTimeHourUtc: number;
  frequencyHours: number;
  durationHours: number;
  currentPollMessageId: string | null;
  lastPostedAtUtc: string | null;
  nextPostAtUtc: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PollConfigRow {
  guild_id: string;
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
  created_at: Date | string;
  updated_at: Date | string;
}

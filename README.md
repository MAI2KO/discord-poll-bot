# Discord Poll Bot

A small production-ready Discord bot that posts recurring native Discord polls in one configured channel per server.

The bot deletes the previous poll before posting a fresh one. It uses Discord native polls only: no reactions, buttons, modals, custom voting, history, leaderboards, or dashboards.

## Requirements

- Node.js 20 or newer
- A Discord application with a bot user
- Bot permissions in the target channel:
  - View Channel
  - Send Messages
  - Read Message History
  - Manage Messages
  - Use Application Commands
- Server Members Intent may be needed for role member fetching. Enable it in the Discord Developer Portal if `/poll-missing` cannot fetch role members.

## Create The Discord Application

1. Open the Discord Developer Portal.
2. Create a new application.
3. Go to Bot and add a bot user.
4. Copy the bot token. Put it in `.env` as `DISCORD_TOKEN`.
5. Go to OAuth2 and copy the Application ID. Put it in `.env` as `CLIENT_ID`.
6. If missing-voter checks cannot fetch role members, go to Bot and enable Server Members Intent.

## Invite The Bot

In OAuth2 URL Generator:

1. Select `bot` and `applications.commands`.
2. Select these bot permissions:
   - View Channel
   - Send Messages
   - Read Message History
   - Manage Messages
   - Use Application Commands
3. Open the generated URL and invite the bot to your server.

## Configure Environment

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

```env
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_application_id
DATABASE_URL=your_postgres_connection_url
```

## Install And Build

```bash
npm install
npm run build
```

## Register Slash Commands

Register global commands:

```bash
npm run register-commands
```

Global Discord commands can take a few minutes to appear.

## Run Locally

Development:

```bash
npm run dev
```

Production build:

```bash
npm run build
npm start
```

## Example Setup Commands

Run these in Discord after commands are registered:

```text
/poll-setup channel:#daily-task-poll
/poll-question question:"Have you completed the task?"
/poll-options option_1:"1" option_2:"2" option_3:"3" option_4:"4"
/poll-time time:"08:00 UTC"
/poll-frequency frequency:"Every 24 hours"
/poll-duration duration:"24 hours"
/poll-set-role role:@Task Team
/poll-post-now
/poll-missing
/poll-remind-missing
```

## Commands

- `/poll-setup` sets the text channel.
- `/poll-question` sets the question for the next poll.
- `/poll-options` sets 2 to 10 answer options.
- `/poll-time` sets the UTC hour when the recurring cycle starts.
- `/poll-frequency` sets how often the current poll is replaced.
- `/poll-duration` sets how long Discord keeps each poll open.
- `/poll-set-role` sets the role whose non-bot members are expected to vote.
- `/poll-post-now` deletes the previous poll and posts a fresh one immediately.
- `/poll-delete` deletes the current poll and clears the saved message ID.
- `/poll-status` shows the saved config, schedule pause state, next post time, and any duration/frequency warning.
- `/poll-missing` privately shows total expected voters, total voted, total missing, and the missing member mentions.
- `/poll-remind-missing` posts a public reminder in the poll channel tagging only missing voters.
- `/poll-clear-tracking` clears stored voter tracking rows for the current poll.

All commands are admin-only. Users need Manage Guild or Administrator permission.

## Defaults

- Poll time: `08:00 UTC`
- Poll frequency: every `24 hours`
- Poll duration: `24 hours`
- Question: `Have you completed the task?`
- Options: `1`, `2`, `3`, `4`
- Polls are single-choice only.

Changing settings affects the next poll. Discord native polls cannot be edited after creation, so use `/poll-post-now` to reset immediately with the latest settings.

## Missing Voter Tracking

Set the expected voter role before checking missing voters:

```text
/poll-set-role role:@Task Team
```

The bot checks the current native Discord poll, fetches voters for each poll answer through Discord's native poll API, and compares those users with non-bot members of the configured role.

```text
/poll-missing
/poll-remind-missing
```

`/poll-missing` replies ephemerally to the admin. `/poll-remind-missing` posts a public reminder in the poll channel only when someone is missing. It does not run automatically.

Privacy: the bot only checks who has not voted. It does not publicly show vote choices, announce winners, keep old missing-voter lists, or keep long-term voting history.

Tracking rows are scrubbed when a poll is deleted with `/poll-delete`, when `/poll-post-now` replaces the active poll, and when the scheduled reset replaces the active poll. `/poll-clear-tracking` can also clear stored tracking for the current poll manually.

If member fetching fails, enable Server Members Intent in the Discord Developer Portal and make sure the bot can access the server member list.

## Deploy On Railway

Railway deployments require PostgreSQL so poll configuration survives restarts and redeploys.

1. Add a PostgreSQL service to the same Railway project.
2. Open the bot service.
3. Go to Variables.
4. Add `DATABASE_URL` using the Postgres `DATABASE_URL` reference.
5. Keep `DISCORD_TOKEN` and `CLIENT_ID` on the bot service.
6. Redeploy the bot.

The bot creates the `poll_configs` and `poll_votes` tables automatically on startup.

## Scheduling

The scheduler runs in UTC and checks every minute for configs where `next_post_at_utc` is due. After a poll is posted, the next post time is advanced by `frequency_hours`.

If the configured channel is deleted, inaccessible, missing permissions, or no longer a text channel, the bot pauses scheduled posting for that server and records the reason. `/poll-status` shows the pause, and `/poll-setup` with an accessible text channel clears it. `/poll-post-now` still tries manually and reports any posting error privately.

On startup, the bot deletes saved poll data for servers it is no longer in. It also deletes a server's saved config and vote tracking when the bot is removed from that server.

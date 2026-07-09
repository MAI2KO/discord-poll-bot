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

## Create The Discord Application

1. Open the Discord Developer Portal.
2. Create a new application.
3. Go to Bot and add a bot user.
4. Copy the bot token. Put it in `.env` as `DISCORD_TOKEN`.
5. Go to OAuth2 and copy the Application ID. Put it in `.env` as `CLIENT_ID`.

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
DATABASE_PATH=./data/bot.sqlite
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
/poll-post-now
```

## Commands

- `/poll-setup` sets the text channel.
- `/poll-question` sets the question for the next poll.
- `/poll-options` sets 2 to 10 answer options.
- `/poll-time` sets the UTC hour when the recurring cycle starts.
- `/poll-frequency` sets how often the current poll is replaced.
- `/poll-duration` sets how long Discord keeps each poll open.
- `/poll-post-now` deletes the previous poll and posts a fresh one immediately.
- `/poll-delete` deletes the current poll and clears the saved message ID.
- `/poll-status` shows the saved config, next post time, and any duration/frequency warning.

All commands are admin-only. Users need Manage Guild or Administrator permission.

## Defaults

- Poll time: `08:00 UTC`
- Poll frequency: every `24 hours`
- Poll duration: `24 hours`
- Question: `Have you completed the task?`
- Options: `1`, `2`, `3`, `4`
- Polls are single-choice only.

Changing settings affects the next poll. Discord native polls cannot be edited after creation, so use `/poll-post-now` to reset immediately with the latest settings.

## Deploy On A VPS

1. Install Node.js 20 or newer on the server.
2. Clone or copy this project to the VPS.
3. Create `.env` with `DISCORD_TOKEN`, `CLIENT_ID`, and `DATABASE_PATH`.
4. Install and build:

```bash
npm install
npm run build
npm run register-commands
```

5. Run the bot with a process manager such as systemd or pm2.

Example pm2 flow:

```bash
npm install -g pm2
pm2 start dist/index.js --name discord-poll-bot
pm2 save
pm2 startup
```

Example systemd service:

```ini
[Unit]
Description=Discord Poll Bot
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/ubuntu/discord-poll-bot
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

After creating the service file:

```bash
sudo systemctl daemon-reload
sudo systemctl enable discord-poll-bot
sudo systemctl start discord-poll-bot
sudo systemctl status discord-poll-bot
```

## Scheduling

The scheduler runs in UTC and checks every minute for configs where `next_post_at_utc` is due. After a poll is posted, the next post time is advanced by `frequency_hours`.

If the bot lacks channel permissions, the channel is deleted, or the previous poll is missing, the bot logs the issue and continues running.

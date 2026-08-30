# TA1LDA3M0N, Twitch Chat Bot

A feature-rich Twitch chat bot built in Node.js for the channel **F0XTA1L**. TA1LDA3M0N (a.k.a. "Tails" / "TailDaemon") is an in-character sentient daemon that manages chat, moderation, music, media playback, a virtual currency system, and an interactive alternate reality game, all themed around the "Glosso-Sphere" lore.

---

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Running](#running)
- [Chat Commands](#chat-commands)
- [Module Overview](#module-overview)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [Architecture Notes](#architecture-notes)

---

## Features

- **Chat Commands**: 20+ chat commands including greetings, lore responses, socials, clipping, follow age, shoutouts, counters, lurk tracking, and hug interactions.
- **Song Requests (SSR)**: Viewers request songs via `!sr`. Integrates with Pear Desktop Music and YouTube Data API for search, queuing, and playback. Queue open/close controlled by mods.
- **Media Requests (MR)**: Channel-point redemption triggers video download via `yt-dlp`, OBS source display, and VLC playback. Moderators approve or reject before playback. Includes expiry sweep, atomic pending store, and startup reconciliation.
- **Shield System**: Automatically enables Twitch Shield Mode when the stream goes offline and disables it when live, via EventSub `stream.online` / `stream.offline`.
- **EventSub Integration**: Handles follow events (custom welcome), raids (auto-shoutout with official Twitch `/shoutout` API), and ad break notifications with countdown warnings.
- **Ad Schedule Poller**: Adaptive polling of the Twitch ad schedule API. Warns chat ~45 seconds before a scheduled ad. Pauses when stream is offline, resumes on online.
- **Virtual Currency (Glossels)**: Viewers earn Glossels through `!system connect` daily check-ins and participating in ARG events, or instantly convert 1000 channel points into 50 Glossels via the Points to Glossels channel points redeem (Twitch enforces the per-user per-stream limit and approval-skip). Gamble Glossels by sending them into unknown network nodes (`!system handshake <amount>`), or transfer them to other viewers. Lost Glossels accumulate in the Network Cache, and a rare `drained` outcome lets a player retrieve everything. Leaderboard and rank tracking via `!system balance`, `!system rank`, `!system top`.
- **Alternate Reality Game (ARG)**: An in-chat terminal simulation ("AETHER-OS") with a virtual filesystem, coherence system, bit-rot decay, port probing, lore files, file access gated by coherence level and discovered events, and a network gamble/transfer system for Glossels.
- **Moderation**: Automatic link filtering with domain allowlists. Links are deleted and the user warned unless they have a trusted badge or the link matches an allowed domain. Song-request and media-request domains are conditionally permitted.
- **Counters**: Configurable chat counters (e.g. death, yawn, 404) with increment, set, stats, and last-counted subcommands.
- **Timed Commands**: Periodic chat messages or function calls driven by a JSON config, with randomized offset and interval. Auto-pause on stream offline, auto-resume on online.
- **Daemon Personality**: Bot responds to greetings, lore character names (Ace, Joel, Mara, Dex), project names (AETHER-LINK, Glosso-Sphere, bit-rot), threats, compliments, and gratitude with characterful in-character responses.
- **Testing Commands**: Mods can simulate follow, raid, and ad break events via `!testfollow`, `!testraid`, `!testads` without needing real events.

---

## Prerequisites

| Dependency | Purpose | Notes |
|---|---|---|
| **Node.js** | Runtime | v16+ recommended. CommonJS modules. |
| **OBS Studio** | Media playback display | WebSocket server enabled (default port 4455). Bot waits for OBS to connect before starting. |
| **yt-dlp** | Video download for media requests | Must be on `$PATH` |
| **VLC media player** | Video playback | HTTP API enabled on `localhost:8080` |
| **Pear Desktop Music** | Song request playback | Local network app with HTTP API (default `192.168.1.71:26538`) |
| **Twitch App** | Chat + API access | Requires Client ID, Client Secret, and OAuth tokens for both bot and broadcaster accounts |
| **YouTube Data API key** | Song search and metadata | Used for `!sr` search and video duration validation |

---

## Setup

1. **Clone the repository:**
   ```bash
   git clone <repo-url>
   cd TwitchBot
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   Then edit `.env` and fill in your values:
   - Twitch `CLIENT_ID` and `CLIENT_SECRET`
   - YouTube Data API key (`YOUTUBE_ACCESS_KEY`)
   - OBS WebSocket URL and password
   - VLC host and password
   - Pear Desktop Music host, port, and auth ID
   - Media queue directory path (`MEDIA_QUEUE_DIR`)
   - Social links (Discord, YouTube, Instagram, itch.io)

4. **Obtain OAuth refresh tokens** for both bot and broadcaster accounts and place them in:
   - `data/bot_refresh_token.json`
   - `data/broadcaster_refresh_token.json`
   
   These are automatically refreshed at runtime. Use the [Twitch Token Generator](https://twitchapps.com/tmi/) or the Twitch Developer Console to obtain initial tokens.

5. **Ensure OBS Studio** is running with WebSocket server enabled before starting the bot.

---

## Running

```bash
node bot.js
```

The bot will:
1. Connect to OBS via WebSocket. It **will not** start chat or any other module until OBS is online.
2. Initialize Twitch OAuth tokens (app, bot, broadcaster) and fetch user IDs.
3. Authenticate with Pear Desktop Music (gracefully degrades if unavailable).
4. Connect to Twitch chat via `tmi.js`.
5. Start the Shield System (EventSub for stream online/offline).
6. Start the main EventSub hub (follows, raids, ad breaks, media request redemptions).
7. Reconcile any pending media redemptions from a previous crash/restart.
8. Apply each registered reward's declared startup state (rewards with `startClosed: true`, e.g. media requests, start paused and must be opened with `!openmr`).
9. Start the ad schedule poller, timed commands, chat commands, and ARG elements.

The bot tears down all modules and disconnects when OBS goes offline, then auto-reconnects to OBS every 20 seconds.

---

## Chat Commands

### General

| Command | Description |
|---|---|
| `!tail` / `!tails` | Bot shares a lore-flavored status message (15% chance of a rare "warm" response) |
| `!socials` | Displays YouTube, Instagram links |
| `!discord` | Displays Discord invite link |
| `!dev` | Displays itch.io demo link |
| `!raid` | In-character raid greeting |
| `!backseat` | Polite no-backseat/spoiler reminder |
| `!hug @user` | Send a themed hug to another viewer (special responses for Laya) |
| `fih` / `fish` / `feesh` | Fish acknowledgment |
| `!clip` | Creates a Twitch clip |
| `!followage` / `!followage @user` | Shows how long you (or someone) have been following |
| `!so @user1 [@user2 ...]` | Shoutout one or more users (also sends official Twitch `/shoutout`) |

### Song Requests

| Command | Description |
|---|---|
| `!sr <name or YouTube URL>` | Request a song (must be ≤10 min). Searches YouTube Music or accepts direct URLs. |
| `!song` / `!currentsong` | Show the currently playing song |
| `!queue` / `!q` | Show the queue (current + up to 5 upcoming) |
| `!skip` | Skip current song (mod only) |
| `!opensr` / `!startsr` | Open song requests (mod only) |
| `!closesr` / `!stopsr` | Close song requests and clear queue (mod only) |
| `!clearQ` | Clear the SSR queue (mod only) |

### Media Requests

| Command | Description |
|---|---|
| `!openmr` / `!startmr` | Open media request redemptions (mod only) |
| `!closemr` / `!stopmr` | Close media request redemptions (mod only) |

### Currency & ARG

| Command | Description |
|---|---|
| `!system` / `!sys` | Activate the AETHER-OS terminal |
| `!system help` | List available terminal commands |
| `!system dir <path>` | Navigate the virtual filesystem |
| `!system ls` | List current directory |
| `!system read <file>` | Read a lore file |
| `!system cwd` | Show current directory |
| `!system probe <port>` | Probe a port for lore/unlocks |
| `!system connect` | Daily check-in to earn Glossels |
| `!system ping` | Ping the system (+2% coherence) |
| `!system handshake <amount>` | Gamble Glossels by sending them into an unknown network node (weighted outcomes: 2x, push, lose, 3x, partial loss, or drain the Network Cache) |
| `!system handshake <amount> <user>` | Transfer Glossels directly to another viewer |
| `!system cache` | Check the current Network Cache balance |
| `!system balance` | Check your Glossels balance |
| `!system rank` | See your leaderboard rank |
| `!system top` | Top 5 Glossels leaderboard |
| `!sysAdmin grant probe <port>` | Admin: unlock a port (broadcaster only) |
| `!sysAdmin revoke probe <port>` | Admin: lock a port (broadcaster only) |
| `!sysAdmin bump coherence <n>` | Admin: add coherence (broadcaster only) |
| `!sysAdmin reduce coherence <n>` | Admin: remove coherence (broadcaster only) |
| `!sysAdmin grant glossels <n> <user>` | Admin: add Glossels to a user, or `SYSTEM` for all (broadcaster only) |
| `!sysAdmin revoke glossels <n> <user>` | Admin: remove Glossels from a user, or `SYSTEM` for all (broadcaster only) |
| `!sysAdmin grant cache <n>` | Admin: add Glossels to the Network Cache (broadcaster only) |
| `!sysAdmin revoke cache <n>` | Admin: remove Glossels from the Network Cache (broadcaster only) |

### Counters

Any counter defined in `data/counters.json` can be invoked by its command name. Subcommands: `+N`, `-N`, `=N` (set), `stats`, `last`. Mods can set or adjust by more than 1.

### Moderation (Mod Only)

| Command | Description |
|---|---|
| `!testfollow` | Simulate a follow event |
| `!testraid <name> [viewers]` | Simulate a raid event |
| `!testads [duration] [auto\|manual] [name]` | Simulate an ad break |

### Lurk

| Command | Description |
|---|---|
| `!lurk` | Enter lurk mode. Any subsequent message auto-unlurks with duration. Typing `!lurk` while lurking ends the lurk early. |

---

## Module Overview

### Configuration (`config.js`)
- Loads environment variables from `.env` via `dotenv`.
- Exports the `config` object with all settings and data file paths.

### Logger (`services/Logger.js`)
- Centralized logging: writes to both console and daily log files in `logs/`.
- `Logger.log()`, `Logger.error()`, `Logger.warn()` — all output goes to file + stdout.
- Optional Discord DM support (pass a Discord.js client to `Logger.init()`; gracefully skipped if none provided).
- Initialized once at bot startup before any modules load.

### Authentication (`auth.js`)
- Loads refresh tokens from `data/*.json`, fetches app/bot/broadcaster OAuth tokens.
- `withTokenRetry()` wrapper handles 401 → refresh → retry for any Twitch API call.
- Broadcaster token proactively refreshed every 3 hours.
- If chat login is rejected (stale bot OAuth), the bot refreshes the bot token and reconnects automatically instead of staying mute.
- `initPearToken()` authenticates with Pear Desktop Music (3s timeout, gracefully skipped if unavailable).

### EventSub (`modules/helpers/eventsub/`)
- **`core.js`**: WebSocket hub. Manages the EventSub session, subscription registry, and reconnection.
- **`handlers.js`**: Registers the EventSub handlers: `channel.follow`, `channel.raid`, `channel.ad_break.begin`, plus the generic channel point redemption `add`/`update` pair. Importing this file is sufficient to register all subscriptions.

### Shield System (`modules/helpers/shield_system.js`)
- Separate EventSub WebSocket connection for `stream.online` / `stream.offline`.
- Toggles Twitch Shield Mode via the Helix API.
- Broadcasts stream state via `stream-state.js` pub/sub (used by ad poller, timers, ARG, and the shield system itself).

### Media Requests Pipeline (`modules/media_requests/`)
 1. **`videoRedeemHandler.js`**: Self-registers the video reward with the redemption dispatcher. Feature logic only: validate URL → fetch metadata → download → delegate approval/playback to the dispatcher. New redemption rewards add a `registerReward()` call in their own module, no EventSub or pending-store code needed.
 2. **`metadataService.js`**: Extracts video metadata via `yt-dlp --dump-json`.
3. **`downloadService.js`**: Downloads video via `yt-dlp` to `MEDIA_QUEUE_DIR`.
4. **`obsController.js`**: Shows/hides the media source in OBS via WebSocket.
5. **`vlcController.js`**: Controls VLC playback via HTTP API (play, stop, status).
6. **`playbackManager.js`**: Coordinates OBS source visibility and VLC playback.
7. **`pendingStore.js`**: Atomic write (tmp + rename) persistence for in-flight redemptions. Survives crashes.
8. **`twitchRedemption.js`**: Central redemption dispatcher + Twitch API helpers. Routes redemption events to the registered reward module, manages the generic pending/approval lifecycle (reconciliation + expiry sweep), and can auto-fulfill instant rewards. Tracks each reward's open/closed state (paused/unpaused on Twitch) with `openReward`/`closeReward`/`isRewardOpen`, applied on startup from each reward's `startClosed` flag. Also provides redemption status update and reward pause/unpause API helpers.

### Song Requests (`modules/song_requests/`)
- **`pear-desktop-music.js`**: YouTube search via Data API, Pear Desktop Music API integration, SSR queue polling (checks every 5s if a queued song started playing).
- **`ssr-queue.js`**: In-memory queue persisted to `data/ssr_queue.json`.

### Personality (`modules/bot_specific/bot_response_modules.js`)
- Responds to greetings + daemon name mentions, threat words, lore character/place names, gratitude, and compliments. Rate-limited per module to prevent spam.

### Timers (`modules/helpers/timer.js`)
- Reads `data/timed_commands.json` for scheduled messages/functions. Each entry has a randomized offset, interval, optional condition, and type (`message` or `function`). Timers auto-pause on stream offline and resume on online.

---

## Project Structure

```
TwitchBot/
├── .env.example                    # Environment variable template
├── .env                            # Your secrets (gitignored)
├── .gitignore                      # Git ignore rules
├── bot.js                          # Entrypoint: startBot/stopBot orchestration
├── config.js                       # Configuration loader (reads .env)
├── auth.js                         # OAuth token management and refresh
├── obs_watcher.js                  # OBS WebSocket watcher: triggers startBot on OBS connect
├── services/
│   ├── index.js                    # Services barrel export
│   └── Logger.js                   # Centralized logging: console + daily log files
├── commands/
│   ├── chat_integration.js         # Message router, command matching, cooldown dispatch
│   └── registry.js                 # All command implementations and exports
├── modules/
│   ├── bot_specific/
│   │   └── bot_response_modules.js # Daemon personality: greetings, lore, threats, gratitude
│   ├── functions/
│   │   ├── clipping.js             # Twitch clip creation
│   │   ├── followage.js            # Follow age lookup
│   │   ├── currency/
│   │   │   ├── glossels.js          # Glossels virtual currency system
│   │   │   └── glosselsRedeemHandler.js # Points to Glossels instant reward (registers with dispatcher)
│   │   ├── lurk_tracker.js         # Lurk/unlurk tracking
│   │   ├── shoutout.js             # Single + mass shoutout + official Twitch /shoutout
│   │   └── testing_events.js       # Simulated follow/raid/ad events for testing
│   ├── helpers/
│   │   ├── ad_schedule_poller.js   # Adaptive ad schedule polling + chat warnings
│   │   ├── cooldown.js             # Per-user per-command cooldown system
│   │   ├── counters.js             # Configurable chat counters
│   │   ├── eventsub/
│   │   │   ├── core.js             # EventSub WebSocket hub + subscription registry
│   │   │   └── handlers.js         # Follow, raid, ad break + generic redemption subscriptions
│   │   ├── shield_system.js        # Shield Mode auto-toggle on stream online/offline
│   │   ├── stream-state.js         # Online/offline state pub/sub
│   │   ├── timer.js                # Timed/recurring chat messages
│   │   └── twitchRedemption.js     # Redemption dispatcher + Twitch channel point API helpers
│   ├── media_requests/
│   │   ├── downloadService.js      # yt-dlp video download
│   │   ├── metadataService.js      # yt-dlp metadata extraction + validation
│   │   ├── obsController.js        # OBS WebSocket source visibility control
│   │   ├── pendingStore.js         # Persistent pending redemptions (atomic writes)
│   │   ├── playbackManager.js      # Media playback orchestrator (OBS + VLC)
│   │   ├── videoRedeemHandler.js   # Video redemption reward module (registers with dispatcher)
│   │   └── vlcController.js        # VLC HTTP API controller
│   ├── moderation/
│   │   └── link_filter.js          # Link blocking + redeem URL validation
│   └── song_requests/
│       ├── pear-desktop-music.js   # Pear Desktop Music API + YouTube search + SSR polling
│       └── ssr-queue.js            # SSR queue persistence (JSON file)
├── ARG/
│   ├── _filesystem/                # Virtual in-chat filesystem (JSON lore files)
│   │   ├── boot/                   # Boot logs, readme, status, bitrot
│   │   ├── cache/                  # Data fragments
│   │   ├── daemon/                 # Process logs
│   │   ├── external/               # External character data
│   │   ├── hidden/                 # Secret files (locked behind coherence)
│   │   ├── logs/                   # Historical chatroom logs + secret logs
│   │   └── ports/                  # Port data files (lore unlocks)
│   ├── data/                       # ARG state: ports.json, found_ports.json, state.json
│   └── modules/
│       └── arg_main.js             # Core ARG logic: terminal, filesystem, probes, coherence, network gamble/transfer
├── data/                           # Runtime persistence (JSON)
│   ├── bot_refresh_token.json
│   ├── broadcaster_refresh_token.json
│   ├── counters.json
│   ├── user_data.json
│   ├── network_cache.json
│   ├── moderation.json
│   ├── pendingRedemptions.json
│   ├── ssr_queue.json
│   ├── state.json
│   └── timed_commands.json
├── logs/                           # Daily log files (auto-created by Logger)
├── package.json
└── package-lock.json
```

---

## Configuration

Secrets and environment-specific values are stored in `.env` (gitignored). See `.env.example` for all available options. The `data/` directory holds runtime state:

| File | Purpose |
|---|---|
| `data/bot_refresh_token.json` | Bot OAuth refresh token (auto-refreshed) |
| `data/broadcaster_refresh_token.json` | Broadcaster OAuth refresh token (auto-refreshed) |
| `data/user_data.json` | Cross-platform user dictionary (Twitch + Discord). Each entry: `usrName`, `usrId`, `amount`, `lastCheckin`, `discordUserId` (unknown fields are preserved across reloads) |
| `data/network_cache.json` | Network Cache: accumulated lost Glossels from failed handshakes, drainable via rare `drained` outcome |
| `data/counters.json` | Counter definitions and current values |
| `data/moderation.json` | Link filter config: allowed domains, trusted badges, warn cooldown |
| `data/ssr_queue.json` | Current song request queue |
| `data/pendingRedemptions.json` | In-flight media request redemptions (atomic writes, survives crashes) |
| `data/timed_commands.json` | Scheduled message/function definitions |
| `data/state.json` | General state |
| `ARG/data/state.json` | ARG coherence level and bit-rot state |
| `ARG/data/ports.json` | Port definitions (what each port number unlocks) |
| `ARG/data/found_ports.json` | Which ports have been discovered |

---

## Architecture Notes

- **OBS-gated startup**: The bot connects to OBS first and only starts all other modules once OBS is online. If OBS disconnects, everything tears down and the bot waits for OBS to reconnect (polls every 20s).
- **Dual EventSub connections**: The Shield System uses its own dedicated WebSocket for `stream.online`/`stream.offline`. The main EventSub hub (`core.js`) handles follow, raid, ad, and media request events. Both auto-reconnect.
- **Stream-state pub/sub**: A simple observer pattern (`onOnline`/`onOffline` in `stream-state.js`) decouples stream lifecycle from individual modules. The ad poller, timers, ARG, and shield system all subscribe to it.
- **Self-registering handlers**: EventSub handler modules (e.g. `videoRedeemHandler.js`) register at require-time. Redemption reward modules call `registerReward()` on the dispatcher in `twitchRedemption.js`; other subscription types are registered in `handlers.js`. Importing the file is enough to register, no explicit wiring needed.
- **Redemption dispatcher**: All channel point redemptions flow through a generic EventSub `add`/`update` pair in `handlers.js` into `twitchRedemption.js`, which routes to the module registered for each reward id. Rewards define an `onRedeem` plus optional `onResolve`/`onReject`/`onExpire`; if no `onResolve` is given the reward is fulfilled instantly. The dispatcher owns the pending store, startup reconciliation, the 5-minute expiry sweep for mod-approval rewards, and each reward's open/closed state (a reward's `startClosed` flag decides whether it begins paused on bot start, e.g. media requests).
- **Atomic persistence**: `pendingStore.js` writes to a `.tmp` file then renames, preventing corruption on crash. All other JSON files are read on demand and written after every mutation.
- **Cooldown system**: Per-user, per-command cooldowns (default 5s). Mods and broadcaster are exempt. `!system handshake` has a 30s cooldown.
- **Command matching**: Most commands use regex word-boundary matching (`hasCommand()`). Commands with arguments (`!sr`, `!followage`, `!so`, `!system`, `!sysAdmin`, `!hug`) use `startsWith` instead. `!sysAdmin` is checked before `!sys` to prevent prefix collision.
- **No build step**: Plain CommonJS Node.js. Run directly with `node bot.js`.

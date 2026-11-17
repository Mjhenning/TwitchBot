# Chat Commands Reference

All commands are case-insensitive. Cooldowns are per-user per-command (5 seconds, mods exempt). `!accept`, `!decline` and `!cancel` have no cooldown. Commands also fire inside Twitch replies, leading @mentions are ignored. `!sysAdmin` is broadcaster-only with an instant denial.

---

## Interaction Commands

| Command | Description |
|---|---|
| `!hug @user` | Send a themed hug to another viewer (special responses for Silver and Ace, family wording only from Fox or each other) |
| `!pat @user` / `!headpat @user` | Send a gentle pulse / headpat to another viewer (signal/perimeter theme) |
| `!poke @user` / `!boop @user` | Trigger a brief signal spike at another viewer |
| `!nom @user` | Send a small packet to another viewer (data/coherence theme) |
| `!armwrestle @user` | Challenge someone to an arm wrestle duel |
| `!rps @user` | Challenge someone to rock paper scissors |
| `!coinflip @user` | Challenge someone to a coin flip |
| `!accept` / `!decline` / `!cancel` | Answer a pending duel challenge / withdraw your own (silent when no duel is pending, no cooldown) |
| `!bin @user` | Throw someone in the recycling bin; they resurface "after a time" |
| `!bonk @user` | Bonk someone, static scatters |

> Special responses apply to targets Silver (tinysilverfoxx) and Ace (acewype) across `!hug`, `!pat`/`!headpat`, `!poke`/`!boop` and `!nom`. Family wording (sister, brother, family confirmed) only appears when Fox or the other sibling triggers the command. Pools live in `data/family.json` and load via `modules/helpers/family_responses.js`.
>
> Duels are requests: the named target answers with `!accept` (or `!decline`), and the challenger can `!cancel`. The winner is pure RNG, and `!rps`/`!coinflip` narration is always coherent (loser's throw loses, winner's call matches the flip). Requests expire silently after `DUEL_TTL_SECONDS` (default 60). `!bin` recovery fires after a hidden random delay (`BIN_RECOVERY_MIN_SECONDS` to `BIN_RECOVERY_MAX_SECONDS`, default 45–90s) and is never announced. State is in-memory only, so it resets on restart.

---

## Song Requests

| Command | Description |
|---|---|
| `!sr <name or YouTube URL>` | Request a song (must be ≤10 min). Searches YouTube Music, accepts direct YouTube URLs, or resolves a Spotify track link to a YouTube match. |
| `!song` / `!currentsong` | Show the currently playing song |
| `!queue` / `!q` | Show the queue (current + up to 5 upcoming) |
| `!skip` | Skip current song (mod only) |
| `!opensr` / `!startsr` | Open song requests (mod only) |
| `!closesr` / `!stopsr` | Close song requests and clear queue (mod only) |
| `!clearQ` | Clear the SSR queue (mod only) |

---

## Media Requests

| Command | Description |
|---|---|
| `!openmr` / `!startmr` | Open media request redemptions (mod only) |
| `!closemr` / `!stopmr` | Close media request redemptions (mod only) |

---

## ARG / System Terminal

| Command | Description |
|---|---|
| `!system` | Initialise the ARG terminal |
| `!system help` | Show available subcommands |
| `!system ls` | List directory contents |
| `!system cwd` | Show current working directory |
| `!system dir <path>` | Navigate the virtual filesystem |
| `!system read <path>` | Read a file |
| `!system probe` | Probe a network node |
| `!system connect` | Daily check-in for Glossels |
| `!system ping <target>` | Ping a node |
| `!system cache` | View the Network Cache |
| `!system balance` | Check your Glossel balance |
| `!system rank` | Check your rank |
| `!system top` | Show the top 10 Glossels holders |
| `!system handshake <amount>` | Gamble Glossels on a MOTHER SEQUENCE roll |
| `!sysAdmin grant probe <port>` | Admin: grant probe access |
| `!sysAdmin revoke probe <port>` | Admin: revoke probe access |
| `!sysAdmin bump coherence <amount>` | Admin: increase coherence |
| `!sysAdmin reduce coherence <amount>` | Admin: decrease coherence |
| `!sysAdmin grant glossels <amount> <user>` | Admin: grant Glossels |
| `!sysAdmin revoke glossels <amount> <user>` | Admin: revoke Glossels |
| `!sysAdmin grant cache <amount>` | Admin: grant cache |
| `!sysAdmin revoke cache <amount>` | Admin: revoke cache |

---

## Social & Fun

| Command | Description |
|---|---|
| `!so @user1 [@user2 ...]` | Shoutout one or more users (mod only, also sends official Twitch `/shoutout`) |
| `!socials` | Show social links |
| `!discord` | Discord link |
| `!watchtime` | Show your watchtime with a themed message |
| `!followage` | Show how long you've been following |
| `!lurk` | Enter lurk mode (any message auto-unlurks) |
| `!unlurk` | Not a command; users auto-unlurk on their next message |
| `!clip` | Create a clip |
| `!backseat` | Backseat mode |
| `!tail` / `!tails` | Tail responses |
| `!dev` | Developer info |
| `!goals` | Show Glosso-thon goals (mod can `!goals pin` to pin overlay) |
| `!raid` | Raid info |
| `!thon` | Toggle thon system |
| `!timer` | Toggle timer (mod only) |
| `!timer add [minutes]` | Add minutes to the timer (mod only) |
| `!timer set [minutes]` | Set timer to a specific duration in minutes (mod only) |
| `!timer pin` | Pin/unpin the timer overlay (mod only) |

---

## Test Commands (mod only)

| Command | Description |
|---|---|
| `!testfollow` | Test follow event |
| `!testgift` | Test gifted sub |
| `!testraid` | Test raid event |
| `!testads` | Test ad break |
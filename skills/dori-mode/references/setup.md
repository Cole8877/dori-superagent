# Setup

Run these once, in order. Stop and ask the owner wherever a step needs their choice or their hand.

## 1. herdr

herdr is the terminal multiplexer the Dori runs in. Every lane is a herdr tab, and herdr lets you read a pane, type into it and see which process runs there.

```sh
curl -fsSL https://herdr.dev/install.sh | sh
herdr integration install pi        # omo; for omp lanes: herdr integration install omp
herdr --skill                       # load its skill unless it is already in your context
```

### Running lanes on omp

Set `"agent": "omp"` in `~/.dori/config.json`. Lanes then start as `omp --model {model} --goal {prompt}`, and session ids are read from `~/.omp/agent/sessions`. omp needs two things omo has built in:

- `herdr integration install omp`, so herdr reports the lane's agent state. Without it an omp lane reads as a plain shell and is never treated as busy.
- The [omp-ulw](https://github.com/dbc-hbin/omp-ulw) extension (`ln -s <checkout> ~/.omp/agent/extensions/omp-ulw`), so the `ulw` launch keyword arms ultrawork. `--goal` opens the native goal that `dori pause` / `dori resume` act on; omp does not make one from a positional prompt.

## 2. Messenger

Install agent-messenger (github.com/agent-messenger/agent-messenger) and read which platforms it supports. Ask the owner which one to use and wait for the answer.

agent-messenger wraps part of each platform. Read the platform's current bot API changelog and call the API directly for the rest:

- Telegram: stream a reply as it grows and show "Thinking…" with message drafts, send rich messages for tables and headings, and use topics in the private chat (turn on threaded mode in BotFather's mini app; there is no API for that switch).
- Discord: edit your own messages to grow them, and use threads.

### If the owner picks Slack: user token or bot token

Ask which mode, give the trade-off as a short list, and wait for the choice:

- **User token**: the Dori acts as a real member of the workspace.
  - It needs a paid seat, which the owner pays for.
  - It reads everything that member can see.
  - It can keep a green online dot (`dori presence slack`).
- **Bot token**: the Dori is a Slack app.
  - There's no seat cost.
  - It only sees channels it is invited to, within the scopes the app was granted.
  - It shows as an app, not a person.

Record the choice. With a user token, set `DORI_SLACK_TOKEN` and `DORI_SLACK_COOKIE` (the `d` cookie from that member's browser session). With a bot token, set `DORI_SLACK_TOKEN` to the `xoxb-` token.

## 3. Bot

Finish every login in the browser. Create the bot with agent-messenger and finish its setup. Then give it its avatar: the default is `assets/dori-avatar.png` in this skill, and the owner can swap in any image.

- **Telegram**: @BotFather → `/setuserpic` → pick the bot → send the image.
- **Discord**: Developer Portal → your application → **General Information** → App Icon, and **Bot** → Icon.
- **Slack**:
  - bot token: the app's **Basic Information** → Display Information → App icon;
  - user token: the member's profile photo (`users.setPhoto`, or the profile page).

Greet the owner through the bot before doing anything else.

## 4. Scripts

```sh
cd skills/dori-mode/scripts && bun install && bun link    # puts `dori` on PATH
mkdir -p ~/.dori && cp ../references/config.example.json ~/.dori/config.json
```

Then edit `~/.dori/config.json`: at least `leadPane` (your own herdr pane, from `herdr pane current`), `laneWorkspace`, `defaultCwd`, and the two hooks if you want lane threads updated automatically. `references/scripts.md` explains every field.

## 5. Monitors

Arm these as persistent monitors in your own session:

| Monitor | Command | Filter |
|---|---|---|
| inbound messages | your messenger's watch command | new owner messages |
| done flow | `dori watch` | `^LANE_` |
| dead panes | `dori dead-panes --loop 3` | `^(DEAD_PANE\|UNRECOGNISED_PANE)` |
| host guard | `dori guard --loop 1` | `^HOST_GUARD` |
| freshness | `dori freshness --loop 5` | `^(NUDGED\|POSTED\|NO-REPORT\|PENDING-REPORT\|STALE-REPORT)` |
| Slack inbound (Slack only) | `dori inbound slack --loop 1` | `^INBOUND` |
| presence (optional) | `dori presence slack` or `dori presence discord` | `^PRESENCE_READY` |

## 6. First look around

Once the bot is live, explore the machine: running coding-agent sessions, the tools in use, recent logs. Write what you find into memory, and adopt any running lanes with `dori adopt`.

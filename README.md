# TallyConnect

ATEM tally light for ProPresenter Stage Display and web overlays. Connects to a
Blackmagic ATEM switcher, watches a configured input, and broadcasts its
program/preview state over a local web server (WebSocket) and an Electron
overlay window.

## Development

Requires Node.js 20+.

```bash
npm install        # install dependencies
npm run dev        # compile + launch the Electron app
npm run compile    # compile TypeScript to dist/
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm test           # vitest unit tests
npm run build      # compile + package distributables (electron-builder)
```

## Developing without an ATEM mixer

You don't need real hardware — a built-in **Node ATEM simulator** emulates an ATEM
switcher over UDP/9910, speaking the exact protocol `atem-connection` expects.

**Option A — one command:**

```bash
npm run mock                       # starts the simulator on udp://0.0.0.0:9910
ATEM_IP=127.0.0.1 npm run dev      # point TallyConnect at the simulator
```

The simulator also exposes an HTTP control so you can flip Program/Preview
without a real switcher:

```bash
curl 'http://localhost:9932/set?program=2&preview=3'
```

**Option B — Docker:**

```bash
docker compose up                 # atem-sim on udp 127.0.0.1:9910 (+ http :9932)
ATEM_IP=127.0.0.1 npm run dev
```

Then put your configured input on Program/Preview (via the HTTP control above, or
the official **ATEM Software Control** app pointed at `127.0.0.1`) and watch the
tally update in TallyConnect (and at `http://localhost:8090/tally.html`).

> **Note:** `npm run mock:pyatem` still exists, but `pyAtemSim` uses an older ATEM
> header format that `atem-connection` does not understand, so it will **not**
> connect to this app. Use the Node simulator above instead.

Environment overrides (handy for dev):

| Variable           | Default            | Purpose                  |
| ------------------ | ------------------ | ------------------------ |
| `ATEM_IP`          | `192.168.10.240`   | ATEM IP to connect to    |
| `ATEM_INPUT`       | `1`                | Tally input number       |
| `ATEM_DISPLAY_ID`  | _(unset)_          | Overlay display id       |
| `WEB_PORT`         | `8090`             | Web tally server port    |

Simulator overrides:

| Variable             | Default      | Purpose                          |
| -------------------- | ------------ | -------------------------------- |
| `ATEM_MOCK_PORT`     | `9910`       | UDP port the simulator listens on |
| `ATEM_MOCK_ADDRESS`  | `0.0.0.0`    | Bind address                     |
| `ATEM_MOCK_HTTP_PORT`| `9932`       | HTTP control port                |
| `ATEM_MOCK_PROGRAM`  | `1`          | Initial Program input            |
| `ATEM_MOCK_PREVIEW`  | `0`          | Initial Preview input            |

## Web Tally (iframe)

In addition to the full-screen Electron overlay, TallyConnect serves the same
tally page over its local web server, so you can embed a **tally box in any
iframe** (ProPresenter Stage Display, OBS Browser Source, a web page, etc.).

The server binds to all interfaces and sets no `X-Frame-Options` / CSP headers,
so it can be embedded cross-origin and reached from other devices on your LAN
(use the machine's LAN IP instead of `localhost`). Note the port is exposed on
the LAN; only the app's own Settings window can change settings (a browser hitting
`/settings.html` has no Electron preload and cannot drive IPC).

The page is `tally.html`; the style is controlled by query parameters:

| URL (append to `http://<host>:<port>/tally.html`) | Result                                              |
| ------------------------------------------------- | --------------------------------------------------- |
| `?style=box&showLabel=true`                       | **Filled box** — solid red (Program) / green (Preview) fill; off-air is a dim translucent fill |
| `?style=border&showLabel=true`                    | **Framed box** — colored edge frame only, transparent center (click-through) |
| `?style=both&showLabel=true`                      | Frame **and** fill                                  |
| _(no params)_                                     | Defaults to `style=border`, `width=14`              |

Parameters:

- `style` — `box` | `border` | `both` (default `border`)
- `width` — frame thickness in px (default `14`)
- `showLabel` — `true` to show the centered `LIVE` / `PREVIEW` / `OFF-AIR` label

Example iframe:

```html
<iframe src="http://localhost:8090/tally.html?style=box&showLabel=true"
        style="width:200px;height:120px;border:0"></iframe>
```

The page opens a WebSocket to the same host and updates live as the configured
input changes program/preview state.

## Testing

- `npm test` runs vitest unit tests (tally logic + `AtemTallyClient` with a fake
  ATEM) — fast, no hardware.
- `RUN_ATEM_INTEGRATION=1 npm test` additionally spins up the Node ATEM simulator
  and asserts the real `atem-connection` handshake + tally state works. This job
  also runs (non-blocking) in CI.

## Architecture

- `src/main/main.ts` — Electron main process: ATEM connection, Express web
  server, WebSocket broadcast, overlay window.
- `src/main/tally.ts` — pure tally-state computation (unit tested).
- `src/shared/types.ts` — shared types and IPC channel constants.
- `src/web/public/tally.html` — web tally client (WebSocket). Same page is used
  by the overlay window **and** by iframe embeds (style via query params).

## Releasing

Releases are automated with semantic versioning:

1. Go to **Actions → Release** and run the workflow.
2. Pick a bump — `patch`, `minor`, or `major`.
3. The workflow bumps `package.json`, commits it, tags the repo (`vX.Y.Z`), and
   creates a GitHub release (release notes are generated from commits).
4. A matrix build then produces distributables for **macOS** (`.dmg` + `.zip`,
   arm64), **Windows** (`.exe`/NSIS installer), and **Linux** (`.AppImage` +
   `.deb`), and uploads them to that release.

Notes:

- Builds are **unsigned** (no Apple Developer ID / Authenticode cert), so macOS
  will show a Gatekeeper warning and Windows a SmartScreen warning on install.
  Right-click → Open (macOS), or `xattr -d com.apple.quaternion …` if needed.
- The macOS build targets Apple-Silicon runners (arm64). Add a second macOS arch
  (or `--universal`) if you need Intel-Mac builds.
- The app icon is the default Electron icon; drop `build/icon.png` to brand it.
- CI (`.github/workflows/ci.yml`) lints, typechecks, runs unit tests, and runs
  the opt-in ATEM integration test — but does **not** build release artifacts.

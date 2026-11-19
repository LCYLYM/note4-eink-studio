# NOTE4 Web

No fake service or localStorage database. Serve through `../server` Wrangler assets and the real `/api` endpoints. Uses native ES modules with no web build dependency. The light two-pane desktop / switchable mobile layout is retained from `../../prototype/index.html`; that reference is unchanged.

- Work creation and manual editing remain available without an AI key. Model state is explicit; real model tasks are polled and cancellable.
- Edit creates server-side revisions; restoration creates another revision. Card images are normalized to PNG within 400×300; server compiles the authoritative packed page (60,000 bytes, left pixel high nibble), and preview displays those exact bytes.
- `core.js` implements ABI 1 at fixed 50 ms ticks, matching the actual C++ `firmware/main/core.hpp`; `preview.js` uses this core, not a test replacement. Runner canvas quantizes all output to four grays. Preview pauses when tab is hidden; no idle animation loop.
- Three keys, gesture events and NFC entry are explicitly simulated in browser. Long down stops browser preview only. Device stop is a real command with receipt state, not an optimistic claim of stop.
- Device list labels SIMULATED sessions, last report and offline uncertainty. Installation continues independently of the modal or page. Export/import use real ZIP APIs.
- Authentication token stays in JS memory only. No credential goes into exported work. No external fonts/CDNs/assets.

`app.js`: UI + API adapter; `core.js`: deterministic integer runner; `preview.js`: native canvas and pixel packing; `style.css`/`index.html`: retained responsive shell.

Verification: node syntax checks; real C++ 11-input state vectors matched all JS state fields. Browser smoke evidence is under `../tools` / reports. Hardware refresh, phone keyboard/safe-area behavior and physical inputs remain HARDWARE_UNVERIFIED.

Character addition: editor supports original 16×24 fox / penguin pixel art. `../shared/characters.json` is the common palette/sprite source; `../shared/characters.hpp` and `characters.js` consume the identical 0-transparent, 1-black, 2-dark, 3-light, 4-white data. Only rendering changes; physics ABI remains unchanged. `../tools/verify-character.cjs` verified real form selection, persistence, and preview; screenshot `web-penguin.png`.

## v1.1 device flow

The existing work editor/layout is unchanged. Device details now separate a completed game, stopped load, and OTA phases. `operation-state.js` labels only `confirmed` as a confirmed new version; download, verified, rebooting and ready remain pending. Cancellation is a request until the actual device receipt, with late cancellation rejected by the backend. Failed/cancelled upgrades show the actual receipt detail rather than inventing an old-version retention claim.

The explicit “升级底座” flow shows reported model/version/layout/ABI and compatible release targets before the user starts. It uses `/api/releases`, `/api/devices/:id/ota`, `/api/operations/:command_id/cancel`. The phone setup help describes first-use AP, UP long-press 2 seconds, screen credentials and short binding code; identity/server provisioning is a one-time maintainer action, not recurring end-user USB work.

Verification for v1.1: `../tools/web-v11-smoke.json` records actual API device claim + browser OTA click/cancel with the built 1.1.0 application image. The device is explicitly SIMULATED, using a prior 1.0.0 version on the new dual-slot layout (not the historical factory layout). The UI distinguished a cancel request from the later cancelled receipt, and 390px dialog/document widths remained 390px. Existing create/edit/revision/card-build browser smoke passed. Physical reboot/rollback, actual AP provisioning and phone hardware remain HARDWARE_UNVERIFIED.

# v1.1.3 current status

The current fixes, build profiles and observed hardware results are in [the USB acceptance report](../docs/v1.1.3-交付.md). USB lab is installed on the device; production was compiled only. The operational notes below describe the production profile.

# NOTE4 firmware 1.1.0 — ESP32-S3 / ESP-IDF 5.5.2

**HARDWARE_UNVERIFIED. No device was flashed.** This is a fresh build, not the baseline v1.0 binary. Review original flash layout and recoverable backups before local initial installation. `OTA.md` and the two distinct artifact manifests are authoritative for addresses and upgrade boundaries.

## Build
Install official ESP-IDF tag `v5.5.2`, target `esp32s3`. All task dependencies/cache are local, not global skills.
```sh
export IDF_TOOLS_PATH=/tmp/note4-sdk/tools # replace with your tools directory
export XDG_CACHE_HOME="$PWD/.build-cache"
. /tmp/note4-sdk/esp-idf/export.sh
python tools/generate_protocol.py
idf.py build
python tools/package_release.py --build build --out artifacts --url https://YOUR_SERVICE/api/releases/note4-1.1.0/artifact
```
A clean checkout must `idf.py set-target esp32s3` before building if its config is absent. Use actual published same-origin HTTPS URL only when authorized; shipped URL is explicitly UNDEPLOYED. Source ZIPs may have future mtimes; normalize only working-copy mtimes if Ninja repeatedly reconfigures.

## F1/F2/F3 fixes
- `main/protocol.hpp` is generated from `../shared/protocol.json`. Production receipt enqueue and direct OTA acknowledgements use it. `created` is accepted end-to-end; `completed` is an explicit observed runtime state. The host `tests/protocol_dump.cpp` consumes the actual production header.
- Receipt spool: two bounded 64 KiB files, at most eight sends per pass; malformed/non-retryable 4xx (except 408/429) go to bounded 8 KiB diagnostics, and later valid messages continue. Network failures/5xx/408/429 retry with backoff. Overflow counts are exposed, not silently called delivered. OTA acknowledgements require HTTP success **and** `accepted:true, late:false`.
- Official `components/zectrix_epd` is unchanged. `power_guard.cpp` wraps only GPIO6 set/hold at the linker boundary. STOP atomically releases hold, drives low, re-holds low, and rejects subsequent high writes by an already-running official driver. Stale display authorization is refused. Custom entry/exit explicitly transfers hold ownership. Readback and blocked-write counts are observable; software values are not a voltage measurement.

## Independent STOP and resource policy
- **Hold DOWN 800 ms**: stop work, mute PA/capture, cut/lock panel power, cancel work/OTA downloads, clear residual input/local-retry eligibility. CPU, GPIO17 system latch, USB and lightweight Wi-Fi remain alive. No deep sleep or USB shutdown. OK long also stops; **UP long 2 s** is Wi-Fi setup. Short events are released after 30 ms debounce, mutually exclusive with long events.
- Stop generation cancels in-flight downloads; pending ID and stop latch/cutoff persist. Commands created before local STOP are refused, including previously unseen queued commands. If device clock was unset, it fails closed until verified gateway hello supplies server time; a later explicit command is required. New commands cannot silently resurrect an interrupted old ID. Reboot never auto-runs runner, or a stopped card.
- Game physics stays deterministic at 50 ms. Drawing skips while display has no budget; planner sleeps on notifications when no frame/pulses remain. There is no optical FPS claim. Static pages refresh only when changed. Game-over accepts the selected retry source: physical short press, wave, or both. Selected gesture retry retains capture until the bounded lease; STOP cannot be undone by either source.
- Acoustic capture is enabled only for running works configured with wave, not static/button-only/stopped/OTA; completed rounds retain capture only when gesture retry is selected. Temperature sampled 1 Hz; >=50°C derates draw submission and disables audio, <=47°C restores eligible load, >=55°C or sensor failure stops high load. These are provisional MCU-temperature policies, not panel-temperature or safety measurements.
- Idle polling nominal 15 s, active/pending 2 s, failures/reconnect exponential to 60 s; HTTP keepalive avoids intentionally reopening TLS each request. Telemetry sampled 1 Hz, reported about 30 s/state changes: temperature/derating, heap/min heap, reporting-task stack margin, display drops, receipt drops, panel readback, stop cause. STOP responsiveness does not wait for this cadence.

## First installation and per-device identity (maintainer only)
No production credentials are generated or supplied in this handoff. Initial stock devices still require audited local installation/preconfiguration; OTA cannot retrofit the v1.0 factory partition table.

Preferred independent enrollment:
1. Maintainer uses service `POST /api/enrollments` for one `device_id` and independently generated short-lived >=24-character code.
2. During audited device preparation, USB JSON:
```json
{"op":"enroll","base_url":"https://YOUR_SERVICE","device_id":"YOUR_DEVICE_ID","enrollment_code":"ONE_DEVICE_SHORT_LIVED_CODE"}
```
3. Device generates its own 64-hex token once and commits it before registration; restart, connect Wi-Fi, then verified TLS `/api/device/register` retries idempotently with that token. Successful registration erases enrollment code. Do not repeatedly issue enroll for a registered device. Explicit maintenance reprovisioning is separate.

Legacy explicit per-device provision remains available (`op:provision`, SSID/password/base_url/device_token/device_id), never a shared fleet token. NVS is not encrypted by default: production physical-security provisioning requires a separately audited secure-boot/flash-encryption plan; no eFuse changes are made here.

## Recipient phone flow — no routine USB
A prepared device with no Wi-Fi enters WPA2 setup automatically. At any later time hold **UP 2 seconds**. The 400×300 screen displays AP name, a fresh random 16-character password, and **http://192.168.4.1**. Connect the phone to that AP and open the address manually if no automatic portal opens. The real AP-only form changes Wi-Fi SSID/password, not identity/service secrets. Nonce-protected submission; AP expires after five minutes, or one minute after save. After gateway registration/hello, the screen shows the short-lived one-use pairing code for the existing phone web binding page. Actual iOS/Android/NFC behavior remains unverified. Captive DNS/automatic portal launch is not assumed.

USB equivalents: `{"op":"wifi_setup"}`, `{"op":"wifi_setup_stop"}`. USB debug `{"op":"status"}` exposes actual runtime telemetry; `{"op":"stop"}` is always global emergency stop. `{"op":"run","command_id":"new-id","build_id":"active-build","run_id":"new-run"}` explicitly restarts an installed work.

NFC commissioning only: `{"op":"nfc_url","url":"https://YOUR_PUBLIC_WEB/device/ID"}` first preserves all 880 bytes under `/data/nfc-backup.bin`; `{"op":"nfc_restore"}` restores. No URL write on boot, no secret in tag. Shared I²C lock and NFC/codec power coordination remain intact.

## Work install vs system OTA
ND4A works remain data in alternating SPIFFS files, checked before NVS active-pointer commit. Old valid work remains until staged validation; activation failure resumes old state only if no intervening STOP. HTTPS chunks check cancellation (2 s transport timeout). System OTA is separate, uses inactive app slot, rejects incompatible model/layout/ABI/non-newer version/size/hash and never writes works/NVS/bootloader/partition table. OTA and high-load work are mutually exclusive; new image must report ready to the actual gateway before confirmation. See `OTA.md`.

`works-initial-only.bin` is a blank initial filesystem. Writing it destroys existing works/NFC backup. It is **never** an ordinary OTA payload. Mount failure does not auto-format.

## Minimal local hardware acceptance
Audit original partition/whole-flash/NVS/works recovery first. Then short white/static refresh, static→native4→static hold readback, DOWN during each official phase, buttons, phone AP/code binding, NFC backup/tap/restore, buttons-only short runner then acoustics, STOP during download/OTA/offline and USB after STOP, invalid package/storage exhaustion, compatible OTA success→ready→confirmed, cancelled/invalid image, unconfirmed reboot rollback, and finally bounded joint thermal/load runs. See the current report for the completed USB subset. Wi-Fi, actual system OTA/rollback and the remaining peripheral acceptance are still unverified; host simulations do not prove chip execution or optical quality.

# NOTE4 v1.1 system OTA (not work installation)

Current version: **1.1.3**. USB application flashing, display and physical STOP are verified on the NOTE4. Real Wi-Fi system OTA confirmation and rollback remain **HARDWARE_UNVERIFIED**; no firmware was published to production.

## Layout and release

16 MiB flash: NVS 0x9000/0x5000, PHY 0xe000/0x1000, otadata 0xf000/0x2000; ota_0 0x20000/0x300000; ota_1 0x320000/0x300000; works 0x620000/0x9e0000. App slots have >1.5 MiB spare at current size. Works ends exactly at 0x1000000. **This does not migrate a v1.0 factory partition table.** First install requires a local partition/backup/recovery audit; ordinary OTA never rewrites bootloader, partitions, NVS, or works.

Command `op:"ota"` carries `release:{release_id,version,model:"NOTE4-ESP32-S3",layout:"note4-16m-ota-v1",abi:1,url,byte_length,sha256}`. `url` is same-origin HTTPS with device Bearer, no redirects. Image is streamed to the inactive slot with ESP-IDF esp_https_ota; image descriptor project/version, chip compatibility (IDF), exact byte size and SHA-256 of received app bytes are checked. Only strictly newer numeric major.minor.patch releases are accepted. Authentication relies on configured trusted HTTPS gateway/authorized release; offline image signing/secure-boot provisioning are not silently claimed.

Generate manifests from **this build**, not historical binaries:

```
python tools/package_release.py --build build --out artifacts --url https://YOUR-DEPLOYED-ORIGIN/api/device/firmware/RELEASE.bin
```

`initial-install-manifest.json` lists separate initial files/addresses; `ota-release.json` refers only to the application. `works-initial-only.bin` must NEVER be sent as an ordinary OTA update. No automatic flash command is supplied. The release generator validates real app header/chip/project and computes the required app integrity digest once; this is not a general hash audit.

## Lifecycle / integration

Before `ota_execute(command,release_json,cancelled)` parent quiesces display/audio/work. It uses only bounded streaming buffers; local STOP cancellation is checked between IO/chunks; network timeouts are 5 seconds. `/api/device/ota-status?command_id=...` is queried at most every two seconds during download for user cancellation. Cancel/failure before finish aborts inactive write with current boot unchanged. The tiny post-finish/pre-restart local cancel window explicitly restores the old boot partition. No forced power-off is used.

Pending command/version is persisted before selecting the new boot image. The gateway must acknowledge the rebooting/commit phase before IDF finish selects the new slot; if acknowledgement is unavailable, download is aborted with old boot unchanged. `rebooting` is not completion. On next boot `ota_boot_begin()` checks pending state/layout/metadata; `ota_boot_poll(hello_accepted)` reports `ready` only after the live five-manager/storage/temperature readiness check and gateway hello acceptance. Actual `ready` HTTP 200 precedes `esp_ota_mark_app_valid_cancel_rollback()`, then `confirmed`. If the new version cannot establish that checkpoint within 120 seconds it invokes IDF rollback; old firmware later reports `rolled_back`. If no valid rollback image is available it stays in a management-only pending/failure hold, not fake success. Rollback-required metadata missing or local self-check failure is also rejected.

NVS pending metadata remains until a terminal postboot acknowledgement; reboot after mark-valid but before confirmed acknowledgement retries confirmed rather than downgrading. Current flash/NVS power-loss durability, bootloader rollback and GPIO behavior still require hardware verification.

## Local acceptance (short controlled runs)

1. Audit/backup original layout; install both bootloader/partition OTA layout through an explicit local maintenance process, preserving/migrating original data deliberately.
2. Establish known-good ota_0 and local STOP/USB. Build a real newer version for ota_1; verify actual ready→confirmed and retained credentials/works/NFC backup.
3. Reject same/older version, wrong model/layout/ABI, oversized/truncated/digest-mismatched image; old boot must remain selected.
4. Cancel during download and before finish; disconnect network; USB/physical STOP stays responsive and existing app remains bootable.
5. Trigger new-image self-check failure/no ready acknowledgement; verify rollback and truthful rolled_back. Power-cut cases and real flash durability remain hardware tests, never simulator proof.

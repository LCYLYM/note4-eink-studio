# Device protocol 1.1

`../shared/protocol.json` is the single wire-state list. `tools/generate_protocol.py` creates `main/protocol.hpp`; production receipt enqueue/acknowledgements validate it and `runtime_snapshot` uses the generated running/stopped/completed names. `tests/protocol_dump.cpp` can be host-compiled to exercise that same contract.

## Transport
Verified HTTPS, per-device Bearer, exact configured origin for artifact downloads, no automatic redirects. Device-local templates do not depend on phone foreground or socket heartbeat. HTTP keepalive, default idle15s/pending2s polls, network/reconnect backoff up to60s. Hello includes new random boot_id, connection_epoch, capabilities/readiness, `firmware` OTA identity, actual `observed` state, and bounded telemetry in readiness. `/api/device/hello` returns `server_time_ms` for fail-closed STOP cutoff when the device clock was unset, plus one-use short pairing code when unbound.

GET `/api/device/next?boot_id=...&connection_epoch=...` returns `{poll_after_ms,command}`. Work command fields: command_id/build_id/run_id/op(install/run/stop),scope,artifact_url,byte_length,created_at. STOP scopes audio/app/device-run remain separate. Local emergency STOP rejects install/run/OTA commands whose creation time is no later than the persisted STOP cutoff; an interrupted pending ID also cannot resume. After explicit new command, local high-load policy still applies.

POST `/api/device/receipts`: original command/build/run plus boot/epoch/state/detail. Work producer sends actual sequence **created→downloading→verified→staged→activating→running**, with failure/cancel/stop/completed/duplicate branches. Offline spool is bounded; bad nonretryable4xx are quarantined, not permanently placed at the head. Consumer must retain late history without state regression. OTA direct ack requires **accepted:true and late:false**; mere200 never confirms readiness.

Runtime `completed` means a finished game, not lost device connection. Current state/last-known state differ; offline is never proof it is still running. A fresh local OK retry generates local-run identity and reports observation, not a fabricated cloud command.

## System OTA
Command `op:"ota"`, normal command/run IDs, build_id:null, `release:{release_id,version,model:"NOTE4-ESP32-S3",layout:"note4-16m-ota-v1",abi:1,url,byte_length,sha256}`. See `OTA.md` for slots and checks. User cancellation is polled through `/api/device/ota-status?command_id=...`; local STOP independently cancels even offline. Newboot selfcheck→gateway-acknowledged ready→IDF valid→confirmed. Only the actually restored old firmware reports rolled_back. Initial artifacts and app-only OTA manifest are distinct.

## Work ND4A ABI1 (unchanged)
Header12 bytes: ASCII ND4A, uint32LE manifest length, uint32LE payload length. Manifest<=8192bytes, payload<=480000bytes; exact download<=500000bytes. Card1..8 consecutive400×3004bpp pages60000bytes each, high nibble left,0black15white. Runner payload empty. No arbitrary code or scripts.

Fields: abi1,template runner/card,build_id,character fox/penguin,seed,speed,jump,gravity,obstacle_every,lease_ms,pages,inputs.jump. Defaults speed8/jump18/gravity3/obstacle400; bounds1..16/6..30/1..8/160..800; lease1000..180000ms. Integer50ms core and xorshift32 unchanged. Input mapping gates jump and acoustic capture; STOP cannot be remapped. UI sprites share `../shared/characters.json/.hpp` with web. No separate artwork/template hashes added; OTA SHA256 is required image-integrity validation, not an unrelated audit.

## Enrollment and phone setup
Maintainer prepares unique short-lived enrollment per physical device; USB enroll stores service/id/code and generates private device token locally before TLS registration. `/api/device/register` retries same token idempotently, success clears code. Stock recipient uses automatic-first or UP-long WPA2 AP with screen-displayed password/address, then screen short pairing code. The AP changes only Wi-Fi. Neither AP page nor NFC contains device credentials. No production enrollment/keys are shipped.

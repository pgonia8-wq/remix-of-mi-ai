# PC Node client rules

- Protocol must stay byte-compatible with `pc-node/protocol.mjs` (ECDH P-256, HKDF "miai-node-v1", AES-256-GCM, AAD `req|device|ctr` / `res|device|ctr`). Why: phone and PC are released separately.
- Pairing requires the 6-digit code AND the fingerprint shown on the PC; the node must return its own HMAC proof. Why: sharing a Wi-Fi network is not proof of ownership.
- The device private key is stored only via `repo.sealSecret` (Keystore vault); the counter is persisted before each request. Why: no plaintext keys, no counter reuse after a crash.
- Storage writes carry the base hash; conflicts are surfaced, never overwritten; offline listings come from local metadata marked `unavailable`. Why: older copies must never replace newer ones.
- Tunnels: every kind binds to localhost or the paired phone's IP only, uses explicit destination allowlists/subnets (never 0.0.0.0/0), a TTL and a log; native kinds (SSH, VPN) need an Android confirmation and never reopen by themselves after restart; SOCKS/VPN session secrets stay in memory. Why: no open proxy or silent network access.
- `scripts/native/MiaiVpnService.java` frame format must match `pc-node/relay.mjs` (u32 length, AES-256-GCM, nonce = direction u32 + counter u64). Why: both ends are released separately.
- On Android, LAN HTTP uses CapacitorHttp (`nativeTransportIfAvailable`); the WebView blocks http from the https origin. Why: mixed-content rules.

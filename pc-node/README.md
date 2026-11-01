# MI AI PC Node

Lets an authorized computer lend CPU, RAM, disk, compilers and toolchains to MI AI over your local Wi-Fi. No Internet or cloud account is needed.

## Install and run
1. Install Node.js 20 or newer on the PC (Windows, Linux or macOS).
2. Copy `miai-node.mjs` and `protocol.mjs` into one folder.
3. Run: `node miai-node.mjs --share "C:\MI-AI"` (repeat `--share` for more folders). Only those folders are ever used.
4. The console shows the address, a 6-digit code (valid 10 minutes), the fingerprint and the QR content. Type `codigo` + Enter for a new code.
5. In MI AI → Herramientas → Sistema autónomo → PC Node, paste the QR content (or type address, code and fingerprint) and press Emparejar.

Optional flags: `--port 47820`, `--allow-target 127.0.0.1:5173` (services the phone may reach through a dev tunnel or SOCKS5), `--vpn-subnet 192.168.1.0/24` (private networks the phone may reach through the split VPN or SOCKS5; /8 or narrower, never all traffic), `--isolation docker|process`, `--state <folder>`, `--no-discovery`.

## Security
- Mutual authentication (code proofs both ways + pinned fingerprint), ECDH P-256 + AES-256-GCM, anti-replay counter, per-device revocation.
- No shell: commands run as argument lists, only installed toolchains, inside the project's folder.
- With Docker: no network unless approved, memory/CPU caps. Without Docker: CPU-time and file-size caps only (reported as such).
- Audit log: `<state>/audit.log`.

## SOCKS5 and VPN
- SOCKS5: opened from the app; one-time user/password, only `--allow-target` destinations and `--vpn-subnet` networks.
- Split VPN: the phone routes only the chosen shared subnets to this PC (encrypted). The PC re-creates the TCP/UDP connections itself; no admin rights or route changes on the PC.

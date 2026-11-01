# MI AI PC Node

Lets an authorized computer lend CPU, RAM, disk, compilers and toolchains to MI AI over your local Wi-Fi. No Internet or cloud account is needed.

## Install and run
1. Install Node.js 20 or newer on the PC (Windows, Linux or macOS).
2. Copy all `.mjs` files from `pc-node/` into one folder (including `relay`, `media` and `media-plan`).
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

## Optional advanced media
- Install FFmpeg (including ffprobe) on PATH for transitions/PiP/animated positions, original audio, captions and H.264/AAC export.
- Install Demucs (`python -m pip install demucs`) in a compatible Python/PyTorch environment. Put the trusted htdemucs model weights and bag YAML in a local repository, then start with `--demucs-models <repository> --isolation process`. No model download is initiated by MI AI; preparation requires Internet once or copying the weights offline.
- Example: `node miai-node.mjs --share "C:\MI-AI" --demucs-models "C:\MI-AI-models" --isolation process`.
- Explicit app confirmation before transfer; files use encrypted RPC chunks. PC work files are private-by-permissions plaintext during processing, not encrypted PC disk storage; they are deleted on collection/cancel, retained for recovery otherwise. Restart never restarts jobs.
- Demucs is optional and CPU execution can be slow; APK alone does not contain PyTorch or model weights. Process mode is not a full sandbox; use only your own trusted computer.

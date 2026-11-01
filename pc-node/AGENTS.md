# PC Node service rules

- Standalone Node 20+ with zero dependencies; must run on Windows, Linux and macOS. Why: installable on any PC without the app's toolchain.
- Only folders passed with `--share` are reachable, one `miai/<projectId>` subfolder per project; reject absolute paths, `..` and symlinks. Why: whole-disk access never exists.
- Processes: argv only (no shell), binary must be a detected toolchain, scrubbed env, project cwd. Docker mode adds no-network/memory/CPU caps; process mode caps CPU time and file size only and reports that honestly. Why: never claim isolation that is not there.
- Git: reject `-c`, `--config-env`, `-C`, `--exec-path`; remote subcommands need `remoteApproved`. Why: config/alias injection runs arbitrary commands.
- Jobs running at startup become `lost`; state writes are serialized and atomic. Why: never claim a job survived a shutdown.
- Tunnels accept only the paired phone's IP and allowlisted targets, with a TTL and an audit log. Why: no open proxy.
- SOCKS5/VPN live in `relay.mjs`: CONNECT only, RFC 1929 auth with per-session random credentials, destinations = `--allow-target` or `--vpn-subnet` (/8 or narrower); VPN is a userspace NAT, one client, first frame must decrypt to the hello. Why: no open proxy and no admin rights.

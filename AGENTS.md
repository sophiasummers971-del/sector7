# Sector 7

Owner: Jade. Be direct, practical, and honest. Work autonomously on reversible tasks within the authorised scope.

- Keep edits inside the current Sector 7 repository checkout. Original Surface location: E:\Sector7. On the Surface Pro 3 SD-backed virtual drive, minimise processes, writes, dependencies, and scans.
- On Windows use npm.cmd; on other hosts use npm. Do not change PowerShell execution policy. No watchers or background servers left after verification.
- Sector 7 is a phone-first workflow coordinator. Sector 9 and Velvet Vault are separate; do not alter them.
- Independent systems enforce their own permissions. Outages never expand authority. Correlation IDs and permission fields are not enforcement.
- Prefer deterministic code and Node built-ins. No external service calls, provisioning, deployment, firewall changes, or public exposure for this slice.
- Enforce loopback-only binding until authenticated TLS access is commissioned. All APIs require an owner key. Never enable repository or arbitrary-network capabilities in this local-only slice. Bound and validate requests. Preserve operation-key conflict semantics and restart persistence.
- Earlier private-Wi-Fi testing is historical: plain-HTTP LAN binding is now disabled by the security baseline. No firewall rule or public exposure is authorised. Do not put owner keys into Git, reports or screenshots.
- Architecture proposals are background ideas, not verified implementation. Report actual checks and limitations.

Verified initial environment: Node v24.21.0, npm 11.19.0 (npm.cmd), Git 2.56.0.windows.2. Project was empty before this prototype. See README.md for current implementation and commands.

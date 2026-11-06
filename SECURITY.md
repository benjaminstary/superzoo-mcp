# Security

The MCP has no built-in authentication. Stdio runs as the local user. HTTP binds to `127.0.0.1` by default and checks Host and Origin headers. Those checks are not access control: any client that can reach the endpoint can use its tools.

For a network deployment, put the HTTP endpoint behind a TLS reverse proxy with your chosen access control and request limits. Pocket ID can supply the identity provider for an OIDC-aware proxy; Pocket ID alone does not protect this server. Ensure your MCP client supports your chosen authentication flow. Never expose the backend port around the proxy.

Set `SUPERZOO_ALLOWED_HOSTS` to the hostname the proxy forwards. Set `SUPERZOO_ALLOWED_ORIGINS` only for specific browser clients that need CORS. Forward the intended Host header. The server does not trust X-Forwarded-Host or X-Forwarded-For for authorization.

All tools are read-only. They use fixed upstream hosts and accept no account credentials. Availability uses an upstream POST that only reads stock. Prices and stock are public observations, not purchase or reservation guarantees.

If GitHub private vulnerability reporting is enabled for this repository, use its Security tab to report a vulnerability. Otherwise contact the maintainer through the contact method listed on their GitHub profile before sharing sensitive details. Do not post secrets or exploit details in public issues.

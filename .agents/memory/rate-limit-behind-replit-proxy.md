---
name: Rate limiting & CORS behind Replit's reverse proxy
description: How to configure express-rate-limit, trust proxy, and CORS correctly for a Replit-hosted API
---

Express APIs on Replit sit behind a shared reverse (mTLS) proxy, so raw `req.ip` is the proxy, not the client.

- Set `app.set("trust proxy", 1)` so `req.ip` reflects `X-Forwarded-For` (the real client). Without it an IP-based rate limiter collapses all users into one key and throttles everyone together.
- Prefer keying the limiter by authenticated user id (e.g. Clerk `getAuth(req)?.userId`) and fall back to IP via `ipKeyGenerator(req.ip)` for anonymous traffic. Mount the limiter AFTER the auth middleware so the user id is available.
- CORS: derive the prod allowlist from `REPLIT_DOMAINS` (comma-separated hostnames → `https://<host>`). Fail closed in production (throw if empty) rather than falling back to `origin: true`.

**Why:** shared-proxy IP collapse is a real footgun; a naive limiter DOSes your own users, and an open CORS fallback silently undoes the hardening.

**How to apply:** any new Replit-hosted Express artifact that adds rate limiting or CORS.

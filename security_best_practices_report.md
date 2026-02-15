# Security Best Practices Review Report

## Executive Summary

This codebase has a solid baseline for score integrity (RLS enabled, browser writes blocked, service-role-only secure RPCs, token hashing, and Turnstile enforcement).  
The highest-impact gaps are around trust-boundary hardening in the Edge Function and supply-chain controls in the frontend. No critical remote code execution or direct secret exposure was found in this review.

## Critical Findings

No critical findings identified.

## High Findings

### [SBP-001] Incomplete Turnstile verification (missing hostname/action binding)

- Rule ID: JS-API-VERIFICATION-001
- Severity: High
- Location: `supabase/functions/submit-score/index.ts:129`, `supabase/functions/submit-score/index.ts:163`
- Evidence:

```ts
const data = await response.json();
if (!data?.success) { ... }
return { ok: true, reason: "ok" };
```

```ts
const turnstile = await verifyTurnstile(String(body?.captchaToken || ""), ip);
if (!turnstile.ok) {
  return jsonResponse({ error: "Captcha failed", reason: turnstile.reason }, 403, origin);
}
```

- Impact: The function accepts any token that returns `success=true` without confirming expected `hostname` or `action`, weakening anti-automation guarantees if Turnstile/site settings drift or tokens are replayed across contexts.
- Fix:
  1. Parse and validate `data.hostname` against a server-side allowlist.
  2. Validate `data.action` against expected action per request (`score_create` or `score_rename`).
  3. Reject responses with missing/empty hostname or action.
- Mitigation: Keep strict Turnstile dashboard domain restrictions and short token lifetimes while implementing server-side checks.
- False positive notes: If Turnstile dashboard is perfectly constrained, risk is reduced but still not eliminated because server-side binding is the authoritative control.

### [SBP-002] Runtime third-party module loading from CDN without integrity pinning

- Rule ID: JS-SUPPLYCHAIN-001
- Severity: High
- Location: `app.js:814`, `index.html:12`
- Evidence:

```js
supabaseRealtimeClientPromise = import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm")
```

```html
script-src 'self' https://cdn.jsdelivr.net https://challenges.cloudflare.com
```

- Impact: A compromised CDN path or unexpected upstream major/minor update can execute attacker-controlled code in the browser with full origin privileges.
- Fix:
  1. Vendor `@supabase/supabase-js` locally and import from same-origin static assets.
  2. Pin exact versions (no floating `@2` ranges) in dependency/build config.
  3. Remove `https://cdn.jsdelivr.net` from `script-src` once no longer needed.
- Mitigation: If immediate self-hosting is not possible, pin exact URL versions and monitor dependency integrity aggressively.
- False positive notes: CSP currently restricts sources, but does not protect against a trusted-source compromise.

## Medium Findings

### [SBP-003] Privileged backend error details are returned to clients

- Rule ID: API-ERROR-LEAK-001
- Severity: Medium
- Location: `supabase/functions/submit-score/index.ts:199`, `supabase/functions/submit-score/index.ts:229`
- Evidence:

```ts
return jsonResponse({ error: "Create failed", details: error.message }, 400, origin);
...
return jsonResponse({ error: "Rename failed", details: error.message }, 400, origin);
```

- Impact: Internal DB/RPC error text can leak implementation details useful for probing and bypass attempts.
- Fix:
  1. Return generic user-facing error codes/messages.
  2. Keep full `error.message` only in server logs.
  3. Optionally map known failures to stable internal codes (for observability) without exposing internals.
- Mitigation: Add log correlation IDs so production incidents remain debuggable without client-visible internals.
- False positive notes: If upstream errors are always generic, exposure is lower; this is still a best-practice hardening gap.

### [SBP-004] CSP delivered via meta tag includes unsupported framing directive

- Rule ID: JS-CSP-DEPLOYMENT-001
- Severity: Medium
- Location: `index.html:11`
- Evidence:

```html
<meta http-equiv="Content-Security-Policy" content="... frame-ancestors 'none' ...">
```

- Impact: `frame-ancestors` is not reliably enforceable via meta-delivered CSP, so clickjacking protection may not be applied as intended.
- Fix:
  1. Move CSP to HTTP response headers at hosting/edge layer.
  2. Set `Content-Security-Policy` header with `frame-ancestors 'none'` there.
  3. Keep the meta CSP only as fallback for directives that are supported in meta context.
- Mitigation: Add runtime security-header checks in deployment verification to ensure header-based CSP is present.
- False positive notes: If hosting already injects CSP headers, this may already be mitigated; verify with runtime response headers.

## Low Findings

### [SBP-005] Edit tokens persist in `localStorage` without TTL

- Rule ID: JS-STORAGE-001
- Severity: Low
- Location: `app.js:421`, `app.js:432`
- Evidence:

```js
localStorage.setItem(editTokenStorageKey(id), token);
...
const stored = localStorage.getItem(editTokenStorageKey(id)) || "";
```

- Impact: Any future XSS or local browser compromise could harvest long-lived edit tokens and rename historical scores.
- Fix:
  1. Prefer in-memory storage for edit tokens when possible.
  2. If persistence is required, store expiry metadata and auto-expire tokens (for example, 24h/7d).
  3. Provide a cleanup routine for stale token keys.
- Mitigation: Maintain strict DOM XSS hygiene (already mostly good in this repo) and reduce token lifetime.
- False positive notes: Token scope is limited to name editing, so business impact is bounded.

### [SBP-006] IP extraction trusts generic forwarding headers

- Rule ID: API-RATELIMIT-TRUST-001
- Severity: Low
- Location: `supabase/functions/submit-score/index.ts:93`, `supabase/functions/submit-score/index.ts:95`
- Evidence:

```ts
const forwarded = req.headers.get("x-forwarded-for");
...
const real = req.headers.get("x-real-ip");
```

- Impact: If requests can reach this service without a trusted proxy normalizing headers, attackers can spoof IP-derived audit/rate-limit attribution.
- Fix:
  1. Trust only platform-guaranteed headers (for example `cf-connecting-ip`) in production.
  2. Ignore `x-forwarded-for`/`x-real-ip` unless proxy chain trust is explicitly verified.
  3. Treat missing trusted IP as a separate rate-limit bucket.
- Mitigation: Keep Turnstile validation and origin checks enabled as layered controls.
- False positive notes: In fully controlled edge-proxy deployments, spoofing risk may already be reduced.

## Observed Good Practices

1. Browser direct writes are blocked; secure RPCs are service-role only (`supabase/sql/highscore-security.sql:199` to `supabase/sql/highscore-security.sql:203`).
2. Score and token inputs are validated both in Edge Function and SQL (`supabase/functions/submit-score/index.ts:181` to `supabase/functions/submit-score/index.ts:185`, `supabase/sql/highscore-security.sql:100` to `supabase/sql/highscore-security.sql:109`).
3. Edit tokens are stored hashed server-side (`supabase/sql/highscore-security.sql:112`).
4. DOM rendering mostly uses safe text sinks (`app.js:2577`, `app.js:2606`) rather than unsafe HTML insertion.

## Secure-by-Default Improvement Plan (Prioritized)

1. Harden Turnstile validation first (hostname + action checks) to strengthen abuse resistance at the API boundary.
2. Remove runtime CDN JS dependency for Supabase client; self-host and pin exact versions.
3. Stop returning raw backend error details to clients.
4. Move CSP to response headers and verify `frame-ancestors` at runtime.
5. Add TTL/rotation behavior to client edit-token storage.

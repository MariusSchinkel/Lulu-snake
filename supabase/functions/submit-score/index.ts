import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TURNSTILE_SECRET_KEY = Deno.env.get("TURNSTILE_SECRET_KEY") || "";
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const MAX_PLAYER_NAME_LENGTH = 24;
const MAX_SUBMIT_SCORE = 20000;
const EDIT_TOKEN_REGEX = /^[a-f0-9]{48}$/;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env");
}

let adminClient: ReturnType<typeof createClient> | null = null;

function getAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  if (!adminClient) {
    adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return adminClient;
}

type ScoreCreateRequest = {
  action: "create";
  name: string;
  score: number;
  editToken: string;
  captchaToken: string;
};

type ScoreRenameRequest = {
  action: "rename";
  id: string;
  name: string;
  editToken: string;
  captchaToken: string;
};

type ScoreRequest = ScoreCreateRequest | ScoreRenameRequest;

function buildCorsHeaders(origin: string | null) {
  const allowOrigin = origin && (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin))
    ? origin
    : "null";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
  };
}

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
  origin: string | null = null,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: buildCorsHeaders(origin),
  });
}

function normalizeName(rawName: string) {
  const cleaned = String(rawName || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PLAYER_NAME_LENGTH);
  return cleaned || "Player 1";
}

function normalizeScore(rawScore: number) {
  const numeric = Number(rawScore);
  if (!Number.isFinite(numeric)) return 0;
  return Math.floor(numeric);
}

function extractIp(req: Request) {
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp;
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return null;
}

function isOriginAllowed(origin: string | null) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.length === 0) return false;
  return ALLOWED_ORIGINS.includes(origin);
}

async function verifyTurnstile(token: string, remoteIp: string | null) {
  if (!TURNSTILE_SECRET_KEY) {
    return { ok: false, reason: "turnstile_not_configured" };
  }
  if (!token) {
    return { ok: false, reason: "missing_captcha" };
  }

  const form = new URLSearchParams();
  form.set("secret", TURNSTILE_SECRET_KEY);
  form.set("response", token);
  if (remoteIp) form.set("remoteip", remoteIp);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });

  if (!response.ok) {
    return { ok: false, reason: `turnstile_http_${response.status}` };
  }

  const data = await response.json();
  if (!data?.success) {
    const codes = Array.isArray(data?.["error-codes"]) ? data["error-codes"].join(",") : "verification_failed";
    return { ok: false, reason: `turnstile_${codes}` };
  }

  return { ok: true, reason: "ok" };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: buildCorsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, origin);
  }

  if (!isOriginAllowed(origin)) {
    return jsonResponse({ error: "Forbidden origin" }, 403, origin);
  }

  let body: ScoreRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, origin);
  }

  const ip = extractIp(req);
  const userAgent = req.headers.get("user-agent") || "";

  const turnstile = await verifyTurnstile(String(body?.captchaToken || ""), ip);
  if (!turnstile.ok) {
    return jsonResponse({ error: "Captcha failed", reason: turnstile.reason }, 403, origin);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Server misconfigured" }, 500, origin);
  }
  const admin = getAdminClient();
  if (!admin) {
    return jsonResponse({ error: "Server misconfigured" }, 500, origin);
  }

  if (body.action === "create") {
    const name = normalizeName(body.name);
    const score = normalizeScore(body.score);
    const editToken = String(body.editToken || "").trim().toLowerCase();

    if (score < 0 || score > MAX_SUBMIT_SCORE) {
      return jsonResponse({ error: "Invalid score" }, 400, origin);
    }
    if (!EDIT_TOKEN_REGEX.test(editToken)) {
      return jsonResponse({ error: "Invalid edit token" }, 400, origin);
    }

    const { data, error } = await admin.rpc("create_highscore_secure", {
      p_name: name,
      p_score: score,
      p_edit_token: editToken,
      p_ip: ip,
      p_user_agent: userAgent,
      p_origin: origin,
    });

    if (error) {
      console.error("create_highscore_secure failed", error);
      return jsonResponse({ error: "Create failed", details: error.message }, 400, origin);
    }

    const row = Array.isArray(data) ? data[0] : data;
    return jsonResponse(row || {}, 200, origin);
  }

  if (body.action === "rename") {
    const id = String(body.id || "").trim();
    const name = normalizeName(body.name);
    const editToken = String(body.editToken || "").trim().toLowerCase();

    if (!id) {
      return jsonResponse({ error: "Missing score id" }, 400, origin);
    }
    if (!EDIT_TOKEN_REGEX.test(editToken)) {
      return jsonResponse({ error: "Invalid edit token" }, 400, origin);
    }

    const { data, error } = await admin.rpc("rename_highscore_secure", {
      p_id: id,
      p_name: name,
      p_edit_token: editToken,
      p_ip: ip,
      p_user_agent: userAgent,
      p_origin: origin,
    });

    if (error) {
      console.error("rename_highscore_secure failed", error);
      return jsonResponse({ error: "Rename failed", details: error.message }, 400, origin);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return jsonResponse({ error: "Not found or token mismatch" }, 404, origin);
    }
    return jsonResponse(row, 200, origin);
  }

  return jsonResponse({ error: "Invalid action" }, 400, origin);
});

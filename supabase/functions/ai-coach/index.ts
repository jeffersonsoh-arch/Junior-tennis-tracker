// AI Coach — Supabase Edge Function.
//
// The browser never talks to Anthropic directly (that would mean shipping
// an API key to every visitor); it calls this function instead, forwarding
// the signed-in user's own Supabase JWT. This function reuses that JWT to
// build its Supabase client, so every read still goes through the same
// Row Level Security policies as the rest of the app — there is no
// service-role bypass here, and a user can only get AI help for a player
// they actually have access to.
//
// Deploy: supabase functions deploy ai-coach
// Secret: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// Optional: supabase secrets set AI_COACH_MODEL=claude-sonnet-5

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const YOUTH_STAGE_LABELS: Record<string, string> = {
  red_starter: "Red Starter",
  red_rally: "Red Rally",
  red_game_player: "Red Game Player",
  orange_ready: "Orange Ready",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function levelLabel(level: { ntrp_level: number | null; youth_stage: string | null } | null) {
  if (!level) return "no level set yet";
  if (level.ntrp_level != null) return "NTRP " + Number(level.ntrp_level).toFixed(1);
  return YOUTH_STAGE_LABELS[level.youth_stage || ""] || level.youth_stage || "unknown stage";
}

function systemPrompt(player: any, level: any) {
  return `You are the AI Coach inside Deuce Board, a junior tennis development tracker. You are helping a parent or coach plan practice for one specific player:

- Name: ${player.name}
- Pathway: ${player.pathway === "youth" ? "youth red/orange ball on-ramp" : "NTRP adult/competitive scale"}
- Current level: ${levelLabel(level)}
- Sessions per week: ${player.sessions_per_week}

House style for any drill or session you propose (match this, the same structure the rest of the app already uses):
- Sessions are broken into short, timed, labeled segments — e.g. warm-up, a technical block by stroke (forehand, backhand, slice, volley, serve type, footwork), live-ball or point play, cool-down — not a single paragraph.
- Be stroke-specific, not generic: name the actual shot (forehand topspin, backhand slice, kick serve, etc.), not just "groundstrokes."
- Keep content age/level-appropriate: shorter and more playful for the youth red/orange pathway, more tactical and match-oriented as NTRP level rises.
- Total session length should roughly match real practice norms: ~35-45 minutes for youth, ~60-75 minutes for NTRP.

Answer coaching questions conversationally and concisely. If — and only if — the parent/coach is asking you to create or save a concrete drill or a full practice plan for this player, end your reply with a single fenced code block like this, containing nothing but valid JSON (no comments, no trailing text after the closing fence):

\`\`\`json
{"kind":"drill","title":"...","summary":"one line","segments":[{"label":"Warm-up","minutes":10,"text":"..."}]}
\`\`\`

Use "kind":"plan" instead of "drill" for a full multi-segment session plan (same shape either way — the only difference is what you call it). Omit the JSON block entirely for ordinary conversation, questions, or advice that isn't a concrete saved drill/plan.`;
}

// Anthropic replies may put the JSON block last; look for a fenced ```json
// block anywhere and, if it parses into the expected shape, split it out
// from the human-readable reply shown in the chat.
function extractStructured(text: string): { reply: string; structured: any | null } {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) return { reply: text.trim(), structured: null };
  try {
    const parsed = JSON.parse(match[1].trim());
    if (
      parsed && typeof parsed === "object" &&
      (parsed.kind === "drill" || parsed.kind === "plan") &&
      typeof parsed.title === "string" && Array.isArray(parsed.segments)
    ) {
      const reply = (text.slice(0, match.index) + text.slice(match.index! + match[0].length)).trim();
      return { reply: reply || "Here's what I'd suggest — saved below.", structured: parsed };
    }
  } catch (_e) { /* not valid JSON — fall through and show it as plain text */ }
  return { reply: text.trim(), structured: null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401);

  let playerId: string, message: string, history: Array<{ role: string; content: string }>;
  try {
    const body = await req.json();
    playerId = body.playerId;
    message = body.message;
    history = Array.isArray(body.history) ? body.history : [];
    if (!playerId || !message || typeof message !== "string") throw new Error("bad body");
  } catch (_e) {
    return jsonResponse({ error: "Expected { playerId, message, history }" }, 400);
  }

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return jsonResponse({ error: "AI Coach isn't configured yet (missing ANTHROPIC_API_KEY secret)." }, 500);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: player, error: playerErr } = await supabase
    .from("players").select("id,name,pathway,sessions_per_week").eq("id", playerId).maybeSingle();
  if (playerErr) return jsonResponse({ error: playerErr.message }, 500);
  if (!player) return jsonResponse({ error: "Player not found, or you don't have access to it." }, 403);

  const { data: levels } = await supabase
    .from("player_levels").select("ntrp_level,youth_stage").eq("player_id", playerId)
    .order("effective_date", { ascending: false }).limit(1);
  const level = levels && levels[0] ? levels[0] : null;

  const recentHistory = history.slice(-20).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || "").slice(0, 4000),
  }));

  const model = Deno.env.get("AI_COACH_MODEL") || "claude-sonnet-5";
  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      system: systemPrompt(player, level),
      messages: [...recentHistory, { role: "user", content: message }],
    }),
  });

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    console.error("Anthropic API error:", anthropicRes.status, errText);
    return jsonResponse({ error: "The AI Coach is unavailable right now. Please try again shortly." }, 502);
  }

  const anthropicData = await anthropicRes.json();
  const text = (anthropicData.content || [])
    .filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
  if (!text) return jsonResponse({ error: "The AI Coach didn't return a response. Please try again." }, 502);

  const { reply, structured } = extractStructured(text);
  return jsonResponse({ reply, structured });
});

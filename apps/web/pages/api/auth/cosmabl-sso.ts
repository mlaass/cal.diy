import type { NextApiRequest, NextApiResponse } from "next";
import { encode } from "next-auth/jwt";
import jwt from "jsonwebtoken";

import prisma from "@calcom/prisma";

/**
 * COSMABL SSO bridge (PRD §8.3, the Phase-0 spike).
 *
 * COSMABL's `caldiy-sso` Edge Function verifies the practitioner, mints a
 * short-lived JWT (signed with the shared CALDIY_SSO_SECRET, claim
 * `{ cal_user_id }`) and redirects the browser here with `?caldiy_token=...`.
 * This route verifies that token and establishes a real cal.diy NextAuth session
 * by encoding a session JWT (with NEXTAUTH_SECRET) shaped like cal.com's own
 * `jwt` callback output, then setting the NextAuth session cookie.
 *
 * ⚠️ SPIKE — verify against the running app before trusting in prod:
 *   - the exact session-cookie name (secure prefix) and claim set cal.com's
 *     session callback requires (id/email/username/role/upId/profileId);
 *   - whether `belongsToActiveTeam` / org claims are needed for your setup.
 * Reference: packages/features/auth/lib/next-auth-options.ts (jwt + session callbacks).
 */

const SESSION_MAX_AGE = 24 * 60 * 60; // 1 day

// Open-redirect + header-split guard: only same-site relative paths, no control
// or whitespace chars (codepoint <= 0x20 or DEL). Codepoint check avoids any
// literal-control-char-in-source ambiguity.
function safeRedirectPath(p: unknown): string {
  if (typeof p !== "string" || !p.startsWith("/")) return "/availability";
  if (p.startsWith("//") || p.startsWith("/\\")) return "/availability";
  for (let i = 0; i < p.length; i++) {
    const c = p.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f) return "/availability";
  }
  return p;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token =
    (typeof req.query.caldiy_token === "string" && req.query.caldiy_token) ||
    (req.cookies?.caldiy_session ?? "");
  if (!token) return res.status(401).json({ error: "missing_token" });

  const secret = process.env.CALDIY_SSO_SECRET;
  const nextAuthSecret = process.env.NEXTAUTH_SECRET;
  if (!secret || !nextAuthSecret) return res.status(500).json({ error: "sso_not_configured" });

  let payload: { cal_user_id?: string | number };
  try {
    payload = jwt.verify(token, secret) as { cal_user_id?: string | number };
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }
  const calUserId = Number(payload.cal_user_id);
  if (!Number.isFinite(calUserId)) return res.status(400).json({ error: "bad_cal_user_id" });

  const user = await prisma.user.findUnique({
    where: { id: calUserId },
    select: { id: true, email: true, username: true, role: true, name: true },
  });
  if (!user) return res.status(404).json({ error: "user_not_found" });

  // Shape mirrors packages/features/auth/lib/next-auth-options.ts session/jwt
  // callbacks. upId "usr-<id>" is the personal-profile id cal.com expects.
  const sessionToken = await encode({
    secret: nextAuthSecret,
    maxAge: SESSION_MAX_AGE,
    token: {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      role: user.role,
      profileId: null,
      upId: `usr-${user.id}`,
      belongsToActiveTeam: false,
    },
  });

  const useSecure = (process.env.NEXTAUTH_URL || "").startsWith("https");
  const cookieName = useSecure ? "__Secure-next-auth.session-token" : "next-auth.session-token";
  const parts = [
    `${cookieName}=${sessionToken}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE}`,
  ];
  if (useSecure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));

  return res.redirect(302, safeRedirectPath(req.query.redirectPath));
}

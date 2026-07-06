# COSMABL cal.diy fork

Fork of `calcom/cal.diy` carrying COSMABL's self-host patches for the scheduling
migration (see the COSMABL repo `docs/prd-scheduling-caldiy-migration.md`).

- **Pinned to** upstream tag `v6.2.0`. Patch branch: `cosmabl-local`.
- Update deliberately; re-verify patches + the E2E suite before bumping.

## Patches carried

| Patch | File | Why |
|---|---|---|
| Email no-op | `packages/lib/serverConfig.ts` | When `CALDIY_DISABLE_EMAILS=1`, `detectTransport()` returns nodemailer `jsonTransport` — cal.diy serializes but never sends. COSMABL's branded MailerSend (fed by the `cal-webhook` Edge Fn) owns all mail (PRD §11.1). Survives env mistakes. |
| SSO session bridge | `apps/web/pages/api/auth/cosmabl-sso.ts` | Verifies the COSMABL `caldiy_token` (JWT, `CALDIY_SSO_SECRET`) → mints a cal.com-shaped NextAuth session JWT (`NEXTAUTH_SECRET`) → sets the session cookie → redirects. Resolves the §8.3 spike. |
| CI image build | `.github/workflows/cosmabl-build-image.yml` | Builds web + v2 API images → GHCR on push to `cosmabl-local`/`cosmabl-prod`. Coolify pulls prebuilt so the VPS never runs the heavy build (PRD D21). |

## SSO cookie → NextAuth session — implemented, pending app verification

`apps/web/pages/api/auth/cosmabl-sso.ts` implements the §8.3 bridge: COSMABL's
`caldiy-sso` Edge Fn redirects the browser to `…/api/auth/cosmabl-sso?caldiy_token=…`;
this route verifies the token with the shared `CALDIY_SSO_SECRET`, loads the
cal.com user via Prisma, `encode()`s a NextAuth session JWT with the claim shape
cal.com's own `jwt`/`session` callbacks produce (id/email/username/role/upId), and
sets the `next-auth.session-token` cookie.

⚠️ Still the **riskiest patch** — it is written from cal.com's source
(`packages/features/auth/lib/next-auth-options.ts`) but must be verified against
the running app: confirm the session-cookie name (secure prefix), the exact
required claims, and whether org/team claims are needed. Requires
`CALDIY_SSO_SECRET` set on the cal.diy container (shared with the Edge Fn).

## Local build

Built by the COSMABL repo's `infra/local/cal.diy.compose.yaml` against a checkout
of this fork; see `docs/caldiy-operations-runbook.md` in the COSMABL repo.

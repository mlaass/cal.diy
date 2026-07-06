# COSMABL cal.diy fork

Fork of `calcom/cal.diy` carrying COSMABL's self-host patches for the scheduling
migration (see the COSMABL repo `docs/prd-scheduling-caldiy-migration.md`).

- **Pinned to** upstream tag `v6.2.0`. Patch branch: `cosmabl-local`.
- Update deliberately; re-verify patches + the E2E suite before bumping.

## Patches carried

| Patch | File | Why |
|---|---|---|
| Email no-op | `packages/lib/serverConfig.ts` | When `CALDIY_DISABLE_EMAILS=1`, `detectTransport()` returns nodemailer `jsonTransport` — cal.diy serializes but never sends. COSMABL's branded MailerSend (fed by the `cal-webhook` Edge Fn) owns all mail (PRD §11.1). Survives env mistakes. |
| CI image build | `.github/workflows/cosmabl-build-image.yml` | Builds web + v2 API images → GHCR on push to `cosmabl-local`/`cosmabl-prod`. Coolify pulls prebuilt so the VPS never runs the heavy build (PRD D21). |

## Remaining spike: SSO cookie → NextAuth session

The COSMABL `caldiy-sso` Edge Fn mints a signed `caldiy_session` JWT cookie on
`.cosmabl.com` and redirects to `cal.cosmabl.com/availability`. The cal.diy side
still needs middleware that reads that cookie, verifies it with
`CALDIY_SSO_SECRET`, and establishes a NextAuth session for the mapped
`cal_user_id`. This is the **riskiest fork patch** (PRD §8.3) and is intentionally
NOT shipped here yet — it must be proven against the running app (a verified
cookie is not itself a NextAuth session; likely a Credentials-provider auto-login
or a minted NextAuth session JWT). Until then, practitioners reach cal.diy via its
normal login. Track under PRD §8.3 / §14 Phase 0.

## Local build

Built by the COSMABL repo's `infra/local/cal.diy.compose.yaml` against a checkout
of this fork; see `docs/caldiy-operations-runbook.md` in the COSMABL repo.

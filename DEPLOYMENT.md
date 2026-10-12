# Vercel and Supabase setup

The repository now contains the Vercel API functions, Supabase REST adapter,
database migration, and static-site configuration. This document explains the
account setup that still has to be done; no Vercel or Supabase resources have
been created and no signer emails have been sent.

## 1. Create the database

Create a Supabase project, then open its SQL Editor and run
[`supabase/migrations/20261012000000_frienda_signing.sql`](supabase/migrations/20261012000000_frienda_signing.sql).
It creates and seeds the six signer rows, enables row-level security, removes
anonymous table access, and adds two server-only database functions:

- `issue_signing_invite` atomically reserves the per-signer one-minute cooldown
  and stores the invite hash and expiry.
- `confirm_email_signing` atomically consumes the invite, records consent and
  the scribble, and invalidates any other invites for that signer.

The database stores no email addresses or raw invite tokens. The Supabase
secret key is used only by the server functions. Never add it to browser code or
commit it to Git.

## 2. Import the repository into Vercel

In Vercel, create a project from `dalmaer/frienda`, using the repository root
and the “Other” framework preset. There is no build step: `public/` is served as
the site and `api/` contains Node.js functions. `vercel.json` adds baseline
security headers. The site is intentionally public; `public/robots.txt` asks
crawlers not to index it but does not protect the data.

## 3. Configure environment variables

Add these to Vercel **Production** only after the production database and email
sender are ready. Keep **Preview** unconfigured or use a separate test database,
test email addresses, and non-production credentials.

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SECRET_KEY=<server-only Supabase secret key>
ADMIN_TOKEN=<at least 32 random characters>
SIGNER_EMAILS_JSON={"dion":"...","emily":"...","ivan":"...","amanda":"...","juan":"...","kathy":"..."}
RESEND_API_KEY=<Resend API key>
FROM_EMAIL=FrieNDA <pledge@your-verified-domain>
PUBLIC_URL=https://<your-domain>
```

Use addresses you have permission to use, and verify the sender domain with
Resend before sending. The repo contains no real addresses. The app shows the
organizer panel only when all six addresses and all mail settings are present.
The administrator token is entered in that panel and sent only in the request
authorization header; it is not saved in the browser.

## 4. Test a preview before sharing

After the migration and environment are ready, deploy a Vercel preview and test
the full flow with test addresses:

1. Confirm `/api/state` shows six unsigned signers and no email addresses.
2. Send one invitation; confirm it reaches only the configured address.
3. Open the link and confirm its token is in the URL fragment, not the query
   string, and is cleared from the address bar when the page opens.
4. Confirm without a scribble or consent; the API must reject it.
5. Sign, refresh the page, and confirm the signature remains in Supabase.
6. Replay the link and attempt a second invite within one minute; both must fail.
7. Confirm the site works from a second browser/device and the public status
   shows only names, groups, methods, and timestamps.

Before changing Production settings, confirm the group is comfortable with the
public page displaying who has signed and when. The repository is public, and
`robots.txt` is only a crawler request. For private signatures, add real access
control before deploying rather than relying on an unlisted URL.

## Local development

`npm start` runs the Node server with an ignored local JSON store. It is useful
for the pledge and status UI, but does not exercise the production database
adapter. Do not copy a local test signature file into production without an
explicit decision to preserve it.

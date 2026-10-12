# FrieNDA: simplest durable data store and Vercel deployment

## Recommendation

Use **Supabase Postgres through Vercel Marketplace** for the durable store, and
Vercel Node.js Functions for the API. Keep the existing HTML/CSS/JavaScript
front end as static files. This is a small relational data set, but it needs
uniqueness and atomic single-use invite handling; Postgres provides those
without inventing a file or key-value protocol.

Vercel Functions have a read-only application filesystem (apart from temporary
`/tmp` storage), so `.data/signatures.json` cannot be the live database. The
Vercel Marketplace can provision a Supabase resource and synchronize its
connection variables to the Vercel project. See the [Vercel storage
integrations](https://vercel.com/docs/marketplace-storage) and [Supabase's
Vercel Marketplace guide](https://supabase.com/docs/guides/integrations/vercel-marketplace).

## Small schema

Keep the six known people in a `signers` table, seeded by one SQL migration:

```sql
create table public.signers (
  id text primary key check (id in ('dion','emily','ivan','amanda','juan','kathy')),
  name text not null,
  group_name text not null,
  signed_at timestamptz,
  method text check (method in ('handwritten','email-link')),
  signature_points jsonb,
  last_invited_at timestamptz,
  check ((signed_at is null and method is null)
      or (signed_at is not null and method is not null)),
  check (method <> 'handwritten' or signature_points is not null)
);

create table public.signing_invites (
  token_hash text primary key check (length(token_hash) = 64),
  signer_id text not null references public.signers(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
```

Do not put email addresses or raw invite tokens in these tables. Keep addresses
in Vercel's server-side `SIGNER_EMAILS_JSON` variable; store only a SHA-256 hash
of each random invite token. Retain the drawing only if the group wants it kept;
otherwise store the consent, method, and timestamp and discard the points after
submission.

## API and data flow

Move the current custom `http.createServer()` routes into Vercel functions under
`/api/` (for example, `api/state.js`, `api/manual-sign.js`,
`api/admin/invite.js`, and `api/email-sign.js`). Keep reusable database and
validation helpers in underscored files such as `api/_lib/store.js`. Serve the
current `public/` assets from the deployment root. Vercel Functions support
Node.js request handlers from the root `api/` directory; the current long-lived
HTTP server entry point is not itself a function handler.

Add `@supabase/supabase-js`; create its client once in the shared server helper
from `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. Use the Supabase Data API over
HTTPS, so the functions do not need to maintain database sockets. Enable RLS on
both tables, add no anonymous table policies, and never ship the Supabase secret
key to the browser. Only the Vercel functions get that key. Supabase documents that
its secret/service-role keys bypass RLS and must never be exposed to clients in
the [RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security).

- `GET /api/state`: read the six signer rows and return only names, group,
  signed state, method, and timestamp. Never return emails or invite hashes.
- `POST /api/manual-sign`: validate consent and normalized strokes, then update
  one unsigned signer row. The signer primary key makes duplicate signing a
  conflict instead of a second signature.
- `POST /api/admin/invite`: validate the organizer token, check
  `last_invited_at` in the database for a durable rate limit, generate a random
  one-time token, store its hash and expiry, and send the raw link via Resend.
- `POST /api/email-sign`: call one Postgres function that atomically claims an
  unexpired, unused token and records the signer's assent. A second use, expired
  link, or already-signed person returns a conflict/gone response.

The current email link puts its token in the query string. Before deployment,
move it to the URL fragment and have the browser submit it once to the API; a
fragment is not sent in the initial HTTP request. Clear it from browser history
after reading. Keep request logging from recording invite tokens.

## Vercel setup

1. In Vercel, import `dalmaer/frienda` as a project with the repository root as
   its root directory. Use the “Other” framework preset; there is no front-end
   build step. Put the current `robots.txt` in `public/robots.txt` so it is
   served at the deployed site's root.
2. Add Supabase from Vercel Marketplace and create the schema by running a
   checked-in migration in the Supabase SQL editor. Seed the six signer rows.
3. Keep `SUPABASE_SECRET_KEY` and all application secrets server-only. Add
   `ADMIN_TOKEN`, `SIGNER_EMAILS_JSON`, `RESEND_API_KEY`, `FROM_EMAIL`, and
   `PUBLIC_URL` in Vercel project settings. Configure Production and Preview
   separately; previews should use a separate test database and fake/test
   addresses, never the production signer list.
4. Deploy a preview and test the state endpoint, handwritten submission,
   duplicate submission, invite email, successful email confirmation, expiry,
   replay, and database persistence across separate function invocations.
5. Promote to production only after checking the public deployment's access and
   data behavior. The repository and site are public by choice; `robots.txt`
   asks crawlers not to index, but it is not a privacy control.

## One important signing limitation

The public scribble form currently lets a visitor select any of the six names.
A drawn mark does not prove who drew it. For a public site, the cleanest way to
make a person's assent attributable to their own inbox is to send each person a
unique email link and let that link open the same consent-and-scribble form. The
link then proves control of that email account at signing time; it still is not
a legal identity check or a legally binding NDA. Until that flow is built,
disable public name-select scribble signing or treat it as an informal keepsake
only.

## Existing data

The ignored local `.data/signatures.json` is not in Git. No production
signatures exist yet, so the initial migration starts with six unsigned rows.
If local test signatures are ever worth keeping, write a one-time import script
that reads the file locally and inserts only the intended records; never commit
the file or put it in a deployment bundle.

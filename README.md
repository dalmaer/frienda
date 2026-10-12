# FrieNDA

A private, deliberately non-legal group pledge for Dion and Emily Almaer,
Ivan Lee and Amanda Dufresne Lee, and Juan and Kathy Batlle. “Blood oath” is a
metaphor: no blood, needles, actual legal NDA, or mysterious basement ceremony
required.

## Run locally

Requires Node.js 22.9 or newer. The app has no package dependencies.

```sh
npm start
```

Open <http://localhost:4317>. Local signatures and invite hashes live in
`.data/signatures.json`, which is ignored by Git. The local server binds to
`127.0.0.1`. It uses this file store for development; Vercel uses Supabase.

## Signing

Public visitors can see the six names and signature status, but cannot select a
person or sign as them. The organizer sends a personal link to the configured
email for each signer. The link is random, single-use, expires after seven days,
and is stored only as a SHA-256 hash. It opens that person’s scribble and assent
form. This demonstrates access to the invited inbox at signing time; it is not
legal identity verification or a legally binding electronic signature.

No real email addresses or mail credentials are included. Organizer controls
stay hidden until all six addresses and the mail settings are configured. A
failed email delivery still holds that signer’s one-minute invite cooldown.

## Deploying

See [`DEPLOYMENT.md`](DEPLOYMENT.md) for the Vercel/Supabase setup. The checked-in
migration is [`supabase/migrations/20261012000000_frienda_signing.sql`](supabase/migrations/20261012000000_frienda_signing.sql).
The website and repository are public by choice. `robots.txt` and an
`X-Robots-Tag` header ask crawlers not to index the site; neither is access
control. Names and who has signed (including timestamps) are publicly visible.
The signature drawings are stored in Supabase but are not returned to the public
status endpoint or shown on the page.

## Tests

```sh
npm test
```

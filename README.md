# FrieNDA

A private, deliberately non-legal group pledge for Dion and Emily Almaer,
Ivan and Amanda Dufresne Lee, and Juan and Kathy Batlle. “Blood oath” is a
metaphor here: no blood, needles, actual legal NDA, or mysterious basement
ceremony required.

## Run locally

Requires Node.js 20 or newer; there are no package dependencies.

```sh
npm start
```

Open <http://localhost:4317>. Signatures and invite tokens are written to
`.data/signatures.json`, which is intentionally ignored by Git. The server
binds to `127.0.0.1` by default, so it is only reachable on this Mac.

## Signing options

- **Scribble:** a participant selects their name, reads the pledge, checks the
  assent box, draws a mark, and submits it. The app labels this a handwritten
  signature; it does not independently verify who held the device.
- **Personal email link:** configure `ADMIN_TOKEN`, `SIGNER_EMAILS_JSON`,
  `RESEND_API_KEY`, `FROM_EMAIL`, and `PUBLIC_URL` in a local `.env` (copy
  `.env.example`). Restart the server, open the invite panel, enter the admin
  token, and send a link to the chosen participant. Each link is random,
  single-use, stored only as a hash, and expires after seven days. The signer
  opens the link and explicitly confirms the pledge. The server records that
  the link was used; it does not claim this is legally binding identity proof.

The email flow is off until configured. The app never guesses or looks up
email addresses, and no email is sent by this project as created.

## Privacy and hosting

This is a friendly-group keepsake, not legal advice or a legally enforceable
NDA. It stores a signature drawing, name, method, and timestamp locally. Do
not expose this local server to the internet as-is. A real shared deployment
needs HTTPS, private access controls, a durable database, backups, and a
review of the chosen email sender and hosting provider. Keep `.env` and
`.data/` out of Git.

## Tests

```sh
npm test
```

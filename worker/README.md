# Newsletter Worker

A Cloudflare Worker with one endpoint, `POST /subscribe`. The site's newsletter form
(`src/components/newsletter-form.js`) posts to it, and the Worker adds the address to the
Mailchimp audience. The Mailchimp API key lives only in the Worker, as an encrypted
secret. It is never in this repo, the page or the browser.

Every signup is added as `pending`, so Mailchimp sends its confirmation email and the
address only joins the list after the click (double opt-in).

## What a request goes through

In this order. Mailchimp is only called when everything before it passed.

1. **Origin.** Only the sites in `ALLOWED_ORIGINS` (`src/constants.js`) get an answer
   their browser accepts.
2. **Shape.** A JSON body under 4 KB. JSON makes the browser ask permission first,
   which a plain form post from another site can't do.
3. **Honeypot.** A hidden `website` field. If it is filled, the Worker answers with the
   normal success and does nothing.
4. **Rate limit.** 5 requests a minute per visitor IP (`wrangler.jsonc`). Cloudflare
   counts per location and approximately, which is enough here.
5. **Email.** Trimmed, lowercased, at most 254 characters, one pattern check.
6. **Turnstile.** Only when the `TURNSTILE_SECRET` secret is set. See below.

The form also sends the page it is on. The Worker keeps it only when it is a page of the
site that sent the request, and drops the query and the fragment, so no tracking or
personal data from a link ends up in Mailchimp. See "Change things" for the field.

## Answers

The Worker answers `{ "ok": true | false, "code": "…" }` with a code, never with
Mailchimp's own text. The form maps each code to copy set in Webflow
(`data-message-<code>`, see `docs/markup.md`). Details go to the Worker log, without
the email address.

| Code | HTTP | When |
| --- | --- | --- |
| `subscribed` | 200 | New address, already on the list, re-subscribed, or a filled honeypot |
| `invalid_email` | 400 | Fails the check, or Mailchimp rejects the address |
| `email_refused` | 409 | Mailchimp won't take this address again: it bounced, or it was erased |
| `verification_failed` | 400, 403, 405 | Wrong origin, not a JSON post, or Turnstile fails |
| `rate_limited` | 429 | More than 5 tries in a minute |
| `unavailable` | 500, 502, 503 | Mailchimp error or timeout, or a secret is missing |

The form reads the code, not the HTTP status. The statuses are there for the browser's
network tab and the Worker log.

One success for a new address and for one that is already on the list is on purpose: a
separate "you're already subscribed" would let anyone test whether an address is on the
list. `email_refused` is the one exception. It tells the visitor that the address can't
be added, because a success would leave them waiting for an email that never comes.

How Mailchimp's replies are handled (`src/mailchimp.js`):

- `Member Exists`: Mailchimp says this for every member, also one who unsubscribed. The
  Worker looks up the member's status. `subscribed` and `pending` need nothing: success.
  (Mailchimp sends no second confirmation email to a pending address.) Any other status
  is set back to `pending` with a `PUT`, which sends a fresh confirmation email, so the
  person opts in again themselves.
- `Member In Compliance State`: the same `PUT`. If Mailchimp refuses that too (a bounced
  address): `email_refused`.
- `Forgotten Email Not Subscribed` (erased under GDPR; only Mailchimp's own signup form
  can add them again): `email_refused`.
- `Invalid Resource`: `invalid_email`, unless Mailchimp names another field than the
  email. Then it is logged, tried once more without the page, and otherwise answered as
  `unavailable`. A required audience field would cause that, so keep every field except
  the email optional in Mailchimp.
- An address that signed up to many lists in a short time is held back by Mailchimp for
  a day or two: `unavailable`, so the visitor is asked to try again later.

## Set up and deploy

Needs Node 22.12 or newer and a Cloudflare account (the free plan is enough).

    cd worker
    npm install
    npx wrangler login              # opens the browser; pick the Cloudflare account
    npx wrangler deploy             # prints the URL, like https://dia-newsletter.<name>.workers.dev

Then the secrets. Each command asks for the value, so nothing ends up in your shell
history:

    npx wrangler secret put MAILCHIMP_API_KEY
    npx wrangler secret put MAILCHIMP_AUDIENCE_ID

- **API key:** in Mailchimp's account settings, under Extras > API keys. Create one only
  for this Worker, so it can be revoked without touching anything else. A Mailchimp key
  gives full account access and can't be scoped. The Worker reads the datacenter (like
  `us20`) from the key's ending.
- **Audience ID:** in the audience's settings, under "Audience name and defaults".

Until both exist the Worker answers `unavailable`. Secrets apply right away, with no
new deploy.

Last, put the Worker's URL plus `/subscribe` in the form's **Action** in Webflow
(Form settings), for example `https://dia-newsletter.<name>.workers.dev/subscribe`.

### Check it

Replace the URL with yours. The first signs up a real address, so use your own.

    URL=https://dia-newsletter.<name>.workers.dev/subscribe
    ORIGIN='Origin: https://www.democracyinaction.eu'
    JSON='Content-Type: application/json'

    curl -i -X POST -H "$ORIGIN" -H "$JSON" -d '{"email":"you@example.com","firstName":"You"}' $URL   # 200 subscribed
    curl -i -X POST -H "$ORIGIN" -H "$JSON" -d '{"email":"nope"}' $URL                                 # 400 invalid_email
    curl -i -X POST -H "$ORIGIN" -H "$JSON" -d '{"email":"a@b.co","website":"x"}' $URL                 # 200, nothing sent
    curl -i -X POST -H 'Origin: https://example.com' -H "$JSON" -d '{"email":"a@b.co"}' $URL           # 403

Live logs while you test: `npx wrangler tail`.

## Turnstile (optional)

Cloudflare's bot check. Without it the Worker relies on the origin check, the honeypot
and the rate limit. To turn it on:

1. Cloudflare dashboard > Turnstile > Add widget, for `democracyinaction.eu` and
   `dia-2af02e.webflow.io`. Mode "Managed".
2. `npx wrangler secret put TURNSTILE_SECRET` with the widget's secret key.
3. In Webflow, add `data-turnstile-sitekey="<site key>"` to the Form Block.

From then on the Worker refuses any signup without a valid token, so do steps 2 and 3
together. The site key is public; the secret is not. The form side of this is built and
tested against a stand-in for the widget, but not yet against the real one: check a
signup on staging right after turning it on.

## Change things

- **Allowed sites:** `ALLOWED_ORIGINS` in `src/constants.js`, then `npx wrangler deploy`.
- **Tag:** signups get the Mailchimp tag `Website` (`MAILCHIMP_TAGS` in
  `wrangler.jsonc`, comma-separated, empty for none).
- **Signup page:** the page a signup came from goes into the audience field with the
  merge tag `REFERRER` (`MAILCHIMP_PAGE_FIELD` in `wrangler.jsonc`, empty to leave it
  out). Create it in Mailchimp under Audience > Settings > Audience fields and merge
  tags: type Text, not required, tag `REFERRER`. Only new signups get it.
- **Own domain:** if the domain's DNS is on Cloudflare, add a route such as
  `api.democracyinaction.eu/subscribe` in `wrangler.jsonc` and update the form's Action.

## Develop

    cp .dev.vars.example .dev.vars    # local secrets, gitignored
    npm run dev                       # http://localhost:8787
    npm test                          # Mailchimp and Turnstile are faked, nothing leaves your machine

## Files

    src/index.js        the checks, in order
    src/mailchimp.js    subscribe, re-subscribe, how Mailchimp's replies map to codes
    src/turnstile.js    token check
    src/respond.js      success() and failure()
    src/constants.js    allowed sites, limits, codes
    wrangler.jsonc      name, rate limit, tag, page field (no secrets)
    test/               npm test

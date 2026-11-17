import { CODES } from './constants.js'

const json = (body, status, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  })

// One reply for every success path: a new signup, an address that is already on the
// list, a re-subscribe and a filled honeypot all look the same from the outside, so the
// form can't be used to test whether an address is subscribed.
export const success = (headers) => json({ ok: true, code: CODES.SUBSCRIBED }, 200, headers)

// A code, never Mailchimp's own text. Details go to the Worker log.
export const failure = (code, status, headers) => json({ ok: false, code }, status, headers)

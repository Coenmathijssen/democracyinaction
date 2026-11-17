import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, test } from 'node:test'

import worker from '../src/index.js'

// Run with `npm test`. Mailchimp and Turnstile are replaced by a fake fetch, so the
// tests never touch the network or a real audience.

const ORIGIN = 'https://www.democracyinaction.eu'
const URL_SUBSCRIBE = 'https://dia-newsletter.example.workers.dev/subscribe'
const MEMBERS = 'https://us20.api.mailchimp.com/3.0/lists/abc123/members'
const ENV = {
  MAILCHIMP_API_KEY: 'testkey-us20',
  MAILCHIMP_AUDIENCE_ID: 'abc123',
  MAILCHIMP_TAGS: 'Website',
  MAILCHIMP_PAGE_FIELD: 'REFERRER',
}

const realFetch = globalThis.fetch
const realDigest = crypto.subtle.digest.bind(crypto.subtle)
let calls

// Workers support MD5 in crypto.subtle; Node doesn't.
crypto.subtle.digest = async (algorithm, data) =>
  algorithm === 'MD5' ? createHash('md5').update(Buffer.from(data)).digest().buffer : realDigest(algorithm, data)

// Each entry answers one outgoing request, in order.
const mockFetch = (...replies) => {
  calls = []
  globalThis.fetch = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ url: String(url), method: init.method, body, headers: init.headers })
    const reply = replies.shift()
    if (reply instanceof Error) throw reply
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status })
  }
}

const post = (body, { env = ENV, origin = ORIGIN, headers = {} } = {}) =>
  worker.fetch(
    new Request(URL_SUBSCRIBE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, 'CF-Connecting-IP': '203.0.113.7', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env,
  )

const read = async (response) => ({ status: response.status, ...(await response.json()) })

const memberUrl = (email) => `${MEMBERS}/${createHash('md5').update(email).digest('hex')}`
const SUBSCRIBED = { status: 200, ok: true, code: 'subscribed' }
const UNAVAILABLE = { status: 502, ok: false, code: 'unavailable' }
const EMAIL_REFUSED = { status: 409, ok: false, code: 'email_refused' }
const MEMBER_EXISTS = { status: 400, body: { title: 'Member Exists' } }
const COMPLIANCE_STATE = { status: 400, body: { title: 'Member In Compliance State' } }

beforeEach(() => mockFetch())
afterEach(() => {
  globalThis.fetch = realFetch
})

test('a new address is added as pending, with the first name, the page and the tag', async () => {
  mockFetch({ status: 200 })
  const response = await post({ email: '  Jane@Example.org ', firstName: ' Jane ', page: `${ORIGIN}/about` })

  assert.deepEqual(await read(response), SUBSCRIBED)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, MEMBERS)
  assert.deepEqual(calls[0].body, {
    email_address: 'jane@example.org',
    status: 'pending',
    merge_fields: { FNAME: 'Jane', REFERRER: `${ORIGIN}/about` },
    tags: ['Website'],
  })
  assert.equal(calls[0].headers.Authorization, `Basic ${btoa('key:testkey-us20')}`)
})

test('the page is stored without its query and fragment, and cut to what the field holds', async () => {
  mockFetch({ status: 200 })
  await post({ email: 'jane@example.org', page: `${ORIGIN}/events/?utm_source=mail&email=jane@example.org#signup` })
  assert.deepEqual(calls[0].body.merge_fields, { REFERRER: `${ORIGIN}/events/` })

  mockFetch({ status: 200 })
  await post({ email: 'jane@example.org', page: `${ORIGIN}/${'a'.repeat(400)}` })
  assert.equal(calls[0].body.merge_fields.REFERRER.length, 255)
})

test('a page that is not on the site that sent the request is left out', async () => {
  for (const page of ['https://evil.example/', 'https://democracyinaction.eu/about', '/about', 'javascript:alert(1)', 42, null]) {
    mockFetch({ status: 200 })
    await post({ email: 'jane@example.org', page })
    assert.deepEqual(calls[0].body, { email_address: 'jane@example.org', status: 'pending', tags: ['Website'] })
  }
})

test('without MAILCHIMP_PAGE_FIELD the page is not sent', async () => {
  mockFetch({ status: 200 })
  await post({ email: 'jane@example.org', page: `${ORIGIN}/about` }, { env: { ...ENV, MAILCHIMP_PAGE_FIELD: '' } })
  assert.equal(calls[0].body.merge_fields, undefined)
})

test('a signup is not lost when Mailchimp rejects the page field', async () => {
  const rejection = { status: 400, body: { title: 'Invalid Resource', errors: [{ field: 'REFERRER', message: 'Unknown field.' }] } }

  mockFetch(rejection, { status: 200 })
  assert.deepEqual(await read(await post({ email: 'jane@example.org', firstName: 'Jane', page: `${ORIGIN}/about` })), SUBSCRIBED)
  assert.deepEqual(calls[1].body.merge_fields, { FNAME: 'Jane' })

  // Still rejected without the page: something else is wrong. No third try.
  mockFetch(rejection, rejection)
  assert.deepEqual(await read(await post({ email: 'jane@example.org', page: `${ORIGIN}/about` })), UNAVAILABLE)
  assert.equal(calls.length, 2)
})

test('an address that is on the list, or still has to confirm, gets the same success', async () => {
  for (const status of ['subscribed', 'pending']) {
    mockFetch(MEMBER_EXISTS, { status: 200, body: { status } })
    assert.deepEqual(await read(await post({ email: 'Jane@example.org' })), SUBSCRIBED)

    // Looked up, not changed.
    assert.equal(calls.length, 2)
    assert.equal(calls[1].method, 'GET')
    assert.equal(calls[1].url, `${memberUrl('jane@example.org')}?fields=status`)
    assert.equal(calls[1].body, undefined)
  }
})

test('an address that unsubscribed earlier is set back to pending', async () => {
  for (const status of ['unsubscribed', 'archived']) {
    mockFetch(MEMBER_EXISTS, { status: 200, body: { status } }, { status: 200 })
    assert.deepEqual(await read(await post({ email: 'jane@example.org' })), SUBSCRIBED)
    assert.equal(calls[2].method, 'PUT')
    assert.equal(calls[2].url, memberUrl('jane@example.org'))
    assert.deepEqual(calls[2].body, { email_address: 'jane@example.org', status: 'pending' })
  }

  // The other way Mailchimp can say it: straight on the first request.
  mockFetch(COMPLIANCE_STATE, { status: 200 })
  assert.deepEqual(await read(await post({ email: 'jane@example.org' })), SUBSCRIBED)
  assert.equal(calls[1].method, 'PUT')
  assert.equal(calls[1].url, memberUrl('jane@example.org'))
})

test('an address Mailchimp refuses for good gets its own answer', async () => {
  // Bounced ("cleaned"): Mailchimp won't set it back to pending.
  mockFetch(MEMBER_EXISTS, { status: 200, body: { status: 'cleaned' } }, COMPLIANCE_STATE)
  assert.deepEqual(await read(await post({ email: 'jane@example.org' })), EMAIL_REFUSED)

  mockFetch(COMPLIANCE_STATE, COMPLIANCE_STATE)
  assert.deepEqual(await read(await post({ email: 'jane@example.org' })), EMAIL_REFUSED)

  // Erased under GDPR.
  mockFetch({ status: 400, body: { title: 'Forgotten Email Not Subscribed' } })
  assert.deepEqual(await read(await post({ email: 'jane@example.org' })), EMAIL_REFUSED)
  assert.equal(calls.length, 1)
})

test('a failed lookup or re-subscribe is answered as unavailable', async () => {
  mockFetch(MEMBER_EXISTS, { status: 500, body: { title: 'Internal Server Error' } })
  assert.deepEqual(await read(await post({ email: 'jane@example.org' })), UNAVAILABLE)
  assert.equal(calls.length, 2)

  mockFetch(MEMBER_EXISTS, { status: 200, body: { status: 'unsubscribed' } }, { status: 500, body: {} })
  assert.deepEqual(await read(await post({ email: 'jane@example.org' })), UNAVAILABLE)
})

test('an address Mailchimp holds back for signing up to many lists is answered as unavailable', async () => {
  const detail = 'jane@example.org has signed up to a lot of lists very recently; we\'re not allowing more signups for now'
  mockFetch({ status: 400, body: { title: 'Invalid Resource', detail } })
  assert.deepEqual(await read(await post({ email: 'jane@example.org' })), UNAVAILABLE)
})

test('an address Mailchimp rejects is an invalid email, however it words it', async () => {
  const rejections = [
    { detail: 'x@example.org looks fake or invalid, please enter a real email address.' },
    { detail: 'Please provide a valid email address.' },
    { detail: 'The resource submitted could not be validated.', errors: [{ field: 'email_address', message: 'This value should be a valid email.' }] },
    {},
  ]
  for (const rejection of rejections) {
    mockFetch({ status: 400, body: { title: 'Invalid Resource', ...rejection } })
    assert.deepEqual(await read(await post({ email: 'x@example.org' })), { status: 400, ok: false, code: 'invalid_email' })
  }
})

test('a rejected audience field is not blamed on the address', async () => {
  mockFetch({ status: 400, body: { title: 'Invalid Resource', errors: [{ field: 'MMERGE5', message: 'This value should not be blank.' }] } })
  assert.deepEqual(await read(await post({ email: 'jane@example.org' })), UNAVAILABLE)
  assert.equal(calls.length, 1)
})

test('a Mailchimp error or a timeout is answered as unavailable', async () => {
  mockFetch({ status: 500, body: { title: 'Internal Server Error' } })
  assert.deepEqual(await read(await post({ email: 'jane@example.org' })), UNAVAILABLE)

  mockFetch(new DOMException('timed out', 'TimeoutError'))
  assert.deepEqual(await read(await post({ email: 'jane@example.org' })), UNAVAILABLE)
})

test('a bad address never reaches Mailchimp', async () => {
  for (const email of ['', 'jane', 'jane@example', 'jane @example.org', `${'a'.repeat(250)}@example.org`, 42, null]) {
    assert.deepEqual(await read(await post({ email })), { status: 400, ok: false, code: 'invalid_email' })
  }
  assert.equal(calls.length, 0)
})

test('a filled honeypot gets a success and nothing is sent', async () => {
  assert.deepEqual(await read(await post({ email: 'bot@example.org', website: 'https://spam.example' })), SUBSCRIBED)
  assert.equal(calls.length, 0)
})

test('other origins are refused without CORS headers', async () => {
  for (const origin of ['https://evil.example', 'https://democracyinaction.eu.evil.example', 'null']) {
    const response = await post({ email: 'jane@example.org' }, { origin })
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null)
    assert.deepEqual(await read(response), { status: 403, ok: false, code: 'verification_failed' })
  }
  assert.equal(calls.length, 0)
})

test('the preflight is answered for an allowed origin only', async () => {
  const preflight = (origin) =>
    worker.fetch(new Request(URL_SUBSCRIBE, { method: 'OPTIONS', headers: { Origin: origin } }), ENV)

  const allowed = await preflight('https://dia-2af02e.webflow.io')
  assert.equal(allowed.status, 204)
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'https://dia-2af02e.webflow.io')
  assert.equal(allowed.headers.get('Access-Control-Allow-Headers'), 'Content-Type')

  assert.equal((await preflight('https://evil.example')).status, 403)
})

test('only small JSON posts to /subscribe are accepted', async () => {
  const get = await worker.fetch(new Request(URL_SUBSCRIBE, { headers: { Origin: ORIGIN } }), ENV)
  assert.equal(get.status, 405)

  const elsewhere = await worker.fetch(new Request('https://dia-newsletter.example.workers.dev/', { headers: { Origin: ORIGIN } }), ENV)
  assert.equal(elsewhere.status, 404)

  const form = await post('EMAIL=jane%40example.org', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
  assert.deepEqual(await read(form), { status: 400, ok: false, code: 'verification_failed' })

  assert.equal((await post('{not json')).status, 400)
  assert.equal((await post('["jane@example.org"]')).status, 400)
  assert.equal((await post({ email: 'jane@example.org', padding: 'x'.repeat(5000) })).status, 400)
  assert.equal(calls.length, 0)
})

test('the rate limit answers 429 before Mailchimp is called', async () => {
  const keys = []
  const env = { ...ENV, RATE_LIMITER: { limit: async ({ key }) => (keys.push(key), { success: false }) } }

  assert.deepEqual(await read(await post({ email: 'jane@example.org' }, { env })), { status: 429, ok: false, code: 'rate_limited' })
  assert.deepEqual(keys, ['203.0.113.7'])
  assert.equal(calls.length, 0)
})

test('with a Turnstile secret, the token is verified first', async () => {
  const env = { ...ENV, TURNSTILE_SECRET: 'turnstile-secret' }

  // No token: refused without asking Cloudflare or Mailchimp.
  assert.deepEqual(await read(await post({ email: 'jane@example.org' }, { env })), { status: 403, ok: false, code: 'verification_failed' })
  assert.equal(calls.length, 0)

  mockFetch({ status: 200, body: { success: false, 'error-codes': ['invalid-input-response'] } })
  assert.equal((await post({ email: 'jane@example.org', token: 'bad' }, { env })).status, 403)
  assert.equal(calls.length, 1)

  mockFetch({ status: 200, body: { success: true } }, { status: 200 })
  assert.deepEqual(await read(await post({ email: 'jane@example.org', token: 'good' }, { env })), SUBSCRIBED)
  assert.equal(calls[0].url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify')
  assert.deepEqual(calls[0].body, { secret: 'turnstile-secret', response: 'good', remoteip: '203.0.113.7' })
  assert.match(calls[1].url, /api\.mailchimp\.com/)
})

test('missing or malformed secrets are answered as unavailable', async () => {
  for (const env of [{}, { MAILCHIMP_API_KEY: 'testkey-us20' }, { MAILCHIMP_API_KEY: 'no-datacenter', MAILCHIMP_AUDIENCE_ID: 'abc123' }]) {
    assert.deepEqual(await read(await post({ email: 'jane@example.org' }, { env })), { status: 503, ok: false, code: 'unavailable' })
  }
  assert.equal(calls.length, 0)
})

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, test } from 'node:test'

import worker from '../src/index.js'

// Run with `npm test`. Mailchimp and Turnstile are replaced by a fake fetch, so the
// tests never touch the network or a real audience.

const ORIGIN = 'https://www.democracyinaction.eu'
const URL_SUBSCRIBE = 'https://dia-newsletter.example.workers.dev/subscribe'
const ENV = { MAILCHIMP_API_KEY: 'testkey-us20', MAILCHIMP_AUDIENCE_ID: 'abc123', MAILCHIMP_TAGS: 'Website' }

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
    calls.push({ url: String(url), method: init.method, body: JSON.parse(init.body), headers: init.headers })
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

beforeEach(() => mockFetch())
afterEach(() => {
  globalThis.fetch = realFetch
})

test('a new address is added as pending, with the first name and the tag', async () => {
  mockFetch({ status: 200 })
  const response = await post({ email: '  Jane@Example.org ', firstName: ' Jane ' })

  assert.deepEqual(await read(response), { status: 200, ok: true, code: 'subscribed' })
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://us20.api.mailchimp.com/3.0/lists/abc123/members')
  assert.deepEqual(calls[0].body, {
    email_address: 'jane@example.org',
    status: 'pending',
    merge_fields: { FNAME: 'Jane' },
    tags: ['Website'],
  })
  assert.equal(calls[0].headers.Authorization, `Basic ${btoa('key:testkey-us20')}`)
})

test('an address that is already on the list gets the same success', async () => {
  mockFetch({ status: 400, body: { title: 'Member Exists' } })
  assert.deepEqual(await read(await post({ email: 'jane@example.org' })), { status: 200, ok: true, code: 'subscribed' })
})

test('an unsubscribed address is set back to pending', async () => {
  mockFetch({ status: 400, body: { title: 'Member In Compliance State' } }, { status: 200 })
  const response = await post({ email: 'Jane@example.org' })

  assert.deepEqual(await read(response), { status: 200, ok: true, code: 'subscribed' })
  assert.equal(calls[1].method, 'PUT')
  assert.equal(
    calls[1].url,
    `https://us20.api.mailchimp.com/3.0/lists/abc123/members/${createHash('md5').update('jane@example.org').digest('hex')}`,
  )
  assert.deepEqual(calls[1].body, { email_address: 'jane@example.org', status: 'pending' })
})

test('an address erased under GDPR gets the normal success', async () => {
  mockFetch({ status: 400, body: { title: 'Forgotten Email Not Subscribed' } })
  assert.deepEqual(await read(await post({ email: 'jane@example.org' })), { status: 200, ok: true, code: 'subscribed' })
})

test('an address Mailchimp rejects is an invalid email', async () => {
  mockFetch({ status: 400, body: { title: 'Invalid Resource', detail: 'x@example.org looks fake or invalid, please enter a real email address.' } })
  assert.deepEqual(await read(await post({ email: 'x@example.org' })), { status: 400, ok: false, code: 'invalid_email' })
})

test('a rejected audience field is not blamed on the address', async () => {
  mockFetch({ status: 400, body: { title: 'Invalid Resource', errors: [{ field: 'MMERGE5', message: 'This value should not be blank.' }] } })
  assert.deepEqual(await read(await post({ email: 'jane@example.org' })), { status: 502, ok: false, code: 'unavailable' })
})

test('a Mailchimp error or a timeout is answered as unavailable', async () => {
  mockFetch({ status: 500, body: { title: 'Internal Server Error' } })
  assert.deepEqual(await read(await post({ email: 'jane@example.org' })), { status: 502, ok: false, code: 'unavailable' })

  mockFetch(new DOMException('timed out', 'TimeoutError'))
  assert.deepEqual(await read(await post({ email: 'jane@example.org' })), { status: 502, ok: false, code: 'unavailable' })
})

test('a bad address never reaches Mailchimp', async () => {
  for (const email of ['', 'jane', 'jane@example', 'jane @example.org', `${'a'.repeat(250)}@example.org`, 42, null]) {
    assert.deepEqual(await read(await post({ email })), { status: 400, ok: false, code: 'invalid_email' })
  }
  assert.equal(calls.length, 0)
})

test('a filled honeypot gets a success and nothing is sent', async () => {
  assert.deepEqual(await read(await post({ email: 'bot@example.org', website: 'https://spam.example' })), {
    status: 200,
    ok: true,
    code: 'subscribed',
  })
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
  assert.deepEqual(await read(await post({ email: 'jane@example.org', token: 'good' }, { env })), { status: 200, ok: true, code: 'subscribed' })
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

import {
  ALLOWED_ORIGINS,
  CODES,
  EMAIL_PATTERN,
  MAX_BODY_BYTES,
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PAGE_LENGTH,
  SUBSCRIBE_PATH,
} from './constants.js'
import * as mailchimp from './mailchimp.js'
import { failure, success } from './respond.js'
import * as turnstile from './turnstile.js'

/**
 * Newsletter signup for the Democracy in Action site: POST /subscribe.
 *
 * The site's form (src/components/newsletter-form.js) posts JSON here, and the Worker
 * adds the address to the Mailchimp audience with the API key that only it holds.
 * The cheap checks run first; Mailchimp is only called for a request that passed them all.
 * Setup and the response codes: worker/README.md.
 */

// The HTTP status of a failed signup. Any other code is Mailchimp's or the Worker's own: 502.
const FAILURE_STATUS = { [CODES.INVALID_EMAIL]: 400, [CODES.EMAIL_REFUSED]: 409 }

const corsHeaders = (origin) => ({ 'Access-Control-Allow-Origin': origin, Vary: 'Origin' })

const preflight = (cors) =>
  new Response(null, {
    status: 204,
    headers: {
      ...cors,
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  })

// A small JSON object, or null for anything else.
const readBody = async (request) => {
  if (!request.headers.get('Content-Type')?.includes('application/json')) return null
  if (Number(request.headers.get('Content-Length')) > MAX_BODY_BYTES) return null

  const text = await request.text()
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return null

  try {
    const body = JSON.parse(text)
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null
  } catch {
    return null
  }
}

// The Worker decides what a valid address is. The browser's type="email" is a convenience.
const normalizeEmail = (value) => {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(email) ? email : null
}

const normalizeName = (value) => (typeof value === 'string' ? value.trim().slice(0, MAX_NAME_LENGTH) : '')

// The page the signup came from. Only a page of the site that sent the request counts,
// and without its query and fragment, which can hold tracking or personal data.
const normalizePage = (value, origin) => {
  if (typeof value !== 'string') return ''
  try {
    const url = new URL(value)
    return url.origin === origin ? `${url.origin}${url.pathname}`.slice(0, MAX_PAGE_LENGTH) : ''
  } catch {
    return ''
  }
}

// The binding counts per Cloudflare location and is approximate, which is enough to
// stop one visitor from hammering the form. Without the binding nothing is limited.
const isRateLimited = async (env, ip) => {
  if (!env.RATE_LIMITER) return false
  try {
    const { success: allowed } = await env.RATE_LIMITER.limit({ key: ip })
    return !allowed
  } catch (error) {
    console.error('[newsletter] rate limit failed', error.name)
    return false
  }
}

const handle = async (request, env) => {
  if (new URL(request.url).pathname !== SUBSCRIBE_PATH) return new Response('Not found', { status: 404 })

  // 1. Origin. Other sites get no CORS headers, so their browsers refuse the reply.
  const origin = request.headers.get('Origin')
  if (!ALLOWED_ORIGINS.includes(origin)) return failure(CODES.VERIFICATION_FAILED, 403)

  const cors = corsHeaders(origin)
  if (request.method === 'OPTIONS') return preflight(cors)
  if (request.method !== 'POST') return failure(CODES.VERIFICATION_FAILED, 405, { ...cors, Allow: 'POST, OPTIONS' })

  // 2. Shape. JSON forces the browser to ask first (preflight), which a plain form
  //    post from another site can't do.
  const body = await readBody(request)
  if (!body) return failure(CODES.VERIFICATION_FAILED, 400, cors)

  // 3. Honeypot. A field no person sees or fills in. Bots get the normal success.
  if (body.website) return success(cors)

  // 4. Rate limit, per visitor IP.
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  if (await isRateLimited(env, ip)) return failure(CODES.RATE_LIMITED, 429, cors)

  // 5. Email.
  const email = normalizeEmail(body.email)
  if (!email) return failure(CODES.INVALID_EMAIL, 400, cors)

  // 6. Turnstile, once its secret is set.
  if (turnstile.isEnabled(env) && !(await turnstile.verify(env, body.token, ip))) {
    return failure(CODES.VERIFICATION_FAILED, 403, cors)
  }

  if (!mailchimp.isConfigured(env)) {
    console.error('[newsletter] MAILCHIMP_API_KEY or MAILCHIMP_AUDIENCE_ID is missing or malformed')
    return failure(CODES.UNAVAILABLE, 503, cors)
  }

  const code = await mailchimp.subscribe(env, {
    email,
    firstName: normalizeName(body.firstName),
    page: normalizePage(body.page, origin),
  })
  if (code === CODES.SUBSCRIBED) return success(cors)
  return failure(code, FAILURE_STATUS[code] ?? 502, cors)
}

export default {
  fetch: async (request, env) => {
    try {
      return await handle(request, env)
    } catch (error) {
      console.error('[newsletter] unexpected', error.name, error.message)
      const origin = request.headers.get('Origin')
      return failure(CODES.UNAVAILABLE, 500, ALLOWED_ORIGINS.includes(origin) ? corsHeaders(origin) : {})
    }
  },
}

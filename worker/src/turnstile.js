import { MAX_TOKEN_LENGTH, TURNSTILE_TIMEOUT, TURNSTILE_VERIFY_URL } from './constants.js'

// Turnstile is optional: it is on once the TURNSTILE_SECRET secret exists.
export const isEnabled = (env) => Boolean(env.TURNSTILE_SECRET)

// Asks Cloudflare whether the token from the form is real. A token works once and for
// five minutes. Anything unexpected counts as not verified.
export const verify = async (env, token, ip) => {
  if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_LENGTH) return false

  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(TURNSTILE_TIMEOUT),
    })
    const result = await response.json()

    if (result.success !== true) console.warn('[newsletter] turnstile rejected', result['error-codes'])
    return result.success === true
  } catch (error) {
    console.error('[newsletter] turnstile failed', error.name)
    return false
  }
}

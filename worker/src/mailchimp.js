import { CODES, MAILCHIMP_TIMEOUT } from './constants.js'

// A Mailchimp key ends in its datacenter, like "-us20". That suffix is the API's subdomain.
const DATACENTER_PATTERN = /-([a-z]+\d+)$/

export const isConfigured = (env) =>
  DATACENTER_PATTERN.test(env.MAILCHIMP_API_KEY ?? '') && Boolean(env.MAILCHIMP_AUDIENCE_ID)

const membersUrl = (env) => {
  const [, datacenter] = env.MAILCHIMP_API_KEY.match(DATACENTER_PATTERN)
  return `https://${datacenter}.api.mailchimp.com/3.0/lists/${env.MAILCHIMP_AUDIENCE_ID}/members`
}

const call = (env, method, url, body) =>
  fetch(url, {
    method,
    headers: {
      // Mailchimp uses basic auth with any username and the key as the password.
      Authorization: `Basic ${btoa(`key:${env.MAILCHIMP_API_KEY}`)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(MAILCHIMP_TIMEOUT),
  })

// Mailchimp's error body: { title, detail, errors: [{ field, message }] }.
const readError = async (response) => (await response.json().catch(() => null)) ?? {}

// The log gets the status, Mailchimp's title and the field names. Never the address,
// and never `detail`, which can repeat the address.
const log = (response, error) => {
  const fields = (error.errors ?? []).map(({ field }) => field).join(', ')
  console.error('[newsletter] mailchimp', response.status, error.title ?? 'unknown', fields)
}

// "Invalid Resource" covers more than a bad address: a required audience field can
// trigger it too. Only blame the address when Mailchimp does.
const isAddressRejected = (error) =>
  (error.errors ?? []).some(({ field }) => field === 'email_address') ||
  /looks fake or invalid/i.test(error.detail ?? '')

const tags = (env) =>
  (env.MAILCHIMP_TAGS ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)

// Mailchimp addresses a member by the MD5 of the lowercased email.
const subscriberHash = async (email) => {
  const digest = await crypto.subtle.digest('MD5', new TextEncoder().encode(email.toLowerCase()))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

// Someone who unsubscribed earlier can't be added with POST. Setting them back to
// pending sends a fresh confirmation email, so they opt in again themselves.
const resubscribe = async (env, email) => {
  const url = `${membersUrl(env)}/${await subscriberHash(email)}`
  const response = await call(env, 'PUT', url, { email_address: email, status: 'pending' })
  if (response.ok) return CODES.SUBSCRIBED

  log(response, await readError(response))
  return CODES.UNAVAILABLE
}

/**
 * Adds the address to the audience as `pending`, so Mailchimp sends the confirmation
 * email (double opt-in). Returns one of CODES.
 */
export const subscribe = async (env, { email, firstName }) => {
  const member = { email_address: email, status: 'pending' }
  if (firstName) member.merge_fields = { FNAME: firstName }
  if (tags(env).length) member.tags = tags(env)

  try {
    const response = await call(env, 'POST', membersUrl(env), member)
    if (response.ok) return CODES.SUBSCRIBED

    const error = await readError(response)

    switch (error.title) {
      case 'Member Exists':
        return CODES.SUBSCRIBED

      case 'Member In Compliance State':
        return await resubscribe(env, email)

      // Erased under GDPR. The API can't add them again; only Mailchimp's own signup
      // form can. Answered as a success so it doesn't reveal anything.
      case 'Forgotten Email Not Subscribed':
        log(response, error)
        return CODES.SUBSCRIBED

      case 'Invalid Resource':
        if (isAddressRejected(error)) return CODES.INVALID_EMAIL
        log(response, error)
        return CODES.UNAVAILABLE

      default:
        log(response, error)
        return CODES.UNAVAILABLE
    }
  } catch (error) {
    // A timeout or a network failure.
    console.error('[newsletter] mailchimp failed', error.name)
    return CODES.UNAVAILABLE
  }
}

import { CODES, MAILCHIMP_TIMEOUT } from './constants.js'

// A Mailchimp key ends in its datacenter, like "-us20". That suffix is the API's subdomain.
const DATACENTER_PATTERN = /-([a-z]+\d+)$/
// A member with one of these statuses needs nothing: on the list, or still to confirm.
const SETTLED_STATUSES = ['subscribed', 'pending']
// Mailchimp won't take the address through the API, and trying again doesn't change that.
const REFUSED_TITLES = ['Member In Compliance State', 'Forgotten Email Not Subscribed']
// Mailchimp holds an address back for a day or two when it signed up to many lists at once.
const THROTTLED_PATTERN = /signed up to a lot of lists|not allowing more signups/i

export const isConfigured = (env) =>
  DATACENTER_PATTERN.test(env.MAILCHIMP_API_KEY ?? '') && Boolean(env.MAILCHIMP_AUDIENCE_ID)

const membersUrl = (env) => {
  const [, datacenter] = env.MAILCHIMP_API_KEY.match(DATACENTER_PATTERN)
  return `https://${datacenter}.api.mailchimp.com/3.0/lists/${env.MAILCHIMP_AUDIENCE_ID}/members`
}

// Mailchimp addresses a member by the MD5 of the lowercased email.
const memberUrl = async (env, email) => {
  const digest = await crypto.subtle.digest('MD5', new TextEncoder().encode(email.toLowerCase()))
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${membersUrl(env)}/${hash}`
}

const call = (env, method, url, body) =>
  fetch(url, {
    method,
    headers: {
      // Mailchimp uses basic auth with any username and the key as the password.
      Authorization: `Basic ${btoa(`key:${env.MAILCHIMP_API_KEY}`)}`,
      'Content-Type': 'application/json',
    },
    body: body && JSON.stringify(body),
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

// "Invalid Resource" is Mailchimp's answer to an address it won't take, in several
// wordings. A rejected audience field gets the same title, but then `errors` names that
// field. So the address is at fault unless Mailchimp points at another field.
const blamesAnotherField = (error) => (error.errors ?? []).some(({ field }) => !/email/i.test(field ?? ''))

const tags = (env) =>
  (env.MAILCHIMP_TAGS ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)

// The page of the signup goes into the audience field named by MAILCHIMP_PAGE_FIELD.
const hasPage = (env, { page }) => Boolean(page && env.MAILCHIMP_PAGE_FIELD)

const newMember = (env, signup) => {
  const fields = {}
  if (signup.firstName) fields.FNAME = signup.firstName
  if (hasPage(env, signup)) fields[env.MAILCHIMP_PAGE_FIELD] = signup.page

  const member = { email_address: signup.email, status: 'pending' }
  if (Object.keys(fields).length) member.merge_fields = fields
  if (tags(env).length) member.tags = tags(env)
  return member
}

// Back to pending, so Mailchimp sends a fresh confirmation email and the person opts in
// again themselves. Mailchimp refuses this for an address that bounced or was erased.
const resubscribe = async (env, email) => {
  const response = await call(env, 'PUT', await memberUrl(env, email), { email_address: email, status: 'pending' })
  if (response.ok) return CODES.SUBSCRIBED

  const error = await readError(response)
  log(response, error)
  return REFUSED_TITLES.includes(error.title) ? CODES.EMAIL_REFUSED : CODES.UNAVAILABLE
}

// "Member Exists" comes back for every member, also one who unsubscribed. The status
// tells them apart. It is looked up first, because setting a subscribed member to
// pending would take them off the list until they confirm again.
const revive = async (env, email) => {
  const response = await call(env, 'GET', `${await memberUrl(env, email)}?fields=status`)
  if (!response.ok) {
    log(response, await readError(response))
    return CODES.UNAVAILABLE
  }

  const { status } = await response.json()
  return SETTLED_STATUSES.includes(status) ? CODES.SUBSCRIBED : resubscribe(env, email)
}

const add = async (env, signup) => {
  const response = await call(env, 'POST', membersUrl(env), newMember(env, signup))
  if (response.ok) return CODES.SUBSCRIBED

  const error = await readError(response)

  switch (error.title) {
    case 'Member Exists':
      return revive(env, signup.email)

    case 'Member In Compliance State':
      return resubscribe(env, signup.email)

    // Erased under GDPR. The API can't add them again; only Mailchimp's own signup form can.
    case 'Forgotten Email Not Subscribed':
      log(response, error)
      return CODES.EMAIL_REFUSED

    case 'Invalid Resource':
      if (THROTTLED_PATTERN.test(error.detail ?? '')) {
        log(response, error)
        return CODES.UNAVAILABLE
      }
      if (!blamesAnotherField(error)) return CODES.INVALID_EMAIL

      log(response, error)
      // The page is an extra. A signup is not lost over its audience field: once more without.
      return hasPage(env, signup) ? add(env, { ...signup, page: '' }) : CODES.UNAVAILABLE

    default:
      log(response, error)
      return CODES.UNAVAILABLE
  }
}

/**
 * Adds the address to the audience as `pending`, so Mailchimp sends the confirmation
 * email (double opt-in). Returns one of CODES.
 */
export const subscribe = async (env, signup) => {
  try {
    return await add(env, signup)
  } catch (error) {
    // A timeout or a network failure.
    console.error('[newsletter] mailchimp failed', error.name)
    return CODES.UNAVAILABLE
  }
}

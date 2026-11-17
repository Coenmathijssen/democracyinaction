// Sites allowed to call the Worker. Browsers send the page's origin with every request.
export const ALLOWED_ORIGINS = [
  'https://www.democracyinaction.eu',
  'https://democracyinaction.eu',
  'https://dia-2af02e.webflow.io',
]

export const SUBSCRIBE_PATH = '/subscribe'

// Room for a Turnstile token (up to 2048 characters) plus the fields.
export const MAX_BODY_BYTES = 4096
export const MAX_EMAIL_LENGTH = 254
export const MAX_NAME_LENGTH = 80
export const MAX_TOKEN_LENGTH = 2048
// What a Mailchimp text field holds.
export const MAX_PAGE_LENGTH = 255
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Milliseconds.
export const MAILCHIMP_TIMEOUT = 8000
export const TURNSTILE_TIMEOUT = 5000

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

// The only answers the form ever gets. The copy for each code lives in Webflow.
export const CODES = {
  SUBSCRIBED: 'subscribed',
  INVALID_EMAIL: 'invalid_email',
  EMAIL_REFUSED: 'email_refused',
  VERIFICATION_FAILED: 'verification_failed',
  RATE_LIMITED: 'rate_limited',
  UNAVAILABLE: 'unavailable',
}

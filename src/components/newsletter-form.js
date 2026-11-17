import gsap from 'gsap'

// How long the Worker may take before the form gives up, in ms.
const REQUEST_TIMEOUT = 10000
// How long a submit waits for Turnstile's token, in ms.
const TURNSTILE_TIMEOUT = 8000
const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

// The Worker's answers (worker/src/constants.js), plus one for a request that never got there.
const SUBSCRIBED = 'subscribed'
const INVALID_EMAIL = 'invalid_email'
const UNAVAILABLE = 'unavailable'
const OFFLINE = 'offline'

/**
 * Newsletter form: sends the signup to the newsletter Worker (worker/), which adds the
 * address to Mailchimp, and shows the Worker's answer in the Form Block's own success
 * and error blocks.
 *
 * The form's Action (Form settings in the Designer) is the Worker's /subscribe URL.
 * The error copy for each answer sits on the root as data-message-<code>, so wording
 * changes need no release. Without one, the error block keeps its Designer text.
 *
 * Markup (docs/markup.md): data-component="newsletter-form" on the Form Block.
 */
export default class NewsletterForm {
  constructor(element) {
    if (!element) return
    this.element = element
    this.init()
  }

  init = () => {
    this.form = this.element.querySelector('form')
    this.success = this.element.querySelector('[data-js="newsletter-success"]')
    this.error = this.element.querySelector('[data-js="newsletter-error"]')
    this.endpoint = this.form?.getAttribute('action')
    if (!this.endpoint || !this.success || !this.error) return

    this.email = this.form.elements.EMAIL
    this.firstName = this.form.elements.FNAME
    this.submit = this.form.querySelector('[type="submit"]')
    this.label = this.submit?.value
    this.message = this.error.querySelector('[data-js="newsletter-message"]') ?? this.error
    this.defaultMessage = this.message.textContent
    this.sitekey = this.element.dataset.turnstileSitekey
    this.loading = false
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    this.honeypot = this.createHoneypot()
    this.setAria()
    this.createTimelines()
    this.bindEvents()
  }

  destroy = () => {
    this.errorTimeline?.kill()
    this.successTimeline?.kill()
    this.form?.removeEventListener('submit', this.handleSubmit)
    this.form?.removeEventListener('focusin', this.handleFirstFocus)
    this.email?.removeEventListener('input', this.clearInvalid)
    this.honeypot?.remove()
    this.turnstileElement?.remove()
  }

  // A field no person sees or fills in. The Worker drops any signup that has it filled.
  createHoneypot = () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.name = 'website'
    input.tabIndex = -1
    input.autocomplete = 'off'
    input.setAttribute('aria-hidden', 'true')
    Object.assign(input.style, {
      position: 'absolute',
      left: '-9999px',
      width: '1px',
      height: '1px',
      opacity: '0',
    })
    this.form.append(input)
    return input
  }

  setAria = () => {
    this.error.id ||= 'newsletter-error'
    this.success.tabIndex = -1
  }

  // Built once. play() reveals, reverse() hides.
  createTimelines = () => {
    this.errorTimeline = gsap
      .timeline({ paused: true, defaults: { ease: 'power4.out' } })
      .fromTo(this.error, { display: 'none', autoAlpha: 0, y: -8 }, { display: 'block', autoAlpha: 1, y: 0, duration: 0.35 })

    this.successTimeline = gsap
      .timeline({ paused: true, defaults: { ease: 'power4.out' }, onComplete: this.focusSuccess })
      .to(this.form, { autoAlpha: 0, y: -8, duration: 0.2 })
      .set(this.form, { display: 'none' })
      .fromTo(this.success, { display: 'none', autoAlpha: 0, y: 8 }, { display: 'block', autoAlpha: 1, y: 0, duration: 0.35 })
  }

  bindEvents = () => {
    this.form.addEventListener('submit', this.handleSubmit)
    this.email?.addEventListener('input', this.clearInvalid)
    // Turnstile only loads once someone starts on the form, so the page pays nothing before.
    if (this.sitekey) this.form.addEventListener('focusin', this.handleFirstFocus, { once: true })
  }

  // A failed load is dealt with at submit: the token is then empty.
  handleFirstFocus = () => {
    this.loadTurnstile().catch(() => {})
  }

  handleSubmit = async (event) => {
    // Webflow's form script listens for submits on the document. Stopping the event
    // here keeps it from handling this form as well.
    event.preventDefault()
    event.stopPropagation()
    if (this.loading) return

    this.setLoading(true)
    this.hideError()
    const code = await this.send()
    this.setLoading(false)

    if (code === SUBSCRIBED) this.showSuccess()
    else this.showError(code)
  }

  send = async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: this.email?.value ?? '',
          firstName: this.firstName?.value ?? '',
          website: this.honeypot.value,
          token: await this.takeToken(),
        }),
        signal: controller.signal,
      })
      const result = await response.json().catch(() => null)
      return result?.code ?? UNAVAILABLE
    } catch {
      // No connection, a timeout, or a blocked request.
      return OFFLINE
    } finally {
      clearTimeout(timer)
    }
  }

  setLoading = (loading) => {
    this.loading = loading
    this.form.setAttribute('aria-busy', String(loading))
    if (!this.submit) return

    this.submit.disabled = loading
    // Webflow keeps the button's "waiting" text in data-wait.
    this.submit.value = loading ? this.submit.dataset.wait || this.label : this.label
  }

  showSuccess = () => {
    if (this.reducedMotion) this.successTimeline.progress(1)
    else this.successTimeline.play()
  }

  // Once the message is visible, so screen readers land on it. A hidden element can't take focus.
  focusSuccess = () => {
    this.success.focus({ preventScroll: true })
  }

  showError = (code) => {
    // Set here and not at init: Webflow's form script resets the roles on its own blocks
    // when the page loads. An alert is read out by screen readers when it appears.
    this.message.setAttribute('role', 'alert')
    this.message.textContent = this.getMessage(code)

    if (code === INVALID_EMAIL && this.email) {
      this.email.setAttribute('aria-invalid', 'true')
      this.email.setAttribute('aria-describedby', this.error.id)
      this.email.focus({ preventScroll: true })
    }

    if (this.reducedMotion) this.errorTimeline.progress(1)
    else this.errorTimeline.play()
  }

  hideError = () => {
    if (this.reducedMotion) this.errorTimeline.progress(0)
    else this.errorTimeline.reverse()
  }

  clearInvalid = () => {
    this.email.removeAttribute('aria-invalid')
    this.email.removeAttribute('aria-describedby')
  }

  // data-message-invalid-email for invalid_email, and so on.
  getMessage = (code) =>
    this.element.getAttribute(`data-message-${code.replaceAll('_', '-')}`) || this.defaultMessage

  /**
   * Turnstile, Cloudflare's bot check. Optional: it only runs when the root has
   * data-turnstile-sitekey, and the Worker then needs the matching TURNSTILE_SECRET.
   */
  loadTurnstile = () => {
    this.turnstileReady ??= new Promise((resolve, reject) => {
      if (window.turnstile) {
        resolve()
        return
      }
      const script = document.createElement('script')
      script.src = TURNSTILE_SCRIPT
      script.async = true
      script.onload = resolve
      script.onerror = reject
      document.head.append(script)
    }).then(this.renderTurnstile)

    return this.turnstileReady
  }

  renderTurnstile = () => {
    this.turnstileElement = document.createElement('div')
    this.turnstileElement.dataset.js = 'newsletter-turnstile'
    this.element.append(this.turnstileElement)

    this.createToken()
    this.widget = window.turnstile.render(this.turnstileElement, {
      sitekey: this.sitekey,
      // Invisible unless Cloudflare wants the visitor to tick a box.
      appearance: 'interaction-only',
      callback: (token) => this.resolveToken(token),
      'expired-callback': this.refreshToken,
      'error-callback': () => this.resolveToken(''),
    })
  }

  // Each token is a promise that the widget's callback resolves.
  createToken = () => {
    this.token = new Promise((resolve) => {
      this.resolveToken = resolve
    })
  }

  refreshToken = () => {
    this.createToken()
    window.turnstile.reset(this.widget)
  }

  // A token works once, so taking one also asks for the next. Without Turnstile, or if
  // it can't load or takes too long, the token is empty and the Worker decides.
  takeToken = async () => {
    if (!this.sitekey) return ''

    try {
      await this.loadTurnstile()
      const timeout = new Promise((resolve) => setTimeout(resolve, TURNSTILE_TIMEOUT, ''))
      const token = await Promise.race([this.token, timeout])
      this.refreshToken()
      return token
    } catch {
      return ''
    }
  }
}

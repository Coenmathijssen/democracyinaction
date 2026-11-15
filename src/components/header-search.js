import gsap from 'gsap'

/**
 * Header search: turns the navbar into a full-width search bar.
 * Submits to Webflow's native /search page. Markup: docs/markup.md.
 */
export default class HeaderSearch {
  constructor(element) {
    if (!element) return
    this.element = element
    this.init()
  }

  init = () => {
    this.openButtons = [...this.element.querySelectorAll('[data-js="search-open"]')]
    this.panel = this.element.querySelector('[data-js="search-panel"]')
    if (!this.panel || !this.openButtons.length) return

    this.closeButtons = [...this.panel.querySelectorAll('[data-js="search-close"]')]
    this.input = this.panel.querySelector('input[type="search"], input[name="query"]')
    this.opened = false
    this.lastTrigger = null
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    this.setAria()
    this.createTimeline()
    this.prefillQuery()
    this.setShortPlaceholder()
    this.bindEvents()
  }

  destroy = () => {
    this.timeline?.kill()
    this.openButtons?.forEach((button) => button.removeEventListener('click', this.handleOpenClick))
    this.closeButtons?.forEach((button) => button.removeEventListener('click', this.handleCloseClick))
    document.removeEventListener('keydown', this.handleKeydown)
    document.removeEventListener('click', this.handleDocumentClick)
    this.mobileQuery?.removeEventListener('change', this.applyPlaceholder)
  }

  setAria = () => {
    this.panel.id ||= 'header-search'
    this.panel.setAttribute('role', 'dialog')
    this.panel.setAttribute('aria-label', 'Search')
    this.panel.setAttribute('aria-hidden', 'true')
    this.panel.inert = true

    this.openButtons.forEach((button) => {
      button.setAttribute('aria-controls', this.panel.id)
      button.setAttribute('aria-expanded', 'false')
      if (!button.hasAttribute('aria-label')) button.setAttribute('aria-label', 'Open search')
    })
    this.closeButtons.forEach((button) => {
      if (!button.hasAttribute('aria-label')) button.setAttribute('aria-label', 'Close search')
    })
  }

  createTimeline = () => {
    const form = this.input?.closest('form') ?? this.input
    const parts = [form, ...this.closeButtons].filter(Boolean)
    const speed = this.reducedMotion ? 0 : 1

    this.timeline = gsap
      .timeline({
        paused: true,
        defaults: { ease: 'power2.out' },
        onReverseComplete: () => gsap.set(this.panel, { visibility: 'hidden' }),
      })
      .fromTo(this.panel, { opacity: 0 }, { opacity: 1, duration: 0.25 * speed })
      .fromTo(parts, { y: -8, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3 * speed, stagger: 0.05 * speed }, '<0.05')
  }

  bindEvents = () => {
    this.openButtons.forEach((button) => button.addEventListener('click', this.handleOpenClick))
    this.closeButtons.forEach((button) => button.addEventListener('click', this.handleCloseClick))
    document.addEventListener('keydown', this.handleKeydown)
    document.addEventListener('click', this.handleDocumentClick)
  }

  handleOpenClick = (event) => {
    event.preventDefault()
    this.open(event.currentTarget)
  }

  handleCloseClick = (event) => {
    event.preventDefault()
    this.close()
  }

  handleKeydown = (event) => {
    if (event.key === 'Escape' && this.opened) this.close()
  }

  handleDocumentClick = (event) => {
    if (!this.opened) return
    const inside =
      this.panel.contains(event.target) || this.openButtons.some((button) => button.contains(event.target))
    if (!inside) this.close({ restoreFocus: false })
  }

  open = (trigger = null) => {
    if (this.opened) return

    // Before `opened` flips: this click bubbles to handleDocumentClick.
    document.querySelector('.w-nav-button.w--open')?.click()

    this.opened = true
    this.lastTrigger = trigger
    this.setExpanded(true)
    document.documentElement.classList.add('is-search-open')

    this.panel.inert = false
    this.panel.setAttribute('aria-hidden', 'false')
    // Visible before focus, so the mobile keyboard opens within the tap.
    gsap.set(this.panel, { visibility: 'visible' })
    this.input?.focus({ preventScroll: true })

    this.timeline.timeScale(1).play()
  }

  close = ({ restoreFocus = true } = {}) => {
    if (!this.opened) return

    this.opened = false
    this.setExpanded(false)
    document.documentElement.classList.remove('is-search-open')

    this.panel.inert = true
    this.panel.setAttribute('aria-hidden', 'true')
    if (restoreFocus) this.lastTrigger?.focus()

    if (this.timeline.progress() === 0) gsap.set(this.panel, { visibility: 'hidden' })
    else this.timeline.timeScale(1.5).reverse()
  }

  toggle = (trigger) => (this.opened ? this.close() : this.open(trigger))

  setExpanded = (value) => {
    this.openButtons.forEach((button) => button.setAttribute('aria-expanded', String(value)))
  }

  prefillQuery = () => {
    const query = new URLSearchParams(window.location.search).get('query')
    if (this.input && query && !this.input.value) this.input.value = query
  }

  setShortPlaceholder = () => {
    const short = this.input?.dataset.placeholderShort
    if (!short) return

    this.longPlaceholder = this.input.placeholder
    this.shortPlaceholder = short
    this.mobileQuery = window.matchMedia('(max-width: 767px)')
    this.mobileQuery.addEventListener('change', this.applyPlaceholder)
    this.applyPlaceholder()
  }

  applyPlaceholder = () => {
    this.input.placeholder = this.mobileQuery.matches ? this.shortPlaceholder : this.longPlaceholder
  }
}

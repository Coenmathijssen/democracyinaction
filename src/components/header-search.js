import gsap from 'gsap'
import { MOBILE_QUERY } from '@/core/breakpoints'

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

    this.inner = this.panel.querySelector('[data-js="search-inner"]')
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

    // The panel waits at top: -100% (set in Webflow) and slides down by its own height.
    this.timeline = gsap
      .timeline({ paused: true, defaults: { ease: 'power4.out' } })
      .fromTo(this.panel, { yPercent: 0 }, { yPercent: 100, duration: 0.35 })

    // The content moves the opposite way at the same pace, so it stays put and the
    // panel's clipped edge (overflow: hidden) wipes it into view. The logo never moves.
    if (this.inner) this.timeline.fromTo(this.inner, { yPercent: 100 }, { yPercent: 0, duration: 0.35 }, '<')

    this.timeline.fromTo(parts, { y: -12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.25, stagger: 0.04 }, '<0.15')
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
    document.documentElement.classList.add('cc-search-open')

    this.panel.inert = false
    this.panel.setAttribute('aria-hidden', 'false')
    // Focus inside the tap, so the mobile keyboard opens.
    this.input?.focus({ preventScroll: true })

    if (this.reducedMotion) this.timeline.progress(1)
    else this.timeline.timeScale(1).play()
  }

  close = ({ restoreFocus = true } = {}) => {
    if (!this.opened) return

    this.opened = false
    this.setExpanded(false)
    document.documentElement.classList.remove('cc-search-open')

    this.panel.inert = true
    this.panel.setAttribute('aria-hidden', 'true')
    if (restoreFocus) this.lastTrigger?.focus()

    if (this.reducedMotion) this.timeline.progress(0)
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
    this.mobileQuery = window.matchMedia(MOBILE_QUERY)
    this.mobileQuery.addEventListener('change', this.applyPlaceholder)
    this.applyPlaceholder()
  }

  applyPlaceholder = () => {
    this.input.placeholder = this.mobileQuery.matches ? this.shortPlaceholder : this.longPlaceholder
  }
}

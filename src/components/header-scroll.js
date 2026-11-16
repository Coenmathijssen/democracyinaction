import { MOBILE_QUERY } from '@/core/breakpoints'

/**
 * Header scroll: slims the fixed header once the page is scrolled, by toggling the
 * `cc-scrolled` combo class on .nav-container. The slim height and its transition are
 * styled in Webflow (.nav-container.cc-scrolled), so they stay editable in the Designer.
 * .main-wrapper reserves the header's full height, so the page doesn't move.
 *
 * There's no scroll listener. An IntersectionObserver watches an invisible strip over
 * the first `threshold` px of the page and only calls back when the strip leaves or
 * re-enters the viewport, so nothing runs while scrolling. On mobile (MOBILE_QUERY)
 * the header keeps its full height.
 *
 * Markup (docs/markup.md): data-component="header-scroll" on .nav-container.
 */
export default class HeaderScroll {
  // Distance in px the page scrolls before the header slims down.
  threshold = 16

  constructor(element) {
    if (!element) return
    this.element = element
    this.init()
  }

  init = () => {
    this.scrolled = false
    this.mobileQuery = window.matchMedia(MOBILE_QUERY)
    this.sentinel = this.createSentinel()

    // The observer also calls back once right away, so a page that loads scrolled
    // (refresh, back button, anchor link) starts with the slim header.
    this.observer = new IntersectionObserver(this.handleIntersect)
    this.observer.observe(this.sentinel)
    this.mobileQuery.addEventListener('change', this.update)
  }

  destroy = () => {
    this.observer?.disconnect()
    this.sentinel?.remove()
    this.mobileQuery?.removeEventListener('change', this.update)
    this.element?.classList.remove('cc-scrolled')
  }

  // Empty and 1px wide: invisible, takes no clicks, and only marks the threshold.
  createSentinel = () => {
    const sentinel = document.createElement('div')
    sentinel.setAttribute('aria-hidden', 'true')
    Object.assign(sentinel.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '1px',
      height: `${this.threshold}px`,
      pointerEvents: 'none',
    })
    document.body.append(sentinel)
    return sentinel
  }

  handleIntersect = ([entry]) => {
    this.scrolled = !entry.isIntersecting
    this.update()
  }

  update = () => {
    this.element.classList.toggle('cc-scrolled', this.scrolled && !this.mobileQuery.matches)
  }
}

/**
 * Header scroll: slims the fixed header once the page is scrolled, by toggling the
 * `is-scrolled` combo class on .nav-container. The slim padding and its transition
 * are styled in Webflow (.nav-container.is-scrolled), so they stay editable in the
 * Designer. .main-wrapper reserves the header's full height, so the page doesn't
 * move when the header slims.
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
    this.scrolled = null
    this.ticking = false

    // The page can load already scrolled (refresh, back button, anchor link).
    this.update()
    window.addEventListener('scroll', this.handleScroll, { passive: true })
  }

  destroy = () => {
    window.removeEventListener('scroll', this.handleScroll)
  }

  // One check per frame, however often the scroll event fires.
  handleScroll = () => {
    if (this.ticking) return
    this.ticking = true
    requestAnimationFrame(() => {
      this.ticking = false
      this.update()
    })
  }

  update = () => {
    const scrolled = window.scrollY > this.threshold
    if (scrolled === this.scrolled) return

    this.scrolled = scrolled
    this.element.classList.toggle('is-scrolled', scrolled)
  }
}

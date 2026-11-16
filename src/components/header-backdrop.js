/**
 * Header backdrop: when the sticky header sits on top of a hero, the header's
 * background shows the hero's own background, cut from the same spot. At the top of
 * the page the two read as one surface, and while scrolling the header keeps the
 * hero's top edge instead of a different image.
 *
 * Markup (docs/markup.md): data-component="header-backdrop" on .navbar-bg, and
 * data-header-backdrop on the element whose background it copies (the Home hero).
 * Pages without a data-header-backdrop element keep the header's own background.
 *
 * Supports `background-size: cover` with any background-position, which is how
 * the Home hero is set up in Webflow.
 */
export default class HeaderBackdrop {
  constructor(element) {
    if (!element) return
    this.element = element
    this.init()
  }

  init = () => {
    this.source = document.querySelector('[data-header-backdrop]')
    if (!this.source) return

    this.images = new Map()

    // Fires once on observe, then whenever the hero resizes (cover scaling depends on it).
    this.observer = new ResizeObserver(this.update)
    this.observer.observe(this.source)
  }

  destroy = () => {
    this.observer?.disconnect()
  }

  update = async () => {
    const style = getComputedStyle(this.source)
    // One image layer; greedy match because file names can contain brackets, like "(2).webp".
    const url = style.backgroundImage.match(/^url\((["']?)(.*)\1\)$/)?.[2]
    if (!url || style.backgroundSize !== 'cover') return

    const image = await this.loadImage(url)
    if (!image) return

    // Where the hero sits relative to the header when the page is scrolled to the top.
    const hero = this.source.getBoundingClientRect()
    const header = this.element.getBoundingClientRect()
    const heroLeft = hero.left - header.left
    const heroTop = hero.top + window.scrollY

    const scale = Math.max(hero.width / image.naturalWidth, hero.height / image.naturalHeight)
    const width = image.naturalWidth * scale
    const height = image.naturalHeight * scale
    const [positionX, positionY] = style.backgroundPosition.split(' ')

    const x = heroLeft + this.offset(positionX, hero.width, width)
    const y = heroTop + this.offset(positionY, hero.height, height)

    Object.assign(this.element.style, {
      backgroundImage: `url("${url}")`,
      backgroundSize: `${width}px ${height}px`,
      backgroundPosition: `${x}px ${y}px`,
    })
  }

  // A background-position value as px from the box's edge.
  offset = (value = '50%', box, image) =>
    value.endsWith('%') ? ((box - image) * parseFloat(value)) / 100 : parseFloat(value)

  // Natural size of the hero image. The hero swaps images per breakpoint, so cache by url.
  loadImage = (url) => {
    if (!this.images.has(url)) {
      const loaded = new Promise((resolve) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => resolve(null)
        image.src = url
      })
      this.images.set(url, loaded)
    }
    return this.images.get(url)
  }
}

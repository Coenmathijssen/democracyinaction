# Markup rules

How Webflow markup connects to the code. Set attributes in the Designer under
Element settings > Custom attributes.

## Conventions

- `data-component="<name>"` on a component's root. `src/core/app.js` creates
  `new Component(element)` for every match and keeps it in `app.instances`
  (also `window.dia.instances` in the console).
- `data-js="<name>"` on elements the code needs inside that root.
- Use attributes, not `js-` classes, for JS hooks. In Webflow a second class on an
  element becomes a combo class, which is easy to style by accident in the
  Designer, and classes get renamed when styles are tidied up.
- Classes are for styling only and are managed in the Designer. Code never
  styles by class; the CSS in `src/styles` only handles what the Designer can't.
- Classes made for this code start with `cc-`, so they stand apart from the site's own
  classes: the Webflow classes of its components and the state classes the code toggles.
- State classes: code may toggle a `cc-` combo class (like `.nav-container.cc-scrolled`)
  whose styles live in Webflow. It never queries elements by them. To edit one in the
  Designer, add the combo to the element, style it, and remove it again. Don't run
  "Clean up unused styles" without keeping these: they look unused in the Designer.

## Header

The **Navbar** component, on every page.

- `.navbar` is `position: fixed` at the top. `.main-wrapper` reserves its full height
  with `padding-top`, so content starts below it on every page.
- Header height: 7em on desktop (112px at 1512px), 5.5em from 480 to 991px, 5em at
  479px and below. `.main-wrapper`'s padding-top and the Home hero use these numbers.
- `.nav-container` sets the header height directly (`height` 7em / 5.5em / 5em, no
  vertical padding; the content is centred with `align-items: center`).
- Once the page scrolls 16px, the **header-scroll** component adds `cc-scrolled` to
  `.nav-container`, which sets a slimmer height (5.25em / 4.5em, so 84 / 72px). At 767px
  and below the code doesn't add it, so the header keeps its full height on mobile. The
  code uses an IntersectionObserver, not a scroll listener. The height transition on
  `.nav-container` is 350ms `cubic-bezier(0.22, 1, 0.36, 1)`, the CSS twin of GSAP's
  `power4.out` used by the search panel. The header is fixed and the reserved space
  doesn't change, so nothing on the page moves.

- Both logos (`.nav-brand-logo-link` and `.cc-nav-search-logo`) sit 0.125em (2px) above
  centre with `position: relative; top: -0.125em`. They are centred mathematically, but
  the logo's shape makes them look low, so this centres them by eye.

### Home hero under the header

On Home the hero's background continues behind the header:

```
.main-wrapper                                       padding-top 7em / 5.5em / 5em (the header's space)
  Navbar
  section.section.overflow-hidden.cc-under-header   margin-top -7em / -5.5em / -5em (pulls the hero under the header)
    .section-bg.gradient-home-hero                  padding-top 7em / 5.5em / 5em, data-header-backdrop
```

`data-header-backdrop` tells the **header-backdrop** component (on `.navbar-bg`) to
paint the header with that element's background, cut from the same spot. The hero
and header then read as one surface at the top, and while scrolling the header keeps
the hero's top edge. It supports `background-size: cover`, which the hero uses. Pages
without a `data-header-backdrop` element keep `.navbar-bg`'s own image.

`.navbar-bg`'s own image is sized for the full header height and anchored to the top
(`background-position: 50% 0%`), so when the header slims the image is clipped at the
bottom instead of rescaled. `background-size` is `max(100%, 120.3em) auto` on desktop
(120.3em is 7em times the image's 3024 / 176 aspect ratio, so it covers the full height
and still fills ultra-wide screens), `auto 5.5em` at 991px and `auto 5em` at 479px. If the
image changes, update 120.3em to 7em × its width / height.

If the header height changes, update these numbers in `.main-wrapper`, `.cc-under-header`
and `.gradient-home-hero`.

## Header search

Lives in the **Navbar** component, so it is on every page that uses it.

```
.navbar                                      data-component="header-search"
  .nav-container                             data-component="header-scroll", height 7em / 5.5em / 5em, slimmer with .cc-scrolled
    .nav-right-wrapper                       gap 5em (0.6667em at tablet and below)
      .nav-menu
      .cc-nav-actions                        gap 1em
        .nav-button-wrapper.for-desktop      CONTACT, height 2.625em like the search button
        .cc-nav-search-button (Link Block)   data-js="search-open"
      .menu-button
  .navbar-bg                                 data-component="header-backdrop"
  .cc-nav-search-panel                       data-js="search-panel", overflow hidden
    .cc-nav-search-inner                     data-js="search-inner"
      .cc-nav-search-logo (Link Block)       hidden at 767px and below
      Search element (native)                form .cc-nav-search-form, input .cc-nav-search-input
      .cc-nav-search-close (Link Block)      data-js="search-close"
```

- Use Webflow's native **Search** element (Add > Forms > Search). It submits to
  `/search?query=…`, the native results page.
- Optional: `data-placeholder-short="Search..."` on the search input for the
  shorter mobile placeholder (767px and below).
- Sizes are in `em`, like the rest of the nav. The Global Styles component sets a fluid
  font-size on `body` (16px at 1512px, fixed 16px at 991px and below), and `html` stays
  16px, so `rem` would not scale. Figma desktop is 1:1 (px / 16 = em); the mobile frame
  is drawn at 1.5x (72px in Figma = 48px). On the input, em is relative to its own
  font-size, hence values like 2.3333em (42px at 18px, the same height as the X).
- Icons are Code Embeds holding filled SVGs (`fill="currentColor"`, viewBox only, no
  strokes), so they take the button's text colour. The SVG has no size of its own:
  the embed's class sets it (`.cc-nav-search-icon` 1.25em, `.cc-nav-search-close-icon` 1.375em).
- Don't give the input the id `search`: the results page already uses it.
- Don't reuse the classes `Search`, `Search Input`, `Search Result List` and
  `Search Result Item`. They belong to the results page.
- `.cc-nav-search-panel` is positioned in Webflow: absolute, `top: -100%`, full width,
  the navbar's height, `overflow: hidden`. The code slides it down by its own height
  (`yPercent: 100`) and moves `.cc-nav-search-inner` the other way at the same pace, so
  the content (logo included) stays in place and the panel's edge wipes it into view.
  To edit it in the Designer, set its top to 0% temporarily and back to -100% after.
- While the search is open, touch drags don't scroll the page (a non-passive
  `touchmove` listener cancels them). On iOS a drag with the keyboard up would
  otherwise pan the visible area and carry the fixed header out of view. Taps and
  desktop scrolling aren't affected.
- The label and submit button carry `.cc-nav-search-sr-only`: hidden visually, still
  there for screen readers and for submitting with Enter.
- The placeholder is set in the Designer (Search Input settings). The short mobile
  one comes from `data-placeholder-short`.

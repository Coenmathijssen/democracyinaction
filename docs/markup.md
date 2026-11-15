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
  styles by class; the CSS in `src/styles` only handles states that need JS.

## Header search

Lives in the **Navbar** component, so it is on every page that uses it.

```
.navbar                                  data-component="header-search"
  .nav-container                         padding-y 1.75em (112px header at 1512), 1em at tablet and below
    .nav-right-wrapper                   gap 5em (0.6667em at tablet and below)
      .nav-menu
      .nav-actions                       gap 1.5em
        .nav-button-wrapper.for-desktop  CONTACT, height 2.625em like the search button
        .nav-search-button (Link Block)  data-js="search-open"
      .menu-button
  .navbar-bg
  .nav-search-panel                      data-js="search-panel"
    .nav-search-inner
      .nav-search-logo (Link Block)      hidden at 767px and below
      Search element (native)            form .nav-search-form, input .nav-search-input
      .nav-search-close (Link Block)     data-js="search-close"
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
  the embed's class sets it (`.nav-search-icon` 1.25em, `.nav-search-close-icon` 1.375em).
- Don't give the input the id `search`: the results page already uses it.
- Don't reuse the classes `Search`, `Search Input`, `Search Result List` and
  `Search Result Item`. They belong to the results page.
- `.nav-search-panel` is positioned in Webflow: absolute, `top: -100%`, full width,
  the navbar's height. The code slides it down by its own height (`yPercent: 100`).
  To edit it in the Designer, set its top to 0% temporarily and back to -100% after.
- The label and submit button carry `.nav-search-sr-only`: hidden visually, still
  there for screen readers and for submitting with Enter.
- The placeholder is set in the Designer (Search Input settings). The short mobile
  one comes from `data-placeholder-short`.

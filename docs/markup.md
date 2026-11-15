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
  .nav-container
    .nav-right-wrapper
      …
      .nav-search-button (Link Block)    data-js="search-open"
      .menu-button
  .nav-search-panel                      data-js="search-panel"
    .nav-search-inner
      logo (desktop only)
      Search element (native)            form .nav-search-form, input .nav-search-input
      .nav-search-close (Link Block)     data-js="search-close"
```

- Use Webflow's native **Search** element (Add > Forms > Search). It submits to
  `/search?query=…`, the native results page.
- Optional: `data-placeholder-short="Search..."` on the search input for the
  shorter mobile placeholder (767px and below).
- Don't give the input the id `search`: the results page already uses it.
- Don't reuse the classes `Search`, `Search Input`, `Search Result List` and
  `Search Result Item`. They belong to the results page.
- The panel is visible in the Designer (custom code doesn't run there). Hide it
  in the Navigator while editing the nav underneath.

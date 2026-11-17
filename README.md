# Democracy in Action: Webflow code

Custom JS/CSS for the Democracy in Action Webflow site. Vite builds one bundle,
`dist/main.js` and `dist/main.css`, which Webflow loads through Site settings > Custom code.

- Components: `src/components/`, registered in `src/core/app.js`
- How markup connects to the code: [docs/markup.md](docs/markup.md)
- Webflow custom code snippets: [webflow-custom-code.html](webflow-custom-code.html)
- Newsletter signup: a Cloudflare Worker in `worker/`, deployed on its own. See [worker/README.md](worker/README.md)

## GSAP

GSAP isn't bundled. Turn it on in Webflow under Site settings > GSAP integration,
and tick any plugins you need. `src/vendor/gsap.js` re-exports Webflow's global, so
components keep writing `import gsap, { ScrollTrigger } from 'gsap'`.

## Develop

    npm install
    npm run dev                # Vite dev server on http://localhost:5173

To run the staging site (dia-2af02e.webflow.io) against your local code, enter this in the browser console:

    localStorage.setItem('dia-dev', '1')     // load src/main.js from localhost
    localStorage.removeItem('dia-dev')       // back to the released bundle

## Release

    npm run build
    git add dist && git commit -m "Build vX.Y.Z"
    git tag -a vX.Y.Z -m "vX.Y.Z" && git push --follow-tags   # --follow-tags only pushes annotated tags

Then bump the tag in Webflow's custom code (both snippets in
`webflow-custom-code.html`) and publish to staging first.

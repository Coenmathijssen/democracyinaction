const { gsap, ScrollTrigger } = window

if (!gsap) console.warn('[dia] GSAP not found. Turn it on in Site settings > GSAP integration.')

export default gsap
export { gsap, ScrollTrigger }

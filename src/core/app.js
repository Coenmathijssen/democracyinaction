import HeaderBackdrop from '@/components/header-backdrop'
import HeaderSearch from '@/components/header-search'

const components = {
  'header-backdrop': HeaderBackdrop,
  'header-search': HeaderSearch,
}

class App {
  instances = new Map()

  init = () => {
    document.querySelectorAll('[data-component]').forEach((element) => {
      const Component = components[element.dataset.component]
      if (!Component || this.instances.has(element)) return
      this.instances.set(element, new Component(element))
    })
  }
}

export const app = new App()

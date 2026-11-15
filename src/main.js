import { app } from '@/core/app'
import '@/styles/header-search.css'

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', app.init)
} else {
  app.init()
}

window.dia = app

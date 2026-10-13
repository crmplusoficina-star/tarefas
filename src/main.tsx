import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/instrument-sans'
import '@fontsource/instrument-serif'
import '@fontsource-variable/jetbrains-mono'
import './styles/tokens.css'
import './styles/base.css'
import './styles/hud.css'
import './styles/panels.css'
import { App } from './App'
import { runtime } from './scene/runtime'
import { dataStore } from './state/dataStore'
import { uiStore } from './state/uiStore'

// handy for debugging in the console (and for e2e inspection); read-only by convention
if (import.meta.env.DEV) Object.assign(window, { __orbita: { runtime, dataStore, uiStore } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

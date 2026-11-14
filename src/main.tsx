import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Background from './Background.tsx'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Background />
    <App />
  </StrictMode>,
)

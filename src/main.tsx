import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App.tsx'
import './styles.css'

registerSW({ immediate: true })

// 브라우저가 저장소를 임의로 지우지 않도록 요청 (iOS 홈 화면 앱은 기본 영구)
void navigator.storage?.persist?.()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Leaflet's CSS is bundled with the JS but we import it here so the map
// widget gets its styles (no external CDN needed in the sandbox).
import 'leaflet/dist/leaflet.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

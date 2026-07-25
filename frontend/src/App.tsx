import { BrowserRouter } from 'react-router-dom'
import AppRoutes from './routes'

/**
 * Omari — the app is now just a router host. Chrome lives in shell/AppShell,
 * the route table in routes.tsx.
 */
export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}

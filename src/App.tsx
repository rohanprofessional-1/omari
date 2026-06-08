import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import AppShell from './components/AppShell'
import Splash from './components/Splash'
import Home from './pages/Home'
import Intake from './pages/Intake'
import CareJourney from './pages/CareJourney'
import Documents from './pages/Documents'
import Messages from './pages/Messages'
import ReferralStatus from './pages/ReferralStatus'
import Resources from './pages/Resources'
import Settings from './pages/Settings'

export default function App() {
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const t = window.setTimeout(() => setLoading(false), 850)
    return () => window.clearTimeout(t)
  }, [])

  if (loading) return <Splash />

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Home />} />
        <Route path="/intake" element={<Intake />} />
        <Route path="/journey" element={<CareJourney />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/referral" element={<ReferralStatus />} />
        <Route path="/resources" element={<Resources />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

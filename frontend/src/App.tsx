import { useState } from 'react'
import TopAppBar from './components/TopNav'
import Builder from './pages/Builder'
import Runner from './pages/Runner'
import Generate from './pages/Generate'

export type Page = 'generate' | 'builder' | 'runner'

function App() {
  const [page, setPage] = useState<Page>('builder')

  return (
    <div className="flex h-screen flex-col bg-bg text-ink">
      <TopAppBar page={page} onNavigate={setPage} />
      <main className="min-h-0 flex-1">
        {page === 'builder' ? (
          <Builder />
        ) : page === 'generate' ? (
          <Generate onOpenBuilder={() => setPage('builder')} />
        ) : (
          <div className="h-full overflow-y-auto">
            <Runner />
          </div>
        )}
      </main>
    </div>
  )
}

export default App

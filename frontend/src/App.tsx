import { useState } from 'react'
import TopAppBar from './components/TopNav'
import Builder from './pages/Builder'
import KnowledgeBase from './pages/KnowledgeBase'
import Runner from './pages/Runner'
import Generate from './pages/Generate'
import Reconcile from './pages/Reconcile'

export type Page = 'generate' | 'reconcile' | 'builder' | 'runner' | 'knowledge'

function App() {
  const [page, setPage] = useState<Page>('builder')

  return (
    <div className="flex h-screen flex-col bg-bg text-ink">
      <TopAppBar page={page} onNavigate={setPage} />
      <main className="min-h-0 flex-1">
        {page === 'builder' ? (
          <Builder />
        ) : page === 'generate' ? (
          <Generate onOpenBuilder={() => setPage('builder')} onOpenReconcile={() => setPage('reconcile')} />
        ) : page === 'reconcile' ? (
          <Reconcile onOpenBuilder={() => setPage('builder')} />
        ) : page === 'knowledge' ? (
          <KnowledgeBase />
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

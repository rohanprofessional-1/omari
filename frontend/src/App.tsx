import { useState } from 'react'
import TopAppBar from './components/TopNav'
import Builder from './pages/Builder'
import Runner from './pages/Runner'
import { TreeProvider } from './store/treeStore'

export type Page = 'builder' | 'runner'

function App() {
  const [page, setPage] = useState<Page>('builder')

  return (
    <TreeProvider>
      <div className="flex h-screen flex-col bg-bg text-ink">
        <TopAppBar page={page} onNavigate={setPage} />
        <main className="min-h-0 flex-1">
          {page === 'builder' ? (
            <Builder />
          ) : (
            <div className="h-full overflow-y-auto">
              <Runner />
            </div>
          )}
        </main>
      </div>
    </TreeProvider>
  )
}

export default App

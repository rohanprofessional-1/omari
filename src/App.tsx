import { useState } from 'react'
import TopAppBar from './components/TopNav'
import Builder from './pages/Builder'
import Runner from './pages/Runner'
import { TreeProvider } from './store/treeStore'
import BuilderToolbarContext, { type ToolbarActions } from './components/BuilderToolbarContext'

export type Page = 'builder' | 'runner'

function App() {
  const [page, setPage] = useState<Page>('builder')
  // Builder publishes its global actions here so the top app bar can render them.
  const [toolbar, setToolbar] = useState<ToolbarActions | null>(null)

  return (
    <TreeProvider>
      <BuilderToolbarContext.Provider value={{ register: setToolbar }}>
        <div className="flex h-screen flex-col bg-bg text-ink">
          <TopAppBar
            page={page}
            onNavigate={setPage}
            actions={page === 'builder' ? toolbar : null}
          />
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
      </BuilderToolbarContext.Provider>
    </TreeProvider>
  )
}

export default App

import { useState } from 'react'

export type ProgressWorkspace = {
  id: number
  name: string
  source_type: 'backlog' | 'notion' | 'trello' | 'manual'
  builtin: boolean
  position: number
}

const SOURCE_TYPE_ICON: Record<ProgressWorkspace['source_type'], string> = {
  backlog: '🌿',
  notion: '📝',
  trello: '📋',
  manual: '✋',
}

export default function WorkspaceTabs({
  workspaces,
  selectedWorkspaceId,
  onSelect,
  onAdd,
  onDelete,
}: {
  workspaces: ProgressWorkspace[]
  selectedWorkspaceId: number | null
  onSelect: (workspaceId: number) => void
  onAdd: (name: string) => void
  onDelete: (workspaceId: number) => void
}) {
  const [addingTab, setAddingTab] = useState(false)
  const [newWorkspaceName, setNewWorkspaceName] = useState('')

  const submitNewWorkspace = () => {
    const trimmedName = newWorkspaceName.trim()
    if (!trimmedName) { setAddingTab(false); return }
    onAdd(trimmedName)
    setNewWorkspaceName('')
    setAddingTab(false)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {workspaces.map((workspace) => {
        const isActive = workspace.id === selectedWorkspaceId
        return (
          <div key={workspace.id} className="group relative">
            <button
              onClick={() => onSelect(workspace.id)}
              onContextMenu={(e) => {
                if (workspace.builtin) return
                e.preventDefault()
                if (confirm(`「${workspace.name}」タブを削除しますか？`)) onDelete(workspace.id)
              }}
              className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold shadow-sm transition ${
                isActive
                  ? 'bg-gradient-to-r from-fuchsia-500 to-pink-500 text-white'
                  : 'border border-[var(--color-border)] bg-white text-[var(--color-text-sub)] hover:bg-gray-50'
              } ${!workspace.builtin ? 'pr-7' : ''}`}
            >
              <span className="mr-1">{SOURCE_TYPE_ICON[workspace.source_type]}</span>
              {workspace.name}
            </button>
            {!workspace.builtin && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm(`「${workspace.name}」タブを削除しますか？`)) onDelete(workspace.id)
                }}
                title="タブを削除"
                className={`absolute right-1.5 top-1/2 -translate-y-1/2 text-xs font-bold opacity-60 hover:opacity-100 ${
                  isActive ? 'text-white' : 'text-[var(--color-text-sub)]'
                }`}
              >
                ✕
              </button>
            )}
          </div>
        )
      })}

      {addingTab ? (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            value={newWorkspaceName}
            onChange={(e) => setNewWorkspaceName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitNewWorkspace()
              if (e.key === 'Escape') { setAddingTab(false); setNewWorkspaceName('') }
            }}
            onBlur={submitNewWorkspace}
            placeholder="タブ名"
            className="w-28 rounded-full border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm text-[var(--color-text)] placeholder-gray-400"
          />
        </div>
      ) : (
        <button
          onClick={() => setAddingTab(true)}
          title="ワークスペースを追加"
          className="grid h-8 w-8 place-items-center rounded-full border border-dashed border-[var(--color-border)] text-sm font-semibold text-[var(--color-text-sub)] hover:bg-gray-50"
        >
          ＋
        </button>
      )}
    </div>
  )
}

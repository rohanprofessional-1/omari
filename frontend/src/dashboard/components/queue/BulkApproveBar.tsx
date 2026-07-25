/**
 * Bulk-approve controls for the "Ready to approve" group header: a select-all
 * checkbox, the selection count, and the primary approve button. Lives inside
 * the sticky group header — never a floating overlay.
 */

export default function BulkApproveBar({
  readyCount,
  selectedCount,
  onToggleAll,
  onApprove,
}: {
  readyCount: number
  selectedCount: number
  onToggleAll: () => void
  onApprove: () => void
}) {
  const allSelected = readyCount > 0 && selectedCount === readyCount
  return (
    <div className="flex items-center gap-3">
      {selectedCount > 0 && (
        <span className="text-dash-micro font-medium tabular-nums text-dash-ink">
          {selectedCount} selected
        </span>
      )}
      <label className="flex cursor-pointer items-center gap-1 text-dash-micro text-dash-muted">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={onToggleAll}
          aria-label="Select all ready referrals"
          className="h-4 w-4 accent-dash-accent-strong"
        />
        Select all
      </label>
      {selectedCount > 0 && (
        <button
          onClick={onApprove}
          className="rounded-dash-ctl bg-dash-accent-strong px-3 py-1 text-dash-micro font-semibold text-white transition-colors hover:bg-dash-accent disabled:opacity-40"
        >
          Approve {selectedCount} referral{selectedCount === 1 ? '' : 's'}
        </button>
      )}
    </div>
  )
}

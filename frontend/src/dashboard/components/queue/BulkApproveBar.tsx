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
    <div className="flex items-center gap-2.5">
      {selectedCount > 0 && (
        <span className="text-[12px] font-medium text-ink">{selectedCount} selected</span>
      )}
      <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-muted">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={onToggleAll}
          aria-label="Select all ready referrals"
        />
        Select all
      </label>
      {selectedCount > 0 && (
        <button
          onClick={onApprove}
          className="rounded-md bg-accent-strong px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-40"
        >
          Approve {selectedCount} referral{selectedCount === 1 ? '' : 's'}
        </button>
      )}
    </div>
  )
}

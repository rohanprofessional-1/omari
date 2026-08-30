import { useState, useMemo, useEffect } from 'react'
import type { Slot } from '../carePlan'
import { formatDate } from '../../../dashboard/lib/demoClock'

export default function CalendarModal({
  isOpen,
  onClose,
  slots,
  onPick,
  title
}: {
  isOpen: boolean
  onClose: () => void
  slots: Slot[]
  onPick: (slot: Slot) => void
  title: string
}) {
  const [selectedDateStr, setSelectedDateStr] = useState<string | null>(null)

  // Group slots by their local date string (e.g. "2026-09-22")
  const slotsByDate = useMemo(() => {
    const map = new Map<string, Slot[]>()
    for (const slot of slots) {
      const d = new Date(slot.at)
      // Extract YYYY-MM-DD local
      const year = d.getFullYear()
      const month = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      const dateStr = `${year}-${month}-${day}`
      if (!map.has(dateStr)) map.set(dateStr, [])
      map.get(dateStr)!.push(slot)
    }
    return map
  }, [slots])

  const uniqueDates = Array.from(slotsByDate.keys()).sort()
  
  // Set initial selected date to the first available date when modal opens
  useEffect(() => {
    if (isOpen && uniqueDates.length > 0) {
      setSelectedDateStr(uniqueDates[0])
    } else if (!isOpen) {
      setSelectedDateStr(null)
    }
  }, [isOpen, uniqueDates])

  if (!isOpen) return null

  const availableSlots = selectedDateStr ? (slotsByDate.get(selectedDateStr) || []) : []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line bg-canvas px-5 py-4">
          <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[16px] text-muted transition-colors hover:bg-line/50 hover:text-ink"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {slots.length === 0 ? (
            <p className="text-center text-[14px] text-muted py-8">
              No appointments available. Please call the clinic.
            </p>
          ) : (
            <>
              {/* Date Selector (Horizontal Scroll) */}
              <h3 className="mb-3 text-[14px] font-semibold text-ink">Select a Date</h3>
              <div className="flex gap-3 overflow-x-auto pb-4 snap-x">
                {uniqueDates.map((dateStr) => {
                  const isSelected = selectedDateStr === dateStr
                  // Use T00:00:00 so JS parses it as local time, preventing off-by-one errors
                  const d = new Date(dateStr + 'T00:00:00') 
                  const dayName = d.toLocaleDateString('en-US', { weekday: 'short' })
                  const monthName = d.toLocaleDateString('en-US', { month: 'short' })
                  const dayNum = d.getDate()

                  return (
                    <button
                      key={dateStr}
                      onClick={() => setSelectedDateStr(dateStr)}
                      className={`flex min-w-[76px] shrink-0 snap-start flex-col items-center rounded-xl border p-3 transition-colors ${
                        isSelected
                          ? 'border-accent bg-accent text-white shadow-md transform scale-105'
                          : 'border-line bg-white text-ink hover:border-accent-strong/40'
                      }`}
                    >
                      <span className={`text-[12px] font-medium uppercase tracking-wide ${isSelected ? 'text-white/90' : 'text-muted'}`}>
                        {dayName}
                      </span>
                      <span className="mt-1 text-[22px] font-bold leading-none">{dayNum}</span>
                      <span className={`mt-1 text-[11px] font-medium ${isSelected ? 'text-white/90' : 'text-muted'}`}>
                        {monthName}
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* Time Selector */}
              <div className="mt-4">
                <h3 className="mb-3 flex items-center justify-between text-[14px] font-semibold text-ink">
                  <span>Available Times</span>
                  {selectedDateStr && (
                    <span className="text-[13px] font-medium text-accent">
                      {formatDate(selectedDateStr + 'T00:00:00')}
                    </span>
                  )}
                </h3>
                
                {availableSlots.length > 0 ? (
                  <div className="grid grid-cols-2 gap-3">
                    {availableSlots.map((slot) => (
                      <button
                        key={slot.at}
                        onClick={() => onPick(slot)}
                        className="flex items-center justify-center rounded-xl border border-line bg-canvas py-3.5 text-[14px] font-semibold text-accent transition-all hover:border-accent hover:bg-sky hover:shadow-sm"
                      >
                        {slot.time}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-[13px] text-muted">Select a date to see times.</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

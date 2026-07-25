/**
 * Honest stand-in for a route that exists in the nav but hasn't been built yet.
 * Every section stays clickable while the split lands screen by screen.
 * Delete each usage as its real screen arrives.
 */
export default function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-16 text-center">
      <h1 className="font-display text-lg font-semibold text-ink">{title}</h1>
      <p className="mt-2 text-[13px] text-muted">{note}</p>
    </div>
  )
}

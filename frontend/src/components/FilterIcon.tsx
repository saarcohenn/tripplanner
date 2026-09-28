/**
 * The filter/sort affordance, shared so the same picture means the same thing on every tab.
 * Hand-drawn rather than taken from lucide: the sliders there read as settings, and this one
 * has to say "narrow what's listed".
 */
export default function FilterIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="6" x2="20" y2="6" /><circle cx="16" cy="6" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="12" x2="20" y2="12" /><circle cx="9" cy="12" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="18" x2="20" y2="18" /><circle cx="14" cy="18" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

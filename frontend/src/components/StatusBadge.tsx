export type Tone = 'good' | 'bad' | 'busy' | 'neutral';

/** Always shows text, so meaning never depends on colour alone. */
export function StatusBadge({ tone, label }: { tone: Tone; label: string }) {
  return <span className={`badge badge-${tone}`}>{label}</span>;
}

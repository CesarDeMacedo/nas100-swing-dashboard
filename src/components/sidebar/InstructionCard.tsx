import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type InstructionCardProps = {
  title: string;
  icon: LucideIcon;
  tone: 'danger' | 'warning' | 'score' | 'context';
  /** 'primary' (default) is the full-weight treatment for the two cards worth reading
   * first (why no entry, setup score). 'secondary' is a visually quieter treatment for
   * supporting detail (next action, market context) so the sidebar reads as one ranked
   * list instead of four identical boxes. */
  emphasis?: 'primary' | 'secondary';
  children: ReactNode;
  testId?: string;
};

export function InstructionCard({
  title,
  icon: Icon,
  tone,
  emphasis = 'primary',
  children,
  testId,
}: InstructionCardProps) {
  return (
    <section className={`instruction-card instruction-card--${tone} instruction-card--${emphasis}`} data-testid={testId}>
      <header className="instruction-card__header">
        <span className="instruction-card__icon">
          <Icon aria-hidden="true" size={emphasis === 'secondary' ? 17 : 22} strokeWidth={2} />
        </span>
        <h2>{title}</h2>
      </header>
      <div className="instruction-card__body">{children}</div>
    </section>
  );
}

export function NarrativeList({ items, fallback }: { items?: string[]; fallback: string }) {
  if (!items?.length) {
    return <p className="narrative-fallback">{fallback}</p>;
  }

  return (
    <ul>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type InstructionCardProps = {
  title: string;
  icon: LucideIcon;
  tone: 'danger' | 'warning' | 'score' | 'context';
  children: ReactNode;
  testId?: string;
};

export function InstructionCard({
  title,
  icon: Icon,
  tone,
  children,
  testId,
}: InstructionCardProps) {
  return (
    <section className={`instruction-card instruction-card--${tone}`} data-testid={testId}>
      <header className="instruction-card__header">
        <span className="instruction-card__icon">
          <Icon aria-hidden="true" size={22} strokeWidth={2} />
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

import type { PropsWithChildren } from 'react';

export function AppShell({ children }: PropsWithChildren) {
  return (
    <main className="app-shell">
      <div className="dashboard-frame">{children}</div>
    </main>
  );
}

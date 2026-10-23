import type { ReactNode } from 'react';

interface Props {
  kind: 'success' | 'error' | 'warning' | 'info';
  title: string;
  children?: ReactNode;
}

/** role=alert for errors so screen readers announce them; status for the rest. */
export function Alert({ kind, title, children }: Props) {
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <strong>{title}</strong>
      {children && <div className="alert-body">{children}</div>}
    </div>
  );
}

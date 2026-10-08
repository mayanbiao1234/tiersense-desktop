import { useEffect, useRef, type ReactNode } from 'react';
import { X, type LucideIcon } from 'lucide-react';
export function Logo({ small = false }: { small?: boolean }) { return <img className={`brand-icon ${small ? 'small' : ''}`} src="/icon.svg" alt="清枢智汇" />; }
export function TierSenseLogo({ wordmark = false }: { wordmark?: boolean }) { return <img className={wordmark ? "tiersense-wordmark" : "tiersense-mark"} src={wordmark ? "/tiersense-logo.svg" : "/tiersense-symbol.svg"} alt="TierSense" />; }
export function Button({ children, onClick, icon: Icon, kind = 'primary', disabled = false, type = 'button', className = '' }: { children?: ReactNode; onClick?: () => void; icon?: LucideIcon; kind?: 'primary' | 'secondary' | 'ghost' | 'danger'; disabled?: boolean; type?: 'button' | 'submit'; className?: string }) {
  return <button type={type} className={`btn ${kind} ${className}`} onClick={onClick} disabled={disabled}>{Icon && <Icon size={15} strokeWidth={1.8} />}{children}</button>;
}
export function Badge({ children, color = '' }: { children: ReactNode; color?: string }) { return <span className={`badge ${color}`}>{children}</span>; }
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) { return <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}><span /></button>; }
export function Empty({ icon: Icon, title, text, children }: { icon: LucideIcon; title: string; text: string; children?: ReactNode }) { return <div className="empty"><div className="empty-icon"><Icon size={25} strokeWidth={1.4} /></div><h3>{title}</h3><p>{text}</p>{children}</div>; }
export function Modal({ title, subtitle, children, onClose, wide = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!dialog.current?.contains(document.activeElement)) dialog.current?.focus({ preventScroll: true });
    const handler = (event: KeyboardEvent) => {
      if (Array.from(document.querySelectorAll('[role="dialog"]')).at(-1) !== dialog.current) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, a[href], [tabindex="0"]') ?? []).filter(el => el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handler);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', handler); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <div className="modal-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section ref={dialog} tabIndex={-1} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button aria-label="关闭" className="icon-button" onClick={onClose}><X size={19} /></button></div>{children}</section></div>;
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function SectionHead({ title, text, action }: { title: string; text: string; action?: ReactNode }) { return <div className="section-head"><div><h1>{title}</h1><p>{text}</p></div>{action}</div>; }

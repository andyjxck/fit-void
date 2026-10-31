import { create } from 'zustand';

export type NotifyTone = 'success' | 'error' | 'info';

export interface NotifyItem {
  id: number;
  title: string;
  body?: string;
  tone: NotifyTone;
}

export interface ConfirmRequest {
  title: string;
  body?: string;
  confirmText: string;
  cancelText: string;
  destructive: boolean;
  resolve: (value: boolean) => void;
}

interface NotifyState {
  queue: NotifyItem[];
  pendingConfirm: ConfirmRequest | null;
  /** Confirms requested while another is already showing. */
  confirmBacklog: ConfirmRequest[];
  dismissTop: () => void;
}

export const useNotify = create<NotifyState>((set) => ({
  queue: [],
  pendingConfirm: null,
  confirmBacklog: [],
  dismissTop: () => set((s) => ({ queue: s.queue.slice(1) })),
}));

/** Push a transient banner. Dedupes identical title+body already queued. */
export function notify(title: string, opts?: { body?: string; tone?: NotifyTone }) {
  const body = opts?.body;
  const tone = opts?.tone ?? 'info';
  useNotify.setState((s) => {
    if (s.queue.some((n) => n.title === title && n.body === body)) return s;
    return { queue: [...s.queue, { id: Date.now() + Math.random(), title, body, tone }] };
  });
}

function _resolveConfirm(value: boolean) {
  const s = useNotify.getState();
  const current = s.pendingConfirm;
  if (!current) return;
  const [next, ...rest] = s.confirmBacklog;
  useNotify.setState({ pendingConfirm: next ?? null, confirmBacklog: rest });
  current.resolve(value);
}

/** Show a modal confirm; resolves with the user's choice. */
export function confirm(opts: {
  title: string;
  body?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const req: ConfirmRequest = {
      title: opts.title,
      body: opts.body,
      confirmText: opts.confirmText ?? 'OK',
      cancelText: opts.cancelText ?? 'CANCEL',
      destructive: opts.destructive ?? false,
      resolve,
    };
    const s = useNotify.getState();
    if (s.pendingConfirm) {
      useNotify.setState({ confirmBacklog: [...s.confirmBacklog, req] });
    } else {
      useNotify.setState({ pendingConfirm: req });
    }
  });
}

/** Internal: resolve the pending confirm (true/false) and surface any queued one. */
export function _resolvePendingConfirm(value: boolean) {
  _resolveConfirm(value);
}

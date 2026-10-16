/** Module-level toast bus: lets non-React code (socket handlers) raise toasts. */
export interface ToastPayload {
  level: 'info' | 'success' | 'warning' | 'error';
  title: string;
  description?: string;
}

type Listener = (t: ToastPayload) => void;
const listeners = new Set<Listener>();

export const toastBus = {
  emit(t: ToastPayload) {
    listeners.forEach((l) => l(t));
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

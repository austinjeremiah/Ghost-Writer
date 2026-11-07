'use client';

import Toast from '@/components/Toast';
import { useUi } from '@/store/ui';

export default function ToastContainer() {
  const { toasts, removeToast } = useUi();

  return (
    <div className="container toast-container">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onHide={removeToast} />
      ))}
    </div>
  );
}

'use client';

import React from 'react';
import { Dialog, DialogProps } from './dialog';
import { Button } from './button';
import { useI18n } from '@/i18n/provider';

export function ConfirmDialog({
  open, onClose, onConfirm, title, text, danger = true, confirmLabel, loading, children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  text?: string;
  danger?: boolean;
  confirmLabel?: string;
  loading?: boolean;
  /** rich body — replaces `text` when provided */
  children?: React.ReactNode;
} & Pick<DialogProps, 'title'>) {
  const { t } = useI18n();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title ?? t('common.deleteConfirmTitle')}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </>
      }
    >
      {children ?? <p className="text-sm leading-relaxed text-gray-600">{text ?? t('common.deleteConfirmText')}</p>}
    </Dialog>
  );
}

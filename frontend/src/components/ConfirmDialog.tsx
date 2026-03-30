interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
  variant?: 'danger' | 'primary'
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  onConfirm,
  onCancel,
  loading = false,
  variant = 'danger',
}: ConfirmDialogProps) {
  if (!open) {
    return null
  }

  const confirmButtonClass = variant === 'danger'
    ? 'bg-red-500 hover:bg-red-600 text-white'
    : 'bg-primary hover:bg-primary/90 text-white'

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-[1px] p-4 flex items-center justify-center"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white shadow-[0_24px_48px_rgba(15,23,42,0.2)] p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <h4 className="text-base font-semibold text-text-primary">{title}</h4>
        {description && (
          <p className="text-sm text-text-secondary mt-2">{description}</p>
        )}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-text-primary hover:bg-gray-200 transition-colors"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-70 ${confirmButtonClass}`}
          >
            {loading ? '处理中...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

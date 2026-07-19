interface Props {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open, title, message, confirmLabel = '确认', cancelLabel = '取消', danger, onConfirm, onCancel
}: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-6 animate-fade-in">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="glass rounded-2xl p-6 w-full max-w-sm relative z-10 animate-slide-up">
        <h3 className="text-base font-semibold text-text-primary mb-2">{title}</h3>
        <p className="text-sm text-text-secondary mb-5">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl bg-white/5 text-text-secondary text-sm font-medium hover:bg-white/10 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              danger ? 'bg-danger/15 text-danger hover:bg-danger/25' : 'bg-primary/15 text-primary-light hover:bg-primary/25'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

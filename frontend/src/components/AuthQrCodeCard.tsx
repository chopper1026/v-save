import { QRCodeSVG } from 'qrcode.react'

interface AuthQrCodeCardProps {
  title: string
  alt: string
  expireAtLabel: string
  qrValue?: string | null
  qrImageUrl?: string | null
  displayUrl?: string | null
}

export default function AuthQrCodeCard({
  title,
  alt,
  expireAtLabel,
  qrValue,
  qrImageUrl,
  displayUrl,
}: AuthQrCodeCardProps) {
  const normalizedValue = String(qrValue || '').trim()
  const normalizedImageUrl = String(qrImageUrl || '').trim()
  const normalizedDisplayUrl = String(displayUrl || '').trim()
  const shouldRenderValue = normalizedValue.length > 0
  const shouldRenderImage = !shouldRenderValue && normalizedImageUrl.length > 0

  if (!shouldRenderValue && !shouldRenderImage) {
    return null
  }

  return (
    <div className="mt-5 p-4 rounded-2xl border border-dashed border-primary/30 bg-primary/5">
      <p className="text-sm text-text-primary font-medium mb-3">{title}</p>
      <div className="w-44 h-44 rounded-xl border border-gray-200 bg-white flex items-center justify-center overflow-hidden p-3">
        {shouldRenderValue ? (
          <QRCodeSVG
            value={normalizedValue}
            size={164}
            level="M"
            includeMargin
            title={alt}
            role="img"
            className="w-full h-full"
          />
        ) : (
          <img
            src={normalizedImageUrl}
            alt={alt}
            className="w-full h-full object-contain"
          />
        )}
      </div>
      {normalizedDisplayUrl && (
        <p className="text-xs text-text-secondary mt-3 break-all">
          二维码链接：{normalizedDisplayUrl}
        </p>
      )}
      <p className="text-xs text-text-secondary mt-1">
        过期时间：{expireAtLabel}
      </p>
    </div>
  )
}

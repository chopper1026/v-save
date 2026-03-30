import { useState, useRef } from 'react'
import { Clipboard, X, Loader2, Link2 } from 'lucide-react'

interface LinkInputProps {
  value: string
  onChange: (value: string) => void
  onParse: () => void
  isLoading?: boolean
}

export default function LinkInput({ value, onChange, onParse, isLoading }: LinkInputProps) {
  const [isFocused, setIsFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      onChange(text)
    } catch (err) {
      console.error('Failed to read clipboard:', err)
    }
  }

  const handleClear = () => {
    onChange('')
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && value.trim()) {
      onParse()
    }
  }

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div
        className={`
          relative flex items-center gap-2 rounded-2xl border px-3 py-2 transition-all duration-200
          ${isFocused
            ? 'border-sky-400 bg-white shadow-[0_18px_40px_rgba(14,165,233,0.24)]'
            : 'border-sky-100 bg-white/95 shadow-[0_12px_28px_rgba(15,23,42,0.08)]'}
        `}
      >
        <div className="hidden sm:flex w-9 h-9 rounded-xl bg-sky-50 text-sky-500 items-center justify-center">
          <Link2 className="w-4 h-4" />
        </div>

        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder="粘贴视频链接或分享文案，自动识别抖音 / B站 / 小红书 / 快手 / YouTube"
          className="flex-1 h-12 px-2 text-[15px] md:text-base bg-transparent text-text-primary placeholder:text-text-secondary/65"
        />

        {value && (
          <button
            onClick={handleClear}
            className="p-2 text-text-secondary hover:text-text-primary transition-colors rounded-lg hover:bg-slate-100"
            aria-label="清空输入"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        <button
          onClick={handlePaste}
          className="flex items-center gap-1.5 px-3 sm:px-4 h-10 text-sm font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-xl transition-colors"
        >
          <Clipboard className="w-4 h-4" />
          <span>粘贴</span>
        </button>

        <button
          onClick={onParse}
          disabled={!value.trim() || isLoading}
          className={`
            h-10 px-5 md:px-6 text-sm font-semibold text-white rounded-xl transition-all
            ${value.trim()
              ? 'bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 shadow-[0_10px_24px_rgba(37,99,235,0.35)]'
              : 'bg-slate-300 cursor-not-allowed'}
          `}
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              解析中...
            </span>
          ) : (
            '解析'
          )}
        </button>
      </div>
    </div>
  )
}

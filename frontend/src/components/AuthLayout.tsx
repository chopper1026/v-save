import { Link } from 'react-router-dom'
import { Video, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'

interface AuthLayoutProps {
  badge: string
  title: string
  subtitle: string
  featureTitle: string
  featureDescription: string
  featurePoints: string[]
  children: ReactNode
  bottomHint?: string
}

export default function AuthLayout({
  badge,
  title,
  subtitle,
  featureTitle,
  featureDescription,
  featurePoints,
  children,
  bottomHint,
}: AuthLayoutProps) {
  return (
    <div className="min-h-screen bg-[#f4f8ff] relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[320px] bg-gradient-to-b from-sky-100/80 via-blue-50 to-transparent" />
      <div className="pointer-events-none absolute top-16 -left-10 w-[220px] h-[220px] rounded-full bg-sky-200/40 blur-3xl" />
      <div className="pointer-events-none absolute top-8 -right-16 w-[260px] h-[260px] rounded-full bg-blue-300/30 blur-3xl" />

      <div className="relative max-w-[1200px] mx-auto px-4 pt-8 pb-10 md:pt-10">
        <Link to="/" className="inline-flex items-center gap-2 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center shadow-[0_8px_20px_rgba(37,99,235,0.35)] group-hover:scale-[1.03] transition-transform">
            <Video className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-extrabold tracking-tight text-slate-900">V-SAVE</span>
        </Link>

        <div className="mt-6 rounded-3xl border border-sky-100 bg-white/72 backdrop-blur-md shadow-[0_20px_60px_rgba(15,23,42,0.12)] overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] min-h-[620px]">
            <section className="hidden lg:flex relative px-10 py-10 border-r border-sky-100/80">
              <div className="pointer-events-none absolute inset-0 opacity-65 [background-image:linear-gradient(rgba(148,163,184,0.14)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.14)_1px,transparent_1px)] [background-size:26px_26px]" />
              <div className="relative z-10 flex flex-col justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-sky-200 bg-sky-50 text-sm font-semibold text-sky-700">
                    <Sparkles className="w-4 h-4" />
                    {badge}
                  </div>
                  <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-slate-900 leading-tight">
                    {title}
                  </h1>
                  <p className="mt-4 text-lg text-slate-600 leading-relaxed max-w-[520px]">{subtitle}</p>
                </div>

                <div className="rounded-2xl border border-sky-100 bg-white/90 p-5 shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
                  <h2 className="text-lg font-bold text-slate-900">{featureTitle}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{featureDescription}</p>
                  <div className="mt-4 space-y-2.5">
                    {featurePoints.map((item) => (
                      <div key={item} className="flex items-center gap-2.5 text-sm text-slate-600">
                        <span className="inline-flex w-5 h-5 rounded-full bg-sky-100 text-sky-700 items-center justify-center text-[11px] font-bold">
                          ✓
                        </span>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="px-5 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10 flex items-center">
              <div className="w-full max-w-md mx-auto">
                <div className="lg:hidden mb-6">
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-sky-200 bg-sky-50 text-xs font-semibold text-sky-700">
                    <Sparkles className="w-3.5 h-3.5" />
                    {badge}
                  </div>
                  <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 leading-tight">
                    {title}
                  </h1>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{subtitle}</p>
                </div>

                <div className="rounded-2xl border border-sky-100 bg-white/92 p-5 sm:p-6 shadow-[0_14px_34px_rgba(15,23,42,0.1)]">
                  {children}
                </div>

                {bottomHint && (
                  <p className="text-center text-sm text-slate-500 mt-5">{bottomHint}</p>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

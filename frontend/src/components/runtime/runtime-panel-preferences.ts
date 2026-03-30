const PANEL_KEYS = [
  'successRateTrend',
  'p95Trend',
  'clientComparison',
  'platformBreakdown',
] as const

export type RuntimeDashboardPanelPreferenceKey = (typeof PANEL_KEYS)[number]

export type RuntimeDashboardPanelPreferences = Record<
  RuntimeDashboardPanelPreferenceKey,
  boolean
>

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export const RUNTIME_DASHBOARD_PANEL_PREFERENCES_STORAGE_KEY =
  'runtime-dashboard-panel-preferences'

const DEFAULT_RUNTIME_DASHBOARD_PANEL_PREFERENCES: RuntimeDashboardPanelPreferences =
  {
    successRateTrend: true,
    p95Trend: true,
    clientComparison: true,
    platformBreakdown: true,
  }

const isBooleanRecord = (
  value: unknown,
): value is Partial<Record<RuntimeDashboardPanelPreferenceKey, boolean>> => {
  return typeof value === 'object' && value !== null
}

export const readRuntimeDashboardPanelPreferences = (
  storage?: StorageLike | null,
): RuntimeDashboardPanelPreferences => {
  if (!storage) {
    return { ...DEFAULT_RUNTIME_DASHBOARD_PANEL_PREFERENCES }
  }

  const raw = storage.getItem(RUNTIME_DASHBOARD_PANEL_PREFERENCES_STORAGE_KEY)
  if (!raw) {
    return { ...DEFAULT_RUNTIME_DASHBOARD_PANEL_PREFERENCES }
  }

  try {
    return normalizeRuntimeDashboardPanelPreferences(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_RUNTIME_DASHBOARD_PANEL_PREFERENCES }
  }
}

export const writeRuntimeDashboardPanelPreferences = (
  storage: StorageLike | null | undefined,
  preferences: RuntimeDashboardPanelPreferences,
): RuntimeDashboardPanelPreferences => {
  const normalized = normalizeRuntimeDashboardPanelPreferences(preferences)

  if (storage) {
    storage.setItem(
      RUNTIME_DASHBOARD_PANEL_PREFERENCES_STORAGE_KEY,
      JSON.stringify(normalized),
    )
  }

  return normalized
}

export const normalizeRuntimeDashboardPanelPreferences = (
  value: unknown,
): RuntimeDashboardPanelPreferences => {
  if (!isBooleanRecord(value)) {
    return { ...DEFAULT_RUNTIME_DASHBOARD_PANEL_PREFERENCES }
  }

  const next = { ...DEFAULT_RUNTIME_DASHBOARD_PANEL_PREFERENCES }

  PANEL_KEYS.forEach((key) => {
    if (typeof value[key] === 'boolean') {
      next[key] = value[key]
    }
  })

  return next
}

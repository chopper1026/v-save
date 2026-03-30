import { describe, expect, it } from 'vitest'

type StorageLike = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

const createMemoryStorage = (
  initial: Record<string, string> = {},
): StorageLike & { dump: () => Record<string, string> } => {
  const store = new Map(Object.entries(initial))

  return {
    getItem(key) {
      return store.get(key) ?? null
    },
    setItem(key, value) {
      store.set(key, value)
    },
    dump() {
      return Object.fromEntries(store.entries())
    },
  }
}

const loadPreferencesModule = async () => {
  return import('./runtime-panel-preferences').catch(() => ({
    RUNTIME_DASHBOARD_PANEL_PREFERENCES_STORAGE_KEY: undefined,
    readRuntimeDashboardPanelPreferences: undefined,
    writeRuntimeDashboardPanelPreferences: undefined,
  }))
}

describe('runtime panel preferences', () => {
  it('returns collapsed defaults when nothing is persisted', async () => {
    const module = await loadPreferencesModule()

    expect(typeof module.readRuntimeDashboardPanelPreferences).toBe('function')

    const preferences = module.readRuntimeDashboardPanelPreferences?.(
      createMemoryStorage(),
    )

    expect(preferences).toEqual({
      successRateTrend: true,
      p95Trend: true,
      clientComparison: true,
      platformBreakdown: true,
    })
  })

  it('merges persisted values with defaults and ignores invalid entries', async () => {
    const module = await loadPreferencesModule()

    expect(typeof module.readRuntimeDashboardPanelPreferences).toBe('function')

    const storage = createMemoryStorage({
      'runtime-dashboard-panel-preferences': JSON.stringify({
        successRateTrend: false,
        p95Trend: 'invalid',
        unknownPanel: false,
      }),
    })

    const preferences = module.readRuntimeDashboardPanelPreferences?.(storage)

    expect(preferences).toEqual({
      successRateTrend: false,
      p95Trend: true,
      clientComparison: true,
      platformBreakdown: true,
    })
  })

  it('writes a normalized payload back to storage', async () => {
    const module = await loadPreferencesModule()

    expect(typeof module.writeRuntimeDashboardPanelPreferences).toBe('function')
    expect(module.RUNTIME_DASHBOARD_PANEL_PREFERENCES_STORAGE_KEY).toBe(
      'runtime-dashboard-panel-preferences',
    )

    const storage = createMemoryStorage()
    const normalized = module.writeRuntimeDashboardPanelPreferences?.(storage, {
      successRateTrend: false,
      p95Trend: false,
      clientComparison: true,
      platformBreakdown: false,
      unexpected: false,
    } as never)

    expect(normalized).toEqual({
      successRateTrend: false,
      p95Trend: false,
      clientComparison: true,
      platformBreakdown: false,
    })
    expect(storage.dump()).toEqual({
      'runtime-dashboard-panel-preferences': JSON.stringify(normalized),
    })
  })
})

import {
  ChevronDown,
  ChevronUp,
  Loader2,
  MonitorSmartphone,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'

type ClientType = 'WEB' | 'MOBILE'
type PlatformKey = 'douyin' | 'bilibili' | 'youtube' | 'kuaishou' | 'xiaohongshu'
type SectionKey = 'editable' | 'readonly'

type DownloadModeValue =
  | 'QUALITY_FIRST'
  | 'SPEED_FIRST'
  | 'AVAILABILITY_FIRST'
  | 'COMPATIBILITY_FIRST'

interface DownloadModeOption {
  value: DownloadModeValue
  label: string
  description: string
}

interface DownloadModePlatformSchema {
  platform: PlatformKey
  label: string
  description: string
  editable: boolean
  readonlyReason?: string
  modes: DownloadModeOption[]
}

interface DownloadModeConfigItem {
  platform: PlatformKey
  clientType: ClientType
  mode: DownloadModeValue
  updatedAt?: string | null
  updatedByEmail?: string | null
}

interface ApiEnvelope<T> {
  success?: boolean
  data?: T
}

interface SaveState {
  loading: boolean
  success: string
  error: string
}

const CLIENT_META: Array<{ key: ClientType; label: string; hint: string }> = [
  { key: 'WEB', label: '网页端', hint: '浏览器下载链路默认策略' },
  { key: 'MOBILE', label: '移动端', hint: 'App 下载链路默认策略' },
]

const PLATFORM_LABEL_MAP: Record<PlatformKey, string> = {
  douyin: '抖音',
  bilibili: 'B站',
  youtube: 'YouTube',
  kuaishou: '快手',
  xiaohongshu: '小红书',
}

const MODE_LABEL_MAP: Record<DownloadModeValue, string> = {
  QUALITY_FIRST: '画质优先',
  SPEED_FIRST: '速度优先',
  AVAILABILITY_FIRST: '可用性优先',
  COMPATIBILITY_FIRST: '兼容优先',
}

const MODE_DESCRIPTION_MAP: Record<DownloadModeValue, string> = {
  QUALITY_FIRST: '优先尝试高质量线路与更完整探测。',
  SPEED_FIRST: '优先走更快返回的下载策略，降低等待时间。',
  AVAILABILITY_FIRST: '优先使用更稳妥的可用线路，兼顾成功率。',
  COMPATIBILITY_FIRST: '优先沿用兼容性更好的端侧策略。',
}

const DEFAULT_PLATFORM_DESCRIPTIONS: Record<PlatformKey, string> = {
  douyin: '支持画质、速度、可用性三种模式，按端区分默认策略。',
  bilibili: '支持画质优先与兼容优先，兼容优先走智能兼容逻辑。',
  youtube: '当前沿用固定 progressive/服务端合流策略。',
  kuaishou: '当前沿用后端测速选流策略。',
  xiaohongshu: '当前沿用固定下载策略。',
}

const DEFAULT_SCHEMA: DownloadModePlatformSchema[] = [
  {
    platform: 'douyin',
    label: PLATFORM_LABEL_MAP.douyin,
    description: DEFAULT_PLATFORM_DESCRIPTIONS.douyin,
    editable: true,
    modes: (['QUALITY_FIRST', 'SPEED_FIRST', 'AVAILABILITY_FIRST'] as DownloadModeValue[]).map((value) => ({
      value,
      label: MODE_LABEL_MAP[value],
      description: MODE_DESCRIPTION_MAP[value],
    })),
  },
  {
    platform: 'bilibili',
    label: PLATFORM_LABEL_MAP.bilibili,
    description: DEFAULT_PLATFORM_DESCRIPTIONS.bilibili,
    editable: true,
    modes: (['QUALITY_FIRST', 'COMPATIBILITY_FIRST'] as DownloadModeValue[]).map((value) => ({
      value,
      label: MODE_LABEL_MAP[value],
      description: MODE_DESCRIPTION_MAP[value],
    })),
  },
  {
    platform: 'youtube',
    label: PLATFORM_LABEL_MAP.youtube,
    description: DEFAULT_PLATFORM_DESCRIPTIONS.youtube,
    editable: false,
    readonlyReason: '首版仅展示固定策略，不开放后台调整。',
    modes: [],
  },
  {
    platform: 'kuaishou',
    label: PLATFORM_LABEL_MAP.kuaishou,
    description: DEFAULT_PLATFORM_DESCRIPTIONS.kuaishou,
    editable: false,
    readonlyReason: '当前依赖后端测速选流，暂不开放模式切换。',
    modes: [],
  },
  {
    platform: 'xiaohongshu',
    label: PLATFORM_LABEL_MAP.xiaohongshu,
    description: DEFAULT_PLATFORM_DESCRIPTIONS.xiaohongshu,
    editable: false,
    readonlyReason: '当前为固定策略，后续再扩展。',
    modes: [],
  },
]

const normalizePlatform = (value: unknown): PlatformKey | null => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'douyin' || normalized === 'bilibili' || normalized === 'youtube' || normalized === 'kuaishou' || normalized === 'xiaohongshu') {
    return normalized
  }
  return null
}

const normalizeClientType = (value: unknown): ClientType | null => {
  const normalized = String(value || '').trim().toUpperCase()
  if (normalized === 'WEB' || normalized === 'MOBILE') {
    return normalized
  }
  return null
}

const normalizeMode = (value: unknown): DownloadModeValue | null => {
  const normalized = String(value || '').trim().toUpperCase()
  if (
    normalized === 'QUALITY_FIRST'
    || normalized === 'SPEED_FIRST'
    || normalized === 'AVAILABILITY_FIRST'
    || normalized === 'COMPATIBILITY_FIRST'
  ) {
    return normalized
  }
  return null
}

const normalizeModeOption = (input: unknown): DownloadModeOption | null => {
  if (!input || typeof input !== 'object') {
    return null
  }

  const record = input as Record<string, unknown>
  const value = normalizeMode(record.value ?? record.mode)
  if (!value) {
    return null
  }

  return {
    value,
    label: String(record.label || MODE_LABEL_MAP[value]),
    description: String(record.description || MODE_DESCRIPTION_MAP[value]),
  }
}

const normalizeSchemaResponse = (payload: unknown): DownloadModePlatformSchema[] => {
  const record = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  const rawPlatforms = Array.isArray(record.platforms)
    ? record.platforms
    : Array.isArray(record.items)
      ? record.items
      : []

  const normalized = rawPlatforms
    .map((item): DownloadModePlatformSchema | null => {
      if (!item || typeof item !== 'object') {
        return null
      }

      const raw = item as Record<string, unknown>
      const platform = normalizePlatform(raw.platform ?? raw.key)
      if (!platform) {
        return null
      }

      const rawModes = Array.isArray(raw.modes)
        ? raw.modes
        : Array.isArray(raw.modeOptions)
          ? raw.modeOptions
          : []
      const modes = rawModes
        .map((mode) => normalizeModeOption(mode))
        .filter((mode): mode is DownloadModeOption => mode !== null)

      return {
        platform,
        label: String(raw.label || PLATFORM_LABEL_MAP[platform]),
        description: String(raw.description || DEFAULT_PLATFORM_DESCRIPTIONS[platform]),
        editable: raw.editable !== false,
        readonlyReason: raw.readonlyReason ? String(raw.readonlyReason) : undefined,
        modes,
      } satisfies DownloadModePlatformSchema
    })
    .filter((item): item is DownloadModePlatformSchema => item !== null)

  if (normalized.length === 0) {
    return DEFAULT_SCHEMA
  }

  const missingPlatforms = DEFAULT_SCHEMA.filter((item) => {
    return !normalized.some((current) => current.platform === item.platform)
  })

  return [...normalized, ...missingPlatforms]
}

const normalizeConfigResponse = (payload: unknown): DownloadModeConfigItem[] => {
  const record = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  const rawItems = Array.isArray(record.items)
    ? record.items
    : Array.isArray(record.configs)
      ? record.configs
      : Array.isArray(payload)
        ? payload
        : normalizePlatform(record.platform) && normalizeClientType(record.clientType) && normalizeMode(record.mode)
          ? [record]
          : []

  const normalized: DownloadModeConfigItem[] = []

  const pushFlatConfigRecord = (raw: Record<string, unknown>) => {
    const platform = normalizePlatform(raw.platform)
    const clientType = normalizeClientType(raw.clientType)
    const mode = normalizeMode(raw.mode)
    if (!platform || !clientType || !mode) {
      return
    }
    normalized.push({
      platform,
      clientType,
      mode,
      updatedAt: raw.updatedAt ? String(raw.updatedAt) : null,
      updatedByEmail: raw.updatedByEmail ? String(raw.updatedByEmail) : null,
    })
  }

  rawItems.forEach((item) => {
    if (!item || typeof item !== 'object') {
      return
    }

    const raw = item as Record<string, unknown>
    const directPlatform = normalizePlatform(raw.platform)
    const directClientType = normalizeClientType(raw.clientType)
    const directMode = normalizeMode(raw.mode)
    if (directPlatform && directClientType && directMode) {
      pushFlatConfigRecord(raw)
      return
    }

    // backend shape: { platform, clients: { WEB: { mode, ... }, MOBILE: { mode, ... } } }
    const platform = normalizePlatform(raw.platform)
    const clients =
      raw.clients && typeof raw.clients === 'object'
        ? (raw.clients as Record<string, unknown>)
        : null
    if (!platform || !clients) {
      return
    }

    ;(['WEB', 'MOBILE'] as const).forEach((clientType) => {
      const clientRaw =
        clients[clientType] && typeof clients[clientType] === 'object'
          ? (clients[clientType] as Record<string, unknown>)
          : null
      const mode = normalizeMode(clientRaw?.mode)
      if (!clientRaw || !mode) {
        return
      }

      normalized.push({
        platform,
        clientType,
        mode,
        updatedAt: clientRaw.updatedAt ? String(clientRaw.updatedAt) : null,
        updatedByEmail: clientRaw.updatedByEmail ? String(clientRaw.updatedByEmail) : null,
      })
    })
  })

  return normalized
}

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return '--'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '--'
  }
  return date.toLocaleString('zh-CN', { hour12: false })
}

const buildConfigMap = (configs: DownloadModeConfigItem[]) => {
  return configs.reduce<Record<string, DownloadModeConfigItem>>((acc, item) => {
    acc[`${item.platform}:${item.clientType}`] = item
    return acc
  }, {})
}

const modeLabelOrFallback = (mode: DownloadModeValue | '') => (mode ? (MODE_LABEL_MAP[mode] || mode) : '--')

const buildCardKey = (sectionKey: SectionKey, platform: PlatformKey) => `${sectionKey}:${platform}`

const createDefaultExpandedCards = (items: DownloadModePlatformSchema[]) => {
  const firstEditable = items.find((item) => item.editable)
  return items.reduce<Record<string, boolean>>((acc, item) => {
    const sectionKey: SectionKey = item.editable ? 'editable' : 'readonly'
    acc[buildCardKey(sectionKey, item.platform)] = Boolean(firstEditable && item.platform === firstEditable.platform && item.editable)
    return acc
  }, {})
}

function PolicyCardShell({
  cardId,
  badge,
  title,
  description,
  summary,
  isExpanded,
  onToggle,
  children,
}: {
  cardId: string
  badge: React.ReactNode
  title: string
  description: string
  summary: React.ReactNode
  isExpanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <article className={`rounded-2xl border bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)] ${isExpanded ? 'border-sky-100 lg:col-span-2' : 'border-gray-100'}`}>
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls={cardId}
        onClick={onToggle}
        className="w-full px-5 py-4 text-left"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            {badge}
            <h3 className="mt-3 text-lg font-semibold text-text-primary">{title}</h3>
            <p className="mt-1 text-sm leading-6 text-text-secondary">{description}</p>
          </div>

          <div className="flex flex-col items-start gap-2 lg:items-end">
            {summary}
            <span className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-text-secondary">
              {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {isExpanded ? '收起' : '展开'}
            </span>
          </div>
        </div>
      </button>

      {isExpanded && (
        <div id={cardId} className="border-t border-gray-100 px-5 pb-5 pt-4">
          {children}
        </div>
      )}
    </article>
  )
}

function ReadonlyPolicyCard({
  schema,
  isExpanded,
  onToggle,
}: {
  schema: DownloadModePlatformSchema
  isExpanded: boolean
  onToggle: () => void
}) {
  const cardId = `download-mode-readonly-${schema.platform}`

  return (
    <PolicyCardShell
      cardId={cardId}
      isExpanded={isExpanded}
      onToggle={onToggle}
      badge={(
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
          <ShieldCheck className="h-3.5 w-3.5" />
          固定策略
        </div>
      )}
      title={schema.label}
      description={schema.description}
      summary={(
        <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
          <span className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-text-secondary">只读展示</span>
          <span className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-text-secondary">不支持调整</span>
        </div>
      )}
    >
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/80 px-4 py-3 text-sm text-text-secondary">
        {schema.readonlyReason || '当前平台暂不开放模式切换。'}
      </div>
    </PolicyCardShell>
  )
}

function EditablePolicyCard({
  schema,
  draftModes,
  persistedModes,
  saveState,
  isExpanded,
  onToggle,
  onModeChange,
  onSave,
}: {
  schema: DownloadModePlatformSchema
  draftModes: Record<ClientType, DownloadModeValue | ''>
  persistedModes: Record<ClientType, DownloadModeValue | ''>
  saveState: SaveState
  isExpanded: boolean
  onToggle: () => void
  onModeChange: (clientType: ClientType, mode: DownloadModeValue) => void
  onSave: () => void
}) {
  const hasChanges = CLIENT_META.some(({ key }) => draftModes[key] !== persistedModes[key])
  const cardId = `download-mode-editable-${schema.platform}`

  const summary = (
    <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
      {CLIENT_META.map((client) => {
        const persisted = persistedModes[client.key]
        const draft = draftModes[client.key]
        const changed = persisted !== draft
        return (
          <span
            key={client.key}
            className={`rounded-lg border px-2.5 py-1 text-xs ${changed ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-gray-200 bg-gray-50 text-text-secondary'}`}
          >
            {client.label}：{changed
              ? `${modeLabelOrFallback(persisted)} -> ${modeLabelOrFallback(draft)}`
              : modeLabelOrFallback(persisted)}
          </span>
        )
      })}
      {hasChanges && (
        <span className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
          有未保存更改
        </span>
      )}
    </div>
  )

  return (
    <PolicyCardShell
      cardId={cardId}
      isExpanded={isExpanded}
      onToggle={onToggle}
      badge={(
        <div className="inline-flex items-center gap-2 rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          可实时调整
        </div>
      )}
      title={schema.label}
      description={schema.description}
      summary={summary}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-text-secondary">展开后可按端选择模式并单平台保存，保存后实时生效。</p>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <button
            type="button"
            onClick={onSave}
            disabled={!hasChanges || saveState.loading}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saveState.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存配置
          </button>
          {saveState.success && <p className="text-xs text-emerald-600">{saveState.success}</p>}
          {saveState.error && <p className="text-xs text-red-500">{saveState.error}</p>}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {CLIENT_META.map((client) => {
          const selectedMode = draftModes[client.key]
          const persistedMode = persistedModes[client.key]
          return (
            <div key={client.key} className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="inline-flex items-center gap-2 text-sm font-semibold text-text-primary">
                    <MonitorSmartphone className="h-4 w-4 text-primary" />
                    {client.label}
                  </div>
                  <p className="mt-1 text-xs text-text-secondary">{client.hint}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-text-secondary">
                  当前：{persistedMode ? MODE_LABEL_MAP[persistedMode] : '--'}
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {schema.modes.map((mode) => {
                  const isSelected = selectedMode === mode.value
                  return (
                    <button
                      key={mode.value}
                      type="button"
                      onClick={() => onModeChange(client.key, mode.value)}
                      className={`w-full rounded-xl border px-4 py-3 text-left transition-all ${
                        isSelected
                          ? 'border-primary bg-primary/5 shadow-[0_0_0_1px_rgba(59,130,246,0.15)]'
                          : 'border-gray-200 bg-white hover:border-primary/40 hover:bg-primary/5'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-text-primary">{mode.label}</p>
                          <p className="mt-1 text-xs leading-5 text-text-secondary">{mode.description}</p>
                        </div>
                        <span
                          className={`mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1.5 text-[11px] font-semibold ${
                            isSelected
                              ? 'border-primary bg-primary text-white'
                              : 'border-gray-200 bg-gray-50 text-text-secondary'
                          }`}
                        >
                          {isSelected ? '已选' : '可选'}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </PolicyCardShell>
  )
}

export default function DownloadModeManagement() {
  const [schema, setSchema] = useState<DownloadModePlatformSchema[]>(DEFAULT_SCHEMA)
  const [configs, setConfigs] = useState<DownloadModeConfigItem[]>([])
  const [drafts, setDrafts] = useState<Record<string, DownloadModeValue | ''>>({})
  const [saveStates, setSaveStates] = useState<Record<PlatformKey, SaveState>>({} as Record<PlatformKey, SaveState>)
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const configMap = useMemo(() => buildConfigMap(configs), [configs])
  const editableSchemas = useMemo(() => schema.filter((item) => item.editable), [schema])
  const readonlySchemas = useMemo(() => schema.filter((item) => !item.editable), [schema])

  const initDraftsFromConfigs = useCallback((items: DownloadModeConfigItem[]) => {
    const nextDrafts: Record<string, DownloadModeValue | ''> = {}
    items.forEach((item) => {
      nextDrafts[`${item.platform}:${item.clientType}`] = item.mode
    })
    setDrafts(nextDrafts)
  }, [])

  const fetchPolicyCenter = useCallback(async () => {
    try {
      setIsLoading(true)
      setError('')
      const [schemaResponse, configsResponse] = await Promise.all([
        api.get<ApiEnvelope<unknown>>('/admin/download-modes/schema'),
        api.get<ApiEnvelope<unknown>>('/admin/download-modes/configs'),
      ])

      const nextSchema = normalizeSchemaResponse(schemaResponse.data?.data)
      const nextConfigs = normalizeConfigResponse(configsResponse.data?.data)
      setSchema(nextSchema)
      setConfigs(nextConfigs)
      initDraftsFromConfigs(nextConfigs)
      setSaveStates(nextSchema.reduce<Record<PlatformKey, SaveState>>((acc, item) => {
        acc[item.platform] = { loading: false, success: '', error: '' }
        return acc
      }, {} as Record<PlatformKey, SaveState>))
      setExpandedCards((prev) => {
        if (Object.keys(prev).length === 0) {
          return createDefaultExpandedCards(nextSchema)
        }

        return nextSchema.reduce<Record<string, boolean>>((acc, item) => {
          const sectionKey: SectionKey = item.editable ? 'editable' : 'readonly'
          const key = buildCardKey(sectionKey, item.platform)
          acc[key] = prev[key] ?? false
          return acc
        }, {})
      })
    } catch (err) {
      console.error('获取下载模式配置失败:', err)
      setError('获取下载模式配置失败，请稍后重试')
    } finally {
      setIsLoading(false)
    }
  }, [initDraftsFromConfigs])

  useEffect(() => {
    void fetchPolicyCenter()
  }, [fetchPolicyCenter])

  const updateSaveState = useCallback((platform: PlatformKey, patch: Partial<SaveState>) => {
    setSaveStates((prev) => ({
      ...prev,
      [platform]: {
        ...(prev[platform] || {}),
        loading: false,
        success: '',
        error: '',
        ...patch,
      },
    }))
  }, [])

  const handleModeChange = useCallback((platform: PlatformKey, clientType: ClientType, mode: DownloadModeValue) => {
    setDrafts((prev) => ({
      ...prev,
      [`${platform}:${clientType}`]: mode,
    }))
    updateSaveState(platform, { success: '', error: '' })
  }, [updateSaveState])

  const handleSave = useCallback(async (platform: PlatformKey) => {
    const webMode = drafts[`${platform}:WEB`]
    const mobileMode = drafts[`${platform}:MOBILE`]
    if (!webMode || !mobileMode) {
      updateSaveState(platform, { error: '请先为网页端和移动端都选择模式。' })
      return
    }

    try {
      updateSaveState(platform, { loading: true, success: '', error: '' })
      await Promise.all([
        api.put<ApiEnvelope<unknown>>(`/admin/download-modes/configs/${platform}/WEB`, { mode: webMode }),
        api.put<ApiEnvelope<unknown>>(`/admin/download-modes/configs/${platform}/MOBILE`, { mode: mobileMode }),
      ])
      const configsResponse = await api.get<ApiEnvelope<unknown>>('/admin/download-modes/configs')
      setConfigs(normalizeConfigResponse(configsResponse.data?.data))
      updateSaveState(platform, { loading: false, success: '下载模式已保存并实时生效。', error: '' })
    } catch (err) {
      console.error(`保存 ${platform} 下载模式失败:`, err)
      updateSaveState(platform, { loading: false, error: '保存失败，请稍后重试。', success: '' })
    }
  }, [drafts, updateSaveState])

  const toggleCard = useCallback((sectionKey: SectionKey, platform: PlatformKey) => {
    const key = buildCardKey(sectionKey, platform)
    setExpandedCards((prev) => ({
      ...prev,
      [key]: !prev[key],
    }))
  }, [])

  const expandAllCards = useCallback(() => {
    setExpandedCards(schema.reduce<Record<string, boolean>>((acc, item) => {
      const sectionKey: SectionKey = item.editable ? 'editable' : 'readonly'
      acc[buildCardKey(sectionKey, item.platform)] = true
      return acc
    }, {}))
  }, [schema])

  const collapseAllCards = useCallback(() => {
    setExpandedCards(schema.reduce<Record<string, boolean>>((acc, item) => {
      const sectionKey: SectionKey = item.editable ? 'editable' : 'readonly'
      acc[buildCardKey(sectionKey, item.platform)] = false
      return acc
    }, {}))
  }, [schema])

  return (
    <div className="rounded-2xl bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)] md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">下载模式管理</h1>
          <p className="mt-1 text-sm text-text-secondary">按平台和端类型统一治理下载策略，保存后实时生效。</p>
        </div>
        <button
          type="button"
          onClick={() => void fetchPolicyCenter()}
          disabled={isLoading}
          className="inline-flex items-center gap-2 self-start rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm text-text-primary transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          刷新配置
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

      {isLoading ? (
        <div className="mt-6 rounded-2xl border border-dashed border-gray-200 bg-gray-50/70 p-8 text-center text-sm text-text-secondary">
          下载模式配置加载中...
        </div>
      ) : (
        <>
          <div className="mt-6 rounded-2xl border border-gray-100 bg-gray-50/70 p-3.5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                <span className="rounded-lg border border-gray-200 bg-white px-2.5 py-1">平台总数：{schema.length}</span>
                <span className="rounded-lg border border-sky-100 bg-sky-50 px-2.5 py-1 text-sky-700">可编辑：{editableSchemas.length}</span>
                <span className="rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-emerald-700">只读：{readonlySchemas.length}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={expandAllCards}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-text-primary hover:bg-gray-50"
                >
                  全部展开
                </button>
                <button
                  type="button"
                  onClick={collapseAllCards}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-text-primary hover:bg-gray-50"
                >
                  全部收起
                </button>
              </div>
            </div>
          </div>

          {editableSchemas.length > 0 && (
            <section className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text-primary">可编辑平台</h2>
                <span className="rounded-lg border border-sky-100 bg-sky-50 px-2.5 py-1 text-xs text-sky-700">{editableSchemas.length} 个平台</span>
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {editableSchemas.map((item) => {
                  const persistedModes = {
                    WEB: configMap[`${item.platform}:WEB`]?.mode || '',
                    MOBILE: configMap[`${item.platform}:MOBILE`]?.mode || '',
                  } satisfies Record<ClientType, DownloadModeValue | ''>
                  const draftModes = {
                    WEB: (drafts[`${item.platform}:WEB`] || persistedModes.WEB) as DownloadModeValue | '',
                    MOBILE: (drafts[`${item.platform}:MOBILE`] || persistedModes.MOBILE) as DownloadModeValue | '',
                  } satisfies Record<ClientType, DownloadModeValue | ''>
                  const saveState = saveStates[item.platform] || { loading: false, success: '', error: '' }
                  const cardKey = buildCardKey('editable', item.platform)

                  return (
                    <EditablePolicyCard
                      key={cardKey}
                      schema={item}
                      draftModes={draftModes}
                      persistedModes={persistedModes}
                      saveState={saveState}
                      isExpanded={Boolean(expandedCards[cardKey])}
                      onToggle={() => toggleCard('editable', item.platform)}
                      onModeChange={(clientType, mode) => handleModeChange(item.platform, clientType, mode)}
                      onSave={() => void handleSave(item.platform)}
                    />
                  )
                })}
              </div>
            </section>
          )}

          {readonlySchemas.length > 0 && (
            <section className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text-primary">只读平台</h2>
                <span className="rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">{readonlySchemas.length} 个平台</span>
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {readonlySchemas.map((item) => {
                  const cardKey = buildCardKey('readonly', item.platform)
                  return (
                    <ReadonlyPolicyCard
                      key={cardKey}
                      schema={item}
                      isExpanded={Boolean(expandedCards[cardKey])}
                      onToggle={() => toggleCard('readonly', item.platform)}
                    />
                  )
                })}
              </div>
            </section>
          )}
        </>
      )}

      {!isLoading && (
        <div className="mt-6 rounded-2xl border border-sky-100 bg-sky-50/70 p-4">
          <h2 className="text-sm font-semibold text-sky-900">当前治理口径</h2>
          <ul className="mt-2 space-y-1 text-xs leading-5 text-sky-800">
            <li>网页端与移动端使用独立默认模式，请分别配置。</li>
            <li>用户显式确认后的重试行为仍会按当次请求覆盖默认模式。</li>
            <li>只读平台继续沿用既有固定策略，不影响现有下载链路。</li>
          </ul>
        </div>
      )}

      {!isLoading && configs.length > 0 && (
        <div className="mt-6 rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
          <h2 className="text-sm font-semibold text-text-primary">最近生效记录</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {configs.map((item) => (
              <div key={`${item.platform}:${item.clientType}`} className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-text-primary">
                    {PLATFORM_LABEL_MAP[item.platform]} / {item.clientType === 'WEB' ? '网页端' : '移动端'}
                  </span>
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-text-secondary">
                    {MODE_LABEL_MAP[item.mode] || item.mode}
                  </span>
                </div>
                <p className="mt-1 text-xs text-text-secondary">
                  更新时间：{formatDateTime(item.updatedAt)}
                  {item.updatedByEmail ? ` ｜ 操作人：${item.updatedByEmail}` : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

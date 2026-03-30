import { useCallback, useEffect, useState } from 'react'
import { getApiOrigin } from '../lib/api'

export const LOCAL_COMPANION_BASE_URL = 'http://127.0.0.1:37219'

export interface LocalCompanionAvailabilityState {
  isChecked: boolean
  isChecking: boolean
  isAvailable: boolean
  message: string
}

interface UseLocalCompanionAvailabilityOptions {
  enabled?: boolean
}

const DEFAULT_UNAVAILABLE_MESSAGE =
  '未检测到本机登录助手，请先安装并启动 V-SAVE Companion'

export const useLocalCompanionAvailability = ({
  enabled = true,
}: UseLocalCompanionAvailabilityOptions = {}) => {
  const [state, setState] = useState<LocalCompanionAvailabilityState>({
    isChecked: false,
    isChecking: false,
    isAvailable: false,
    message: DEFAULT_UNAVAILABLE_MESSAGE,
  })

  const refreshAvailability = useCallback(async () => {
    if (!enabled) {
      setState({
        isChecked: false,
        isChecking: false,
        isAvailable: false,
        message: DEFAULT_UNAVAILABLE_MESSAGE,
      })
      return false
    }

    setState((current) => ({
      ...current,
      isChecking: true,
    }))

    try {
      const backendOrigin = getApiOrigin()
      const response = await fetch(`${LOCAL_COMPANION_BASE_URL}/health`, {
        headers: {
          'x-vsave-backend-origin': backendOrigin,
        },
      })

      if (!response.ok) {
        throw new Error(`health check failed: ${response.status}`)
      }

      setState({
        isChecked: true,
        isChecking: false,
        isAvailable: true,
        message: '已检测到本机登录助手',
      })
      return true
    } catch (_error) {
      setState({
        isChecked: true,
        isChecking: false,
        isAvailable: false,
        message: DEFAULT_UNAVAILABLE_MESSAGE,
      })
      return false
    }
  }, [enabled])

  useEffect(() => {
    void refreshAvailability()
  }, [refreshAvailability])

  return {
    ...state,
    refreshAvailability,
  }
}

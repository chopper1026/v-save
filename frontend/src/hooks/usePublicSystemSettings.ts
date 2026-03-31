import { useEffect, useState } from 'react'
import { api } from '../lib/api'

export interface PublicSystemSettingsState {
  registrationEnabled: boolean
  isLoaded: boolean
}

const DEFAULT_STATE: PublicSystemSettingsState = {
  registrationEnabled: false,
  isLoaded: false,
}

let cachedState: PublicSystemSettingsState = DEFAULT_STATE
let pendingRequest: Promise<void> | null = null
const listeners = new Set<(state: PublicSystemSettingsState) => void>()

const emitState = () => {
  listeners.forEach((listener) => listener(cachedState))
}

const commitState = (nextState: PublicSystemSettingsState) => {
  cachedState = nextState
  emitState()
}

const normalizeRegistrationEnabled = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const payload = value as {
    data?: {
      registrationEnabled?: unknown
    }
  }

  return payload.data?.registrationEnabled === true
}

const ensurePublicSettingsLoaded = async () => {
  if (cachedState.isLoaded) {
    return
  }

  if (!pendingRequest) {
    pendingRequest = api
      .get('/system-settings/public')
      .then((response) => {
        commitState({
          isLoaded: true,
          registrationEnabled: normalizeRegistrationEnabled(response.data),
        })
      })
      .catch(() => {
        commitState({
          isLoaded: true,
          registrationEnabled: false,
        })
      })
      .finally(() => {
        pendingRequest = null
      })
  }

  await pendingRequest
}

export const resetPublicSystemSettingsCache = () => {
  cachedState = DEFAULT_STATE
  pendingRequest = null
  emitState()
}

export const setPublicSystemSettingsCache = (input: {
  registrationEnabled: boolean
}) => {
  commitState({
    isLoaded: true,
    registrationEnabled: input.registrationEnabled === true,
  })
}

export function usePublicSystemSettings() {
  const [state, setState] = useState(cachedState)

  useEffect(() => {
    listeners.add(setState)
    if (!cachedState.isLoaded) {
      void ensurePublicSettingsLoaded()
    }

    return () => {
      listeners.delete(setState)
    }
  }, [])

  return state
}

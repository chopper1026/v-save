const LEGACY_REMEMBER_PASSWORD_STORAGE_KEY = 'remembered-login-credentials'
const REMEMBER_PASSWORD_PREFERENCE_KEY = 'remembered-login-preference'

export interface RememberedLoginPreference {
  rememberPassword: boolean
  email: string
}

export const clearLegacyRememberedPassword = () => {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.removeItem(LEGACY_REMEMBER_PASSWORD_STORAGE_KEY)
}

export const loadRememberedLoginPreference = (): RememberedLoginPreference => {
  if (typeof window === 'undefined') {
    return {
      rememberPassword: false,
      email: '',
    }
  }

  const raw = window.localStorage.getItem(REMEMBER_PASSWORD_PREFERENCE_KEY)
  if (!raw) {
    return {
      rememberPassword: false,
      email: '',
    }
  }

  try {
    const parsed = JSON.parse(raw) as Partial<RememberedLoginPreference>
    return {
      rememberPassword: parsed.rememberPassword === true,
      email: typeof parsed.email === 'string' ? parsed.email : '',
    }
  } catch {
    window.localStorage.removeItem(REMEMBER_PASSWORD_PREFERENCE_KEY)
    return {
      rememberPassword: false,
      email: '',
    }
  }
}

export const saveRememberedLoginPreference = (input: RememberedLoginPreference) => {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(
    REMEMBER_PASSWORD_PREFERENCE_KEY,
    JSON.stringify({
      rememberPassword: input.rememberPassword,
      email: input.email,
    }),
  )
}

export const clearRememberedLoginPreference = () => {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.removeItem(REMEMBER_PASSWORD_PREFERENCE_KEY)
}

export const storeBrowserCredential = async (input: {
  email: string
  password: string
}) => {
  if (
    typeof window === 'undefined' ||
    typeof navigator === 'undefined' ||
    !window.isSecureContext
  ) {
    return
  }

  const PasswordCredentialCtor = (
    window as Window & {
      PasswordCredential?: new (data: {
        id: string
        password: string
        name?: string
      }) => Credential
    }
  ).PasswordCredential

  if (!navigator.credentials?.store || !PasswordCredentialCtor) {
    return
  }

  const credential = new PasswordCredentialCtor({
    id: input.email,
    password: input.password,
    name: input.email,
  })

  await navigator.credentials.store(credential)
}

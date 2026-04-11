import type { IncomingMessage } from 'node:http'
import { randomUUID } from 'node:crypto'

type AuthConfig = {
  readonly email: string
  readonly password: string
  readonly token: string
}

type AuthState = {
  readonly sessions: Set<string>
}

export type AuthManager = {
  /** Validate a request's auth credentials. Returns true if authorized. */
  readonly validateRequest: (req: IncomingMessage) => boolean
  /** Create a session from email/password. Returns sessionId or null. */
  readonly createSession: (email: string, password: string) => string | null
}

export function createAuthManager(config: AuthConfig): AuthManager {
  const state: AuthState = {
    sessions: new Set<string>(),
  }

  return {
    validateRequest(req: IncomingMessage): boolean {
      const authHeader = req.headers.authorization

      // Check Bearer token
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7).trim()
        return token === config.token
      }

      // Check session cookie
      const cookieHeader = req.headers.cookie
      if (cookieHeader) {
        const match = cookieHeader.match(/JSESSIONID=([^;]+)/)
        if (match && state.sessions.has(match[1])) {
          return true
        }
      }

      // Check Basic auth
      if (authHeader?.startsWith('Basic ')) {
        const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8')
        const [email, password] = decoded.split(':')
        return email === config.email && password === config.password
      }

      return false
    },

    createSession(email: string, password: string): string | null {
      if (email !== config.email || password !== config.password) {
        return null
      }

      const sessionId = randomUUID()
      state.sessions.add(sessionId)
      return sessionId
    },
  }
}

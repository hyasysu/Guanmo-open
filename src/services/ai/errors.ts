export class AiError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number
  ) {
    super(message)
    this.name = 'AiError'
  }
}

export class AiConfigError extends AiError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR')
    this.name = 'AiConfigError'
  }
}

export class AiNetworkError extends AiError {
  constructor(message: string) {
    super(message, 'NETWORK_ERROR')
    this.name = 'AiNetworkError'
  }
}

export class AiRateLimitError extends AiError {
  constructor(retryAfter?: number) {
    super('Rate limit exceeded', 'RATE_LIMIT', 429)
    this.name = 'AiRateLimitError'
  }
}

export class AiAuthError extends AiError {
  constructor() {
    super('Invalid API key', 'AUTH_ERROR', 401)
    this.name = 'AiAuthError'
  }
}

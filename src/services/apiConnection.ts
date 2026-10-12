import type { AiConfig, EmbeddingConfig } from './ai/types'
import type { WebSearchConfig } from './webSearch'

export interface ApiConnection {
  kind: 'chat' | 'embedding' | 'search'
  protocol: string
  baseUrl: string
}

export interface ApiConnectionStatus {
  configId: string
  configured: boolean
}

export function chatConnection(config: Pick<AiConfig, 'baseUrl' | 'protocol'>): ApiConnection {
  return { kind: 'chat', protocol: config.protocol, baseUrl: config.baseUrl }
}

export function embeddingConnection(config: Pick<EmbeddingConfig, 'baseUrl' | 'protocol'>): ApiConnection {
  return { kind: 'embedding', protocol: config.protocol, baseUrl: config.baseUrl }
}

export function searchConnection(config: Pick<WebSearchConfig, 'provider' | 'customUrl'>): ApiConnection {
  const endpoints = {
    tavily: 'https://api.tavily.com/search',
    serper: 'https://google.serper.dev/search',
    brave: 'https://api.search.brave.com/res/v1/web/search',
    custom: config.customUrl || '',
  }
  return { kind: 'search', protocol: config.provider, baseUrl: endpoints[config.provider] }
}

export function connectionIdentity(connection: ApiConnection): string {
  return JSON.stringify(connection)
}

export function hasApiCredential(config: { apiKey: string; apiKeyConfigured?: boolean }): boolean {
  return Boolean(config.apiKey || config.apiKeyConfigured)
}

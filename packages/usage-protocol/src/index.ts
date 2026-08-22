export * from './quality.ts'
export * from './event.ts'
export * from './query.ts'

export interface RuntimeInfo {
  platform: 'desktop' | 'web' | 'vscode'
  version: string
  pluginApiVersion: string
}

export type Unsubscribe = () => void

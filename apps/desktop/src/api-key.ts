const SECRET_KEYS = /^(DEEPSEEK_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|API_KEY|TOKEN|SECRET)$/iu

export function hasDeepSeekApiKey(env: NodeJS.ProcessEnv): boolean {
  const value = env.DEEPSEEK_API_KEY
  return typeof value === 'string' && value.trim().length > 0
}

export function upsertEnvKey(text: string, key: string, value: string): string {
  const line = `${key}=${value}`
  const pattern = new RegExp(`^${key}=.*$`, 'm')
  if (pattern.test(text)) return text.replace(pattern, line)
  const trimmed = text.replace(/\s+$/u, '')
  return trimmed ? `${trimmed}\n${line}\n` : `${line}\n`
}

export function redactSecrets(text: string): string {
  return text.replace(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/gmu, (full, key: string, value: string) =>
    SECRET_KEYS.test(key) && value.trim() ? `${key}=***` : full,
  )
}

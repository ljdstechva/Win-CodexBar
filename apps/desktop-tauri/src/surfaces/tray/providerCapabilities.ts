const DASHBOARD_PROVIDERS = new Set([
  "abacus", "alibaba", "alibabatokenplan", "amp", "augment", "azureopenai",
  "bedrock", "chatgpt", "claude", "codex", "codebuff", "commandcode", "copilot", "crof",
  "crossmodel", "cursor", "deepgram", "deepinfra", "deepseek", "aiand",
  "zenmux", "clinepass", "longcat", "neuralwatt", "doubao", "elevenlabs",
  "factory", "gemini", "grok", "groq", "infini", "jetbrains", "kilo", "kimi",
  "kimik2", "kiro", "manus", "mimo", "minimax", "mistral", "nanogpt", "ollama",
  "openaiapi", "opencode", "opencodego", "openrouter", "perplexity", "qoder",
  "sakana", "stepfun", "t3chat", "venice", "vertexai", "warp", "windsurf", "zai",
]);

const STATUS_PAGE_PROVIDERS = new Set([
  "alibabatokenplan", "amp", "augment", "azureopenai", "bedrock", "claude",
  "chatgpt", "codex", "copilot", "deepgram", "deepinfra", "deepseek", "zenmux",
  "clinepass", "longcat", "neuralwatt", "elevenlabs", "gemini", "grok",
  "groq", "kiro", "mistral", "openaiapi", "openrouter", "vertexai", "windsurf",
]);

export const hasProviderDashboard = (providerId: string): boolean =>
  DASHBOARD_PROVIDERS.has(providerId);

export const hasProviderStatusPage = (providerId: string): boolean =>
  STATUS_PAGE_PROVIDERS.has(providerId);

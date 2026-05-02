export function formatProviderName(providerId: string): string {
  switch (providerId) {
    case "fireworks":
      return "Fireworks";
    case "moonshot":
      return "Moonshot";
    case "xiaomi":
      return "Xiaomi MiMo";
    case "groq":
      return "Groq";
    case "openai":
      return "OpenAI";
    case "openrouter":
    case "openrouter-groq":
      return "OpenRouter";
    default:
      return providerId || "LLM provider";
  }
}

export function getProviderCreditsUrl(providerId: string): string | null {
  switch (providerId) {
    case "openrouter":
    case "openrouter-groq":
      return "https://openrouter.ai/credits";
    case "fireworks":
      return "https://fireworks.ai";
    case "moonshot":
      return "https://platform.kimi.ai";
    case "xiaomi":
      return "https://platform.xiaomimimo.com";
    case "groq":
      return "https://console.groq.com";
    case "openai":
      return "https://platform.openai.com";
    default:
      return null;
  }
}

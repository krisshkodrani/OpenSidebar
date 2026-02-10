import { ActivateSwarmArgs, AgentStatus } from "../types";
import { logger } from "../utils";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL_NAME = "moonshotai/kimi-k2.5";

// Retry configuration
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_TOTAL_WAIT_MS = 7000; // 7 seconds total

interface SwarmRequest {
  model: string;
  messages: { role: string; content: string }[];
  temperature: number;
  max_tokens: number;
  stream: boolean;
  mode?: "agent_swarm";
}

/**
 * Calls Kimi Swarm with retry logic and smart truncation
 */
export async function callKimiSwarm(
  args: ActivateSwarmArgs,
  statusCallback?: (status: AgentStatus, detail: string) => void,
): Promise<string> {
  const settings = await chrome.storage.sync.get(["openRouterApiKey"]);
  const apiKey = settings.openRouterApiKey;

  if (!apiKey) {
    return "Error: OpenRouter API key not configured. Please add it in Settings.";
  }

  const systemPrompt = buildSwarmSystemPrompt(args);
  const userPrompt = buildSwarmUserPrompt(args);

  logger.info("agent", "Activating Kimi Swarm", { task: args.task });

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        const delay = calculateDelay(attempt);
        logger.info(
          "agent",
          `Retrying Kimi Swarm (${attempt}/${MAX_RETRIES})`,
          { delay },
        );

        if (statusCallback) {
          statusCallback(
            AgentStatus.WAITING_FOR_SWARM,
            `Rate limited, retrying (${attempt}/${MAX_RETRIES}) in ${delay / 1000}s...`,
          );
        }

        await sleep(delay);
      }

      const result = await executeSwarmCall(apiKey, systemPrompt, userPrompt);

      // Smart truncation if result is too long
      const truncatedResult = smartTruncate(result, 8000);

      if (truncatedResult.length < result.length) {
        logger.info("agent", "Kimi Swarm response truncated", {
          originalLength: result.length,
          truncatedLength: truncatedResult.length,
        });
      } else {
        logger.info("agent", "Kimi Swarm completed", { length: result.length });
      }

      return truncatedResult;
    } catch (error: any) {
      lastError = error;

      // Don't retry on client errors (4xx except 429)
      if (
        error.message?.includes("API error 4") &&
        !error.message?.includes("429")
      ) {
        logger.error("agent", "Swarm client error (no retry)", {
          error: error.message,
        });
        break;
      }

      // Don't retry if we've exceeded max wait time
      const totalWaitSoFar = calculateTotalDelay(attempt);
      if (totalWaitSoFar >= MAX_TOTAL_WAIT_MS) {
        logger.warn("agent", "Max wait time exceeded, giving up", {
          totalWait: totalWaitSoFar,
        });
        break;
      }

      logger.warn("agent", `Swarm attempt ${attempt} failed, will retry`, {
        error: error.message,
        nextAttempt: attempt + 1,
      });
    }
  }

  // All retries exhausted
  const errorMsg = lastError?.message || "Unknown error";
  logger.error("agent", "Swarm execution failed after all retries", {
    error: errorMsg,
  });

  if (statusCallback) {
    statusCallback(
      AgentStatus.ERROR,
      `Failed after ${MAX_RETRIES} attempts: ${errorMsg}`,
    );
  }

  return `Swarm Error: ${errorMsg}`;
}

/**
 * Execute the actual API call to OpenRouter
 */
async function executeSwarmCall(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "chrome-extension://opensidebar",
      "X-Title": "OpenSidebar",
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 4000,
      temperature: 0.3,
      stream: true,
      mode: "agent_swarm",
    } as SwarmRequest),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${body}`);
  }

  if (!response.body) throw new Error("No response body");

  // Parse Stream
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n").filter((line) => line.trim() !== "");

    for (const line of lines) {
      if (line === "data: [DONE]") continue;
      if (line.startsWith("data: ")) {
        try {
          const json = JSON.parse(line.slice(6));
          const content = json.choices[0]?.delta?.content || "";
          if (content) {
            fullText += content;
          }
        } catch (_e) {
          // ignore parse errors for partial chunks
        }
      }
    }
  }

  return fullText || "Swarm returned no results.";
}

/**
 * Calculate delay with exponential backoff and jitter
 * Attempt 1: 1000ms, Attempt 2: 2000ms, Attempt 3: 4000ms
 */
function calculateDelay(attempt: number): number {
  const baseDelay = BASE_DELAY_MS * Math.pow(2, attempt - 2); // 1, 2, 4 seconds
  const jitter = Math.floor(Math.random() * 200) + 100; // 100-300ms random jitter
  return baseDelay + jitter;
}

/**
 * Calculate total delay so far to check against max wait time
 */
function calculateTotalDelay(attemptsMade: number): number {
  let total = 0;
  for (let i = 2; i <= attemptsMade; i++) {
    total += BASE_DELAY_MS * Math.pow(2, i - 2);
  }
  return total;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Smart truncation: Extract intro + conclusion, skip verbose middle
 *
 * Strategy:
 * - If text <= 8000 chars: return as-is
 * - If text > 8000 chars: extract first 2000 chars + last 4000 chars
 * - Preserve sentence and paragraph boundaries
 */
function smartTruncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const introLength = 2000;
  const conclusionLength = 4000;
  const omittedLength = text.length - introLength - conclusionLength;

  // Extract intro (first 2000 chars, rounded to sentence boundary)
  let intro = text.slice(0, introLength);
  intro = truncateAtBoundary(intro, true);

  // Extract conclusion (last 4000 chars, rounded to sentence boundary)
  let conclusion = text.slice(-conclusionLength);
  conclusion = truncateAtBoundary(conclusion, false);

  // Remove leading/trailing whitespace from conclusion
  conclusion = conclusion.trim();

  return `${intro}\n\n[_Research report truncated - ${omittedLength.toLocaleString()} characters omitted showing key sections_]
\n[...]\n\n${conclusion}`;
}

/**
 * Truncate text at a natural boundary (sentence or paragraph)
 * @param text - Text to truncate
 * @param fromStart - If true, truncate from end (keeping start). If false, truncate from start (keeping end)
 */
function truncateAtBoundary(text: string, fromStart: boolean): string {
  if (fromStart) {
    // Find the last sentence boundary within the text
    // Try to find: period + space, newline, or end of paragraph
    const sentenceMatch = text.match(/.*[.!?]\s+/s);
    const paragraphMatch = text.match(/.*\n\n/s);

    if (paragraphMatch && paragraphMatch[0].length > text.length * 0.7) {
      // If we can keep most of the text by truncating at paragraph, do that
      return paragraphMatch[0].trim();
    } else if (sentenceMatch && sentenceMatch[0].length > text.length * 0.8) {
      // If we can keep most of the text by truncating at sentence, do that
      return sentenceMatch[0].trim();
    }

    return text.trim();
  } else {
    // From end - find first sentence/paragraph boundary
    const sentenceMatch = text.match(/[.!?]\s+.*/s);
    const paragraphMatch = text.match(/\n\n.*/s);

    if (paragraphMatch && paragraphMatch[0].length > text.length * 0.7) {
      return paragraphMatch[0].trim();
    } else if (sentenceMatch && sentenceMatch[0].length > text.length * 0.8) {
      return sentenceMatch[0].trim();
    }

    return text.trim();
  }
}

function buildSwarmSystemPrompt(_args: ActivateSwarmArgs): string {
  return `You are the Deep Thought Engine (Kimi Swarm). 
Your goal is to perform deep, comprehensive research on the user's topic.
You have access to a massive context window (128k).

## Instructions
1. Analyze the request.
2. If URLs are provided, use them as primary sources.
3. Synthesize a detailed report.
4. Structure your response with Markdown properties:
   - # Title
   - ## Executive Summary
   - ## Key Findings (Bulleted)
   - ## Deep Dive (Sections)
   - ## Conclusion & Recommendations

Keep the report factual, dense, and properly cited where possible.`;
}

function buildSwarmUserPrompt(args: ActivateSwarmArgs): string {
  let prompt = `Research Task: ${args.task}`;
  if (args.urls && args.urls.length > 0) {
    prompt += `\n\nSource URLs:\n${args.urls.join("\n")}`;
  }
  return prompt;
}

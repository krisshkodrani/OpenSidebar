import {
  MessageSource,
  RuntimeMessage,
  MemoryWorkerMessage,
  MemoryWorkerResponse,
} from "../../types";

const OFFSCREEN_DOCUMENT_PATH = "src/offscreen/memory/index.html";
let creatingPromise: Promise<void> | null = null;

async function setupOffscreenDocument(path: string) {
  // If a creation is already in flight, wait for it
  if (creatingPromise) {
    await creatingPromise;
    return;
  }

  // Check if offscreen document exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(path)],
  });

  if (existingContexts.length > 0) {
    return;
  }

  // Create offscreen document (guard against concurrent calls)
  creatingPromise = chrome.offscreen.createDocument({
    url: path,
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification:
      "Running Transformers.js for semantic search (memory system).",
  });

  try {
    await creatingPromise;
  } finally {
    creatingPromise = null;
  }
}

export async function sendMessageToMemory(
  payload: MemoryWorkerMessage["payload"],
): Promise<MemoryWorkerResponse["payload"]> {
  await setupOffscreenDocument(OFFSCREEN_DOCUMENT_PATH);

  const requestId = crypto.randomUUID();
  const message: MemoryWorkerMessage = {
    type: "MEMORY_WORKER",
    requestId,
    source: MessageSource.BACKGROUND,
    payload,
  };

  return new Promise((resolve, reject) => {
    const listener = (response: RuntimeMessage) => {
      if (
        response.type === "MEMORY_WORKER_RESPONSE" &&
        response.requestId === requestId
      ) {
        chrome.runtime.onMessage.removeListener(listener);
        if ((response.payload as any).error) {
          reject(new Error((response.payload as any).error));
        } else {
          resolve(response.payload);
        }
      }
    };

    // Timeout
    setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error("Memory operation timed out"));
    }, 30000); // Embeddings can be slow to auto-download model first time

    chrome.runtime.onMessage.addListener(listener);
    chrome.runtime.sendMessage(message);
  });
}

import { logger } from "../../utils";

const BACKEND_URL = "http://127.0.0.1:7590";
const TIMEOUT_MS = 5000;

async function backendFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  return fetch(`${BACKEND_URL}${path}`, {
    ...options,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "Content-Type": "application/json", ...options.headers },
  });
}

export async function markTaskRunning(id: string): Promise<void> {
  try {
    await backendFetch(`/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "running" }),
    });
  } catch {
    logger.debug("backend-client", "Task status update failed");
  }
}

export async function markTaskCompleted(
  id: string,
  result: string,
): Promise<void> {
  try {
    await backendFetch(`/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "completed", result }),
    });
  } catch {
    logger.debug("backend-client", "Task completion update failed");
  }
}

export async function markTaskFailed(
  id: string,
  result: string,
): Promise<void> {
  try {
    await backendFetch(`/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "failed", result }),
    });
  } catch {
    logger.debug("backend-client", "Task failure update failed");
  }
}

import { BufferedMemory } from "./types";
import { sendMessageToMemory } from "../memory/bridge";
import { logger } from "../../utils";

export class MemoryBuffer {
  private byWorker = new Map<string, BufferedMemory[]>();

  add(workerId: string, item: BufferedMemory): void {
    const items = this.byWorker.get(workerId) ?? [];
    items.push(item);
    this.byWorker.set(workerId, items);
  }

  drainWorker(workerId: string): BufferedMemory[] {
    const items = this.byWorker.get(workerId) ?? [];
    this.byWorker.delete(workerId);
    return items;
  }

  discardWorker(workerId: string): void {
    this.byWorker.delete(workerId);
  }

  async commitWorker(workerId: string): Promise<number> {
    const items = this.drainWorker(workerId);
    if (items.length === 0) return 0;

    const response = await sendMessageToMemory({
      action: "batch_add",
      items: items.map((m) => ({
        content: m.content,
        category: m.category,
        sourceUrl: m.sourceUrl,
      })),
    });

    if (response.action !== "batch_add" || !response.success) {
      logger.warn("orchestrator", "Failed to commit buffered memories", {
        workerId,
        count: items.length,
      });
      return 0;
    }

    return response.count;
  }
}

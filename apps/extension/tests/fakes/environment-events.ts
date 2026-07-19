/**
 * In-memory fakes for the Phase 4a event ports (RFC LP-15). Each fake lets a
 * test drive the events a port would emit and observe what consumers do, with
 * no chrome globals. Seeds the Phase 5 fake-environment kit.
 */

import type {
  NavigationErrorDetails,
  NavigationEventDetails,
  NavigationEventsPort,
  RuntimeMessagingPort,
  SchedulerPort,
} from "../../src/background/environment/types";

function emitter<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    add(listener: (value: T) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(value: T): void {
      for (const listener of [...listeners]) listener(value);
    },
    get size() {
      return listeners.size;
    },
  };
}

export interface FakeRuntimeMessagingPort extends RuntimeMessagingPort {
  /** Messages passed to broadcast(), in order. */
  readonly broadcasts: unknown[];
  /** Deliver an inbound message (i.e. from another context) to subscribers. */
  deliver(message: unknown, sender?: { tabId?: number }): void;
}

export function createFakeRuntimeMessagingPort(
  responder?: (message: unknown) => unknown,
): FakeRuntimeMessagingPort {
  const broadcasts: unknown[] = [];
  const inbound = emitter<{ message: unknown; sender: { tabId?: number } }>();
  return {
    broadcasts,
    broadcast(message) {
      broadcasts.push(message);
      // Honour the RuntimeMessagingPort contract: a broadcast reaches this
      // port's own subscribers too. Keeping this in step with the chrome port
      // is what stops a fake from certifying a path production can't run.
      inbound.emit({ message, sender: {} });
    },
    async request(message) {
      return responder ? responder(message) : undefined;
    },
    onMessage(listener) {
      return inbound.add(({ message, sender }) => listener(message, sender));
    },
    deliver(message, sender = {}) {
      inbound.emit({ message, sender });
    },
  };
}

export interface FakeNavigationEventsPort extends NavigationEventsPort {
  emitCommitted(details: NavigationEventDetails): void;
  emitCompleted(details: NavigationEventDetails): void;
  emitHistoryStateUpdated(details: NavigationEventDetails): void;
  emitErrorOccurred(details: NavigationErrorDetails): void;
}

export function createFakeNavigationEventsPort(): FakeNavigationEventsPort {
  const committed = emitter<NavigationEventDetails>();
  const completed = emitter<NavigationEventDetails>();
  const history = emitter<NavigationEventDetails>();
  const error = emitter<NavigationErrorDetails>();
  return {
    onCommitted: (l) => committed.add(l),
    onCompleted: (l) => completed.add(l),
    onHistoryStateUpdated: (l) => history.add(l),
    onErrorOccurred: (l) => error.add(l),
    emitCommitted: (d) => committed.emit(d),
    emitCompleted: (d) => completed.emit(d),
    emitHistoryStateUpdated: (d) => history.emit(d),
    emitErrorOccurred: (d) => error.emit(d),
  };
}

export interface FakeSchedulerPort extends SchedulerPort {
  /** Alarm names currently active. */
  readonly alarms: Map<string, { periodInMinutes?: number }>;
  /** Fire an alarm to its subscribers. */
  fire(name: string): void;
}

export function createFakeSchedulerPort(): FakeSchedulerPort {
  const alarms = new Map<string, { periodInMinutes?: number }>();
  const onAlarm = emitter<{ name: string }>();
  return {
    alarms,
    async createAlarm(name, options) {
      alarms.set(name, { periodInMinutes: options.periodInMinutes });
    },
    async clearAlarm(name) {
      return alarms.delete(name);
    },
    onAlarm: (l) => onAlarm.add(l),
    fire(name) {
      if (alarms.has(name)) onAlarm.emit({ name });
    },
  };
}

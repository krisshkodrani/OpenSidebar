/**
 * Keepalive Module Tests
 * Tests for service worker keepalive alarm functionality.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";

// Mock chrome APIs
globalThis.chrome = {
    alarms: {
        create: vi.fn(async () => { }),
        clear: vi.fn(async () => { }),
        onAlarm: { addListener: vi.fn(() => { }) },
    },
} as any;

// Import after mocking
import {
    startKeepalive,
    stopKeepalive,
    registerAlarmListener,
} from "../../src/background/keepalive";

describe("Keepalive Module", () => {
    beforeEach(() => {
        // Reset mocks
        (chrome.alarms.create as any).mockClear();
        (chrome.alarms.clear as any).mockClear();
    });

    describe("startKeepalive", () => {
        test("creates alarm with correct name and period", async () => {
            await startKeepalive();

            expect(chrome.alarms.create).toHaveBeenCalledWith(
                "opensidebar:keepalive",
                expect.objectContaining({ periodInMinutes: expect.any(Number) })
            );
        });
    });

    describe("stopKeepalive", () => {
        test("clears alarm by name", async () => {
            // First start to set isActive
            await startKeepalive();
            await stopKeepalive();

            expect(chrome.alarms.clear).toHaveBeenCalledWith("opensidebar:keepalive");
        });

        test("clears alarm even when called without prior startKeepalive (SW restart scenario)", async () => {
            // Simulate SW restart: isActive is false, but alarm exists in Chrome registry.
            // stopKeepalive should still attempt to clear the alarm.
            await stopKeepalive();

            expect(chrome.alarms.clear).toHaveBeenCalledWith("opensidebar:keepalive");
        });
    });

    describe("registerAlarmListener", () => {
        test("registers onAlarm listener", () => {
            registerAlarmListener();

            expect(chrome.alarms.onAlarm.addListener).toHaveBeenCalled();
        });
    });
});

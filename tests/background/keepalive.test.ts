/**
 * Keepalive Module Tests
 * Tests for service worker keepalive alarm functionality.
 */

import { describe, test, expect, beforeEach, mock } from "bun:test";

// Mock chrome APIs
globalThis.chrome = {
    alarms: {
        create: mock(async () => { }),
        clear: mock(async () => { }),
        onAlarm: { addListener: mock(() => { }) },
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
                "qsidebar:keepalive",
                expect.objectContaining({ periodInMinutes: expect.any(Number) })
            );
        });
    });

    describe("stopKeepalive", () => {
        test("clears alarm by name", async () => {
            // First start to set isActive
            await startKeepalive();
            await stopKeepalive();

            expect(chrome.alarms.clear).toHaveBeenCalledWith("qsidebar:keepalive");
        });
    });

    describe("registerAlarmListener", () => {
        test("registers onAlarm listener", () => {
            registerAlarmListener();

            expect(chrome.alarms.onAlarm.addListener).toHaveBeenCalled();
        });
    });
});

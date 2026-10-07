/**
 * Keepalive Module Tests
 * Tests for service worker keepalive alarm functionality.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

// Mock chrome APIs
globalThis.chrome = {
    runtime: {
        getPlatformInfo: vi.fn(async () => ({})),
        onConnect: { addListener: vi.fn() },
    },
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
        vi.useFakeTimers();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        await stopKeepalive();
        vi.useRealTimers();
    });

    test("keeps pending work alive without a panel and stops when work ends", async () => {
        await startKeepalive();
        await startKeepalive();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(chrome.runtime.getPlatformInfo).toHaveBeenCalledTimes(3);
        await stopKeepalive();
        await vi.advanceTimersByTimeAsync(40_000);
        expect(chrome.runtime.getPlatformInfo).toHaveBeenCalledTimes(3);
    });

    test("heartbeat survives alarm creation failure", async () => {
        vi.mocked(chrome.alarms.create).mockRejectedValueOnce(new Error("alarm unavailable"));
        await startKeepalive();
        await vi.advanceTimersByTimeAsync(20_000);
        expect(chrome.runtime.getPlatformInfo).toHaveBeenCalledTimes(1);
    });

    test("registers a receiver for the sidepanel connection", () => {
        registerAlarmListener();
        const connect = vi.mocked(chrome.runtime.onConnect.addListener).mock.calls[0][0];
        const addListener = vi.fn();
        connect({ name: "sidepanel-keepalive", onDisconnect: { addListener } } as any);
        expect(addListener).toHaveBeenCalledTimes(1);
        connect({ name: "unrelated", onDisconnect: { addListener } } as any);
        expect(addListener).toHaveBeenCalledTimes(1);
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

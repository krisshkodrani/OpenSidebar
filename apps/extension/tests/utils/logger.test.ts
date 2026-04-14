import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { logger } from "../../src/utils/logger";

describe("Logger", () => {
    let consoleLogSpy: any;
    let consoleWarnSpy: any;
    let consoleErrorSpy: any;
    let consoleGroupCollapsedSpy: any;
    let consoleGroupEndSpy: any;

    beforeEach(() => {
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => { });
        consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => { });
        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => { });
        consoleGroupCollapsedSpy = vi.spyOn(console, "groupCollapsed").mockImplementation(() => { });
        consoleGroupEndSpy = vi.spyOn(console, "groupEnd").mockImplementation(() => { });
        // Ensure DEBUG is visible in tests
        logger.setLevel("DEBUG");
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
        consoleWarnSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        consoleGroupCollapsedSpy.mockRestore();
        consoleGroupEndSpy.mockRestore();
    });

    test("logs info message without data using console.log", () => {
        logger.info("system", "Test message");
        expect(consoleLogSpy).toHaveBeenCalled();
        const callArgs = consoleLogSpy.mock.calls[0];
        const fullMsg = callArgs.join(" ");
        expect(fullMsg).toContain("[system] Test message");
    });

    test("logs debug message with data using groupCollapsed", () => {
        const data = { foo: "bar" };
        logger.debug("agent", "Thinking", data);

        expect(consoleGroupCollapsedSpy).toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledWith("Details:", expect.objectContaining({
            level: "DEBUG",
            category: "agent",
            message: "Thinking",
            data: data
        }));
        expect(consoleGroupEndSpy).toHaveBeenCalled();
    });

    test("WARN uses console.warn", () => {
        logger.warn("ui", "Something is off");
        expect(consoleWarnSpy).toHaveBeenCalled();
        const callArgs = consoleWarnSpy.mock.calls[0];
        const fullMsg = callArgs.join(" ");
        expect(fullMsg).toContain("[ui] Something is off");
    });

    test("ERROR uses console.error", () => {
        logger.error("system", "Boom");
        expect(consoleErrorSpy).toHaveBeenCalled();
        const callArgs = consoleErrorSpy.mock.calls[0];
        const fullMsg = callArgs.join(" ");
        expect(fullMsg).toContain("[system] Boom");
    });

    test("setLevel filters out lower levels", () => {
        logger.setLevel("WARN");
        logger.debug("agent", "should not appear");
        logger.info("agent", "should not appear either");
        logger.warn("agent", "this should appear");

        expect(consoleLogSpy).not.toHaveBeenCalled();
        expect(consoleWarnSpy).toHaveBeenCalled();
    });

    test("withRequestId creates scoped logger that attaches requestId", () => {
        const scoped = logger.withRequestId("req-123");
        scoped.info("agent", "scoped message", { detail: "test" });

        expect(consoleGroupCollapsedSpy).toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledWith("Details:", expect.objectContaining({
            requestId: "req-123",
            message: "scoped message",
        }));
    });

    test("detects source without crashing", () => {
        logger.warn("ui", "Warning");
        // Should not throw
        expect(consoleWarnSpy).toHaveBeenCalled();
    });
});

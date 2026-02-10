import { describe, test, expect } from "bun:test";
import { parseSSEStream } from "../../src/background/streaming";

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
        start(controller) {
            for (const chunk of chunks) {
                controller.enqueue(encoder.encode(chunk));
            }
            controller.close();
        },
    });
}

describe("parseSSEStream", () => {
    test("accumulates text-only response", async () => {
        const stream = makeStream([
            'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
            "data: [DONE]\n\n",
        ]);

        const deltas: string[] = [];
        const result = await parseSSEStream(stream, (d) => deltas.push(d));

        expect(result.content).toBe("Hello world");
        expect(result.tool_calls).toBeUndefined();
        expect(deltas).toEqual(["Hello", " world"]);
    });

    test("accumulates tool calls across chunks", async () => {
        const stream = makeStream([
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"click_element","arguments":""}}]}}]}\n\n',
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"id\\""}}]}}]}\n\n',
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":": 5}"}}]}}]}\n\n',
            "data: [DONE]\n\n",
        ]);

        const deltas: string[] = [];
        const result = await parseSSEStream(stream, (d) => deltas.push(d));

        expect(result.content).toBeNull();
        expect(deltas).toEqual([]);
        expect(result.tool_calls).toHaveLength(1);
        expect(result.tool_calls![0].id).toBe("call_1");
        expect(result.tool_calls![0].function.name).toBe("click_element");
        expect(result.tool_calls![0].function.arguments).toBe('{"id": 5}');
    });

    test("handles lines split across chunks", async () => {
        // The SSE data line is split between two chunks
        const stream = makeStream([
            'data: {"choices":[{"delt',
            'a":{"content":"split"}}]}\n\n',
        ]);

        const deltas: string[] = [];
        const result = await parseSSEStream(stream, (d) => deltas.push(d));

        expect(result.content).toBe("split");
        expect(deltas).toEqual(["split"]);
    });

    test("handles mixed content and tool calls", async () => {
        const stream = makeStream([
            'data: {"choices":[{"delta":{"content":"Thinking..."}}]}\n\n',
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_2","function":{"name":"read_page","arguments":"{}"}}]}}]}\n\n',
            "data: [DONE]\n\n",
        ]);

        const deltas: string[] = [];
        const result = await parseSSEStream(stream, (d) => deltas.push(d));

        expect(result.content).toBe("Thinking...");
        expect(deltas).toEqual(["Thinking..."]);
        expect(result.tool_calls).toHaveLength(1);
        expect(result.tool_calls![0].function.name).toBe("read_page");
    });

    test("returns null content for empty stream", async () => {
        const stream = makeStream(["data: [DONE]\n\n"]);

        const deltas: string[] = [];
        const result = await parseSSEStream(stream, (d) => deltas.push(d));

        expect(result.content).toBeNull();
        expect(result.tool_calls).toBeUndefined();
        expect(deltas).toEqual([]);
    });

    test("skips malformed JSON gracefully", async () => {
        const stream = makeStream([
            "data: {not valid json}\n\n",
            'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
            "data: [DONE]\n\n",
        ]);

        const deltas: string[] = [];
        const result = await parseSSEStream(stream, (d) => deltas.push(d));

        expect(result.content).toBe("ok");
        expect(deltas).toEqual(["ok"]);
    });

    test("[DONE] sentinel is properly ignored", async () => {
        const stream = makeStream([
            'data: {"choices":[{"delta":{"content":"a"}}]}\n\n',
            "data: [DONE]\n\n",
        ]);

        const deltas: string[] = [];
        const result = await parseSSEStream(stream, (d) => deltas.push(d));

        expect(result.content).toBe("a");
        expect(deltas).toEqual(["a"]);
    });

    test("handles multiple tool calls with different indices", async () => {
        const stream = makeStream([
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"click_element","arguments":"{\\"id\\": 1}"}}]}}]}\n\n',
            'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_b","function":{"name":"scroll_page","arguments":"{\\"direction\\": \\"down\\"}"}}]}}]}\n\n',
            "data: [DONE]\n\n",
        ]);

        const deltas: string[] = [];
        const result = await parseSSEStream(stream, (d) => deltas.push(d));

        expect(result.tool_calls).toHaveLength(2);
        expect(result.tool_calls![0].id).toBe("call_a");
        expect(result.tool_calls![0].function.name).toBe("click_element");
        expect(result.tool_calls![1].id).toBe("call_b");
        expect(result.tool_calls![1].function.name).toBe("scroll_page");
    });
});

import { describe, expect, test } from "vitest";
import {
  buildFireworksReport,
  buildOpenRouterReport,
  parseModelCheckArgs,
  probeModel,
} from "../../../../scripts/model-compatibility-check";

describe("model compatibility checker", () => {
  test("requires OpenRouter executor candidates to support images and tool choice", () => {
    const report = buildOpenRouterReport(
      [
        {
          id: "minimax/minimax-m3",
          name: "MiniMax M3",
          architecture: {
            input_modalities: ["text", "image"],
            output_modalities: ["text"],
          },
          supported_parameters: ["tools", "tool_choice", "structured_outputs"],
          expiration_date: null,
        },
        {
          id: "candidate/without-tool-choice",
          architecture: {
            input_modalities: ["text", "image"],
            output_modalities: ["text"],
          },
          supported_parameters: ["tools"],
        },
      ],
      new Date("2026-07-27T00:00:00Z"),
    );

    expect(report.executorCandidateCount).toBe(1);
    expect(
      report.allowlist.find((model) => model.id === "minimax/minimax-m3"),
    ).toMatchObject({
      catalogListed: true,
      candidate: true,
      supportsStructuredOutputs: true,
    });
    expect(report.additionalCandidates).toEqual([]);
    expect(report.allowlist.some((model) => !model.catalogListed)).toBe(true);
  });

  test("keeps Fireworks inference-list presence diagnostic rather than treating it as capability truth", () => {
    const report = buildFireworksReport(
      [
        {
          name: "accounts/fireworks/models/kimi-k2p6",
          displayName: "Kimi K2.6",
          state: "READY",
          supportsImageInput: true,
          supportsTools: true,
          supportsServerless: true,
        },
        {
          name: "accounts/fireworks/models/text-only",
          state: "READY",
          supportsImageInput: false,
          supportsTools: true,
          supportsServerless: true,
        },
      ],
      ["accounts/fireworks/models/kimi-k2p6"],
      new Date("2026-07-27T00:00:00Z"),
    );

    expect(report.executorCandidateCount).toBe(1);
    expect(
      report.allowlist.find(
        (model) => model.id === "accounts/fireworks/models/kimi-k2p6",
      ),
    ).toMatchObject({
      candidate: true,
      inferenceListed: true,
    });
    expect(
      report.allowlist.find(
        (model) => model.id === "accounts/fireworks/models/kimi-k2p7-code",
      ),
    ).toMatchObject({
      catalogListed: false,
      candidate: false,
    });
  });

  test("parses safe provider-scoped probe arguments", () => {
    expect(
      parseModelCheckArgs([
        "--provider=openrouter",
        "--probe",
        "--model=minimax/minimax-m3",
      ]),
    ).toEqual({
      providers: ["openrouter"],
      probe: true,
      model: "minimax/minimax-m3",
      outputPath: undefined,
    });
    expect(() => parseModelCheckArgs(["--model=minimax/minimax-m3"])).toThrow(
      "--model requires",
    );
  });

  test("gives reasoning models enough completion budget to reach a forced tool call", async () => {
    const fetchImpl = async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        max_tokens?: number;
        tool_choice?: { function?: { name?: string } };
      };
      expect(body.max_tokens).toBe(512);
      expect(body.tool_choice?.function?.name).toBe("report_compatibility");
      return new Response(
        JSON.stringify({
          model: "accounts/fireworks/models/kimi-k2p7-code",
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                reasoning_content: "Inspected the image.",
                tool_calls: [
                  {
                    type: "function",
                    function: {
                      name: "report_compatibility",
                      arguments: '{"ok":true}',
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    };

    await expect(
      probeModel(
        "fireworks",
        "accounts/fireworks/models/kimi-k2p7-code",
        "test-key",
        fetchImpl,
      ),
    ).resolves.toMatchObject({
      ok: true,
      finishReason: "tool_calls",
      responseSummary: expect.stringContaining("tool_calls=1"),
    });
  });
});

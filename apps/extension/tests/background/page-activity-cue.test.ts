import { describe, expect, test } from "vitest";
import { shouldShowPageActivityCue } from "../../src/background/page-activity-cue";

describe("shouldShowPageActivityCue", () => {
  test("does not show the page cue for conversational identity prompts", () => {
    expect(shouldShowPageActivityCue("Do you know who I am?")).toBe(false);
    expect(shouldShowPageActivityCue("What do you know about me?")).toBe(false);
  });

  test("shows the page cue for browser interaction tasks", () => {
    expect(shouldShowPageActivityCue("Fill out this job application")).toBe(
      true,
    );
    expect(shouldShowPageActivityCue("Click the submit button")).toBe(true);
    expect(shouldShowPageActivityCue("Summarize this page")).toBe(true);
  });
});

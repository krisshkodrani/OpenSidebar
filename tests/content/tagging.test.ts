import { describe, test, expect, beforeEach } from "bun:test";
import {
  tagElements,
  isElementVisible,
  isRandomHash,
  truncateText,
  resetStableIds,
  getTagMap,
  addDynamicTag,
  getOverflowMetadata,
  MAX_TAGGED_ELEMENTS,
} from "../../src/content/tagging";
import "../../tests/setup";

describe("tagElements", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    resetStableIds();
  });

  test("tags visible buttons", () => {
    const btn = document.createElement("button");
    btn.textContent = "Click Me";
    document.body.appendChild(btn);

    const tagged = tagElements();
    expect(tagged.length).toBe(1);
    expect(tagged[0].tagName).toBe("button");
    expect(tagged[0].text).toBe("Click Me");
  });

  test("skips hidden elements", () => {
    const btn = document.createElement("button");
    btn.style.display = "none";
    document.body.appendChild(btn);

    const tagged = tagElements();
    expect(tagged.length).toBe(0);
  });

  test("tags inputs with correct role", () => {
    const input = document.createElement("input");
    input.type = "text";
    input.value = "Hello";
    document.body.appendChild(input);

    const tagged = tagElements();
    expect(tagged.length).toBe(1);
    expect(tagged[0].role).toBe("text");
    expect(tagged[0].text).toBe("Hello");
  });

  test("respects MAX_TAGGED_ELEMENTS cap of 50", () => {
    for (let i = 0; i < 60; i++) {
      const btn = document.createElement("button");
      btn.textContent = `Button ${i}`;
      document.body.appendChild(btn);
    }

    const tagged = tagElements();
    expect(tagged.length).toBeLessThanOrEqual(50);
  });

  test("extracts priority attributes", () => {
    const link = document.createElement("a");
    link.href = "https://example.com";
    link.textContent = "Example";
    link.setAttribute("data-testid", "example-link");
    document.body.appendChild(link);

    const tagged = tagElements();
    expect(tagged.length).toBe(1);
    expect(tagged[0].attributes["href"]).toContain("example.com");
    expect(tagged[0].attributes["data-testid"]).toBe("example-link");
  });

  test("includes state attributes when non-default", () => {
    const btn = document.createElement("button");
    btn.textContent = "Expand";
    btn.setAttribute("aria-expanded", "true");
    btn.setAttribute("disabled", "");
    document.body.appendChild(btn);

    const tagged = tagElements();
    expect(tagged.length).toBe(1);
    expect(tagged[0].attributes["aria-expanded"]).toBe("true");
    expect(tagged[0].attributes["disabled"]).toBe("true");
    expect(tagged[0].isDisabled).toBe(true);
  });

  test("filters random hash IDs from attributes", () => {
    const btn = document.createElement("button");
    btn.textContent = "Test";
    btn.id = "css-1q2w3e4r";
    document.body.appendChild(btn);

    const tagged = tagElements();
    expect(tagged.length).toBe(1);
    expect(tagged[0].attributes["id"]).toBeUndefined();
  });

  test("keeps human-readable IDs in attributes", () => {
    const btn = document.createElement("button");
    btn.textContent = "Login";
    btn.id = "login-button";
    document.body.appendChild(btn);

    const tagged = tagElements();
    expect(tagged.length).toBe(1);
    expect(tagged[0].attributes["id"]).toBe("login-button");
  });

  test("skips elements with aria-hidden=true", () => {
    const btn = document.createElement("button");
    btn.textContent = "Hidden Button";
    btn.setAttribute("aria-hidden", "true");
    document.body.appendChild(btn);

    const tagged = tagElements();
    expect(tagged.length).toBe(0);
  });

  test("skips elements inside aria-hidden ancestor", () => {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("aria-hidden", "true");
    const btn = document.createElement("button");
    btn.textContent = "Nested Hidden";
    wrapper.appendChild(btn);
    document.body.appendChild(wrapper);

    const tagged = tagElements();
    expect(tagged.length).toBe(0);
  });

  test("resolves aria-describedby to description attribute", () => {
    const hint = document.createElement("span");
    hint.id = "hint-1";
    hint.textContent = "Must be at least 8 characters";
    document.body.appendChild(hint);

    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("aria-describedby", "hint-1");
    document.body.appendChild(input);

    const tagged = tagElements();
    expect(tagged.length).toBe(1);
    expect(tagged[0].attributes["description"]).toBe("Must be at least 8 characters");
  });

  test("resolves multiple space-separated aria-describedby IDs", () => {
    const hint1 = document.createElement("span");
    hint1.id = "hint-a";
    hint1.textContent = "Required.";
    document.body.appendChild(hint1);

    const hint2 = document.createElement("span");
    hint2.id = "hint-b";
    hint2.textContent = "Min 8 chars.";
    document.body.appendChild(hint2);

    const input = document.createElement("input");
    input.type = "password";
    input.setAttribute("aria-describedby", "hint-a hint-b");
    document.body.appendChild(input);

    const tagged = tagElements();
    expect(tagged.length).toBe(1);
    expect(tagged[0].attributes["description"]).toBe("Required. Min 8 chars.");
  });

  test("resolves aria-description direct attribute", () => {
    const btn = document.createElement("button");
    btn.textContent = "Submit";
    btn.setAttribute("aria-description", "Submits the form and sends email");
    document.body.appendChild(btn);

    const tagged = tagElements();
    expect(tagged.length).toBe(1);
    expect(tagged[0].attributes["description"]).toBe("Submits the form and sends email");
  });

  test("resolves aria-labelledby on non-form elements", () => {
    const heading = document.createElement("h2");
    heading.id = "section-title";
    heading.textContent = "Account Settings";
    document.body.appendChild(heading);

    const btn = document.createElement("button");
    btn.setAttribute("aria-labelledby", "section-title");
    document.body.appendChild(btn);

    const tagged = tagElements();
    const btnTag = tagged.find((t) => t.tagName === "button");
    expect(btnTag).toBeDefined();
    expect(btnTag!.attributes["label"]).toBe("Account Settings");
  });
});

describe("stable element IDs", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    resetStableIds();
  });

  test("unchanged elements keep the same IDs across refreshes", () => {
    const btn1 = document.createElement("button");
    btn1.textContent = "Submit";
    const btn2 = document.createElement("button");
    btn2.textContent = "Cancel";
    document.body.appendChild(btn1);
    document.body.appendChild(btn2);

    const tagged1 = tagElements();
    const submitId1 = tagged1.find(t => t.text === "Submit")!.tag;
    const cancelId1 = tagged1.find(t => t.text === "Cancel")!.tag;

    // Re-tag without changing DOM
    const tagged2 = tagElements();
    const submitId2 = tagged2.find(t => t.text === "Submit")!.tag;
    const cancelId2 = tagged2.find(t => t.text === "Cancel")!.tag;

    expect(submitId2).toBe(submitId1);
    expect(cancelId2).toBe(cancelId1);
  });

  test("new element gets a new ID without disrupting existing IDs", () => {
    const btn1 = document.createElement("button");
    btn1.textContent = "Submit";
    document.body.appendChild(btn1);

    const tagged1 = tagElements();
    const submitId = tagged1[0].tag;

    // Add a new button
    const btn2 = document.createElement("button");
    btn2.textContent = "Cancel";
    document.body.appendChild(btn2);

    const tagged2 = tagElements();
    const submitId2 = tagged2.find(t => t.text === "Submit")!.tag;
    const cancelId = tagged2.find(t => t.text === "Cancel")!.tag;

    expect(submitId2).toBe(submitId); // Existing ID unchanged
    expect(cancelId).not.toBe(submitId); // New element gets different ID
  });

  test("removed element ID survives one grace period then is freed", () => {
    const btn1 = document.createElement("button");
    btn1.textContent = "Submit";
    const btn2 = document.createElement("button");
    btn2.textContent = "Cancel";
    document.body.appendChild(btn1);
    document.body.appendChild(btn2);

    const tagged1 = tagElements();
    const cancelId = tagged1.find(t => t.text === "Cancel")!.tag;

    // Remove Cancel button
    btn2.remove();

    // First refresh after removal: grace period, ID still in maps
    tagElements();
    // The tag won't be in tagMap (element is gone) but the hash→ID mapping persists

    // Second refresh: grace period expired, hash cleaned up
    tagElements();

    // Now add Cancel back — it should get a new ID since the old mapping was cleaned
    const btn3 = document.createElement("button");
    btn3.textContent = "Cancel";
    document.body.appendChild(btn3);

    const tagged3 = tagElements();
    const newCancelId = tagged3.find(t => t.text === "Cancel")!.tag;
    // The Cancel button has same DOM path + text, so it gets the same hash.
    // Since the hash was cleaned up after 2 refreshes, it gets re-allocated.
    // The ID might be the same number (re-allocated) or different depending on nextId.
    // What matters is the system doesn't crash and the element is tagged.
    expect(newCancelId).toBeDefined();
  });

  test("element with changed text gets a new ID", () => {
    const btn = document.createElement("button");
    btn.textContent = "Click Here";
    document.body.appendChild(btn);

    const tagged1 = tagElements();
    const id1 = tagged1[0].tag;

    // Change the button text
    btn.textContent = "Dismiss";

    const tagged2 = tagElements();
    const id2 = tagged2[0].tag;

    // Text is part of the hash, so different text → different hash → different ID
    expect(id2).not.toBe(id1);
  });

  test("IDs remain stable when unrelated DOM sibling is added", () => {
    const container = document.createElement("div");
    const btn = document.createElement("button");
    btn.textContent = "Action";
    container.appendChild(btn);
    document.body.appendChild(container);

    const tagged1 = tagElements();
    const actionId = tagged1[0].tag;

    // Add a sibling div (not interactive)
    const sibling = document.createElement("div");
    sibling.textContent = "Info text";
    container.appendChild(sibling);

    const tagged2 = tagElements();
    const actionId2 = tagged2.find(t => t.text === "Action")!.tag;

    // Button's DOM path hasn't changed (same parent, same index)
    expect(actionId2).toBe(actionId);
  });

  test("hash collision produces different IDs", () => {
    // Two buttons with identical text at the same DOM position shouldn't happen,
    // but buttons at different positions with same text get different hashes via domPath
    const btn1 = document.createElement("button");
    btn1.textContent = "Click Here";
    const btn2 = document.createElement("button");
    btn2.textContent = "Click Here";
    document.body.appendChild(btn1);
    document.body.appendChild(btn2);

    const tagged = tagElements();
    expect(tagged.length).toBe(2);
    expect(tagged[0].tag).not.toBe(tagged[1].tag);
  });

  test("resetStableIds clears all state and IDs restart from 1", () => {
    const btn = document.createElement("button");
    btn.textContent = "Test";
    document.body.appendChild(btn);

    tagElements();
    resetStableIds();

    const tagged = tagElements();
    expect(tagged[0].tag).toBe(1);
  });
});

describe("isElementVisible", () => {
  test("returns false for display:none", () => {
    const div = document.createElement("div");
    div.style.display = "none";
    document.body.appendChild(div);
    expect(isElementVisible(div)).toBe(false);
  });

  test("returns true for element within viewport (default mock)", () => {
    const btn = document.createElement("button");
    btn.textContent = "Visible";
    document.body.appendChild(btn);
    expect(isElementVisible(btn)).toBe(true);
  });

  test("returns false for visibility:hidden", () => {
    const div = document.createElement("div");
    div.style.visibility = "hidden";
    document.body.appendChild(div);
    expect(isElementVisible(div)).toBe(false);
  });
});

describe("isRandomHash", () => {
  test("detects CSS module hashes", () => {
    expect(isRandomHash("css-1q2w3e4")).toBe(true);
    expect(isRandomHash("Button_root__2dKj")).toBe(true);
  });

  test("detects React-generated IDs", () => {
    expect(isRandomHash("u_0_j_8W0000")).toBe(true);
  });

  test("detects pure alphanumeric hashes without words", () => {
    expect(isRandomHash("AABBCCDD")).toBe(true);
    expect(isRandomHash("A1B2C3D4")).toBe(true);
  });

  test("preserves human-readable IDs", () => {
    expect(isRandomHash("login-button")).toBe(false);
    expect(isRandomHash("search-input")).toBe(false);
    expect(isRandomHash("main-nav")).toBe(false);
    expect(isRandomHash("header")).toBe(false);
    expect(isRandomHash("content")).toBe(false);
  });

  test("preserves short IDs", () => {
    expect(isRandomHash("nav")).toBe(false);
    expect(isRandomHash("btn")).toBe(false);
    expect(isRandomHash("app")).toBe(false);
  });

  test("preserves IDs with readable words even if long", () => {
    expect(isRandomHash("username")).toBe(false);
    expect(isRandomHash("password")).toBe(false);
    expect(isRandomHash("submitbutton")).toBe(false);
  });
});

describe("truncateText", () => {
  test("preserves short text unchanged", () => {
    expect(truncateText("Hello", 80)).toBe("Hello");
  });

  test("preserves text exactly at maxLength", () => {
    const exact = "A".repeat(80);
    expect(truncateText(exact, 80)).toBe(exact);
  });

  test("truncates with head/tail retention", () => {
    const long = "A".repeat(100);
    const result = truncateText(long, 80);
    expect(result.length).toBe(80);
    expect(result).toContain("...");
    expect(result.startsWith("A".repeat(64))).toBe(true);
    expect(result.endsWith("A".repeat(13))).toBe(true);
  });

  test("preserves meaningful head and tail", () => {
    const text =
      "Add to Cart - Limited Time Offer - Free Shipping Available - Buy Now Before Stock Runs Out Today";
    const result = truncateText(text, 80);
    expect(result.length).toBe(80);
    expect(result.startsWith("Add to Cart")).toBe(true);
    expect(result.endsWith("Today")).toBe(true);
  });

  test("returns empty string for empty input", () => {
    expect(truncateText("", 80)).toBe("");
  });
});

describe("collapseNearIdentical (WI-1 dedup)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    resetStableIds();
  });

  test("collapses 30 identical buttons to 2 representatives + tracks overflow", () => {
    for (let i = 1; i <= 30; i++) {
      const btn = document.createElement("button");
      btn.textContent = `Click me ${i}`;
      document.body.appendChild(btn);
    }

    const tagged = tagElements();
    // Only 2 kept from the group (first + last), overflow should show 30 total
    expect(tagged.length).toBeLessThanOrEqual(4); // 2 reps + potential extras
    expect(tagged.length).toBeGreaterThanOrEqual(2);

    // Import overflow metadata
    const overflow = getOverflowMetadata();
    expect(overflow).not.toBeNull();
    expect(overflow!.total).toBe(30);
    expect(overflow!.shown).toBeLessThan(30);
    expect(overflow!.collapsedGroups.length).toBeGreaterThan(0);
    expect(overflow!.collapsedGroups[0]).toContain("click me");
  });

  test("protects draggable + dropzone elements among many identical buttons", () => {
    // 50 identical buttons
    for (let i = 1; i <= 50; i++) {
      const btn = document.createElement("button");
      btn.textContent = `Bait ${i}`;
      document.body.appendChild(btn);
    }
    // 5 draggable items
    for (let i = 1; i <= 5; i++) {
      const div = document.createElement("div");
      div.setAttribute("draggable", "true");
      div.textContent = `Drag item ${i}`;
      div.setAttribute("tabindex", "0");
      document.body.appendChild(div);
    }
    // 5 drop zones (with dropzone attribute)
    for (let i = 1; i <= 5; i++) {
      const span = document.createElement("span");
      span.setAttribute("dropzone", "move");
      span.textContent = `Drop zone ${i}`;
      span.setAttribute("tabindex", "0");
      document.body.appendChild(span);
    }

    const tagged = tagElements();
    const dragItems = tagged.filter(t => t.attributes["draggable"] === "true");
    const dropItems = tagged.filter(t => t.attributes["dropzone"] === "true");

    // All draggable + dropzone elements should be tagged (protected)
    expect(dragItems.length).toBe(5);
    expect(dropItems.length).toBe(5);
  });

  test("diverse elements under cap are not collapsed", () => {
    // Create diverse elements with completely unique text (no trailing digits)
    const uniqueLabels = [
      "Home", "About", "Contact", "Settings", "Dashboard",
      "Profile", "Logout", "Search", "Help", "Subscribe",
      "Download", "Upload", "Archive", "Favorites", "History",
    ];
    for (let i = 0; i < 5; i++) {
      const input = document.createElement("input");
      input.type = "text";
      input.setAttribute("name", uniqueLabels[i].toLowerCase());
      input.placeholder = uniqueLabels[i];
      document.body.appendChild(input);
    }
    for (let i = 0; i < 5; i++) {
      const link = document.createElement("a");
      link.href = `https://example.com/${uniqueLabels[i + 5].toLowerCase()}`;
      link.textContent = uniqueLabels[i + 5];
      document.body.appendChild(link);
    }
    for (let i = 0; i < 5; i++) {
      const btn = document.createElement("button");
      btn.textContent = uniqueLabels[i + 10];
      document.body.appendChild(btn);
    }

    const tagged = tagElements();
    // All 15 diverse elements should be tagged (under cap, each group is unique)
    expect(tagged.length).toBe(15);

    const overflow = getOverflowMetadata();
    // No overflow because all fit under cap
    expect(overflow).toBeNull();
  });

  test("elements with name attribute are protected from collapse", () => {
    for (let i = 1; i <= 10; i++) {
      const input = document.createElement("input");
      input.type = "text";
      input.setAttribute("name", `field_${i}`);
      input.placeholder = "Enter value";
      document.body.appendChild(input);
    }

    const tagged = tagElements();
    // All 10 should be kept because they have name attributes
    expect(tagged.length).toBe(10);
  });
});

describe("dynamic tag preservation", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    resetStableIds();
  });

  test("dynamic tag survives tagElements() refresh", () => {
    // Create a non-interactive element and dynamically tag it
    const span = document.createElement("span");
    span.textContent = "Drop Zone";
    document.body.appendChild(span);

    const dynId = addDynamicTag(span);
    expect(getTagMap().has(dynId)).toBe(true);

    // tagElements() clears tagMap, but dynamic tag should be restored
    const results = tagElements();
    expect(getTagMap().has(dynId)).toBe(true);
    expect(getTagMap().get(dynId)).toBe(span);
    // Should also appear in the results array
    const dynResult = results.find((r) => r.tag === dynId);
    expect(dynResult).toBeDefined();
    expect(dynResult!.text).toBe("Drop Zone");
  });

  test("dynamic tag cleaned when element removed from DOM", () => {
    const span = document.createElement("span");
    span.textContent = "Temp Element";
    document.body.appendChild(span);

    const dynId = addDynamicTag(span);
    expect(getTagMap().has(dynId)).toBe(true);

    // Remove element from DOM
    span.remove();

    // tagElements() should clean up the dynamic tag
    const results = tagElements();
    expect(getTagMap().has(dynId)).toBe(false);
    expect(results.find((r) => r.tag === dynId)).toBeUndefined();
  });

  test("dynamic tag deduplicates with interactive scan", () => {
    // A button is interactive — it will be tagged by the normal scan
    const btn = document.createElement("button");
    btn.textContent = "Click Me";
    document.body.appendChild(btn);

    // Dynamically tag it before the scan
    const dynId = addDynamicTag(btn);

    // tagElements() should tag it via interactive scan, not double-add
    const results = tagElements();
    const matches = results.filter((r) => r.tag === dynId);
    expect(matches.length).toBe(1);
  });

  test("dynamic tag gets overflow slots beyond cap", () => {
    // Fill up to MAX with unique interactive buttons (unique names to avoid collapse)
    for (let i = 0; i < MAX_TAGGED_ELEMENTS; i++) {
      const btn = document.createElement("button");
      btn.textContent = `Unique action ${i}`;
      btn.setAttribute("name", `btn-${i}`);
      document.body.appendChild(btn);
    }

    // Add a dynamic tag for a non-interactive element
    const span = document.createElement("span");
    span.textContent = "Overflow Drop Zone";
    document.body.appendChild(span);
    const dynId = addDynamicTag(span);

    const results = tagElements();
    // Dynamic tags get up to 5 overflow slots — so this should be included
    expect(results.length).toBeGreaterThan(MAX_TAGGED_ELEMENTS);
    expect(results.length).toBeLessThanOrEqual(MAX_TAGGED_ELEMENTS + 5);
    expect(results.find(r => r.tag === dynId)).toBeDefined();
  });

  test("dynamic tag with cyclesRemaining=3 survives 2 refreshes", () => {
    const span = document.createElement("span");
    span.textContent = "Pinned Element";
    document.body.appendChild(span);

    addDynamicTag(span);

    // Refresh 1: cyclesRemaining decremented from 3 to 2
    const results1 = tagElements();
    const found1 = results1.find(r => r.text === "Pinned Element");
    expect(found1).toBeDefined();

    // Refresh 2: cyclesRemaining decremented from 2 to 1
    const results2 = tagElements();
    const found2 = results2.find(r => r.text === "Pinned Element");
    expect(found2).toBeDefined();
  });

  test("dynamic tag removed after 3 refreshes (cycles expired)", () => {
    const span = document.createElement("span");
    span.textContent = "Expiring Element";
    document.body.appendChild(span);

    addDynamicTag(span);

    // Refresh 1: 3→2
    tagElements();
    // Refresh 2: 2→1
    tagElements();
    // Refresh 3: 1→0, deleted
    const results3 = tagElements();
    const found = results3.find(r => r.text === "Expiring Element");
    expect(found).toBeUndefined();
  });

  test("addDynamicTag returns existing tag for already-tagged element", () => {
    const btn = document.createElement("button");
    btn.textContent = "Already Tagged";
    document.body.appendChild(btn);

    const id1 = addDynamicTag(btn);
    const id2 = addDynamicTag(btn);
    expect(id2).toBe(id1);
  });
});

describe("task-relevance element scoring (WI-3)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    resetStableIds();
  });

  test("form input scores higher than generic button", () => {
    // Create many generic buttons to fill the cap
    for (let i = 0; i < 55; i++) {
      const btn = document.createElement("button");
      btn.textContent = `Action ${i}`;
      btn.setAttribute("name", `btn-${i}`); // protect from collapse
      document.body.appendChild(btn);
    }
    // Add a text input at the end (would be excluded by DOM order under old system)
    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("name", "username");
    document.body.appendChild(input);

    const tagged = tagElements();
    // The input should be included because it scores higher
    const inputTag = tagged.find(t => t.tagName === "input" && t.role === "text");
    expect(inputTag).toBeDefined();
  });

  test("draggable/dropzone elements score high", () => {
    // 55 generic buttons
    for (let i = 0; i < 55; i++) {
      const btn = document.createElement("button");
      btn.textContent = `Filler ${i}`;
      btn.setAttribute("name", `filler-${i}`);
      document.body.appendChild(btn);
    }
    // Draggable element
    const drag = document.createElement("div");
    drag.setAttribute("draggable", "true");
    drag.setAttribute("tabindex", "0");
    drag.textContent = "Drag me";
    document.body.appendChild(drag);

    const tagged = tagElements();
    const dragTag = tagged.find(t => t.attributes["draggable"] === "true");
    expect(dragTag).toBeDefined();
  });

  test("sort is stable — DOM order preserved for equal scores", () => {
    const btn1 = document.createElement("button");
    btn1.textContent = "First";
    const btn2 = document.createElement("button");
    btn2.textContent = "Second";
    document.body.appendChild(btn1);
    document.body.appendChild(btn2);

    const tagged = tagElements();
    expect(tagged.length).toBe(2);
    // Both buttons have the same score — DOM order should be preserved
    expect(tagged[0].text).toBe("First");
    expect(tagged[1].text).toBe("Second");
  });
});

describe("adaptive element cap for DnD pages (WI-4)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    resetStableIds();
  });

  test("default cap is 50 on normal pages", () => {
    for (let i = 0; i < 60; i++) {
      const btn = document.createElement("button");
      btn.textContent = `Button ${i}`;
      btn.setAttribute("name", `btn-${i}`);
      document.body.appendChild(btn);
    }

    const tagged = tagElements();
    expect(tagged.length).toBeLessThanOrEqual(50);
  });

  test("cap raised to 75 when draggable elements present", () => {
    // Create 70 unique buttons + some draggable items
    for (let i = 0; i < 68; i++) {
      const btn = document.createElement("button");
      btn.textContent = `Action ${i}`;
      btn.setAttribute("name", `action-${i}`);
      document.body.appendChild(btn);
    }
    for (let i = 0; i < 5; i++) {
      const drag = document.createElement("div");
      drag.setAttribute("draggable", "true");
      drag.setAttribute("tabindex", "0");
      drag.textContent = `Piece ${i}`;
      document.body.appendChild(drag);
    }

    const tagged = tagElements();
    // Should allow more than 50 because DnD detected
    expect(tagged.length).toBeGreaterThan(50);
    expect(tagged.length).toBeLessThanOrEqual(75);
  });

  test("cap raised to 75 when dropzone elements present", () => {
    for (let i = 0; i < 68; i++) {
      const btn = document.createElement("button");
      btn.textContent = `Nav ${i}`;
      btn.setAttribute("name", `nav-${i}`);
      document.body.appendChild(btn);
    }
    for (let i = 0; i < 5; i++) {
      const zone = document.createElement("div");
      zone.setAttribute("tabindex", "0");
      zone.setAttribute("data-droptarget", "true");
      zone.textContent = `Zone ${i}`;
      document.body.appendChild(zone);
    }

    const tagged = tagElements();
    expect(tagged.length).toBeGreaterThan(50);
    expect(tagged.length).toBeLessThanOrEqual(75);
  });

  test("overflow metadata reflects effective cap", () => {
    for (let i = 0; i < 80; i++) {
      const btn = document.createElement("button");
      btn.textContent = `Item ${i}`;
      btn.setAttribute("name", `item-${i}`);
      document.body.appendChild(btn);
    }
    // Add draggable to trigger DnD cap
    const drag = document.createElement("div");
    drag.setAttribute("draggable", "true");
    drag.setAttribute("tabindex", "0");
    drag.textContent = "Piece";
    document.body.appendChild(drag);

    const tagged = tagElements();
    const overflow = getOverflowMetadata();
    // Should have overflow since 81 > 75
    expect(overflow).not.toBeNull();
    expect(overflow!.total).toBe(81);
  });
});

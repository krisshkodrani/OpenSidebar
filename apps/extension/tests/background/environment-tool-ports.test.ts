import { describe, expect, test } from "vitest";
import "../setup";
import {
  createFakeCookiesPort,
  createFakeDownloadsPort,
  createFakeHistoryPort,
  createFakeSearchPort,
  createFakeWindowsPort,
} from "../fakes/environment-tools";

describe("DownloadsPort fake", () => {
  test("tracks downloads and reports availability", async () => {
    const port = createFakeDownloadsPort();
    expect(port.isAvailable()).toBe(true);
    const id = await port.download({ url: "https://x.test/a.pdf", filename: "a.pdf" });
    expect(id).toBe(1);
    expect(port.downloads).toEqual([
      { url: "https://x.test/a.pdf", filename: "a.pdf", id: 1 },
    ]);
    expect(createFakeDownloadsPort(false).isAvailable()).toBe(false);
  });
});

describe("CookiesPort fake", () => {
  test("set upserts; getAll filters by name; remove deletes", async () => {
    const port = createFakeCookiesPort();
    await port.set({ url: "https://x.test", name: "sid", value: "1" });
    await port.set({ url: "https://x.test", name: "sid", value: "2" }); // upsert
    await port.set({ url: "https://x.test", name: "theme", value: "dark" });

    expect(await port.getAll({ name: "sid" })).toEqual([
      { name: "sid", value: "2", domain: undefined, path: undefined },
    ]);
    expect((await port.getAll({})).length).toBe(2);

    await port.remove({ url: "https://x.test", name: "sid" });
    expect(await port.getAll({ name: "sid" })).toEqual([]);
  });
});

describe("HistoryPort fake", () => {
  test("search matches by title, honoring maxResults", async () => {
    const port = createFakeHistoryPort([
      { title: "OpenSidebar docs", url: "https://a.test" },
      { title: "Open source", url: "https://b.test" },
      { title: "Unrelated", url: "https://c.test" },
    ]);
    const results = await port.search({ text: "open", maxResults: 1 });
    expect(results).toEqual([{ title: "OpenSidebar docs", url: "https://a.test" }]);
  });
});

describe("SearchPort fake", () => {
  test("records queries", async () => {
    const port = createFakeSearchPort();
    await port.query({ text: "weather", disposition: "CURRENT_TAB" });
    expect(port.queries).toEqual([
      { text: "weather", disposition: "CURRENT_TAB" },
    ]);
  });
});

describe("WindowsPort fake", () => {
  test("create returns an incrementing window id", async () => {
    const port = createFakeWindowsPort();
    expect(await port.create({ url: "https://x.test" })).toEqual({ id: 100 });
    expect(await port.create({})).toEqual({ id: 101 });
    expect(port.created.length).toBe(2);
  });
});

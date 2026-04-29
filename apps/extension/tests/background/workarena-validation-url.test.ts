import { describe, expect, test } from "vitest";
import { selectValidationUrl } from "../../../../scripts/workarena-validation-url";

describe("WorkArena validation URL selection", () => {
  test("canonicalizes direct ServiceNow list URLs back into the unified navigation wrapper", () => {
    const selection = selectValidationUrl({
      startUrl:
        "https://workarena.example.com/now/nav/ui/classic/params/target/incident_list.do",
      browserActiveUrl:
        "https://workarena.example.com/now/nav/ui/classic/params/target/incident_list.do",
      importedPageUrl:
        "https://workarena.example.com/now/nav/ui/classic/params/target/incident_list.do",
      finalOpenSidebarUrl:
        "https://workarena.example.com/incident_list.do?sysparm_query=ORDERBYDESCnumber^ORDERBYDESCcalendar_duration",
      frameUrls: [],
    });

    expect(selection.source).toBe("finalOpenSidebarUrl:canonical");
    expect(selection.url).toBe(
      "https://workarena.example.com/now/nav/ui/classic/params/target/incident_list.do%3Fsysparm_query%3DORDERBYDESCnumber%5EORDERBYDESCcalendar_duration",
    );
    expect(selection.candidates[0]).toMatchObject({
      source: "finalOpenSidebarUrl",
      selected: false,
      reason: "path_mismatch",
    });
  });

  test("rejects undefined report URLs and uses a valid report frame URL", () => {
    const startUrl =
      "https://workarena.example.com/now/nav/ui/classic/params/target/sys_report_template.do%3Fsysparm_field%3Dcategory%26sysparm_type%3Dbar%26sysparm_table%3Dincident";
    const selection = selectValidationUrl({
      startUrl,
      browserActiveUrl: startUrl,
      importedPageUrl: startUrl,
      finalOpenSidebarUrl:
        "https://workarena.example.com/now/nav/ui/classic/params/target/sys_report_template.do%3Fjvar_report_id%3Dundefined",
      frameUrls: [
        "about:blank",
        "https://workarena.example.com/sys_report_template.do?sysparm_field=category&sysparm_type=bar&sysparm_table=incident",
      ],
    });

    expect(selection.source).toBe("frameUrl:2:canonical");
    expect(selection.url).toBe(startUrl);
    expect(selection.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "finalOpenSidebarUrl",
          selected: false,
          reason: "undefined_report_id",
        }),
        expect.objectContaining({
          source: "frameUrl:1",
          selected: false,
          reason: "origin_mismatch",
        }),
        expect.objectContaining({
          source: "frameUrl:2",
          selected: false,
          reason: "path_mismatch",
        }),
      ]),
    );
  });
});

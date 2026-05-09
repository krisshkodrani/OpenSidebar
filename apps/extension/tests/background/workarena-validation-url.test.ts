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
      source: "finalOpenSidebarUrl:canonical",
      selected: true,
      reason: null,
    });
  });

  test("uses final navigation URLs when success intentionally leaves the start page", () => {
    const startUrl = "https://workarena.example.com/now/nav/ui/home";
    const finalUrl =
      "https://workarena.example.com/now/nav/ui/classic/params/target/cmdb_ci_db_hbase_instance_list.do%3Fsysparm_userpref_module%3D45a4f1329f1221001e021a1cf67fcfe5";

    const selection = selectValidationUrl({
      startUrl,
      browserActiveUrl: startUrl,
      importedPageUrl: startUrl,
      finalOpenSidebarUrl: finalUrl,
      frameUrls: [],
    });

    expect(selection.source).toBe("finalOpenSidebarUrl");
    expect(selection.url).toBe(finalUrl);
    expect(selection.candidates[0]).toMatchObject({
      source: "finalOpenSidebarUrl",
      selected: true,
      reason: null,
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
      ]),
    );
  });

  test("prefers the task form URL after a create-record sys_id handoff", () => {
    const startUrl =
      "https://workarena.example.com/now/nav/ui/classic/params/target/alm_hardware.do";
    const submittedSysId = "073ece642bf0c7d09c8bf462fe91bf3d";
    const detailUrl =
      "https://workarena.example.com/now/nav/ui/classic/params/target/alm_hardware.do%3Fsys_id%3D073ece642bf0c7d09c8bf462fe91bf3d";

    const selection = selectValidationUrl({
      startUrl,
      browserActiveUrl: startUrl,
      importedPageUrl: startUrl,
      finalOpenSidebarUrl: detailUrl,
      frameUrls: [
        "https://workarena.example.com/alm_hardware.do?sys_id=073ece642bf0c7d09c8bf462fe91bf3d",
      ],
      submittedRecordNumber: submittedSysId,
    });

    expect(selection.source).toBe("browserActiveUrl");
    expect(selection.url).toBe(startUrl);
    expect(selection.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "finalOpenSidebarUrl",
          selected: false,
          reason: "submitted_record_detail_url",
        }),
        expect.objectContaining({
          source: "frameUrl:1",
          selected: false,
          reason: "submitted_record_detail_url",
        }),
      ]),
    );
  });
});

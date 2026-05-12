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

  test("uses submitted service catalog request URLs after a catalog order handoff", () => {
    const startUrl =
      "https://workarena.example.com/now/nav/ui/classic/params/target/catalog_home.do%3Fsysparm_view%3Dcatalog_default";
    const requestUrl =
      "https://workarena.example.com/sc_request.do?sys_id=5dcf035d93748f502b00ff87dd03d6e5";

    const selection = selectValidationUrl({
      startUrl,
      browserActiveUrl: startUrl,
      importedPageUrl: startUrl,
      finalOpenSidebarUrl: requestUrl,
      frameUrls: [requestUrl],
      submittedRecordNumber: "REQ0023337",
    });

    expect(selection.source).toBe("finalOpenSidebarUrl:canonical");
    expect(selection.url).toBe(
      "https://workarena.example.com/now/nav/ui/classic/params/target/sc_request.do%3Fsys_id%3D5dcf035d93748f502b00ff87dd03d6e5",
    );
    expect(selection.candidates[0]).toMatchObject({
      source: "finalOpenSidebarUrl:canonical",
      selected: true,
      reason: null,
    });
  });

  test("preserves direct service catalog checkout URLs for catalog validators", () => {
    const startUrl =
      "https://workarena.example.com/now/nav/ui/classic/params/target/catalog_home.do%3Fsysparm_view%3Dcatalog_default";
    const checkoutUrl =
      "https://workarena.example.com/now/nav/ui/classic/params/target/com.glideapp.servicecatalog_checkout_view_v2.do%3Fv%3D1%26sysparm_sys_id%3D135ecc6193344b50d6ddf23cdd03d633%26sysparm_new_request%3Dtrue";

    const selection = selectValidationUrl({
      startUrl,
      browserActiveUrl: startUrl,
      importedPageUrl: startUrl,
      finalOpenSidebarUrl: checkoutUrl,
      frameUrls: [],
      submittedRecordNumber: "REQ0024268",
    });

    expect(selection.source).toBe("finalOpenSidebarUrl:direct-checkout");
    expect(selection.url).toBe(
      "https://workarena.example.com/com.glideapp.servicecatalog_checkout_view_v2.do?v=1&sysparm_sys_id=135ecc6193344b50d6ddf23cdd03d633&sysparm_new_request=true",
    );
    expect(selection.candidates[0]).toMatchObject({
      source: "finalOpenSidebarUrl:direct-checkout",
      selected: true,
      reason: null,
    });
  });

  test("prefers submitted checkout frame URLs over stale catalog top-frame URLs", () => {
    const startUrl =
      "https://workarena.example.com/now/nav/ui/classic/params/target/catalog_home.do%3Fsysparm_view%3Dcatalog_default";
    const staleItemUrl =
      "https://workarena.example.com/now/nav/ui/classic/params/target/com.glideapp.servicecatalog_cat_item_view.do%3Fv%3D1%26sysparm_id%3De212a942c0a80165008313c59764eea1";
    const checkoutFrameUrl =
      "https://workarena.example.com/com.glideapp.servicecatalog_checkout_view_v2.do?v=1&sysparm_sys_id=bbb4cae59378039065c5ff87dd03d623&sysparm_new_request=true";

    const selection = selectValidationUrl({
      startUrl,
      browserActiveUrl: startUrl,
      importedPageUrl: startUrl,
      finalOpenSidebarUrl: staleItemUrl,
      frameUrls: [staleItemUrl, checkoutFrameUrl],
    });

    expect(selection.source).toBe("frameUrl:2:direct-checkout");
    expect(selection.url).toBe(checkoutFrameUrl);
    expect(selection.candidates[0]).toMatchObject({
      source: "frameUrl:2:direct-checkout",
      selected: true,
      reason: null,
    });
  });

  test("uses submitted record detail URLs when a compositional task starts from home", () => {
    const homeUrl = "https://workarena.example.com/now/nav/ui/home";
    const submittedSysId = "073ece642bf0c7d09c8bf462fe91bf3d";
    const detailUrl =
      "https://workarena.example.com/now/nav/ui/classic/params/target/sys_user.do%3Fsys_id%3D073ece642bf0c7d09c8bf462fe91bf3d";

    const selection = selectValidationUrl({
      startUrl: homeUrl,
      browserActiveUrl: homeUrl,
      importedPageUrl: homeUrl,
      finalOpenSidebarUrl: detailUrl,
      frameUrls: [],
      submittedRecordNumber: submittedSysId,
    });

    expect(selection.source).toBe("finalOpenSidebarUrl");
    expect(selection.url).toBe(detailUrl);
    expect(selection.candidates[0]).toMatchObject({
      source: "finalOpenSidebarUrl",
      selected: true,
      reason: null,
    });
  });
});

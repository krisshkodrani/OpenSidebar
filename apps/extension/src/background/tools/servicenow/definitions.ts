/**
 * ServiceNow adapter — tool definitions (LLM-facing function schemas).
 *
 * These live in the adapter (not the generic tools/definitions.ts) so the
 * ServiceNow tool surface — schema + handler + registration — is owned in
 * one place. tools/index.ts must never reach in for these; registration
 * flows through ./register.
 *
 * Import-direction rule: servicenow/* must never import "../index" or the
 * "../tools" barrel — only ../../../types and concrete siblings.
 */

import { ToolName, ToolDefinition } from "../../../types";

export const OPEN_SERVICENOW_MODULE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.OPEN_SERVICENOW_MODULE,
    description:
      "Resolve and open a ServiceNow application module from ServiceNow metadata. For tasks like 'Navigate to the X > Y module of the Z application', call this before manual menu/search clicks or navigate(query).",
    parameters: {
      type: "object",
      properties: {
        application: {
          type: "string",
          description:
            'Optional ServiceNow application name, e.g. "Configuration".',
        },
        path: {
          type: "array",
          description:
            'Module path labels, with the target module as the last item, e.g. ["Database Instances", "HBase"].',
          items: {
            type: "string",
            description: "One application navigator path label.",
          },
        },
        run: {
          type: "boolean",
          description:
            "Whether to navigate after resolving the target URL. Defaults to true.",
        },
      },
      required: ["path"],
    },
  },
};

export const CONFIGURE_SERVICENOW_FORM_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.CONFIGURE_SERVICENOW_FORM,
    description:
      "Fill and verify a ServiceNow record form by field label/name using g_form when available, including hidden/tabbed fields, choices, checkboxes, empty values, and references. Use this on ServiceNow record forms before manual type/click sequences. Set submit=true only after requested values are verified.",
    parameters: {
      type: "object",
      properties: {
        fields: {
          type: "array",
          description:
            "Requested field/value pairs to set. Use visible labels or ServiceNow field names from the user request.",
          items: {
            type: "object",
            description: "One ServiceNow form field/value pair.",
            properties: {
              field: {
                type: "string",
                description:
                  'Visible field label or system field name, e.g. "Short description" or "caller_id".',
              },
              value: {
                type: "string",
                description:
                  "Value to set. Use an empty string to clear an optional field.",
              },
            },
            required: ["field", "value"],
          },
        },
        submit: {
          type: "boolean",
          description:
            "Click the ServiceNow Submit/Save/Update control after verifying requested values. Defaults to false.",
        },
        submitButton: {
          type: "string",
          description:
            'Optional submit control label, e.g. "Submit", "Save", or "Update".',
        },
      },
      required: [],
    },
  },
};

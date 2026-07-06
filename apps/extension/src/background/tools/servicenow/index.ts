/**
 * ServiceNow platform-semantics adapter.
 *
 * Quarantines ServiceNow-specific logic per the repo rule that domain
 * logic lives in clearly-labeled adapters grounded in stable platform
 * semantics (forms, tables, reference fields, module navigation) —
 * never in generic completion or runtime paths.
 *
 * Import-direction rule: modules in this directory must never import
 * "../index" or the "../tools" barrel — only ../helpers and concrete
 * siblings (../bridge, ../registry, ../definitions). tools/index.ts
 * imports from here, never the reverse. This directory is deliberately
 * NOT re-exported from the tools barrel.
 */

export * from "./common";
export * from "./records";
export * from "./references";
export * from "./navigation";
export * from "./register";
export * from "./definitions";
export * from "./tool-hooks";

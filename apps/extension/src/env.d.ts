declare const __DEV__: boolean;
/** Empty outside an explicit internal build; never set for published builds. */
declare const __FLEET_TELEMETRY_INTERNAL_ENDPOINT__: string;
/** Empty in production; configurable for dev/E2E when the default port is busy. */
declare const __LOCAL_OBSERVABILITY_SERVER_URL__: string;

declare module "*.css?inline" {
  const css: string;
  export default css;
}

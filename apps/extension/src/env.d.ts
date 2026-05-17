declare const __DEV__: boolean;

declare module "*.css?inline" {
  const css: string;
  export default css;
}

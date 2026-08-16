/**
 * Style imports carry no runtime value — the bundler injects them. TypeScript 6
 * requires an explicit declaration for a side-effect import, so this states that
 * these extensions are valid modules with nothing to type.
 */
declare module "*.css";
declare module "*.scss";

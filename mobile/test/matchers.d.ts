// Testing Library's matchers, on the `expect` Jest 30 types: its own declaration reaches only
// `@jest/expect` and the old `jest` namespace, and `@types/jest` 30 builds `expect` from `expect`.
import type { JestNativeMatchers } from "@testing-library/react-native/matchers";

declare module "expect" {
  // Merging into `expect`'s own interface: its signature has to match, `T` included.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars
  interface Matchers<R extends void | Promise<void>, T = unknown> extends JestNativeMatchers<R> {}
}

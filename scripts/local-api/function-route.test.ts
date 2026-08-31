import { describe, expect, it } from "vitest";
import { functionNameOf, isFunctionName } from "./function-route";

describe("local api function routing", () => {
  it("reads the function name the way the platform routes it", () => {
    expect(functionNameOf("/functions/v1/money-import")).toBe("money-import");
    expect(functionNameOf("/functions/v1/money-import/anything/after")).toBe("money-import");
  });

  it("also accepts a client pointed straight at the functions server", () => {
    expect(functionNameOf("/money-import")).toBe("money-import");
  });

  it("names nothing for paths that name no function", () => {
    expect(functionNameOf("/")).toBeNull();
    expect(functionNameOf("")).toBeNull();
    expect(functionNameOf("/functions/v1")).toBeNull();
    expect(functionNameOf("/functions/v1/")).toBeNull();
  });

  it("refuses anything that is not a plain slug", () => {
    // The name is handed to `import()`. A traversal that survived this would read a module
    // from anywhere on disk and serve whatever it exported, so each of these has to come back
    // as null rather than as a name the server then tries to resolve.
    expect(functionNameOf("/functions/v1/..%2f..%2fetc")).toBeNull();
    expect(functionNameOf("/functions/v1/.hidden")).toBeNull();
    expect(functionNameOf("/functions/v1/Money-Import")).toBeNull();
    expect(functionNameOf("/functions/v1/money_import")).toBeNull();
    expect(isFunctionName("../secrets")).toBe(false);
    expect(isFunctionName("file:///etc/passwd")).toBe(false);
    expect(isFunctionName("-leading-dash")).toBe(false);
  });

  it("keeps a traversal written as its own segments from naming a function", () => {
    // `/functions/v1/../../x` arrives with the segments intact when the client does not
    // normalise, and `..` must not be a name.
    expect(functionNameOf("/functions/v1/../../x")).toBeNull();
  });
});

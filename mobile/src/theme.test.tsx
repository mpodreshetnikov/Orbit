import { describe, expect, it, jest } from "@jest/globals";
import { renderHook } from "@testing-library/react-native";
import * as ReactNative from "react-native";
import { palettes, usePalette } from "@/theme";

describe("usePalette", () => {
  it("follows the phone's appearance", async () => {
    const scheme = jest.spyOn(ReactNative, "useColorScheme");
    scheme.mockReturnValue("dark");
    expect((await renderHook(() => usePalette())).result.current).toBe(palettes.dark);
    scheme.mockReturnValue("light");
    expect((await renderHook(() => usePalette())).result.current).toBe(palettes.light);
    scheme.mockRestore();
  });
});

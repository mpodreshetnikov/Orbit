import { afterEach, describe, expect, it } from "@jest/globals";
import { testSignInCredentials } from "@/lib/test-sign-in";

const EMAIL = "EXPO_PUBLIC_TEST_SIGNIN_EMAIL";
const PASSWORD = "EXPO_PUBLIC_TEST_SIGNIN_PASSWORD";

afterEach(() => {
  delete process.env[EMAIL];
  delete process.env[PASSWORD];
});

describe("testSignInCredentials", () => {
  it("is null in an ordinary bundle", () => {
    expect(testSignInCredentials()).toBeNull();
  });

  it("is null when only one of the two is set", () => {
    process.env[EMAIL] = "dev@example.com";
    expect(testSignInCredentials()).toBeNull();
  });

  it("returns both when the recordings lane set them", () => {
    process.env[EMAIL] = "dev@example.com";
    process.env[PASSWORD] = "secret";
    expect(testSignInCredentials()).toEqual({ email: "dev@example.com", password: "secret" });
  });
});

import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { forwardedPathFor, matchRoute, resolveRoutes } = require("./gateway.cjs");

type Route = { prefix: string; port: number; strip: boolean };

/**
 * The gateway's decisions are all made before a socket is opened, and this suite runs under the
 * no-network guard, so it tests the decisions. That the decisions are then wired to
 * `http.request` is what `api-local-docker.cjs smoke` proves, against the real services.
 */
describe("local api gateway routing table", () => {
  const routes: Route[] = resolveRoutes({});

  it("orders the table longest prefix first", () => {
    // `/rest/v1` and `/functions/v1` share no prefix today, but a table matched in declaration
    // order is one added route away from a shorter prefix shadowing a longer one.
    const lengths = routes.map((route) => route.prefix.length);
    expect([...lengths].sort((left, right) => right - left)).toEqual(lengths);
  });

  it("routes each prefix to the service that owns it", () => {
    expect(matchRoute(routes, "/rest/v1/money_transactions")?.prefix).toBe("/rest/v1");
    expect(matchRoute(routes, "/auth/v1/token")?.prefix).toBe("/auth/v1");
    expect(matchRoute(routes, "/functions/v1/money-import")?.prefix).toBe("/functions/v1");
  });

  it("matches a bare prefix as well as a path under it", () => {
    expect(matchRoute(routes, "/rest/v1")?.prefix).toBe("/rest/v1");
  });

  it("routes nothing it was not given a service for", () => {
    // Storage has no service in this lane. Answering 404 here is what makes that visible,
    // rather than forwarding it to whichever route happened to match loosely.
    expect(matchRoute(routes, "/storage/v1/object/public/x")).toBeUndefined();
    expect(matchRoute(routes, "/rest/v1x/money_transactions")).toBeUndefined();
    expect(matchRoute(routes, "/")).toBeUndefined();
  });

  it("strips the prefixes whose service serves at its own root", () => {
    const rest = routes.find((route) => route.prefix === "/rest/v1")!;
    const auth = routes.find((route) => route.prefix === "/auth/v1")!;
    expect(
      forwardedPathFor(rest, new URL("http://127.0.0.1/rest/v1/money_transactions?select=id")),
    ).toBe("/money_transactions?select=id");
    expect(
      forwardedPathFor(auth, new URL("http://127.0.0.1/auth/v1/token?grant_type=password")),
    ).toBe("/token?grant_type=password");
  });

  it("keeps the functions prefix, because the functions server routes on it", () => {
    // The one asymmetry in the table, and the reason it is written down: strip it and every
    // request arrives as `/money-import`, which the server still resolves — so the mistake
    // would not show up in this lane at all, only against a stack that reads the full path.
    const functions = routes.find((route) => route.prefix === "/functions/v1")!;
    expect(functions.strip).toBe(false);
    expect(forwardedPathFor(functions, new URL("http://127.0.0.1/functions/v1/money-import"))).toBe(
      "/functions/v1/money-import",
    );
  });

  it("turns a bare stripped prefix into a root request rather than an empty path", () => {
    const rest = routes.find((route) => route.prefix === "/rest/v1")!;
    expect(forwardedPathFor(rest, new URL("http://127.0.0.1/rest/v1"))).toBe("/");
  });

  it("reads every port from the environment, so two lanes can run side by side", () => {
    const custom: Route[] = resolveRoutes({
      ORBIT_REST_PORT: "1111",
      ORBIT_AUTH_PORT: "2222",
      ORBIT_FUNCTIONS_PORT: "3333",
    });
    expect(custom.map((route) => route.port).sort()).toEqual([1111, 2222, 3333]);
  });
});

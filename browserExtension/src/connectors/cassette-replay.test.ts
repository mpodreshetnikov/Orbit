import { describe, expect, it } from "vitest";
import { createCassettePlayer, type Cassette } from "./cassette-replay";

const cassette: Cassette = {
  name: "unit",
  entries: [
    {
      url: "https://www.tbank.ru/api/common/v1/operations?sessionid=REDACTED&start=1&end=2",
      status: 200,
      body: { payload: [{ id: "op-1" }] },
    },
    {
      url: "https://www.tbank.ru/api/common/v1/shopping_receipt?operationId=op-1&sessionid=REDACTED",
      status: 200,
      body: { resultCode: "OK" },
    },
  ],
};

describe("cassette replay", () => {
  it("answers a request that differs only in session id and range bounds", async () => {
    // Range splitting deliberately re-asks for the same data with different bounds, so a
    // cassette that only matched the exact recorded URL would break the moment the connector
    // decided to split.
    const player = createCassettePlayer(cassette);
    const response = await player.fetch(
      "https://www.tbank.ru/api/common/v1/operations?sessionid=other&start=99&end=100",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ payload: [{ id: "op-1" }] });
    expect(player.misses).toEqual([]);
  });

  it("matches a receipt request by its operation", async () => {
    const player = createCassettePlayer(cassette);
    const response = await player.fetch(
      "https://www.tbank.ru/api/common/v1/shopping_receipt?operationId=op-1&sessionid=live",
    );

    expect(await response.json()).toEqual({ resultCode: "OK" });
  });

  it("reports a request the recording never saw", async () => {
    const player = createCassettePlayer(cassette);
    const response = await player.fetch("https://www.tbank.ru/api/common/v1/tranche_offers");

    expect(response.status).toBe(404);
    expect(player.misses).toEqual(["https://www.tbank.ru/api/common/v1/tranche_offers"]);
  });

  it("replays a status that cannot carry a body without one", async () => {
    // `JSON.stringify(null)` is the four-character string "null", and the Fetch spec forbids a
    // body on 204/205/304 — the `Response` constructor throws rather than ignoring it. So a
    // cassette holding one of these blew the replay up on construction, before the connector saw
    // anything it could act on.
    const player = createCassettePlayer({
      name: "bodyless",
      entries: [
        {
          url: "https://www.tbank.ru/api/common/v1/operations?sessionid=live&start=1&end=2",
          status: 204,
          body: null,
        },
      ],
    });

    const response = await player.fetch(
      "https://www.tbank.ru/api/common/v1/operations?sessionid=x&start=1&end=2",
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(player.misses).toEqual([]);
  });

  it("reports recorded responses nothing asked for", async () => {
    const player = createCassettePlayer(cassette);
    await player.fetch("https://www.tbank.ru/api/common/v1/operations?sessionid=x&start=1&end=2");

    expect(player.unused().map((entry) => entry.url)).toEqual([cassette.entries[1].url]);
  });
});

import { assertEquals } from "std/assert/assert-equals";
import { loadRecordPageImages, type PageImageAttachment } from "./page-images.ts";

function attachment(path: string, mimeType = "image/png"): PageImageAttachment {
  return { storage_path: path, mime_type: mimeType };
}

function blobOf(size: number): Blob {
  return new Blob([new Uint8Array(size)]);
}

Deno.test("pages are loaded in document order, normalised as OCR normalised them", async () => {
  const normalised: string[] = [];
  const images = await loadRecordPageImages("record-1", {
    getAttachments: () => Promise.resolve([attachment("a.png"), attachment("b.png")]),
    downloadAttachment: () => Promise.resolve(new Blob([new TextEncoder().encode("raw")])),
    preprocessImage: (_bytes, mimeType) => {
      normalised.push(mimeType);
      return Promise.resolve({
        bytes: new TextEncoder().encode("small"),
        mimeType: "image/jpeg",
        width: 10,
        height: 10,
      });
    },
  });

  assertEquals(images.length, 2);
  assertEquals(normalised, ["image/png", "image/png"]);
  // The model sees the page OCR saw, not the multi-megabyte original.
  assertEquals(images[0], `data:image/jpeg;base64,${btoa("small")}`);
});

Deno.test("a PDF is not sent as a page image", async () => {
  const images = await loadRecordPageImages("record-1", {
    getAttachments: () => Promise.resolve([attachment("scan.pdf", "application/pdf")]),
    downloadAttachment: () => Promise.resolve(blobOf(10)),
  });
  // Its transcription is all the structuring stage gets of a PDF.
  assertEquals(images, []);
});

Deno.test("the number of pages is bounded", async () => {
  const images = await loadRecordPageImages("record-1", {
    getAttachments: () =>
      Promise.resolve(["a", "b", "c", "d", "e", "f"].map((name) => attachment(`${name}.png`))),
    downloadAttachment: () => Promise.resolve(blobOf(10)),
    maxImages: 3,
  });
  assertEquals(images.length, 3);
});

Deno.test(
  "their total size is bounded too, and the cut keeps the document's beginning",
  async () => {
    const downloaded: string[] = [];
    const images = await loadRecordPageImages("record-1", {
      getAttachments: () =>
        Promise.resolve([attachment("a.png"), attachment("b.png"), attachment("c.png")]),
      downloadAttachment: (path) => {
        downloaded.push(path);
        return Promise.resolve(blobOf(600));
      },
      maxBytes: 1000,
    });

    // A count alone is not a bound: four unnormalised photographs are tens of megabytes of base64
    // in one request body.
    assertEquals(images.length, 1);
    assertEquals(downloaded, ["a.png", "b.png"]);
  },
);

Deno.test(
  "a page that cannot be downloaded is skipped rather than failing the record",
  async () => {
    const images = await loadRecordPageImages("record-1", {
      getAttachments: () => Promise.resolve([attachment("gone.png"), attachment("here.png")]),
      downloadAttachment: (path) => Promise.resolve(path === "gone.png" ? null : blobOf(10)),
    });
    assertEquals(images.length, 1);
  },
);

Deno.test("an unreadable attachment list leaves structuring to work from the text", async () => {
  const errors: unknown[] = [];
  const images = await loadRecordPageImages("record-1", {
    getAttachments: () => Promise.reject(new Error("storage unavailable")),
    downloadAttachment: () => Promise.resolve(null),
    log: { log: () => {}, warn: () => {}, error: (...args: unknown[]) => errors.push(args) },
  });
  // Context, not content: the record still structures, exactly as it did before this existed.
  assertEquals(images, []);
  assertEquals(errors.length, 1);
});

// OCR calls once per attachment, so a corrupt page costs only that page. Extraction sends every
// page in one request: a provider rejecting one image would take the whole record's structuring
// with it, when the transcription alone would have worked.
Deno.test("a page that will not decode is omitted rather than sent as it was stored", async () => {
  const errors: unknown[] = [];
  const images = await loadRecordPageImages("record-1", {
    getAttachments: () => Promise.resolve([attachment("bad.png"), attachment("good.png")]),
    downloadAttachment: () => Promise.resolve(new Blob([new TextEncoder().encode("raw")])),
    preprocessImage: (_bytes, _mimeType) => Promise.resolve(_bytes && false ? null : null),
    log: { log: () => {}, warn: () => {}, error: (...args: unknown[]) => errors.push(args) },
  });

  assertEquals(images, []);
  assertEquals(errors.length, 2);
});

Deno.test("only the pages that would not decode are dropped", async () => {
  const images = await loadRecordPageImages("record-1", {
    getAttachments: () => Promise.resolve([attachment("bad.png"), attachment("good.png")]),
    downloadAttachment: (path) =>
      Promise.resolve(new Blob([new TextEncoder().encode(path === "bad.png" ? "junk" : "raw")])),
    preprocessImage: (bytes) =>
      Promise.resolve(
        new TextDecoder().decode(bytes) === "junk"
          ? null
          : {
              bytes: new TextEncoder().encode("small"),
              mimeType: "image/jpeg",
              width: 10,
              height: 10,
            },
      ),
    log: { log: () => {}, warn: () => {}, error: () => {} },
  });

  assertEquals(images, [`data:image/jpeg;base64,${btoa("small")}`]);
});

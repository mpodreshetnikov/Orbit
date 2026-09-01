import { assertEquals } from "std/assert/assert-equals";
import {
  canPreprocess,
  DEFAULT_MAX_IMAGE_EDGE,
  preprocessOcrImage,
  type RasterImage,
} from "./image-preprocess.ts";

/**
 * A page made of pixels rather than a file.
 *
 * The codec is behind a seam precisely so these tests do not need it: what is worth checking is
 * what happens to the pixels, and a real JPEG round trip would only blur the answer.
 */
function createFakeImage(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number],
): RasterImage & { encoded: Array<{ quality: number; width: number; height: number }> } {
  let currentWidth = width;
  let currentHeight = height;
  let bitmap = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const offset = (y * width + x) * 4;
      bitmap[offset] = r;
      bitmap[offset + 1] = g;
      bitmap[offset + 2] = b;
      bitmap[offset + 3] = 255;
    }
  }

  const encoded: Array<{ quality: number; width: number; height: number }> = [];

  return {
    encoded,
    get width() {
      return currentWidth;
    },
    get height() {
      return currentHeight;
    },
    get bitmap() {
      return bitmap;
    },
    resize(nextWidth: number, nextHeight: number) {
      currentWidth = nextWidth;
      currentHeight = nextHeight;
      bitmap = new Uint8ClampedArray(nextWidth * nextHeight * 4);
    },
    encodeJpeg(quality: number) {
      encoded.push({ quality, width: currentWidth, height: currentHeight });
      return Promise.resolve(new Uint8Array([1, 2, 3]));
    },
  };
}

/** A washed-out page: mid-grey paper with slightly darker ink, far from black and white. */
function lowContrastPage(width: number, height: number) {
  return createFakeImage(width, height, (_x, y) =>
    y % 3 === 0 ? [110, 108, 100] : [150, 148, 140],
  );
}

function readRange(bitmap: Uint8ClampedArray): { min: number; max: number } {
  let min = 255;
  let max = 0;
  for (let index = 0; index < bitmap.length; index += 4) {
    if (bitmap[index] < min) min = bitmap[index];
    if (bitmap[index] > max) max = bitmap[index];
  }
  return { min, max };
}

Deno.test("canPreprocess accepts raster pages and refuses everything else", () => {
  assertEquals(canPreprocess("image/png"), true);
  assertEquals(canPreprocess("image/jpeg"), true);
  assertEquals(canPreprocess("IMAGE/PNG"), true);
  // A PDF has no raster to normalise, and goes to the provider as a file rather than an image.
  assertEquals(canPreprocess("application/pdf"), false);
  assertEquals(canPreprocess("image/gif"), false);
});

Deno.test("preprocessing bounds the longest edge without enlarging", async () => {
  const wide = lowContrastPage(3000, 1500);
  const result = await preprocessOcrImage(new Uint8Array([0]), "image/png", {
    decode: () => Promise.resolve(wide),
  });

  assertEquals(result?.width, DEFAULT_MAX_IMAGE_EDGE);
  assertEquals(result?.height, 1000);
  assertEquals(result?.mimeType, "image/jpeg");
  assertEquals(wide.encoded.length, 1);

  // A page already small enough keeps its own size: enlarging invents detail the model would
  // read as text.
  const small = lowContrastPage(400, 300);
  const smallResult = await preprocessOcrImage(new Uint8Array([0]), "image/png", {
    decode: () => Promise.resolve(small),
  });
  assertEquals(smallResult?.width, 400);
  assertEquals(smallResult?.height, 300);
});

Deno.test("preprocessing greys the page and stretches its contrast", async () => {
  const page = lowContrastPage(60, 60);
  await preprocessOcrImage(new Uint8Array([0]), "image/png", {
    decode: () => Promise.resolve(page),
  });

  // The source spans 110..150 out of 255. Stretched, the paper is white and the ink is black --
  // which is the difference between a digit being read and being guessed.
  const range = readRange(page.bitmap);
  assertEquals(range.max, 255);
  assertEquals(range.min, 0);

  // Grey means the three channels agree, everywhere, and alpha is untouched.
  for (let index = 0; index < page.bitmap.length; index += 4) {
    const [r, g, b, a] = [
      page.bitmap[index],
      page.bitmap[index + 1],
      page.bitmap[index + 2],
      page.bitmap[index + 3],
    ];
    assertEquals(r === g && g === b, true, `pixel ${index / 4} is not grey: ${r},${g},${b}`);
    assertEquals(a, 255);
  }
});

Deno.test("luminance decides the grey, not the average of the channels", async () => {
  // Pure green and pure blue have the same channel average; they look nothing alike on paper.
  const page = createFakeImage(2, 1, (x) => (x === 0 ? [0, 255, 0] : [0, 0, 255]));
  await preprocessOcrImage(new Uint8Array([0]), "image/png", {
    decode: () => Promise.resolve(page),
  });
  assertEquals(page.bitmap[0] > page.bitmap[4], true, "green must read brighter than blue");
});

Deno.test("a nearly uniform page is not stretched into noise", async () => {
  const blank = createFakeImage(20, 20, () => [128, 128, 128]);
  await preprocessOcrImage(new Uint8Array([0]), "image/png", {
    decode: () => Promise.resolve(blank),
  });

  // Still mid-grey: with nothing in the histogram to stretch, amplifying it would turn sensor
  // noise into something that looks like text.
  const range = readRange(blank.bitmap);
  assertEquals(range.min, 128);
  assertEquals(range.max, 128);
});

Deno.test("an undecodable page reports that it cannot be preprocessed", async () => {
  const errors: unknown[] = [];
  const result = await preprocessOcrImage(new Uint8Array([1, 2, 3, 4]), "image/png", {
    decode: () => Promise.reject(new Error("not an image")),
    log: { log: () => {}, error: (...args: unknown[]) => errors.push(args) },
  });
  // Null, not a throw: the page is sent as it arrived rather than failing the document.
  assertEquals(result, null);
  assertEquals(errors.length, 1);
});

Deno.test("a PDF is left alone", async () => {
  let decoded = false;
  const result = await preprocessOcrImage(new Uint8Array([1, 2, 3]), "application/pdf", {
    decode: () => {
      decoded = true;
      return Promise.reject(new Error("should not be called"));
    },
  });
  assertEquals(result, null);
  assertEquals(decoded, false);
});

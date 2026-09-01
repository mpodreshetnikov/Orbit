/**
 * What the model is actually shown.
 *
 * The dominant input here is a phone photograph of a printed lab report: a few thousand pixels
 * wide, colour, unevenly lit, and often several megabytes. Every one of those properties costs
 * something and none of them helps the transcription. Resolution beyond what the text needs is
 * paid for in tokens and in the base64 body the function has to hold in memory -- a ten-megabyte
 * attachment becomes roughly thirteen megabytes of JSON. Colour carries nothing on a black-on-
 * white printout. And the contrast a phone camera produces under a kitchen light is the one thing
 * that genuinely changes whether a digit is read as an 8 or a 3.
 *
 * So each raster page is normalised before it is encoded: bounded to a longest edge the text
 * survives, converted to grey by luminance, and stretched so the paper is white and the ink is
 * black. Failure here is never fatal -- a page that cannot be decoded is sent as it arrived,
 * because a slightly worse transcription beats no transcription.
 */

import { ORIENTATION_NORMAL, readJpegOrientation } from "../_shared/exif-orientation.ts";

/**
 * The longest edge a page is reduced to.
 *
 * Print at 300dpi puts a body-text character around 30 pixels tall on an A4 page scanned at
 * 2480px wide; at 2000px it is still roughly 24, which vision models read comfortably. Below
 * about 1500 the thin strokes in decimal points and minus signs start to disappear, and those
 * are exactly the characters a lab value cannot afford to lose.
 */
export const DEFAULT_MAX_IMAGE_EDGE = 2000;

/** JPEG quality for the re-encoded page. High enough that text edges stay clean. */
export const DEFAULT_JPEG_QUALITY = 85;

/**
 * How much of the histogram is treated as outliers when stretching contrast.
 *
 * A photograph almost always has a few specular pixels and a few near-black ones -- a shadow at
 * the page edge, a reflection off the staple. Anchoring the stretch to the true minimum and
 * maximum would let those few pixels decide the mapping and leave the actual page unchanged.
 */
const CONTRAST_CLIP_FRACTION = 0.02;

/**
 * The narrowest luminance range still worth stretching.
 *
 * Below this the image is nearly uniform -- a blank page, or a photograph of nothing -- and
 * stretching it would amplify sensor noise into something that looks like text.
 */
const MIN_CONTRAST_RANGE = 8;

const PREPROCESSABLE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg"]);

export interface PreprocessedImage {
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
}

/**
 * The bare shape of a decoded page: enough to normalise one, and no more.
 *
 * The codec is somebody else's problem -- and a wasm one, which is why it sits behind this seam
 * rather than being imported at module load. What is worth testing here is the normalisation
 * itself, and that needs pixels, not a JPEG decoder.
 */
export interface RasterImage {
  readonly width: number;
  readonly height: number;
  /** RGBA, four bytes per pixel, mutated in place. */
  readonly bitmap: Uint8ClampedArray;
  /** Scale to exactly these dimensions. */
  resize(width: number, height: number): void;
  /** Swap in a differently shaped bitmap -- what turning a sideways photograph upright needs. */
  replace(width: number, height: number, bitmap: Uint8ClampedArray): void;
  encodeJpeg(quality: number): Promise<Uint8Array>;
}

export type ImageDecoder = (bytes: Uint8Array) => Promise<RasterImage>;

export interface PreprocessOptions {
  maxEdge?: number;
  jpegQuality?: number;
  log?: Pick<Console, "log" | "error">;
  decode?: ImageDecoder;
}

/**
 * ImageScript, loaded only when a page actually needs it.
 *
 * The import is dynamic because the library fetches its wasm at load time: a record whose
 * attachments are all PDFs should not pay for that, and neither should a test.
 */
const decodeWithImageScript: ImageDecoder = async (bytes) => {
  const { Image } = await import("imagescript");
  let image = await Image.decode(bytes);
  return {
    get width() {
      return image.width;
    },
    get height() {
      return image.height;
    },
    get bitmap() {
      return image.bitmap;
    },
    resize(width: number, height: number) {
      image.resize(width, height);
    },
    replace(width: number, height: number, bitmap: Uint8ClampedArray) {
      const replacement = new Image(width, height);
      replacement.bitmap.set(bitmap);
      image = replacement;
    },
    encodeJpeg(quality: number) {
      return image.encodeJPEG(quality);
    },
  };
};

/** Whether this attachment is a raster image the pipeline can normalise at all. */
export function canPreprocess(mimeType: string): boolean {
  return PREPROCESSABLE_MIME_TYPES.has(mimeType.toLowerCase());
}

/**
 * Convert to grey by luminance and stretch what is left to the full range.
 *
 * Luminance rather than the average of the channels: red and blue contribute far less to
 * perceived brightness, and a printout photographed under a warm bulb turns muddy when they are
 * weighted equally. Grey and contrast are done in one place because the second needs the first --
 * the histogram being stretched is the histogram of the grey image.
 */
function greyscaleAndNormalise(bitmap: Uint8ClampedArray): void {
  const pixelCount = bitmap.length / 4;
  const luma = new Uint8Array(pixelCount);
  const histogram = new Uint32Array(256);

  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const offset = pixel * 4;
    const alpha = bitmap[offset + 3];
    let value = (bitmap[offset] * 299 + bitmap[offset + 1] * 587 + bitmap[offset + 2] * 114) / 1000;
    if (alpha < 255) {
      // JPEG has no alpha, so a transparent pixel would be encoded as whatever RGB was hiding
      // under it -- usually zero, turning a transparent scan background into black. Composited
      // onto white, which is what a document's background is.
      const opacity = alpha / 255;
      value = value * opacity + 255 * (1 - opacity);
    }
    const rounded = value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
    luma[pixel] = rounded;
    histogram[rounded]++;
  }

  const clip = Math.floor(pixelCount * CONTRAST_CLIP_FRACTION);
  let low = 0;
  let high = 255;

  let seen = 0;
  for (let value = 0; value < 256; value++) {
    seen += histogram[value];
    if (seen > clip) {
      low = value;
      break;
    }
  }

  seen = 0;
  for (let value = 255; value >= 0; value--) {
    seen += histogram[value];
    if (seen > clip) {
      high = value;
      break;
    }
  }

  const stretch = high - low >= MIN_CONTRAST_RANGE;
  const scale = stretch ? 255 / (high - low) : 1;

  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const offset = pixel * 4;
    let value = luma[pixel];
    if (stretch) {
      value = (value - low) * scale;
      value = value < 0 ? 0 : value > 255 ? 255 : value;
    }
    const grey = Math.round(value);
    bitmap[offset] = grey;
    bitmap[offset + 1] = grey;
    bitmap[offset + 2] = grey;
    // Opaque, because the transparency has already been resolved against white above. Leaving
    // the alpha byte would preserve a channel the JPEG encoder is about to discard anyway.
    bitmap[offset + 3] = 255;
  }
}

/**
 * Turn a bitmap the way its EXIF tag says it should be viewed.
 *
 * The eight orientations are the eight ways a sensor can be held: four rotations, each optionally
 * mirrored. Done here rather than through the codec because it is a pixel move like every other
 * step in this file, and because it can then be tested without a decoder.
 */
function applyOrientation(
  bitmap: Uint8ClampedArray,
  width: number,
  height: number,
  orientation: number,
): { bitmap: Uint8ClampedArray; width: number; height: number } {
  if (orientation === ORIENTATION_NORMAL) return { bitmap, width, height };

  // Orientations 5-8 put the sensor on its side, so the page's width and height swap.
  const swapsAxes = orientation >= 5;
  const outWidth = swapsAxes ? height : width;
  const outHeight = swapsAxes ? width : height;
  const out = new Uint8ClampedArray(bitmap.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let targetX: number;
      let targetY: number;
      switch (orientation) {
        case 2: // mirrored
          targetX = width - 1 - x;
          targetY = y;
          break;
        case 3: // upside down
          targetX = width - 1 - x;
          targetY = height - 1 - y;
          break;
        case 4: // mirrored upside down
          targetX = x;
          targetY = height - 1 - y;
          break;
        case 5: // mirrored, quarter turn
          targetX = y;
          targetY = x;
          break;
        case 6: // quarter turn clockwise
          targetX = height - 1 - y;
          targetY = x;
          break;
        case 7: // mirrored, three quarter turn
          targetX = height - 1 - y;
          targetY = width - 1 - x;
          break;
        case 8: // three quarter turn clockwise
          targetX = y;
          targetY = width - 1 - x;
          break;
        default:
          targetX = x;
          targetY = y;
      }

      const from = (y * width + x) * 4;
      const to = (targetY * outWidth + targetX) * 4;
      out[to] = bitmap[from];
      out[to + 1] = bitmap[from + 1];
      out[to + 2] = bitmap[from + 2];
      out[to + 3] = bitmap[from + 3];
    }
  }

  return { bitmap: out, width: outWidth, height: outHeight };
}

/**
 * Normalise one page for transcription, or report that it cannot be.
 *
 * Returns null for anything that is not a raster image this can decode -- a PDF, an unknown
 * type, a corrupt file -- and the caller sends the attachment exactly as it arrived.
 */
export async function preprocessOcrImage(
  bytes: Uint8Array,
  mimeType: string,
  options: PreprocessOptions = {},
): Promise<PreprocessedImage | null> {
  if (!canPreprocess(mimeType)) return null;

  const log = options.log ?? console;
  const maxEdge = options.maxEdge ?? DEFAULT_MAX_IMAGE_EDGE;
  const quality = options.jpegQuality ?? DEFAULT_JPEG_QUALITY;

  try {
    const image = await (options.decode ?? decodeWithImageScript)(bytes);

    // Before anything else, because every later step assumes the page is the right way up. A
    // phone writes the sensor's pixels and records how to turn them; re-encoding drops that tag,
    // and a page that looked upright everywhere would reach the model on its side.
    const oriented = applyOrientation(
      image.bitmap,
      image.width,
      image.height,
      readJpegOrientation(bytes),
    );
    if (oriented.width !== image.width || oriented.bitmap !== image.bitmap) {
      image.replace(oriented.width, oriented.height, oriented.bitmap);
    }

    const longestEdge = Math.max(image.width, image.height);
    if (longestEdge > maxEdge) {
      // Only ever down: enlarging a photograph invents detail the model would read as text.
      const scale = maxEdge / longestEdge;
      image.resize(
        Math.max(1, Math.round(image.width * scale)),
        Math.max(1, Math.round(image.height * scale)),
      );
    }

    greyscaleAndNormalise(image.bitmap);

    return {
      bytes: await image.encodeJpeg(quality),
      mimeType: "image/jpeg",
      width: image.width,
      height: image.height,
    };
  } catch (error) {
    log.error("[health-ocr] image preprocessing failed, sending the original:", error);
    return null;
  }
}

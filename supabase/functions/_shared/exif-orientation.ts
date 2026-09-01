/**
 * Which way up the photograph actually is.
 *
 * A phone does not rotate the pixels it captures. It writes them in the sensor's orientation and
 * records how to turn them in an EXIF tag, and every viewer applies that tag on the way to the
 * screen. Decoding to a bitmap and re-encoding drops the tag -- so a page that looked upright
 * everywhere reaches the model on its side, which is the difference between a transcription and
 * a page of nonsense.
 *
 * Only the tag is read here. Applying it is pixel work, and lives with the rest of it.
 */

/** The identity: pixels are already the right way up, or the file does not say otherwise. */
export const ORIENTATION_NORMAL = 1;

const JPEG_SOI = 0xffd8;
const APP1 = 0xffe1;
/** The first marker of compressed data: everything after it is the image, not metadata. */
const SOS = 0xffda;
const EXIF_TAG_ORIENTATION = 0x0112;

/**
 * Read the EXIF orientation of a JPEG, or 1 when it does not declare one.
 *
 * Deliberately total: a truncated file, a PNG, a JPEG with no EXIF and a corrupt IFD all mean
 * the same thing here -- nothing to correct.
 */
export function readJpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 4 || view.getUint16(0) !== JPEG_SOI) return ORIENTATION_NORMAL;

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    // Markers are 0xFF-prefixed; anything else means the structure is not what it claims.
    if ((marker & 0xff00) !== 0xff00) return ORIENTATION_NORMAL;
    if (marker === SOS) return ORIENTATION_NORMAL;

    const segmentLength = view.getUint16(offset + 2);
    if (segmentLength < 2) return ORIENTATION_NORMAL;

    if (marker === APP1) {
      const orientation = readOrientationFromApp1(view, offset + 4, segmentLength - 2);
      if (orientation !== null) return orientation;
    }

    offset += 2 + segmentLength;
  }

  return ORIENTATION_NORMAL;
}

function readOrientationFromApp1(view: DataView, start: number, length: number): number | null {
  // "Exif\0\0", then a TIFF header. An APP1 that is not EXIF (XMP, most often) is not ours.
  if (length < 14 || start + 14 > view.byteLength) return null;
  if (
    view.getUint8(start) !== 0x45 ||
    view.getUint8(start + 1) !== 0x78 ||
    view.getUint8(start + 2) !== 0x69 ||
    view.getUint8(start + 3) !== 0x66 ||
    view.getUint8(start + 4) !== 0x00
  ) {
    return null;
  }

  const tiff = start + 6;
  const byteOrder = view.getUint16(tiff);
  // "II" is little-endian, "MM" big-endian. Anything else is not a TIFF header.
  const littleEndian = byteOrder === 0x4949;
  if (!littleEndian && byteOrder !== 0x4d4d) return null;
  if (view.getUint16(tiff + 2, littleEndian) !== 42) return null;

  const ifdOffset = view.getUint32(tiff + 4, littleEndian);
  const ifd = tiff + ifdOffset;
  if (ifd + 2 > view.byteLength) return null;

  const entryCount = view.getUint16(ifd, littleEndian);
  for (let index = 0; index < entryCount; index++) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > view.byteLength) return null;
    if (view.getUint16(entry, littleEndian) !== EXIF_TAG_ORIENTATION) continue;

    // A SHORT value sits in the first two bytes of the value field, whatever the byte order.
    const value = view.getUint16(entry + 8, littleEndian);
    return value >= 1 && value <= 8 ? value : ORIENTATION_NORMAL;
  }

  return null;
}

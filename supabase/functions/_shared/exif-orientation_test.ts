import { assertEquals } from "std/assert/assert-equals";
import { ORIENTATION_NORMAL, readJpegOrientation } from "./exif-orientation.ts";

/**
 * The smallest JPEG that carries an orientation: SOI, one APP1 holding a TIFF header with a
 * single IFD entry, then the start of scan.
 */
function jpegWithOrientation(orientation: number, littleEndian = true): Uint8Array {
  const exif = new Uint8Array(6 + 8 + 2 + 12 + 4);
  const view = new DataView(exif.buffer);
  exif.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 0); // "Exif\0\0"

  const tiff = 6;
  view.setUint16(tiff, littleEndian ? 0x4949 : 0x4d4d);
  view.setUint16(tiff + 2, 42, littleEndian);
  view.setUint32(tiff + 4, 8, littleEndian); // IFD0 sits right after the header
  view.setUint16(tiff + 8, 1, littleEndian); // one entry
  view.setUint16(tiff + 10, 0x0112, littleEndian); // orientation
  view.setUint16(tiff + 12, 3, littleEndian); // SHORT
  view.setUint32(tiff + 14, 1, littleEndian); // one value
  view.setUint16(tiff + 18, orientation, littleEndian);

  const out = new Uint8Array(2 + 2 + 2 + exif.length + 2);
  const outView = new DataView(out.buffer);
  outView.setUint16(0, 0xffd8); // SOI
  outView.setUint16(2, 0xffe1); // APP1
  outView.setUint16(4, 2 + exif.length); // segment length includes itself
  out.set(exif, 6);
  outView.setUint16(6 + exif.length, 0xffda); // SOS
  return out;
}

Deno.test("the orientation tag is read, in either byte order", () => {
  assertEquals(readJpegOrientation(jpegWithOrientation(6)), 6);
  assertEquals(readJpegOrientation(jpegWithOrientation(8, false)), 8);
  assertEquals(readJpegOrientation(jpegWithOrientation(1)), ORIENTATION_NORMAL);
});

Deno.test("anything that does not declare an orientation is already upright", () => {
  // A PNG.
  assertEquals(readJpegOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), ORIENTATION_NORMAL);
  // A JPEG with no EXIF at all.
  assertEquals(readJpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda])), ORIENTATION_NORMAL);
  // Truncated before anything can be read.
  assertEquals(readJpegOrientation(new Uint8Array([0xff])), ORIENTATION_NORMAL);
  // An APP1 that is not EXIF -- XMP, most often.
  const xmp = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x08, 0x68, 0x74, 0x74, 0x70]);
  assertEquals(readJpegOrientation(xmp), ORIENTATION_NORMAL);
});

Deno.test("a value outside the eight orientations is treated as upright", () => {
  assertEquals(readJpegOrientation(jpegWithOrientation(42)), ORIENTATION_NORMAL);
});

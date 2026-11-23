import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

const inputPath = fileURLToPath(new URL('./entry.png', import.meta.url));
const outputDirectory = process.env.MAKEFUN_OUTPUT_DIR || '/output';
const outputPath = resolve(outputDirectory, 'entry.png');

function imageDimensions(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    if (bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
      return null;
    }

    return {
      format: 'PNG',
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
  }

  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      return null;
    }

    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= bytes.length) {
      return null;
    }

    const marker = bytes[offset];
    offset += 1;

    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (marker === 0xda || offset + 2 > bytes.length) {
      return null;
    }

    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      return null;
    }

    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 7) {
        return null;
      }

      return {
        format: 'JPEG',
        width: bytes.readUInt16BE(offset + 5),
        height: bytes.readUInt16BE(offset + 3),
      };
    }

    offset += segmentLength;
  }

  return null;
}

async function validateInputImage() {
  const fileSize = (await stat(inputPath)).size;
  if (fileSize > MAX_FILE_BYTES) {
    throw new Error('Invalid entry.png: file is larger than the 1 MiB limit.');
  }

  const bytes = await readFile(inputPath);
  const dimensions = imageDimensions(bytes);
  if (!dimensions) {
    throw new Error('Invalid entry.png: expected a PNG or JPEG with readable dimensions.');
  }
  if (
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width > MAX_IMAGE_DIMENSION ||
    dimensions.height > MAX_IMAGE_DIMENSION
  ) {
    throw new Error('Invalid entry.png: image dimensions must be no larger than 1024x1024 pixels.');
  }
}

await validateInputImage();
await mkdir(outputDirectory, { recursive: true });
await copyFile(inputPath, outputPath);

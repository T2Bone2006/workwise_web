import { strToU8, zipSync, type Zippable } from 'fflate';

export type ZipFile = { name: string; bytes: Uint8Array };

// Photos and PDFs are already compressed: store them, and only squeeze the text.
const ALREADY_COMPRESSED = /\.(jpe?g|png|webp|pdf|zip)$/i;

export function zipFiles(files: ZipFile[]): Uint8Array {
  const zippable: Zippable = {};
  for (const file of files) {
    zippable[file.name] = [file.bytes, { level: ALREADY_COMPRESSED.test(file.name) ? 0 : 6 }];
  }
  return zipSync(zippable);
}

export function textFile(name: string, content: string): ZipFile {
  // The BOM (if any) is already in `content`; strToU8 encodes it as UTF-8.
  return { name, bytes: strToU8(content) };
}

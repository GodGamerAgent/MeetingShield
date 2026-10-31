import fs from "node:fs";
import path from "node:path";

// Precomputed CRC-32 table for standard ZIP archive creation
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  relPath: string;
  data: Buffer;
}

function collectExtensionFiles(dir: string, prefix = ""): ZipEntry[] {
  const entries: ZipEntry[] = [];
  if (!fs.existsSync(dir)) return entries;
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    if (item.name.startsWith(".")) continue;
    const fullPath = path.join(dir, item.name);
    const relPath = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) {
      entries.push(...collectExtensionFiles(fullPath, relPath));
    } else if (item.isFile()) {
      entries.push({
        relPath,
        data: fs.readFileSync(fullPath),
      });
    }
  }
  return entries;
}

export function resolveExtensionDir(): string {
  const candidates = [
    path.resolve(process.cwd(), "../extension"),
    path.resolve(process.cwd(), "extension"),
    "/app/applet/extension",
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "manifest.json"))) {
      return c;
    }
  }
  return candidates[0];
}

export function buildExtensionZipBuffer(): Buffer {
  const extDir = resolveExtensionDir();
  const files = collectExtensionFiles(extDir, "aura-meet-extension");

  const installGuide = `AURA-MEET Chrome Extension — Quick Installation Guide
=======================================================

1. Unzip this archive ("aura-meet-chrome-extension.zip") to a folder on your computer.
2. Open Google Chrome (or Brave / Edge) and navigate to:
   chrome://extensions
3. Enable "Developer mode" using the toggle switch in the top-right corner.
4. Click the "Load unpacked" button in the top-left corner.
5. Select the unzipped "aura-meet-extension" folder (the folder containing manifest.json).
6. Join any Google Meet, Zoom Web, or Microsoft Teams call — AURA-MEET will automatically detect the active meeting room and capture stereo 16kHz audio!
`;

  files.unshift({
    relPath: "aura-meet-extension/README-INSTALL.txt",
    data: Buffer.from(installGuide, "utf-8"),
  });

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.relPath, "utf-8");
    const dataBuf = file.data;
    const checksum = crc32(dataBuf);
    const size = dataBuf.length;

    // Local file header (30 bytes + file name)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed to extract (2.0)
    localHeader.writeUInt16LE(0, 6); // general purpose bit flag
    localHeader.writeUInt16LE(0, 8); // compression method: 0 = STORE (uncompressed)
    localHeader.writeUInt16LE(0, 10); // last mod file time
    localHeader.writeUInt16LE(0x5421, 12); // last mod file date
    localHeader.writeUInt32LE(checksum, 14); // crc-32
    localHeader.writeUInt32LE(size, 18); // compressed size
    localHeader.writeUInt32LE(size, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26); // file name length
    localHeader.writeUInt16LE(0, 28); // extra field length

    localParts.push(localHeader, nameBuf, dataBuf);

    // Central directory file header (46 bytes + file name)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // flags
    centralHeader.writeUInt16LE(0, 10); // compression method: STORE
    centralHeader.writeUInt16LE(0, 12); // mod time
    centralHeader.writeUInt16LE(0x5421, 14); // mod date
    centralHeader.writeUInt32LE(checksum, 16); // crc-32
    centralHeader.writeUInt32LE(size, 20); // compressed size
    centralHeader.writeUInt32LE(size, 24); // uncompressed size
    centralHeader.writeUInt16LE(nameBuf.length, 28); // file name length
    centralHeader.writeUInt16LE(0, 30); // extra field length
    centralHeader.writeUInt16LE(0, 32); // file comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal file attributes
    centralHeader.writeUInt32LE(0, 38); // external file attributes
    centralHeader.writeUInt32LE(offset, 42); // relative offset of local header

    centralParts.push(centralHeader, nameBuf);
    offset += 30 + nameBuf.length + size;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const endOfCentralDir = Buffer.alloc(22);
  endOfCentralDir.writeUInt32LE(0x06054b50, 0); // EOCD signature
  endOfCentralDir.writeUInt16LE(0, 4); // number of this disk
  endOfCentralDir.writeUInt16LE(0, 6); // disk where central directory starts
  endOfCentralDir.writeUInt16LE(files.length, 8); // number of central directory records on this disk
  endOfCentralDir.writeUInt16LE(files.length, 10); // total number of central directory records
  endOfCentralDir.writeUInt32LE(centralDirBuf.length, 12); // size of central directory
  endOfCentralDir.writeUInt32LE(offset, 16); // offset of start of central directory
  endOfCentralDir.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, centralDirBuf, endOfCentralDir]);
}

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

export function extensionVersion(): string {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(resolveExtensionDir(), "manifest.json"), "utf-8"));
    return manifest.version || "dev";
  } catch {
    return "dev";
  }
}

export function extensionZipName(): string {
  return `quorum-extension-v${extensionVersion()}.zip`;
}

// DOS date/time for "now", so unzipped files show when this copy was built
function dosDateTime(d = new Date()): { date: number; time: number } {
  return {
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
  };
}

// Built from the extension/ folder on every request, so the download always matches the current code.
export function buildExtensionZipBuffer(): Buffer {
  const extDir = resolveExtensionDir();
  const files = collectExtensionFiles(extDir, "quorum-extension");
  const { date: modDate, time: modTime } = dosDateTime();

  const installGuide = `Quorum Chrome Extension v${extensionVersion()} — Installation
==============================================

1. Unzip this archive to a folder you will keep (Chrome loads the extension from it).
2. Open chrome://extensions in Chrome, Brave or Edge.
3. Turn on "Developer mode" (top-right).
4. Click "Load unpacked" and select the unzipped "quorum-extension" folder (the one containing manifest.json).
   Updating? Remove the old Quorum/Quorum extension first, or click the reload icon on its card.
5. Pin Quorum to the toolbar.

Recording a meeting
- Open the meeting tab, click the Quorum icon, then "Start recording this tab"
  (or press Alt+Shift+R / Option+Shift+R, or right-click the icon → "Start / stop recording this tab").
- Stop it the same way when the meeting ends. Quorum transcribes and summarizes on your machine.
- The backend must be running: ./start.sh in the project folder (dashboard: http://localhost:3001).
`;

  files.unshift({
    relPath: "quorum-extension/README-INSTALL.txt",
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
    localHeader.writeUInt16LE(modTime, 10); // last mod file time
    localHeader.writeUInt16LE(modDate, 12); // last mod file date
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
    centralHeader.writeUInt16LE(modTime, 12); // mod time
    centralHeader.writeUInt16LE(modDate, 14); // mod date
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

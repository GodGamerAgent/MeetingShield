import { NextRequest, NextResponse } from "next/server";
import { buildExtensionZipBuffer, extensionZipName } from "@/lib/extension-packager";

// Every /api/* call is forwarded to the FastAPI backend, the single source of truth shared
// with the Chrome extension. Only the extension .zip download is served by Next itself.
const BACKEND = process.env.QUORUM_BACKEND_URL || "http://127.0.0.1:8000";

export const dynamic = "force-dynamic";

const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding", "content-encoding", "content-length", "host"]);

async function proxy(req: NextRequest, path: string[]) {
  if (req.method === "GET" && path.join("/") === "extension/download") {
    const zip = buildExtensionZipBuffer();
    return new NextResponse(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${extensionZipName()}"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  }

  const target = `${BACKEND}/api/${path.map(encodeURIComponent).join("/")}${new URL(req.url).search}`;
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });

  try {
    const hasBody = !["GET", "HEAD"].includes(req.method);
    const res = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      cache: "no-store",
      redirect: "manual",
    });
    const outHeaders = new Headers();
    res.headers.forEach((value, key) => {
      if (!HOP_BY_HOP.has(key.toLowerCase())) outHeaders.set(key, value);
    });
    return new NextResponse(res.body, { status: res.status, headers: outHeaders });
  } catch {
    return NextResponse.json(
      { detail: "Quorum backend is not reachable on port 8000. Start it with ./start.sh." },
      { status: 503 }
    );
  }
}

type Ctx = { params: { path: string[] } };
export const GET = (req: NextRequest, ctx: Ctx) => proxy(req, ctx.params.path || []);
export const POST = (req: NextRequest, ctx: Ctx) => proxy(req, ctx.params.path || []);
export const PUT = (req: NextRequest, ctx: Ctx) => proxy(req, ctx.params.path || []);
export const PATCH = (req: NextRequest, ctx: Ctx) => proxy(req, ctx.params.path || []);
export const DELETE = (req: NextRequest, ctx: Ctx) => proxy(req, ctx.params.path || []);

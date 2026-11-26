import { realpathSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { isWithinDir } from "./inventory.ts";

/** Fixed brotli settings specified by WEB_TOPS.md §7 (quality 11, window 22 bits). */
export const BROTLI_OPTIONS = {
  params: {
    [constants.BROTLI_PARAM_QUALITY]: 11,
    [constants.BROTLI_PARAM_LGWIN]: 22,
  },
} as const;

export interface StaticRequest {
  readonly method?: string | undefined;
  readonly url?: string | undefined;
  readonly headers: { readonly "accept-encoding"?: string | string[] | undefined };
}

export interface StaticResponse {
  writeHead(statusCode: number, headers: Readonly<Record<string, string | number>>): unknown;
  end(chunk?: string | Buffer): unknown;
}

export interface StaticServer {
  readonly origin: string;
  readonly port: number;
  readonly close: () => Promise<void>;
}

const MIME_TYPES = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
  [".wasm", "application/wasm"],
  [".txt", "text/plain; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
]);

/** MIME content type for a static `dist/` asset path. */
export function mimeType(filePath: string): string {
  return MIME_TYPES.get(extname(filePath).toLowerCase()) ?? "application/octet-stream";
}

function isBrToken(part: string): boolean {
  const [name, ...params] = part.trim().toLowerCase().split(";");
  if (name !== "br") return false;
  return !params.some((param) => param.trim() === "q=0");
}

/** Whether `Accept-Encoding` requests brotli (`br`) with a non-zero quality. */
export function acceptsBrotli(header: string | string[] | undefined): boolean {
  if (header === undefined) return false;
  const raw = Array.isArray(header) ? header.join(",") : header;
  return raw.split(",").some(isBrToken);
}

function rawPathOf(rawUrl: string): string {
  const query = rawUrl.indexOf("?");
  return query === -1 ? rawUrl : rawUrl.slice(0, query);
}

function decodePathname(rawUrl: string): string | undefined {
  try {
    const pathname = decodeURIComponent(rawPathOf(rawUrl));
    return pathname.includes("\0") ? undefined : pathname;
  } catch {
    return undefined;
  }
}

function safeSegments(pathname: string): string[] | undefined {
  const parts = pathname.split("/");
  return parts.some((part) => part === "." || part === "..") ? undefined : parts;
}

function isSafeFile(realRoot: string, candidate: string): string | undefined {
  const resolved = realpathSync(candidate);
  if (!isWithinDir(realRoot, resolved)) return undefined;
  return statSync(resolved).isFile() ? resolved : undefined;
}

function existingFile(realRoot: string, candidate: string): string | undefined {
  try {
    return isSafeFile(realRoot, candidate);
  } catch {
    return undefined;
  }
}

function candidatesFor(realRoot: string, parts: readonly string[]): string[] {
  const base = join(realRoot, ...parts);
  return [base, join(base, "index.html"), `${base}.html`];
}

type ServedLookup =
  { readonly kind: "ok"; readonly file: string } | { readonly kind: "bad" | "missing" };

function findCandidate(realRoot: string, parts: readonly string[]): ServedLookup {
  for (const candidate of candidatesFor(realRoot, parts)) {
    const found = existingFile(realRoot, candidate);
    if (found !== undefined) return { kind: "ok", file: found };
  }
  return { kind: "missing" };
}

function resolveServedFile(realRoot: string, rawUrl: string): ServedLookup {
  const pathname = decodePathname(rawUrl);
  if (pathname === undefined) return { kind: "bad" };
  const parts = safeSegments(pathname);
  return parts === undefined ? { kind: "bad" } : findCandidate(realRoot, parts);
}

function sendText(res: StaticResponse, status: number, text: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function sendFile(file: string, req: StaticRequest, res: StaticResponse): void {
  const raw = readFileSync(file);
  const br = acceptsBrotli(req.headers["accept-encoding"]);
  const body = br ? brotliCompressSync(raw, BROTLI_OPTIONS) : raw;
  res.writeHead(200, {
    "Content-Type": mimeType(file),
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    Vary: "Accept-Encoding",
    ...(br ? { "Content-Encoding": "br" } : {}),
  });
  res.end(body);
}

const LOOKUP_ERROR = { bad: [400, "Bad Request"], missing: [404, "Not Found"] } as const;

function handleLookup(resolved: ServedLookup, req: StaticRequest, res: StaticResponse): void {
  if (resolved.kind === "ok") {
    sendFile(resolved.file, req, res);
    return;
  }
  const [status, text] = LOOKUP_ERROR[resolved.kind];
  sendText(res, status, text);
}

const ALLOWED_METHODS = new Set(["GET", "HEAD"]);

export function handleRequest(realRoot: string, req: StaticRequest, res: StaticResponse): void {
  const method = req.method ?? "GET";
  if (!ALLOWED_METHODS.has(method)) {
    sendText(res, 405, "Method Not Allowed");
    return;
  }
  handleLookup(resolveServedFile(realRoot, req.url ?? ""), req, res);
}

export interface BindableServer {
  once(event: "error", listener: (error: Error) => void): unknown;
  listen(port: number, host: string, listener: () => void): unknown;
  address(): string | { readonly address: string; readonly port: number } | null;
  close(listener: () => void): unknown;
  closeAllConnections(): void;
}

function closeServer(server: BindableServer): () => Promise<void> {
  let closing: Promise<void> | undefined;
  return () => {
    if (closing !== undefined) return closing;
    closing = new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
      server.closeAllConnections();
    });
    return closing;
  };
}

/** Binds a `BindableServer` on `127.0.0.1` port `0` and fails closed on bind error or non-TCP address. */
export function listenStaticServer(server: BindableServer): Promise<StaticServer> {
  const close = closeServer(server);
  return new Promise<StaticServer>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") {
        void close().finally(() => {
          reject(new Error("failed to bind ephemeral loopback port"));
        });
        return;
      }
      resolve({ origin: `http://${addr.address}:${String(addr.port)}`, port: addr.port, close });
    });
  });
}

/** Starts a local static HTTP server on `127.0.0.1` ephemeral port `0` with fixed brotli support. */
export function startStaticServer(distDir: string): Promise<StaticServer> {
  const realRoot = realpathSync(distDir);
  const server = createServer((req, res) => {
    handleRequest(realRoot, req, res);
  });
  return listenStaticServer(server);
}

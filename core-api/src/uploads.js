require("./env").loadEnvFiles();

const { randomUUID } = require("node:crypto");
const { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } = require("node:fs");
const { basename, extname, resolve } = require("node:path");
const { corsHeaders, readRawBody } = require("./http");

const UPLOAD_DIR = resolve(process.env.CORE_API_UPLOAD_DIR || resolve(__dirname, "..", "uploads"));

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".opus": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime"
};

function ensureUploadDir() {
  mkdirSync(UPLOAD_DIR, { recursive: true });
}

function sanitizeFilename(fileName) {
  const fallback = "upload.bin";
  const normalized = basename(fileName || fallback)
    .replace(/[^\w.\-()\u4e00-\u9fa5]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || fallback;
}

function guessContentType(storedName, fallback = "application/octet-stream") {
  return MIME_BY_EXT[extname(storedName).toLowerCase()] || fallback;
}

function getPublicUploadUrl(req, urlPath) {
  const protocolHeader = req.headers["x-forwarded-proto"];
  const protocol = Array.isArray(protocolHeader)
    ? protocolHeader[0]
    : protocolHeader || "http";
  const host = req.headers.host || "127.0.0.1:4100";
  return `${protocol}://${host}${urlPath}`;
}

async function createUploadFromRequest(req, kind = "file") {
  ensureUploadDir();

  const rawNameHeader = req.headers["x-upload-filename"];
  const originalName = sanitizeFilename(
    typeof rawNameHeader === "string"
      ? decodeURIComponent(rawNameHeader)
      : `upload-${Date.now()}`
  );
  const body = await readRawBody(req);
  if (!body.length) {
    const uploadError = new Error("upload body is empty");
    uploadError.statusCode = 400;
    uploadError.code = "BAD_REQUEST";
    throw uploadError;
  }

  const extension = extname(originalName).toLowerCase();
  const storedName = `${kind}_${Date.now()}_${randomUUID().slice(0, 8)}${extension}`;
  const absolutePath = resolve(UPLOAD_DIR, storedName);
  writeFileSync(absolutePath, body);

  return {
    id: `upload_${randomUUID().slice(0, 8)}`,
    kind,
    originalName,
    storedName,
    sizeBytes: body.length,
    contentType: guessContentType(storedName, req.headers["content-type"] || undefined),
    urlPath: `/uploads/${storedName}`
  };
}

function createUploadFromBuffer({
  buffer,
  kind = "generated",
  originalName = "generated.bin",
  contentType,
}) {
  ensureUploadDir();

  const safeOriginalName = sanitizeFilename(originalName);
  const extension = extname(safeOriginalName).toLowerCase();
  const storedName = `${kind}_${Date.now()}_${randomUUID().slice(0, 8)}${extension}`;
  const absolutePath = resolve(UPLOAD_DIR, storedName);
  writeFileSync(absolutePath, buffer);

  return {
    id: `upload_${randomUUID().slice(0, 8)}`,
    kind,
    originalName: safeOriginalName,
    storedName,
    sizeBytes: buffer.length,
    contentType: contentType || guessContentType(storedName),
    urlPath: `/uploads/${storedName}`,
  };
}

function readUpload(fileName) {
  ensureUploadDir();

  const safeName = basename(fileName || "");
  if (!safeName) return null;

  const absolutePath = resolve(UPLOAD_DIR, safeName);
  if (!absolutePath.startsWith(UPLOAD_DIR) || !existsSync(absolutePath)) {
    return null;
  }

  return {
    absolutePath,
    safeName,
    sizeBytes: statSync(absolutePath).size,
    contentType: guessContentType(safeName)
  };
}

function readUploadByUrlPath(urlPath) {
  if (!urlPath || typeof urlPath !== "string") return null;
  if (!urlPath.startsWith("/uploads/")) return null;
  return readUpload(urlPath.slice("/uploads/".length));
}

function sendUpload(res, fileName) {
  const upload = readUpload(fileName);
  if (!upload) return false;

  const buffer = readFileSync(upload.absolutePath);
  res.writeHead(200, {
    "Content-Type": upload.contentType,
    "Content-Length": buffer.length,
    "Cache-Control": "public, max-age=3600",
    ...corsHeaders()
  });
  res.end(buffer);
  return true;
}

module.exports = {
  createUploadFromRequest,
  createUploadFromBuffer,
  getPublicUploadUrl,
  readUploadByUrlPath,
  sendUpload
};

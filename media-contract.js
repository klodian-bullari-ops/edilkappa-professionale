(function (root) {
  "use strict";

  const MIME_ALIASES = Object.freeze({
    "image/heic-sequence": "image/heic",
    "image/heif-sequence": "image/heif",
    "image/x-heic": "image/heic",
    "image/x-heif": "image/heif",
    "image/jpg": "image/jpeg",
    "video/x-quicktime": "video/quicktime"
  });

  const EXTENSION_TYPES = Object.freeze({
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
    mp4: "video/mp4",
    mov: "video/quicktime",
    m4v: "video/x-m4v",
    webm: "video/webm"
  });

  const SUPPORTED_MEDIA_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
    "video/mp4",
    "video/quicktime",
    "video/webm",
    "video/x-m4v"
  ]);

  function cleanMimeType(value) {
    const mimeType = String(value || "").trim().toLowerCase().split(";", 1)[0];
    return MIME_ALIASES[mimeType] || mimeType;
  }

  function extensionType(fileName) {
    const extension = String(fileName || "").split(".").pop()?.toLowerCase() || "";
    return EXTENSION_TYPES[extension] || "";
  }

  function inferredMimeType(file) {
    const explicitType = cleanMimeType(file?.type);
    if (explicitType && explicitType !== "application/octet-stream") return explicitType;
    return extensionType(file?.name);
  }

  function usableFiles(files) {
    return Array.from(files || []).filter((file) => file && Number(file.size || 0) > 0);
  }

  function selectedFiles(formFiles, rememberedFiles) {
    const submitted = usableFiles(formFiles);
    return submitted.length ? submitted : usableFiles(rememberedFiles);
  }

  function supportedMediaFile(file) {
    return SUPPORTED_MEDIA_TYPES.has(inferredMimeType(file));
  }

  root.EdilKappaMedia = Object.freeze({
    cleanMimeType,
    extensionType,
    inferredMimeType,
    selectedFiles,
    supportedMediaFile,
    usableFiles
  });
})(window);

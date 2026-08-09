"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  convertHeicBuffer,
  isHeicMimeType,
  prepareArchivedHeicPhotos,
  previewStoragePath
} = require("./photo-utils");

test("recognizes HEIC and creates a deterministic preview path beside the original", () => {
  const source = "organisations/edilkappa/documents/user-1/ai-123/Foto iOS.heic";
  const first = previewStoragePath(source);
  assert.equal(first, previewStoragePath(source));
  assert.match(first, /^organisations\/edilkappa\/documents\/user-1\/ai-123\/edilkappa-preview-[a-f0-9]{16}\.jpg$/);
  assert.equal(isHeicMimeType("IMAGE/HEIF"), true);
  assert.equal(isHeicMimeType("image/jpeg"), false);
});

test("reduces HEIC quality until the JPEG fits the preview limit", async () => {
  const qualities = [];
  const result = await convertHeicBuffer(Buffer.from("heic"), {
    maxBytes: 12,
    converter: async ({ quality }) => {
      qualities.push(quality);
      return Buffer.alloc(quality > 0.7 ? 20 : 10, 1);
    }
  });
  assert.equal(result.length, 10);
  assert.deepEqual(qualities, [0.82, 0.68]);
});

test("stores one protected JPEG preview and uses it as the AI image", async () => {
  const files = new Map();
  const sourcePath = "organisations/edilkappa/documents/user-1/ai-123/Foto.heic";
  files.set(sourcePath, { buffer: Buffer.from("source"), contentType: "image/heic" });
  const bucket = {
    file(path) {
      return {
        async getMetadata() {
          const item = files.get(path);
          if (!item) throw Object.assign(new Error("No such object"), { code: 404 });
          return [{ contentType: item.contentType, size: item.buffer.length }];
        },
        async download() {
          const item = files.get(path);
          if (!item) throw Object.assign(new Error("No such object"), { code: 404 });
          return [item.buffer];
        },
        async save(buffer, options) {
          files.set(path, { buffer: Buffer.from(buffer), contentType: options.metadata.contentType });
        }
      };
    }
  };
  const result = await prepareArchivedHeicPhotos({
    storageBucket: bucket,
    uid: "user-1",
    mediaReferences: [{ storagePath: sourcePath, fileName: "Foto.heic", fileType: "image/heic", fileSize: 6, kind: "image" }],
    converter: async () => Buffer.from("jpeg-preview")
  });
  assert.equal(result.mediaReferences[0].previewFileType, "image/jpeg");
  assert.match(result.mediaReferences[0].previewStoragePath, /edilkappa-preview-[a-f0-9]{16}\.jpg$/);
  assert.equal(result.attachments[0].sourceName, "Foto.heic");
  assert.match(result.attachments[0].dataUrl, /^data:image\/jpeg;base64,/);
});

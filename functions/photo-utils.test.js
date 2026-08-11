"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  convertHeicBuffer,
  describePreparedPhotoPreview,
  isHeicMimeType,
  prepareArchivedHeicPhotos,
  previewStoragePath,
  readPreparedPhotoPreviewChunk
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
    mediaReferences: [{ storagePath: sourcePath, fileName: "Foto.heic", fileType: "image/heic", fileSize: 6, kind: "image", photoOrigin: "sopralluogo_edilkappa" }],
    converter: async () => Buffer.from("jpeg-preview")
  });
  assert.equal(result.mediaReferences[0].previewFileType, "image/jpeg");
  assert.match(result.mediaReferences[0].previewStoragePath, /edilkappa-preview-[a-f0-9]{16}\.jpg$/);
  assert.equal(result.attachments[0].sourceName, "Foto.heic");
  assert.equal(result.attachments[0].photoOrigin, "sopralluogo_edilkappa");
  assert.match(result.attachments[0].dataUrl, /^data:image\/jpeg;base64,/);
});

test("returns ordinary archived JPEG photos through the authenticated preview channel", async () => {
  const buffer = Buffer.from("ordinary-jpeg-photo");
  const storagePath = "organisations/edilkappa/documents/user-1/ai-123/IMG_1914.jpeg";
  const bucket = {
    file(path) {
      assert.equal(path, storagePath);
      return {
        async getMetadata() { return [{ contentType: "image/jpeg", size: buffer.length }]; },
        async download() { return [buffer]; }
      };
    }
  };
  const result = await describePreparedPhotoPreview({
    storageBucket: bucket,
    prepared: {
      reference: {
        storagePath,
        previewStoragePath: storagePath,
        previewFileType: "image/jpeg"
      },
      buffer: null
    }
  });
  assert.equal(result.byteLength, buffer.length);
  assert.equal(result.mimeType, "image/jpeg");
  assert.deepEqual(Buffer.from(result.dataUrl.split(",")[1], "base64"), buffer);
});

test("reads a large archived photo in validated chunks instead of exposing a download URL", async () => {
  const buffer = Buffer.from("0123456789");
  const storagePath = "organisations/edilkappa/documents/user-1/ai-123/large.jpeg";
  const bucket = {
    file(path) {
      assert.equal(path, storagePath);
      return {
        async getMetadata() { return [{ contentType: "image/jpeg", size: buffer.length }]; },
        async download(options = {}) {
          if (options.start === undefined) return [buffer];
          return [buffer.subarray(options.start, options.end + 1)];
        }
      };
    }
  };
  const prepared = {
    reference: {
      storagePath,
      previewStoragePath: storagePath,
      previewFileType: "image/jpeg"
    },
    buffer: null
  };
  const description = await describePreparedPhotoPreview({ storageBucket: bucket, prepared, maxInlineBytes: 4, chunkBytes: 4 });
  assert.equal(description.dataUrl, "");
  assert.equal(description.chunkBytes, 4);
  const first = await readPreparedPhotoPreviewChunk({ storageBucket: bucket, prepared, offset: 0, chunkBytes: 4 });
  const second = await readPreparedPhotoPreviewChunk({ storageBucket: bucket, prepared, offset: first.nextOffset, chunkBytes: 4 });
  const third = await readPreparedPhotoPreviewChunk({ storageBucket: bucket, prepared, offset: second.nextOffset, chunkBytes: 4 });
  const rebuilt = Buffer.concat([first, second, third].map((item) => Buffer.from(item.chunkBase64, "base64")));
  assert.deepEqual(rebuilt, buffer);
  assert.equal(first.done, false);
  assert.equal(third.done, true);
  assert.equal(third.nextOffset, buffer.length);
});

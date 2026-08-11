"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

function loadMediaContract() {
  const previousWindow = global.window;
  global.window = {};
  const modulePath = require.resolve("../media-contract.js");
  delete require.cache[modulePath];
  require(modulePath);
  const contract = global.window.EdilKappaMedia;
  global.window = previousWindow;
  return contract;
}

test("normalizza i formati HEIC restituiti da iPhone", () => {
  const media = loadMediaContract();
  assert.equal(media.inferredMimeType({ name: "IMG_1001.HEIC", type: "image/heic", size: 10 }), "image/heic");
  assert.equal(media.inferredMimeType({ name: "IMG_1002.HEIC", type: "image/heic-sequence", size: 10 }), "image/heic");
  assert.equal(media.inferredMimeType({ name: "IMG_1003.heif", type: "image/x-heif", size: 10 }), "image/heif");
  assert.equal(media.inferredMimeType({ name: "IMG_1004.HEIC", type: "application/octet-stream", size: 10 }), "image/heic");
  assert.equal(media.inferredMimeType({ name: "IMG_1005.HEIC", type: "", size: 10 }), "image/heic");
});

test("recupera la selezione ricordata quando FormData perde i file", () => {
  const media = loadMediaContract();
  const remembered = [{ name: "IMG_1001.HEIC", type: "image/heic", size: 100 }];
  assert.deepEqual(media.selectedFiles([], remembered), remembered);
  assert.deepEqual(media.selectedFiles([{ name: "vuoto.heic", size: 0 }], remembered), remembered);
});

test("preferisce i file consegnati dal modulo ed esclude quelli vuoti", () => {
  const media = loadMediaContract();
  const submitted = [
    { name: "foto.jpeg", type: "image/jpeg", size: 200 },
    { name: "vuoto.jpeg", type: "image/jpeg", size: 0 }
  ];
  const remembered = [{ name: "vecchia.heic", type: "image/heic", size: 100 }];
  assert.deepEqual(media.selectedFiles(submitted, remembered), [submitted[0]]);
  assert.equal(media.supportedMediaFile({ name: "live.HEIC", type: "image/heic-sequence", size: 200 }), true);
  assert.equal(media.supportedMediaFile({ name: "archivio.zip", type: "application/zip", size: 200 }), false);
});

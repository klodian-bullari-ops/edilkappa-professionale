"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BACKUP_FORMAT_V2,
  buildRestorePlan,
  buildRestorePreview,
  decodeBackupValue,
  encodeBackupValue,
  inspectBackupPayload
} = require("./backup-core");

const collections = ["clients", "sites", "users"];

function payload(overrides = {}) {
  const rows = {
    clients: [{ id: "client-1", data: { name: "Condominio Il Giardino", createdAt: { __edilkappaBackupType: "timestamp", value: "2026-08-13T10:00:00.000Z", nanoseconds: 0 } } }],
    sites: [{ id: "site-1", data: { title: "Ripristino infiltrazione", value: 1200 } }]
  };
  return {
    format: BACKUP_FORMAT_V2,
    orgId: "edilkappa",
    generatedAt: "2026-08-13T12:00:00.000Z",
    recordCount: 2,
    collections: rows,
    ...overrides
  };
}

test("conserva timestamp, date, byte e valori annidati senza perdere il tipo", () => {
  const timestamp = { nanoseconds: 123000000, toDate: () => new Date("2026-08-13T10:00:00.123Z") };
  const encoded = encodeBackupValue({ timestamp, date: new Date("2026-08-13T11:00:00.000Z"), bytes: Buffer.from("EdilKappa"), nested: [{ ok: true }] });
  assert.equal(encoded.timestamp.__edilkappaBackupType, "timestamp");
  assert.equal(encoded.date.__edilkappaBackupType, "date");
  assert.equal(encoded.bytes.__edilkappaBackupType, "bytes");
  const decoded = decodeBackupValue(encoded, {
    timestamp: (iso, nanoseconds) => ({ iso, nanoseconds })
  });
  assert.deepEqual(decoded.timestamp, { iso: "2026-08-13T10:00:00.123Z", nanoseconds: 123000000 });
  assert.equal(decoded.date.toISOString(), "2026-08-13T11:00:00.000Z");
  assert.equal(decoded.bytes.toString(), "EdilKappa");
  assert.equal(decoded.nested[0].ok, true);
});

test("non trasforma una normale mappa latitude/longitude in GeoPoint", () => {
  class GeoPoint {
    constructor(latitude, longitude) { this.latitude = latitude; this.longitude = longitude; }
  }
  const encoded = encodeBackupValue({ ordinary: { latitude: 45.4, longitude: 9.2 }, point: new GeoPoint(45.4, 9.2) });
  assert.equal(encoded.ordinary.__edilkappaBackupType, undefined);
  assert.equal(encoded.point.__edilkappaBackupType, "geopoint");
  assert.throws(() => decodeBackupValue({ __edilkappaBackupType: "date", value: "non-una-data" }), /Data del backup non valida/);
});

test("legge anche i timestamp dei backup v1 già esistenti", () => {
  const decoded = decodeBackupValue({ _seconds: 1_700_000_000, _nanoseconds: 500_000_000 }, {
    timestampFromParts: (seconds, nanoseconds) => ({ seconds, nanoseconds })
  });
  assert.deepEqual(decoded, { seconds: 1_700_000_000, nanoseconds: 500_000_000 });
});

test("rifiuta raccolte inattese, ID pericolosi, duplicati e conteggi incoerenti", () => {
  const invalid = payload({
    recordCount: 99,
    collections: {
      clients: [
        { id: "bad/id", data: {} },
        { id: "duplicato", data: {} },
        { id: "duplicato", data: {} }
      ],
      secrets: [{ id: "secret-1", data: {} }]
    }
  });
  const result = inspectBackupPayload(invalid, { orgId: "edilkappa", allowedCollections: collections });
  assert.equal(result.valid, false);
  assert.match(result.issues.join(" "), /Raccolta non autorizzata/);
  assert.match(result.issues.join(" "), /Documento non valido/);
  assert.match(result.issues.join(" "), /Documento duplicato/);
  assert.match(result.issues.join(" "), /Conteggio record/);
});

test("costruisce un piano di ripristino tipizzato e non distruttivo", () => {
  const plan = buildRestorePlan(payload(), {
    orgId: "edilkappa",
    allowedCollections: collections,
    adapters: { timestamp: (iso) => `timestamp:${iso}` }
  });
  assert.equal(plan.recordCount, 2);
  assert.deepEqual(plan.collections, [
    { collection: "clients", records: 1 },
    { collection: "sites", records: 1 }
  ]);
  assert.equal(plan.operations[0].data.createdAt, "timestamp:2026-08-13T10:00:00.000Z");
});

test("l'anteprima confronta backup e archivio attuale prima della conferma", () => {
  const preview = buildRestorePreview(payload(), { clients: 3, sites: 1 }, {
    orgId: "edilkappa",
    allowedCollections: collections
  });
  assert.equal(preview.recordCount, 2);
  assert.deepEqual(preview.collections[0], { collection: "clients", records: 1, currentRecords: 3, difference: -2 });
  assert.deepEqual(preview.collections[1], { collection: "sites", records: 1, currentRecords: 1, difference: 0 });
});

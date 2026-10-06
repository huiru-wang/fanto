import assert from "node:assert/strict";
import test from "node:test";
import { parseSaveRecord } from "./content.js";

test("Record accepts a media-only entry", () => {
  assert.deepEqual(parseSaveRecord({
    text: "",
    media: [{ mediaId: "ce2f5608-b2ce-4c1e-a28e-cb0c225494d8" }],
  }), {
    text: "",
    media: [{ mediaId: "ce2f5608-b2ce-4c1e-a28e-cb0c225494d8" }],
  });
});

test("Record accepts one validated location", () => {
  assert.deepEqual(parseSaveRecord({
    text: "在外滩散步",
    media: [],
    location: { name: "外滩", latitude: 31.24001, longitude: 121.49032 },
  }).location, { name: "外滩", latitude: 31.24001, longitude: 121.49032 });
});

test("Record accepts structured administrative areas for a location", () => {
  assert.deepEqual(parseSaveRecord({
    text: "假期结束后回家",
    media: [],
    location: {
      name: "万科·金草公寓",
      countryCode: "cn",
      country: "中国",
      province: "浙江省",
      city: "杭州市",
      district: "上城区",
      latitude: 30.311147,
      longitude: 120.214973,
    },
  }).location, {
    name: "万科·金草公寓",
    countryCode: "cn",
    country: "中国",
    province: "浙江省",
    city: "杭州市",
    district: "上城区",
    latitude: 30.311147,
    longitude: 120.214973,
  });
});

test("Record rejects an invalid country code", () => {
  assert.throws(() => parseSaveRecord({
    text: "地点不对",
    media: [],
    location: { name: "外滩", countryCode: "CHN", latitude: 31.24001, longitude: 121.49032 },
  }));
});

test("Record rejects invalid location coordinates", () => {
  assert.throws(() => parseSaveRecord({
    text: "地点不对",
    media: [],
    location: { name: "外滩", latitude: 91, longitude: 121.49032 },
  }));
});

test("Record rejects an entry without text or media", () => {
  assert.throws(() => parseSaveRecord({ text: "  ", media: [] }));
});

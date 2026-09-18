const test = require("node:test");
const assert = require("node:assert/strict");
const {
  decodeXml,
  parseXmltv,
  parseXmltvDate
} = require("../server/epg");

test("parseXmltvDate converts XMLTV timestamps with timezone offsets", () => {
  assert.equal(
    parseXmltvDate("20260919120000 +0800"),
    "2026-09-19T04:00:00.000Z"
  );
});

test("parseXmltv returns current and next programmes for a channel", () => {
  const now = Date.parse("2026-09-19T04:30:00.000Z");
  const result = parseXmltv(
    [
      '<tv><programme channel="cctv1" start="20260919120000 +0800" stop="20260919130000 +0800">',
      "<title>新闻联播</title></programme>",
      '<programme channel="cctv1" start="20260919130000 +0800" stop="20260919140000 +0800">',
      "<title>焦点访谈</title></programme></tv>"
    ].join(""),
    now
  );

  assert.equal(result.cctv1.current.title, "新闻联播");
  assert.equal(result.cctv1.next.title, "焦点访谈");
});

test("decodeXml handles common XML entities and CDATA", () => {
  assert.equal(decodeXml("<![CDATA[英超 & 直播]]>"), "英超 & 直播");
});

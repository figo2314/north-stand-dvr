const { test, expect } = require("@playwright/test");

test("does not expose an unrevealed score in the browser", async ({ page }) => {
  await page.goto("/#home");
  await expect(page.locator(".recording-row")).toHaveCount(1);
  await expect(page.locator(".recording-result")).toContainText("比分已封存");
  await expect(page.locator("body")).not.toContainText("2 : 1");

  const state = await page.evaluate(async () => {
    const response = await fetch("/api/state");
    return response.json();
  });
  for (const recording of state.recordings) {
    if (recording.hasHiddenScore) {
      expect(recording.score).toBeNull();
    }
  }
});

test("keeps the player mask enabled and the layout inside the viewport", async ({
  page
}) => {
  await page.goto("/#home");
  await page.locator("[data-play]").first().click();
  await expect(page.locator("[data-player-layer]")).toBeVisible();
  await expect(page.locator("[data-score-shield]")).toBeVisible();
  await page.locator("[data-player-close]").click();

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(overflow).toBe(false);
});

test("cancel actions do not create an unintended fixture or reveal", async ({
  page
}) => {
  await page.goto("/#schedule");
  const before = await page.evaluate(async () => {
    const response = await fetch("/api/state");
    const state = await response.json();
    return {
      fixtures: state.fixtures.length,
      recordings: state.recordings.length
    };
  });

  await page
    .locator('[data-view-panel="schedule"] [data-open-schedule]')
    .click();
  await expect(page.locator("[data-schedule-dialog]")).toBeVisible();
  await page.locator("[data-schedule-dialog] [value=cancel]").first().click();
  await expect(page.locator("[data-schedule-dialog]")).not.toBeVisible();

  await page.goto("/#home");
  await page.locator("[data-reveal]").click();
  await expect(page.locator("[data-reveal-dialog]")).toBeVisible();
  await page.locator("[data-reveal-dialog] [value=cancel]").click();
  await expect(page.locator("[data-reveal-dialog]")).not.toBeVisible();

  await page.goto("/#home");
  await page.locator("[data-delete-recording]").first().click();
  await expect(page.locator("[data-delete-dialog]")).toBeVisible();
  await page.locator("[data-delete-dialog] [value=cancel]").click();
  await expect(page.locator("[data-delete-dialog]")).not.toBeVisible();

  const after = await page.evaluate(async () => {
    const response = await fetch("/api/state");
    const state = await response.json();
    return {
      fixtures: state.fixtures.length,
      recordings: state.recordings.length,
      score: state.recordings[0].score
    };
  });
  expect(after.fixtures).toBe(before.fixtures);
  expect(after.recordings).toBe(before.recordings);
  expect(after.score).toBeNull();
});

test("radar schedules and cancels an upcoming match", async ({ page }) => {
  let createdPayload = null;
  let deleted = false;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const group = `体育-明天${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(
    tomorrow.getDate()
  ).padStart(2, "0")}`;

  await page.route("**/api/state", async (route) => {
    await route.fulfill({
      json: {
        settings: { m3uUrl: "https://example.com/source.m3u" },
        fixtures: []
      }
    });
  });

  await page.route("**/api/sources/m3u", async (route) => {
    await route.fulfill({
      json: {
        count: 1,
        channels: [
          {
            id: "radar-match",
            name: "英超 阿森纳VS埃弗顿 23:59",
            group,
            streamUrl: "https://example.com/live"
          }
        ]
      }
    });
  });

  await page.route("**/api/fixtures", async (route) => {
    createdPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      json: { fixture: { id: "fixture-radar" } }
    });
  });

  await page.route("**/api/fixtures/fixture-radar", async (route) => {
    deleted = route.request().method() === "DELETE";
    await route.fulfill({ status: 204 });
  });

  await page.goto("/mockup.html");
  const scheduleButton = page.getByRole("button", { name: "预录这一场" });
  await expect(scheduleButton).toBeVisible();
  await scheduleButton.click();

  await expect(page.getByRole("button", { name: "取消预录" })).toBeVisible();
  expect(createdPayload).toMatchObject({
    home: "阿森纳",
    away: "埃弗顿",
    competition: "英超",
    streamUrl: "https://example.com/live",
    inputFormat: "hls"
  });

  await page.getByRole("button", { name: "取消预录" }).click();
  await expect(page.getByRole("button", { name: "预录这一场" })).toBeVisible();
  expect(deleted).toBe(true);
});

test("radar starts a replay recording for an ended match", async ({ page }) => {
  let replayPayload = null;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const group = `体育-昨天${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(
    yesterday.getDate()
  ).padStart(2, "0")}`;

  await page.route("**/api/state", async (route) => {
    await route.fulfill({
      json: {
        settings: { m3uUrl: "https://example.com/source.m3u" },
        fixtures: []
      }
    });
  });

  await page.route("**/api/sources/m3u", async (route) => {
    await route.fulfill({
      json: {
        count: 1,
        channels: [
          {
            id: "radar-replay",
            name: "西甲 巴塞罗那VS皇家马德里 全场回放 03:15",
            group,
            streamUrl: "https://example.com/replay"
          }
        ]
      }
    });
  });

  await page.route("**/api/replays", async (route) => {
    replayPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 202,
      json: { fixture: { id: "fixture-replay", status: "recording" } }
    });
  });

  await page.goto("/mockup.html");
  const replayButton = page.getByRole("button", { name: "录制回放" });
  await expect(replayButton).toBeVisible();
  await replayButton.click();

  await expect(page.getByRole("button", { name: "录制中…" })).toBeDisabled();
  expect(replayPayload).toMatchObject({
    home: "巴塞罗那",
    away: "皇家马德里",
    competition: "西甲",
    streamUrl: "https://example.com/replay",
    inputFormat: "hls"
  });
});

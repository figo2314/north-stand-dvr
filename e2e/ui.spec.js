const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.route("**/api/replays/available*", async (route) => {
    await route.fulfill({ json: { count: 0, replays: [] } });
  });
});

test("does not expose an unrevealed score in the browser", async ({ page }) => {
  await page.goto("/library.html");
  await expect(page.locator(".library-group-heading")).toContainText(
    "本地录像"
  );
  await expect(page.locator(".recording-row").first()).toBeVisible();
  expect(await page.locator(".recording-row").count()).toBeGreaterThan(0);
  await expect(page.locator(".recording-result").first()).toContainText("比分已封存");
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

test("home library shows only currently playable channel replays", async ({
  page
}) => {
  await page.setViewportSize({ width: 820, height: 900 });
  await page.route("**/api/replays/available*", async (route) => {
    await route.fulfill({
      json: {
        count: 1,
        replays: [
          {
            id: "replay-chelsea",
            channelId: "channel-chelsea-a",
            title: "英超 布伦特福德VS切尔西 全场回放",
            competition: "英超",
            playedAt: "2026-09-19T03:14:55.700Z",
            checkedAt: "2026-09-19T03:14:55.700Z",
            durationSeconds: 0,
            sizeBytes: 0,
            status: "ready",
            thumbnail:
              "https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=1200&q=82",
            mediaUrl: "/api/replays/channel-chelsea-a/stream",
            inputFormat: "hls",
            sourceType: "channel-replay",
            sourceLabel: "测试源",
            quality: "1080p",
            commentary: "颜强、贺宇、程思钦",
            variants: [
              {
                channelId: "channel-chelsea-a",
                label: "颜强、贺宇、程思钦",
                commentary: "颜强、贺宇、程思钦",
                quality: "1080p",
                streamUrl: "/api/replays/channel-chelsea-a/stream"
              },
              {
                channelId: "channel-chelsea-b",
                label: "江忠德",
                commentary: "江忠德",
                quality: "1080p",
                streamUrl: "/api/replays/channel-chelsea-b/stream"
              }
            ],
            variantCount: 2,
            watchedSeconds: 0,
            score: null
          }
        ]
      }
    });
  });

  await page.goto("/library.html");
  await expect(page.locator(".library-group-heading").first()).toContainText(
    "线上回放"
  );
  const replayRow = page.locator(".recording-row.is-channel-replay").first();
  await expect(replayRow).toBeVisible();
  await expect(replayRow).toContainText("布伦特福德VS切尔西");
  await expect(replayRow).toContainText("当前可回放");
  await expect(replayRow).toContainText("2 条可播线路");
  const actionHeights = await replayRow.evaluate((row) => {
    const nodes = [
      row.querySelector(".replay-variant-picker"),
      row.querySelector(".play-button"),
      row.querySelector(".subtle-button")
    ];
    return nodes.map((node) => node.getBoundingClientRect().height);
  });
  expect(Math.max(...actionHeights) - Math.min(...actionHeights)).toBeLessThan(1);
  await replayRow
    .locator("[data-replay-variant]")
    .selectOption("channel-chelsea-b");

  await replayRow.locator("[data-play]").click();
  await expect(page.locator("[data-player-layer]")).toBeVisible();
  await expect(page.locator("[data-player-title]")).toContainText(
    "布伦特福德VS切尔西"
  );
  await expect(page.locator("[data-player-subtitle]")).toContainText(
    "解说 江忠德"
  );
  await expect(page.locator("[data-player-reveal]")).toBeHidden();
});

test("keeps the player mask enabled and the layout inside the viewport", async ({
  page
}) => {
  await page.goto("/library.html");
  await page.locator("[data-play]").first().click();
  await expect(page.locator("[data-player-layer]")).toBeVisible();
  await expect(page.locator("[data-player-fullscreen]")).toBeVisible();
  await expect(
    page.locator(
      "[data-player-pip], [data-player-cast], [data-player-fullscreen]"
    )
  ).toHaveCount(3);
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

  await page.goto("/library.html");
  await page.locator("[data-reveal]").first().click();
  await expect(page.locator("[data-reveal-dialog]")).toBeVisible();
  await page.locator("[data-reveal-dialog] [value=cancel]").click();
  await expect(page.locator("[data-reveal-dialog]")).not.toBeVisible();

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

  await page.goto("/mockup.html", { waitUntil: "domcontentloaded" });
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

  await page.goto("/mockup.html", { waitUntil: "domcontentloaded" });
  await page.locator("[data-radar-league]").selectOption("all");
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

test("radar filters and searches matches", async ({ page }) => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateGroup = (prefix, date) =>
    `体育-${prefix}${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate()
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
        count: 2,
        channels: [
          {
            id: "radar-filter-upcoming",
            name: "英超 阿森纳VS埃弗顿 张路 23:59",
            group: dateGroup("明天", tomorrow),
            streamUrl: "https://example.com/upcoming"
          },
          {
            id: "radar-filter-ended",
            name: "西甲 巴塞罗那VS皇家马德里 03:15",
            group: dateGroup("昨天", yesterday),
            streamUrl: "https://example.com/ended"
          }
        ]
      }
    });
  });

  await page.goto("/mockup.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-radar-league]")).toHaveValue("英超");
  await expect(page.locator(".radar-match")).toHaveCount(1);
  await expect(page.locator(".radar-match")).toContainText("阿森纳");
  await page.locator("[data-radar-league]").selectOption("all");
  await expect(page.locator(".radar-match")).toHaveCount(2);

  await page.getByRole("button", { name: "待开赛", exact: true }).click();
  await expect(page.locator(".radar-match")).toHaveCount(1);
  await expect(page.locator(".radar-match")).toContainText("阿森纳");
  await expect(page.locator(".radar-match")).toContainText("解说：张路");

  await page.getByRole("button", { name: "全部", exact: true }).click();
  await page.locator("[data-radar-search]").fill("皇家马德里");
  await expect(page.locator(".radar-match")).toHaveCount(1);
  await expect(page.locator(".radar-match")).toContainText("巴塞罗那");
});

test("radar pins Arsenal highlight matches first", async ({ page }) => {
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
        count: 2,
        channels: [
          {
            id: "normal",
            name: "英超 曼城VS利物浦 20:00",
            group: "体育-今天09-19",
            streamUrl: "https://example.com/normal.m3u8"
          },
          {
            id: "arsenal",
            name: "英超 阿森纳VS切尔西 HIGHLIGHT 20:30",
            group: "体育-今天09-19",
            streamUrl: "https://example.com/arsenal.m3u8"
          }
        ]
      }
    });
  });
  await page.route("**/api/live/proxy*", async (route) => {
    await route.fulfill({ status: 204 });
  });

  await page.goto("/mockup.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".radar-match").first()).toContainText("HIGHLIGHT");
  await expect(page.locator(".radar-pin")).toContainText("ARSENAL HIGHLIGHT");
});

test("recording progress exposes live preview and recording actions", async ({
  page
}) => {
  const fixture = {
    id: "live-recording",
    home: "阿森纳",
    away: "埃弗顿",
    competition: "英超",
    kickoffAt: "2026-09-17T19:00:00.000Z",
    durationMinutes: 2,
    record: true,
    status: "recording",
    streamUrl: "https://example.com/live",
    inputFormat: "hls",
    recordingId: null,
    isDemo: false,
    result: null
  };
  const activeJob = {
    fixtureId: fixture.id,
    startedAt: "2026-09-17T19:00:00.000Z",
    outputPath: "/app/recordings/live.mp4",
    durationSeconds: 120,
    progressSeconds: 24,
    speed: "1.0x",
    previewUrl: "/api/fixtures/live-recording/preview"
  };
  const health = {
    ffmpeg: { available: true, path: "/usr/bin/ffmpeg" },
    disk: {
      totalBytes: 1000000,
      freeBytes: 750000,
      usedBytes: 250000,
      recordingDir: "/app/recordings"
    },
    activeJobs: [activeJob],
    lastSchedulerError: null
  };

  await page.route("**/api/state", async (route) => {
    await route.fulfill({
      json: {
        settings: { displayName: "北看台", m3uUrl: "" },
        fixtures: [fixture],
        recordings: [],
        health
      }
    });
  });
  await page.route("**/api/health", async (route) => {
    await route.fulfill({ json: health });
  });
  await page.route("**/api/fixtures/live-recording/preview*", async (route) => {
    await route.fulfill({ status: 204 });
  });

  await page.goto("/#schedule", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".schedule-row.is-recording")).toBeVisible();
  await expect(page.locator(".schedule-progress__meta")).toContainText("00:24 / 02:00");

  await page.locator("[data-preview-fixture]").click();
  await expect(page.locator("[data-preview-dialog]")).toBeVisible();
  await expect(page.locator("[data-preview-caption]")).toContainText("00:24 / 02:00");
  await page.locator("[data-preview-dialog] .button--secondary").click();
  await expect(page.locator("[data-preview-dialog]")).not.toBeVisible();

  await page.locator("[data-cancel-recording]").click();
  await expect(page.locator("[data-cancel-recording-dialog]")).toBeVisible();
  await page.locator("[data-cancel-recording-dialog] [value=cancel]").click();
  await expect(page.locator("[data-cancel-recording-dialog]")).not.toBeVisible();
});

test("runtime logs show recording failures with context", async ({ page }) => {
  await page.route("**/api/logs?*", async (route) => {
    await route.fulfill({
      json: {
        entries: [
          {
            id: "log-1",
            timestamp: "2026-09-18T01:20:00.000Z",
            level: "error",
            event: "recording.failed",
            message: "FFmpeg exited with code 1 signal SIGSEGV",
            fixtureId: "fixture-1",
            fixture: "巴列卡诺 vs 西班牙人",
            competition: "西甲"
          }
        ]
      }
    });
  });

  await page.goto("/#logs", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".runtime-log")).toHaveCount(1);
  await expect(page.locator(".runtime-log")).toContainText("录制失败");
  await expect(page.locator(".runtime-log")).toContainText("SIGSEGV");
  await expect(page.locator(".runtime-log")).toContainText("巴列卡诺 vs 西班牙人");
  await expect(page.locator('[data-log-count="error"]')).toContainText("错误 1");
  await page.locator("[data-log-search]").fill("不存在的内容");
  await expect(page.locator(".runtime-log")).toHaveCount(0);
  await page.locator("[data-log-search]").fill("SIGSEGV");
  await expect(page.locator(".runtime-log")).toHaveCount(1);
});

test("channel page renders non-football groups and searches channels", async ({
  page
}) => {
  const probePayloads = [];
  await page.route("**/api/state", async (route) => {
    await route.fulfill({
      json: {
        settings: { m3uUrl: "https://example.com/source.m3u" },
        fixtures: [],
        recordings: [],
        health: {}
      }
    });
  });
  await page.route("**/api/channels", async (route) => {
    await route.fulfill({
      json: {
        count: 4,
        sources: [{ id: "test", label: "测试源", count: 4, error: null }],
        epgUrls: ["https://example.com/guide.xml"],
        channels: [
          {
            id: "cctv-1",
            healthKey: "cctv-1-health",
            name: "CCTV1",
            tvgId: "cctv1",
            group: "央视",
            streamUrl: "https://example.com/cctv1.m3u8"
          },
          {
            id: "satellite-1",
            healthKey: "satellite-1-health",
            name: "湖南卫视",
            group: "卫视",
            streamUrl: "https://example.com/hunan.m3u8",
            health: {
              checkedAt: new Date().toISOString(),
              playable: true,
              quality: "720p",
              latencyMs: 120,
              history: [
                {
                  checkedAt: new Date().toISOString(),
                  playable: true,
                  latencyMs: 120,
                  quality: "720p"
                }
              ]
            }
          },
          {
            id: "satellite-2",
            healthKey: "satellite-2-health",
            name: "浙江卫视",
            group: "卫视",
            streamUrl: "https://example.com/zhejiang.m3u8"
          },
          {
            id: "sports-1",
            healthKey: "sports-1-health",
            name: "足球频道",
            group: "体育-今天09-18",
            streamUrl: "https://example.com/football.m3u8"
          }
        ]
      }
    });
  });
  await page.route("**/api/epg", async (route) => {
    await route.fulfill({
      json: {
        channels: {
          cctv1: {
            current: {
              title: "新闻联播",
              start: "2026-09-19T04:00:00.000Z",
              stop: "2026-09-19T05:00:00.000Z"
            },
            next: null
          }
        },
        errors: []
      }
    });
  });
  await page.route("**/api/live/proxy*", async (route) => {
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/channels/probe", async (route) => {
    probePayloads.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        ok: true,
        message: "Stream #0:0: Video: h264, 1280x720"
      }
    });
  });

  await page.goto("/channels.html", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: /全部 3/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "预检列表" })).toBeVisible();
  await page.getByRole("button", { name: /全部 3/ }).click();
  await expect(page.locator(".channel-row")).toHaveCount(3);
  await expect(page.locator("[data-channel-list]")).not.toContainText("足球频道");
  await expect(page.locator("[data-channel-list]")).toContainText("新闻联播");

  await page.locator("[data-channel-search]").fill("湖南");
  await expect(page.locator(".channel-row")).toHaveCount(1);
  await expect(page.locator(".channel-row")).toContainText("湖南卫视");
  await expect(page.locator(".channel-quality-tag")).toContainText("720p");
  await expect(page.locator(".channel-quality-tag")).toHaveClass(/is-playable/);
  await expect(page.locator("[data-channel-summary]")).toContainText("可播 1");
  expect(probePayloads.some((payload) => payload.healthKey)).toBe(true);

  await page.locator("[data-channel-info]").click();
  await expect(page.locator("[data-channel-detail-dialog]")).toBeVisible();
  await expect(page.locator("[data-channel-detail-title]")).toContainText(
    "湖南卫视"
  );
  await expect(page.locator("[data-channel-detail-body]")).toContainText(
    "线路趋势"
  );
  await page
    .locator("[data-channel-detail-dialog]")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await expect(page.locator("[data-channel-detail-dialog]")).not.toBeVisible();

  const hunanRow = page.locator(".channel-row").filter({ hasText: "湖南卫视" });
  await hunanRow.locator("[data-favorite-channel]").click();
  await expect(
    hunanRow.locator("[data-favorite-channel]")
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "收藏 1" }).click();
  await expect(page.locator(".channel-row")).toHaveCount(1);
  await expect(page.locator(".channel-row")).toContainText("湖南卫视");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "收藏 1" }).click();
  await expect(page.locator(".channel-row")).toHaveCount(1);
  await expect(page.locator(".channel-row")).toContainText("湖南卫视");
});

test("mobile tab bar navigates between the primary views", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#home", { waitUntil: "domcontentloaded" });

  await expect(page.locator(".mobile-tabbar")).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/library\.html$/),
    page.locator(".mobile-tab[data-mobile-tab='library']").click()
  ]);
  await expect(page.locator("[data-recording-list]")).toBeVisible();
  await expect(page.locator(".mobile-tab[data-mobile-tab='library']")).toHaveClass(
    /is-active/
  );

  await Promise.all([
    page.waitForURL(/#settings$/),
    page.locator(".mobile-tab[data-mobile-tab='settings']").click()
  ]);
  await expect(page.locator('[data-view-panel="settings"]')).toBeVisible();
  await expect(page.locator(".mobile-tab[data-mobile-tab='settings']")).toHaveClass(
    /is-active/
  );
  await expect(page.getByRole("button", { name: "运行日志" })).toBeVisible();

  await page.goto("/channels.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".mobile-tab[aria-current='page']")).toContainText(
    "直播"
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(overflow).toBe(false);
});

test("mobile home shows a compact launcher and opens the recording library", async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#home", { waitUntil: "domcontentloaded" });

  await expect(page.locator(".home-mobile-launcher")).toBeVisible();
  await expect(
    page.locator(".home-mobile-launcher [data-mobile-library-open]")
  ).toContainText("看球");
  await expect(
    page.locator(".home-entry-grid [data-mobile-library-open] small")
  ).toContainText("回放");
  await expect(
    page.locator('.home-entry-grid a[href="/mockup.html"] small')
  ).toContainText("赛程");
  await expect(page.locator(".home-mobile-launcher")).not.toContainText(
    "待看录像"
  );
  await expect(page.locator(".mobile-arsenal-strip")).toContainText("ARSENAL");
  await expect(page.locator(".mobile-music-toggle")).toBeVisible();
  await expect(
    page.locator(".home-live-entry:not(.home-live-entry--football)")
  ).toContainText("电视直播");
  await expect(
    page.locator(".home-launcher-quick [data-open-tv-dialog]")
  ).toBeVisible();
  await expect(page.locator(".home-live-entry--football")).toContainText(
    "足球直播"
  );
  const liveHeights = await page
    .locator(".home-live-entry")
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  expect(Math.abs(liveHeights[0] - liveHeights[1])).toBeLessThan(1);
  await expect(
    page.locator('[data-view-panel="home"] > .page-header')
  ).toContainText("早上好");
  await Promise.all([
    page.waitForURL(/\/library\.html$/),
    page.locator("[data-mobile-library-open]").click()
  ]);
  await expect(page.locator(".home-mobile-launcher")).toBeHidden();
  await expect(page.locator("[data-mobile-library-back]")).toBeVisible();
  await expect(page.locator("[data-recording-list]")).toBeVisible();

  await Promise.all([
    page.waitForURL(/\/#home$/),
    page.locator("[data-mobile-library-back]").click()
  ]);
  await expect(page.locator(".home-mobile-launcher")).toBeVisible();
});

test("mobile home keeps primary actions above the tab bar", async ({ page }) => {
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 390, height: 844 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/#home", { waitUntil: "domcontentloaded" });

    const layout = await page.evaluate(() => {
      const quick = document.querySelector(".home-launcher-quick");
      const tabbar = document.querySelector(".mobile-tabbar");
      return {
        quickBottom: quick.getBoundingClientRect().bottom,
        tabbarTop: tabbar.getBoundingClientRect().top,
        overflow:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth
      };
    });

    expect(layout.overflow).toBe(false);
    expect(layout.quickBottom).toBeLessThanOrEqual(layout.tabbarTop);
    expect(layout.tabbarTop - layout.quickBottom).toBeLessThanOrEqual(40);
  }
});

test("home Arsenal anthem is bundled and can be played or paused", async ({
  page
}) => {
  const assetResponse = await page.request.get(
    "/audio/the-angel-north-london-forever.m4a"
  );
  expect(assetResponse.ok()).toBe(true);
  expect(assetResponse.headers()["content-type"]).toContain("audio");
  const secondAssetResponse = await page.request.get(
    "/audio/north-london-forever-2.mp3"
  );
  expect(secondAssetResponse.ok()).toBe(true);
  expect(secondAssetResponse.headers()["content-type"]).toContain("audio");

  await page.goto("/#home", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".rail-arsenal-strip")).toContainText(
    "NORTH LONDON FOREVER"
  );

  const musicToggle = page.locator(".rail-music-toggle");
  const musicLabel = page.locator(".rail-music-toggle [data-music-label]");
  await expect(page.locator("[data-home-music]")).toHaveAttribute(
    "src",
    "/audio/the-angel-north-london-forever.m4a"
  );
  await page.mouse.click(8, 8);
  await expect(musicToggle).toHaveAttribute("aria-pressed", "true");
  await expect(musicLabel).toHaveText("暂停队歌");
  await expect
    .poll(() =>
      page.locator("[data-home-music]").evaluate((audio) => audio.muted)
    )
    .toBe(false);

  await page.locator("[data-home-music]").evaluate((audio) => {
    audio.dispatchEvent(new Event("ended"));
  });
  await expect(page.locator("[data-home-music]")).toHaveAttribute(
    "src",
    "/audio/north-london-forever-2.mp3"
  );
  await expect(page.locator("[data-home-music]")).toHaveAttribute(
    "data-music-index",
    "1"
  );

  await page.locator("[data-home-music]").evaluate((audio) => {
    audio.dispatchEvent(new Event("ended"));
  });
  await expect(page.locator("[data-home-music]")).toHaveAttribute(
    "src",
    "/audio/the-angel-north-london-forever.m4a"
  );
  await expect(page.locator("[data-home-music]")).toHaveAttribute(
    "data-music-index",
    "0"
  );
  await page.mouse.click(8, 8);
  await expect(musicToggle).toHaveAttribute("aria-pressed", "true");

  await musicToggle.click();
  await expect(musicToggle).toHaveAttribute("aria-pressed", "false");
  await expect(musicLabel).toHaveText("播放队歌");

  await musicToggle.click();
  await expect(musicToggle).toHaveAttribute("aria-pressed", "true");
  await expect(musicLabel).toHaveText("暂停队歌");
});

test("home shows the server app version", async ({ page }) => {
  const response = await page.request.get("/api/health");
  expect(response.ok()).toBe(true);
  const health = await response.json();
  expect(health.version).toMatch(/^\d+\.\d+\.\d+\+[a-f0-9]{8}$/);

  await page.goto("/#home", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-app-version]")).toHaveText(health.version);
});

test("music resumes after switching to another page", async ({ page }) => {
  await page.goto("/#home", { waitUntil: "domcontentloaded" });
  await page.mouse.click(8, 8);
  await expect(page.locator(".rail-music-toggle")).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  await Promise.all([
    page.waitForURL("**/channels.html"),
    page.locator('.rail-nav a[href="/channels.html"]').click()
  ]);

  const globalMusic = page.locator("[data-global-music]");
  await expect(globalMusic).toHaveCount(1);
  await page.mouse.click(8, 8);
  await expect
    .poll(() => globalMusic.evaluate((audio) => audio.paused))
    .toBe(false);

  const state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("north-stand-music-state") || "null")
  );
  expect(state.playing).toBe(true);
  expect(state.userPaused).toBe(false);
});

test("home rotates Arsenal championship backdrops with a fade", async ({
  page
}) => {
  const backdropUrls = [
    "/images/home-arsenal-trophy.webp",
    "/images/home-arsenal-champions-poster.webp",
    "/images/home-arsenal-champions-squad.webp",
    "/images/home-arsenal-ribbon-trophy.webp",
    "/images/home-arsenal-confetti-celebration.webp",
    "/images/home-arsenal-red-confetti.webp",
    "/images/home-arsenal-legends-trophy.webp"
  ];
  for (const url of backdropUrls) {
    const response = await page.request.get(url);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/webp");
  }

  await page.clock.install();
  await page.goto("/#home", { waitUntil: "domcontentloaded" });
  const backdrop = page.locator("[data-home-backdrop]");
  await expect(backdrop).toBeVisible();
  await expect(backdrop.locator("[data-home-backdrop-layer]")).toHaveCount(7);
  await expect(backdrop).toHaveAttribute("data-backdrop-index", "0");
  await expect(backdrop.locator(".home-backdrop__layer.is-active")).toHaveClass(
    /home-backdrop__layer--trophy/
  );
  await expect
    .poll(() =>
      backdrop
        .locator(".home-backdrop__layer.is-active")
        .evaluate((node) => getComputedStyle(node).backgroundImage)
    )
    .toContain("/images/home-arsenal-trophy.webp");

  const backdropClasses = [
    "home-backdrop__layer--poster",
    "home-backdrop__layer--squad",
    "home-backdrop__layer--ribbon-trophy",
    "home-backdrop__layer--confetti-celebration",
    "home-backdrop__layer--red-confetti",
    "home-backdrop__layer--legends-trophy"
  ];
  for (const [index, className] of backdropClasses.entries()) {
    await page.clock.fastForward(9_000);
    await expect(backdrop).toHaveAttribute(
      "data-backdrop-index",
      String(index + 1)
    );
    await expect(backdrop.locator(".home-backdrop__layer.is-active")).toHaveClass(
      new RegExp(className)
    );
    if (index === 0) {
      await expect
        .poll(() =>
          backdrop
            .locator(".home-backdrop__layer.is-active")
            .evaluate((node) => getComputedStyle(node).transitionDuration)
        )
        .toContain("2.2s");
    }
  }
});

test("channel page uses an immersive layout in mobile landscape", async ({
  page
}) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.route("**/api/state", async (route) => {
    await route.fulfill({
      json: {
        settings: { m3uUrl: "" },
        fixtures: [],
        recordings: [],
        health: {}
      }
    });
  });
  await page.route("**/api/channels", async (route) => {
    await route.fulfill({
      json: {
        count: 1,
        sources: [{ id: "landscape", label: "横屏源", count: 1, error: null }],
        channels: [
          {
            id: "landscape-channel",
            healthKey: "landscape-channel-health",
            name: "横屏测试频道",
            group: "测试",
            streamUrl: "https://example.com/landscape.m3u8"
          }
        ]
      }
    });
  });
  await page.route("**/api/live/proxy*", async (route) => {
    await route.fulfill({ status: 204 });
  });

  await page.goto("/channels.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".channel-header")).toBeHidden();
  await expect(page.locator(".channel-browser")).toBeHidden();
  await expect(page.locator(".mobile-tabbar")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "横屏播放" })
  ).toBeVisible();
  const stage = await page.locator("[data-channel-stage]").boundingBox();
  expect(stage.height).toBeGreaterThan(380);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(overflow).toBe(false);
});

test("settings manage multiple channel sources", async ({ page }) => {
  const sources = [
    {
      id: "myiptv-ipv4",
      label: "myIPTV",
      url: "https://example.com/myiptv.m3u",
      fallbackUrl: "",
      enabled: true,
      builtIn: true,
      priority: 100
    }
  ];
  const posts = [];

  await page.route("**/api/channel-sources", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { sources } });
      return;
    }
    const payload = route.request().postDataJSON();
    posts.push(payload);
    const existing = sources.find((source) => source.id === payload.id);
    if (existing) {
      Object.assign(existing, payload);
    } else {
      sources.push({
        ...payload,
        id: "custom-source",
        builtIn: false
      });
    }
    await route.fulfill({ json: { source: sources.at(-1) } });
  });
  await page.route("**/api/channel-sources/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    const index = sources.findIndex((source) => source.id === id);
    if (index >= 0) {
      sources.splice(index, 1);
    }
    await route.fulfill({ status: 204 });
  });

  await page.goto("/#settings", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-channel-source-list]")).toContainText(
    "myIPTV"
  );

  await page.locator("[data-channel-source-label]").fill("备用源");
  await page
    .locator("[data-channel-source-url]")
    .fill("https://example.com/backup.m3u");
  await page.locator("[data-channel-source-priority]").fill("80");
  await page.getByRole("button", { name: "添加直播源" }).click();

  await expect(page.locator("[data-channel-source-list]")).toContainText("备用源");
  expect(posts[0]).toMatchObject({
    label: "备用源",
    url: "https://example.com/backup.m3u",
    priority: 80
  });

  await page
    .locator("[data-channel-source-toggle='myiptv-ipv4']")
    .click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1]).toMatchObject({
    id: "myiptv-ipv4",
    enabled: false
  });
});

test("PWA manifest and service worker are available", async ({ page }) => {
  const manifestResponse = await page.request.get("/site.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest.name).toBe("北看台");
  expect(manifest.display).toBe("standalone");
  expect(manifest.shortcuts).toHaveLength(4);

  await page.goto("/#home", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(async () => {
    if (!("serviceWorker" in navigator)) {
      return false;
    }
    return Boolean(await navigator.serviceWorker.getRegistration("/"));
  });
});

test("Apple TV playlist settings expose and test the read-only subscription", async ({
  page
}) => {
  await page.route("**/api/tv/config", async (route) => {
    await route.fulfill({
      json: {
        token: "tv-token",
        playlistUrl:
          "http://192.168.50.62:4173/api/tv/playlist.m3u?token=tv-token",
        epgUrl: "http://192.168.50.62:4173/api/tv/epg.xml?token=tv-token"
      }
    });
  });
  await page.route("**/api/tv/playlist.m3u*", async (route) => {
    await route.fulfill({
      contentType: "audio/x-mpegurl",
      body: [
        "#EXTM3U",
        '#EXTINF:-1,TVB翡翠台 1080P',
        "http://example.com/jade.m3u8",
        '#EXTINF:-1,CCTV1',
        "http://example.com/cctv.m3u8"
      ].join("\n")
    });
  });

  await page.goto("/#settings", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-tv-playlist-url]")).toHaveValue(
    /api\/tv\/playlist\.m3u/
  );
  await expect(page.locator("[data-tv-token]")).toHaveValue("tv-token");
  await page.getByRole("button", { name: "测试订阅" }).click();
  await expect(page.locator("[data-toast-region]")).toContainText("2 个频道");

  await page.goto("/#home", { waitUntil: "domcontentloaded" });
  await page
    .locator(".home-mobile-launcher [data-open-tv-dialog]")
    .click();
  await expect(page.locator("[data-tv-dialog]")).toBeVisible();
  await expect(page.locator("[data-tv-dialog-playlist]")).toHaveValue(
    /api\/tv\/playlist\.m3u/
  );
});

test("channel page opens TVB Jade by default when available", async ({ page }) => {
  await page.route("**/api/channels", async (route) => {
    await route.fulfill({
      json: {
        count: 2,
        sources: [{ id: "test", label: "测试源", count: 2, error: null }],
        epgUrls: [],
        channels: [
          {
            id: "cctv-first",
            healthKey: "cctv-first",
            name: "CCTV1",
            group: "央视",
            streamUrl: "https://example.com/cctv.m3u8"
          },
          {
            id: "jade-offline",
            healthKey: "jade-offline",
            name: "TVB翡翠台 1080P",
            group: "港澳台频道",
            streamUrl: "https://example.com/jade.m3u8",
            health: {
              checkedAt: new Date().toISOString(),
              playable: false,
              quality: "离线",
              height: 1080,
              latencyMs: 120
            }
          }
        ]
      }
    });
  });
  await page.route("**/api/live/proxy*", async (route) => {
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/channels/probe", async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        message: "Video: h264, 1920x1080"
      }
    });
  });

  await page.goto("/channels.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-channel-title]")).toContainText("TVB翡翠台");
  await expect(
    page.locator("[data-channel-group-filter='港澳台频道']")
  ).toContainText("港澳台频道");
});

test("lineup page renders a confirmed formation", async ({ page }) => {
  const players = (prefix) =>
    Array.from({ length: 11 }, (_, index) => ({
      id: `${prefix}-${index}`,
      name: `${prefix}球员${index + 1}`,
      number: index + 1,
      position: index === 0 ? "G" : "P",
      grid: index === 0 ? "1:1" : `${Math.min(4, Math.floor(index / 4) + 2)}:${index % 4 + 1}`
    }));
  await page.route("**/api/state", async (route) => {
    await route.fulfill({
      json: {
        settings: {},
        fixtures: [
          {
            id: "lineup-fixture",
            home: "阿森纳",
            away: "切尔西",
            competition: "英超",
            kickoffAt: "2026-09-19T14:00:00.000Z",
            lineup: {
              status: "confirmed",
              provider: "thesportsdb",
              home: {
                name: "Arsenal",
                formation: "4-3-3",
                startXI: players("主队"),
                substitutes: []
              },
              away: {
                name: "Chelsea",
                formation: "4-2-3-1",
                startXI: players("客队"),
                substitutes: []
              }
            }
          }
        ],
        recordings: [],
        health: {}
      }
    });
  });

  await page.goto("/lineup.html?id=lineup-fixture", {
    waitUntil: "domcontentloaded"
  });
  await expect(page.locator("[data-lineup-status]")).toContainText("官方首发");
  await expect(page.locator("[data-lineup-home-formation]")).toContainText(
    "4-3-3"
  );
  await expect(page.locator("[data-lineup-home-pitch] .lineup-player")).toHaveCount(
    11
  );
  await expect(page.locator("[data-lineup-away-pitch] .lineup-player")).toHaveCount(
    11
  );
});

test("channel list virtualizes large catalogs", async ({ page }) => {
  const channels = Array.from({ length: 220 }, (_, index) => ({
    id: `virtual-${index}`,
    healthKey: `virtual-${index}`,
    name: `虚拟频道 ${index + 1}`,
    group: "压力测试",
    streamUrl: `https://example.com/virtual-${index}.m3u8`
  }));
  await page.route("**/api/channels", async (route) => {
    await route.fulfill({
      json: {
        count: channels.length,
        sources: [
          {
            id: "virtual",
            label: "虚拟源",
            count: channels.length,
            error: null
          }
        ],
        epgUrls: [],
        channels
      }
    });
  });
  await page.route("**/api/channels/probe", async (route) => {
    await route.fulfill({
      json: { ok: true, message: "Video: h264, 1280x720" }
    });
  });
  await page.route("**/api/live/proxy*", async (route) => {
    await route.fulfill({ status: 204 });
  });

  await page.goto("/channels.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-source-state].is-ready")).toBeVisible();
  expect(await page.locator(".channel-row").count()).toBeLessThan(60);

  await page.locator("[data-channel-list]").evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await page.waitForTimeout(150);
  expect(await page.locator(".channel-row").count()).toBeLessThan(60);
  await expect(page.locator("[data-channel-list]")).toContainText(
    "虚拟频道 220"
  );
});

test("football live page only lists football channels", async ({ page }) => {
  await page.route("**/api/channels", async (route) => {
    await route.fulfill({
      json: {
        count: 4,
        sources: [{ id: "test", label: "测试源", count: 4, error: null }],
        epgUrls: [],
        channels: [
          {
            id: "arsenal-highlight",
            healthKey: "arsenal-highlight",
            name: "阿森纳 HIGHLIGHT 英超集锦",
            group: "体育-今天",
            streamUrl: "https://example.com/arsenal-highlight.m3u8"
          },
          {
            id: "football-live",
            healthKey: "football-live",
            name: "英超 阿森纳VS埃弗顿 23:59",
            group: "体育-今天",
            streamUrl: "https://example.com/football-live.m3u8"
          },
          {
            id: "football-replay",
            healthKey: "football-replay",
            name: "西甲 巴塞罗那VS皇家马德里 全场回放",
            group: "体育-昨天",
            streamUrl: "https://example.com/football-replay.m3u8"
          },
          {
            id: "general-channel",
            healthKey: "general-channel",
            name: "湖南卫视",
            group: "卫视",
            streamUrl: "https://example.com/hunan.m3u8"
          }
        ]
      }
    });
  });
  await page.route("**/api/channels/probe", async (route) => {
    await route.fulfill({
      json: { ok: true, message: "Video: h264, 1280x720" }
    });
  });
  await page.route("**/api/live/proxy*", async (route) => {
    await route.fulfill({ status: 204 });
  });

  await page.goto("/football.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-source-state].is-ready")).toBeVisible();
  await expect(page.locator("[data-channel-list]")).toContainText("阿森纳");
  await expect(page.locator(".channel-pin").first()).toContainText("ARSENAL");
  await expect(page.locator(".channel-row").first()).toContainText("HIGHLIGHT");
  await expect(page.locator("[data-channel-list]")).toContainText("全场回放");
  await expect(page.locator("[data-channel-list]")).not.toContainText("湖南卫视");
  await expect(page.locator("[data-channel-title]")).toContainText("HIGHLIGHT");
});

test("football replay exposes a draggable seek bar", async ({ page }) => {
  await page.route("**/api/channels", async (route) => {
    await route.fulfill({
      json: {
        count: 1,
        sources: [{ id: "test", label: "测试源", count: 1, error: null }],
        epgUrls: [],
        channels: [
          {
            id: "football-replay",
            healthKey: "football-replay",
            name: "西甲 巴塞罗那VS皇家马德里 全场回放",
            group: "体育-昨天",
            streamUrl: "https://example.com/football-replay.m3u8"
          }
        ]
      }
    });
  });
  await page.route("**/api/channels/probe", async (route) => {
    await route.fulfill({
      json: { ok: true, message: "Video: h264, 1280x720" }
    });
  });
  await page.route("**/api/live/proxy*", async (route) => {
    await route.fulfill({ status: 204 });
  });

  await page.goto("/football.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-source-state].is-ready")).toBeVisible();
  await page.locator('[data-channel-id="football-replay"]').click();

  await page.locator("[data-channel-video]").evaluate((video) => {
    let currentTime = 120;
    Object.defineProperty(video, "duration", {
      configurable: true,
      get: () => 5400
    });
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => currentTime,
      set: (value) => {
        currentTime = Number(value) || 0;
      }
    });
    video.dispatchEvent(new Event("durationchange"));
    video.dispatchEvent(new Event("timeupdate"));
  });

  const progress = page.locator("[data-channel-replay-progress]");
  await expect(progress).toBeVisible();
  await expect(page.locator("[data-channel-progress-current]")).toHaveText(
    "02:00"
  );
  await expect(page.locator("[data-channel-progress-duration]")).toHaveText(
    "1:30:00"
  );

  await page.locator("[data-channel-seek]").evaluate((seek) => {
    seek.value = "3600";
    seek.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect
    .poll(() =>
      page.locator("[data-channel-video]").evaluate((video) => video.currentTime)
    )
    .toBe(3600);
  await expect(page.locator("[data-channel-progress-current]")).toHaveText(
    "1:00:00"
  );
});

test("fullscreen playback collapses controls until pointer activity", async ({
  page
}) => {
  await page.route("**/api/live/proxy*", async (route) => {
    await route.fulfill({ status: 204 });
  });

  await page.goto("/football.html", { waitUntil: "domcontentloaded" });
  await page.locator("[data-channel-fullscreen]").click();
  await page.waitForFunction(() => Boolean(document.fullscreenElement));

  const panel = page.locator(".channel-player-panel");
  await page.evaluate(() => {
    document.querySelector("[data-channel-message]").hidden = true;
    document
      .querySelector(".channel-player-panel")
      .dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
  });

  await expect(panel).toHaveClass(/is-controls-hidden/, { timeout: 5_000 });
  await expect(page.locator(".channel-player-controls")).toBeHidden();

  await panel.evaluate((node) => {
    node.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
  });
  await expect(panel).not.toHaveClass(/is-controls-hidden/);
  await expect(page.locator(".channel-player-controls")).toBeVisible();
});

test("football channel list wraps long match titles in every layout", async ({
  page
}) => {
  await page.route("**/api/channels", async (route) => {
    await route.fulfill({
      json: {
        count: 1,
        sources: [{ id: "test", label: "测试源", count: 1, error: null }],
        epgUrls: [],
        channels: [
          {
            id: "tablet-long-title",
            healthKey: "tablet-long-title",
            name: "英超 布伦特福德VS切尔西 全场回放（颜强、贺宇、程思钦） 02:45",
            group: "体育-今天09-19",
            streamUrl: "https://example.com/tablet-long-title.m3u8"
          }
        ]
      }
    });
  });
  await page.route("**/api/live/proxy*", async (route) => {
    await route.fulfill({ status: 204 });
  });

  await page.goto("/football.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-source-state].is-ready")).toBeVisible();

  const title = page.locator(".channel-row__copy strong").first();
  for (const viewport of [
    { width: 420, height: 900 },
    { width: 820, height: 1180 },
    { width: 1440, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(100);
    const styles = await title.evaluate((node) => {
      const computed = getComputedStyle(node);
      return {
        whiteSpace: computed.whiteSpace,
        lineClamp: computed.webkitLineClamp,
        lineHeight: Number.parseFloat(computed.lineHeight),
        height: node.getBoundingClientRect().height,
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight
      };
    });
    expect(styles.whiteSpace).toBe("normal");
    expect(styles.lineClamp).toBe("2");
    expect(styles.scrollHeight).toBeLessThanOrEqual(styles.clientHeight + 1);

    await expect(page.locator(".channel-row").first()).toHaveCSS(
      "height",
      "124px"
    );
    await expect(page.locator(".channel-virtual-spacer")).toHaveAttribute(
      "style",
      /height:\s*124px/
    );
  }
});

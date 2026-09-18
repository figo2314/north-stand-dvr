(() => {
  "use strict";

  const STORAGE_KEY = "north-stand-radar-scheduled";

  function normalizeScheduledEntry(value) {
    if (typeof value === "string") {
      return {
        fixtureId: value,
        kind: "scheduled",
        status: "scheduled"
      };
    }
    if (
      value &&
      typeof value === "object" &&
      (value.fixtureId === null || typeof value.fixtureId === "string")
    ) {
      return {
        fixtureId: value.fixtureId,
        kind: value.kind === "replay" ? "replay" : "scheduled",
        status: typeof value.status === "string" ? value.status : "scheduled"
      };
    }
    return null;
  }

  function readScheduledMatches() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
      if (Array.isArray(saved)) {
        return new Map();
      }
      if (saved && typeof saved === "object") {
        const entries = Object.entries(saved)
          .map(([matchId, value]) => [matchId, normalizeScheduledEntry(value)])
          .filter(([matchId, entry]) => typeof matchId === "string" && entry);
        return new Map(entries);
      }
    } catch {
      // Ignore a malformed local checkpoint and fall back to an empty schedule.
    }
    return new Map();
  }

  const app = {
    channels: [],
    matches: [],
    filter: "all",
    league: "英超",
    query: "",
    hls: null,
    liveMatch: null,
    liveStatsTimer: null,
    settings: null,
    scheduled: readScheduledMatches()
  };

  const $ = (selector, root = document) => root.querySelector(selector);

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function refreshIcons() {
    window.lucide?.createIcons({
      attrs: {
        "aria-hidden": "true"
      }
    });
  }

  function toast(title, message = "", type = "success") {
    const item = document.createElement("div");
    item.className = `toast${type === "error" ? " is-error" : ""}`;
    item.innerHTML = `
      <i data-lucide="${type === "error" ? "circle-alert" : "circle-check"}"></i>
      <div>
        <strong>${escapeHtml(title)}</strong>
        ${message ? `<span>${escapeHtml(message)}</span>` : ""}
      </div>
    `;
    $("[data-toast-region]").append(item);
    refreshIcons();
    window.setTimeout(() => item.remove(), 3800);
  }

  function parseGroupDate(group) {
    const match = group.match(/(昨天|今天|明天)(\d{2})-(\d{2})/);
    if (!match) {
      return null;
    }
    const date = new Date();
    if (match[1] === "昨天") date.setDate(date.getDate() - 1);
    if (match[1] === "明天") date.setDate(date.getDate() + 1);
    date.setMonth(Number(match[2]) - 1, Number(match[3]));
    return date;
  }

  function parseChannel(channel) {
    if (!channel.group.startsWith("体育-")) {
      return null;
    }

    const timeMatch = channel.name.match(/(\d{2}):(\d{2})\s*$/);
    const versusIndex = channel.name.toUpperCase().indexOf("VS");
    if (!timeMatch || versusIndex < 0) {
      return null;
    }

    const beforeTeams = channel.name.slice(0, versusIndex).trim();
    const afterTeams = channel.name.slice(versusIndex + 2).trim();
    const beforeParts = beforeTeams.split(/\s+/);
    const feedText = afterTeams
      .replace(/\s*\d{2}:\d{2}\s*$/, "")
      .trim();
    const awayParts = feedText.split(/\s+/);
    const league = beforeParts.shift() || "足球";
    const home = beforeParts.join(" ") || "主队";
    const away = awayParts.shift() || "客队";
    const remainingFeed = awayParts.join(" ").trim();
    const replayMatch = remainingFeed.match(/^(.+?)（(.+)）$/);
    const isOriginalFeed = /(原声|字幕|智能解说)/.test(remainingFeed);
    const feed = replayMatch
      ? replayMatch[1].trim()
      : remainingFeed && isOriginalFeed
        ? remainingFeed
        : "中文解说";
    const commentator = replayMatch
      ? replayMatch[2].trim()
      : remainingFeed && !isOriginalFeed
        ? remainingFeed
        : "";
    const groupDate = parseGroupDate(channel.group);
    if (!groupDate) {
      return null;
    }

    groupDate.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
    const endAt = new Date(groupDate.getTime() + 150 * 60_000);
    const now = new Date();
    const status =
      now >= groupDate && now <= endAt
        ? "live"
        : now < groupDate
          ? "upcoming"
          : "ended";

    return {
      ...channel,
      league,
      home,
      away,
      feed,
      commentator,
      kickoffAt: groupDate,
      endAt,
      status
    };
  }

  function formatDate(date) {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      weekday: "short"
    }).format(date);
  }

  function formatRelative(date, status) {
    if (status === "live") {
      const elapsed = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
      return `已进行约 ${elapsed} 分钟`;
    }
    if (status === "ended") {
      return "录像已就绪";
    }

    const minutes = Math.max(0, Math.round((date.getTime() - Date.now()) / 60_000));
    if (minutes < 60) {
      return `${minutes} 分钟后`;
    }
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return `${hours} 小时${rest ? ` ${rest} 分` : ""}后`;
  }

  function teamColor(name) {
    const colors = [
      "oklch(0.5 0.18 25)",
      "oklch(0.48 0.13 255)",
      "oklch(0.5 0.12 153)",
      "oklch(0.52 0.12 305)",
      "oklch(0.55 0.13 70)"
    ];
    const hash = Array.from(name).reduce((sum, char) => sum + char.codePointAt(0), 0);
    return colors[hash % colors.length];
  }

  function statusCopy(status) {
    if (status === "live") return "正在直播";
    if (status === "upcoming") return "即将开始";
    return "已结束可回看";
  }

  function persistScheduledMatches() {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(app.scheduled))
    );
  }

  function durationForLeague(league) {
    return /(杯|欧冠|欧联|欧协|淘汰)/.test(league) ? 180 : 150;
  }

  function sourceLabel(match) {
    return `${match.feed || "中文解说"}${match.commentator ? ` · ${match.commentator}` : ""}`;
  }

  function renderLeagueOptions() {
    const select = $("[data-radar-league]");
    const leagues = [
      ...new Set(app.matches.map((match) => match.league).filter(Boolean))
    ].sort((left, right) => left.localeCompare(right, "zh-CN"));
    if (!leagues.includes("英超")) {
      leagues.unshift("英超");
    }
    if (app.league !== "all" && !leagues.includes(app.league)) {
      app.league = "英超";
    }
    select.innerHTML = [
      '<option value="all">全部赛事</option>',
      ...leagues.map(
        (league) =>
          `<option value="${escapeHtml(league)}">${escapeHtml(league)}</option>`
      )
    ].join("");
    select.value = app.league;
  }

  function renderMatches() {
    const list = $("[data-match-list]");
    const order = { live: 0, upcoming: 1, ended: 2 };
    const query = app.query.trim().toLocaleLowerCase("zh-CN");
    const matches = [...app.matches]
      .filter((match) => app.filter === "all" || match.status === app.filter)
      .filter(
        (match) => app.league === "all" || match.league === app.league
      )
      .filter((match) => {
        if (!query) {
          return true;
        }
        return `${match.home} ${match.away} ${match.league} ${match.feed} ${match.commentator} ${match.name} ${match.group}`
          .toLocaleLowerCase("zh-CN")
          .includes(query);
      })
      .sort((a, b) => {
        const statusDiff = order[a.status] - order[b.status];
        return statusDiff || a.kickoffAt - b.kickoffAt;
      });

    if (!app.matches.length) {
      list.innerHTML = `
        <div class="radar-empty">
          <i data-lucide="radar"></i>
          <h3>当前源里没有比赛条目</h3>
          <p>体育分组更新后会重新出现在这里。</p>
        </div>
      `;
      refreshIcons();
      return;
    }

    if (!matches.length) {
      list.innerHTML = `
        <div class="radar-empty">
          <i data-lucide="search-x"></i>
          <h3>没有符合条件的比赛</h3>
          <p>换个球队、赛事或状态再试试。</p>
        </div>
      `;
      refreshIcons();
      return;
    }

    list.innerHTML = matches
      .map((match) => {
        const action = app.scheduled.get(match.id);
        const hasAction = Boolean(action);
        const isRecording = action?.status === "recording";
        let canAct = true;
        let actionLabel = "";

        if (match.status === "ended") {
          if (!action) {
            actionLabel = "录制回放";
          } else if (action.status === "recorded") {
            actionLabel = "回放已入库";
            canAct = false;
          } else {
            actionLabel = "录制中…";
            canAct = false;
          }
        } else if (action) {
          if (action.status === "recorded") {
            actionLabel = "已录制";
            canAct = false;
          } else {
            actionLabel = isRecording ? "录制中…" : "取消预录";
            canAct = !isRecording;
          }
        } else {
          actionLabel = match.status === "live" ? "立即录制" : "预录这一场";
        }

        return `
          <article class="radar-match is-${match.status}" data-match-id="${escapeHtml(match.id)}">
            <div class="radar-time">
              <strong>${String(match.kickoffAt.getHours()).padStart(2, "0")}:${String(
                match.kickoffAt.getMinutes()
              ).padStart(2, "0")}</strong>
              <span>${escapeHtml(formatDate(match.kickoffAt))}</span>
            </div>
            <div class="radar-match__main">
              <div class="radar-match__league">
                <span>${escapeHtml(match.league)}</span>
                <span aria-hidden="true">·</span>
                <span>${escapeHtml(statusCopy(match.status))}</span>
                <span aria-hidden="true">·</span>
                <span>${escapeHtml(formatRelative(match.kickoffAt, match.status))}</span>
              </div>
              <div class="radar-match__teams">
                <span class="team-mark" style="--team-color:${teamColor(match.home)}">${escapeHtml(
                  match.home.slice(0, 1)
                )}</span>
                <strong>${escapeHtml(match.home)} vs ${escapeHtml(match.away)}</strong>
                <span class="team-mark" style="--team-color:${teamColor(match.away)}">${escapeHtml(
                  match.away.slice(0, 1)
                )}</span>
              </div>
            </div>
            <div class="radar-match__channel">
              <strong>${escapeHtml(match.feed || "中文解说")}</strong>
              <span>${escapeHtml(
                match.commentator ? `解说：${match.commentator}` : match.group
              )}</span>
            </div>
            <div class="radar-actions">
              <a
                class="radar-watch"
                href="/lineup.html?id=${encodeURIComponent(match.fixtureId || match.id)}"
              >
                <i data-lucide="shirt"></i>
                首发阵容
              </a>
              <button
                class="radar-watch"
                type="button"
                data-watch-live="${escapeHtml(match.id)}"
                ${match.status === "upcoming" ? "disabled" : ""}
              >
                <i data-lucide="play"></i>
                ${match.status === "live" ? "看直播" : match.status === "ended" ? "看回放" : "未开赛"}
              </button>
              <button
                class="radar-record${hasAction ? " is-added" : ""}"
                type="button"
                data-schedule-match="${escapeHtml(match.id)}"
                aria-pressed="${hasAction}"
                ${canAct ? "" : "disabled"}
              >
                ${actionLabel}
              </button>
            </div>
          </article>
        `;
      })
      .join("");
    refreshIcons();
  }

  function renderSummary() {
    const live = app.matches.filter((match) => match.status === "live").length;
    const upcoming = app.matches.filter((match) => match.status === "upcoming").length;
    $("[data-live-count]").textContent = live;
    $("[data-upcoming-count]").textContent = upcoming;
    $("[data-source-count]").textContent = app.channels.length;

    const next = app.matches
      .filter((match) => match.status === "upcoming")
      .sort((a, b) => a.kickoffAt - b.kickoffAt)[0];
    const current = app.matches.find((match) => match.status === "live");
    const title = $("[data-hero-title]");
    const copy = $("[data-hero-copy]");

    if (current) {
      title.textContent = `正在直播：${current.home} vs ${current.away}`;
      copy.textContent = "比赛仍在进行，比分和赛果保持隐藏。可以先预录，结束后自动进入待看录像。";
    } else if (next) {
      title.textContent = `下一场：${next.home} vs ${next.away}`;
      copy.textContent = `${formatDate(next.kickoffAt)} ${String(next.kickoffAt.getHours()).padStart(
        2,
        "0"
      )}:${String(next.kickoffAt.getMinutes()).padStart(2, "0")} 开球，距离现在约 ${formatRelative(
        next.kickoffAt,
        next.status
      )}。`;
    } else {
      title.textContent = "当前没有待开赛的比赛";
      copy.textContent = "已结束的条目可以直接录制回放，完成后会进入待看录像。";
    }
    refreshIcons();
  }

  function reconcileScheduledMatches(fixtures) {
    const fixturesById = new Map(
      fixtures
        .filter((fixture) => typeof fixture.id === "string")
        .map((fixture) => [fixture.id, fixture])
    );
    const failedStatuses = new Set([
      "failed",
      "missed",
      "needs-source",
      "ffmpeg-unavailable"
    ]);

    for (const [matchId, action] of app.scheduled) {
      const fixture = fixturesById.get(action.fixtureId);
      if (!fixture || failedStatuses.has(fixture.status)) {
        app.scheduled.delete(matchId);
        continue;
      }
      action.status = fixture.status || "scheduled";
    }
    persistScheduledMatches();
  }

  async function loadSource() {
    const state = $("[data-source-state]");
    state.className = "mock-source-state is-loading";
    state.innerHTML = '<i data-lucide="loader-circle"></i>正在读取直播源';
    refreshIcons();

    try {
      const stateResponse = await fetch("/api/state").catch(() => null);
      let sourceUrl = "";
      if (stateResponse?.ok) {
        const statePayload = await stateResponse.json();
        app.settings = statePayload.settings || null;
        sourceUrl = String(statePayload.settings?.m3uUrl || "").trim();
        reconcileScheduledMatches(statePayload.fixtures || []);
      }
      if (!sourceUrl) {
        throw new Error("请先在设置中填写 M3U 直播源");
      }

      const response = await fetch("/api/sources/m3u", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sourceUrl })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "直播源读取失败");
      }
      app.channels = payload.channels;
      app.matches = payload.channels.map(parseChannel).filter(Boolean);
      renderLeagueOptions();
      state.className = "mock-source-state is-ready";
      state.innerHTML = `<i data-lucide="circle-check"></i>源站已更新 · ${payload.count} 个频道`;
      renderSummary();
      renderMatches();
      refreshIcons();
    } catch (error) {
      state.className = "mock-source-state is-error";
      state.innerHTML = `<i data-lucide="triangle-alert"></i>${escapeHtml(error.message)}`;
      refreshIcons();
      toast("无法读取比赛雷达", error.message, "error");
    }
  }

  async function toggleSchedule(matchId, button) {
    const match = app.matches.find((item) => item.id === matchId);
    if (!match) {
      return;
    }

    const action = app.scheduled.get(matchId);
    const fixtureId = action?.fixtureId;
    button.disabled = true;
    button.textContent = action
      ? "正在取消…"
      : match.status === "ended"
        ? "正在启动回放…"
        : "正在安排…";

    try {
      if (action) {
        if (action.kind === "replay") {
          return;
        }
        if (fixtureId) {
          const response = await fetch(
            `/api/fixtures/${encodeURIComponent(fixtureId)}`,
            { method: "DELETE" }
          );
          if (!response.ok && response.status !== 404) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || `取消失败，HTTP ${response.status}`);
          }
        }
        app.scheduled.delete(matchId);
        toast("已取消预录", `${match.home} vs ${match.away}`);
      } else if (match.status === "ended") {
        const response = await fetch("/api/replays", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            home: match.home,
            away: match.away,
            competition: match.league,
            kickoffAt: match.kickoffAt.toISOString(),
            durationMinutes: durationForLeague(match.league),
            streamUrl: match.streamUrl,
            inputFormat: "hls",
            sourceLabel: sourceLabel(match)
          })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || `回放启动失败，HTTP ${response.status}`);
        }
        app.scheduled.set(matchId, {
          fixtureId: payload.fixture.id,
          kind: "replay",
          status: payload.fixture.status || "recording"
        });
        toast("已开始录制回放", `${match.home} vs ${match.away}`);
      } else {
        const response = await fetch("/api/fixtures", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            home: match.home,
            away: match.away,
            competition: match.league,
            kickoffAt: match.kickoffAt.toISOString(),
            durationMinutes: durationForLeague(match.league),
            record: true,
            streamUrl: match.streamUrl,
            inputFormat: "hls",
            sourceLabel: sourceLabel(match)
          })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || `安排失败，HTTP ${response.status}`);
        }
        app.scheduled.set(matchId, {
          fixtureId: payload.fixture.id,
          kind: "scheduled",
          status: payload.fixture.status || "scheduled"
        });
        toast("已加入录制日程", `${match.home} vs ${match.away}`);
      }

      persistScheduledMatches();
      renderMatches();
    } catch (error) {
      toast("操作失败", error.message, "error");
      renderMatches();
    }
  }

  function formatBitrate(value) {
    const bits = Number(value) || 0;
    if (bits >= 1_000_000) {
      return `${(bits / 1_000_000).toFixed(bits >= 10_000_000 ? 0 : 1)} Mbps`;
    }
    if (bits >= 1_000) {
      return `${Math.round(bits / 1_000)} Kbps`;
    }
    return "速度检测中";
  }

  function applyLiveMask() {
    const mask = app.settings?.mask || {};
    const shield = $("[data-live-shield]");
    shield.style.setProperty("--live-mask-x", `${Number(mask.x) || 3.5}%`);
    shield.style.setProperty("--live-mask-y", `${Number(mask.y) || 3}%`);
    shield.style.setProperty("--live-mask-width", `${Number(mask.width) || 37}%`);
    shield.style.setProperty("--live-mask-height", `${Number(mask.height) || 11}%`);
    shield.style.setProperty("--live-mask-color", mask.color || "#05070a");
  }

  function updateLiveButton() {
    const video = $("[data-live-video]");
    $("[data-live-toggle]").innerHTML = `<i data-lucide="${
      video.paused ? "play" : "pause"
    }"></i>`;
    refreshIcons();
  }

  function updateLiveStats() {
    const video = $("[data-live-video]");
    const hls = app.hls;
    const network = hls?.bandwidthEstimate || 0;
    const level =
      hls && hls.currentLevel >= 0 ? hls.levels[hls.currentLevel] : null;
    $("[data-live-speed]").textContent = [
      `实时 ${formatBitrate(network)}`,
      level?.height ? `${level.height}p` : ""
    ]
      .filter(Boolean)
      .join(" · ");

    let buffer = 0;
    for (let index = 0; index < video.buffered.length; index += 1) {
      if (
        video.buffered.start(index) <= video.currentTime &&
        video.buffered.end(index) >= video.currentTime
      ) {
        buffer = Math.max(0, video.buffered.end(index) - video.currentTime);
        break;
      }
    }
    $("[data-live-buffer]").textContent = `缓冲 ${buffer.toFixed(1)} 秒`;
    if (level) {
      $("[data-live-quality]").value = String(hls.currentLevel);
    }
  }

  function renderLiveQuality(levels) {
    const select = $("[data-live-quality]");
    select.innerHTML = [
      '<option value="-1">自动</option>',
      ...levels.map((level, index) => {
        const label = `${level.height ? `${level.height}p` : `线路 ${index + 1}`} · ${formatBitrate(
          level.bitrate
        )}`;
        return `<option value="${index}">${escapeHtml(label)}</option>`;
      })
    ].join("");
  }

  function destroyLivePlayer() {
    window.clearInterval(app.liveStatsTimer);
    app.liveStatsTimer = null;
    app.hls?.destroy();
    app.hls = null;
    app.liveMatch = null;
    const video = $("[data-live-video]");
    video.pause();
    video.removeAttribute("src");
    video.load();
    $("[data-live-message]").hidden = true;
  }

  function openLivePlayer(matchId) {
    const match = app.matches.find((item) => item.id === matchId);
    if (!match) {
      return;
    }
    destroyLivePlayer();
    app.liveMatch = match;
    $("[data-live-title]").textContent = `${match.home} vs ${match.away} · ${
      match.feed || "中文解说"
    }${match.commentator ? ` · ${match.commentator}` : ""}`;
    applyLiveMask();
    const dialog = $("[data-live-dialog]");
    if (!dialog.open) {
      dialog.showModal();
    }
    const video = $("[data-live-video]");
    const message = $("[data-live-message]");
    message.hidden = false;
    message.querySelector("strong").textContent = "正在连接直播源";
    message.querySelector("p").textContent = "首次连接可能需要几秒钟。";
    const source = `/api/live/proxy?url=${encodeURIComponent(match.streamUrl)}`;

    if (window.Hls?.isSupported()) {
      const hls = new window.Hls({
        enableWorker: true,
        lowLatencyMode: true,
        liveSyncDurationCount: 3,
        maxBufferLength: 30,
        backBufferLength: 30,
        maxLiveSyncPlaybackRate: 1.5,
        abrEwmaDefaultEstimate: 8_000_000
      });
      app.hls = hls;
      hls.loadSource(source);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, (_, data) => {
        renderLiveQuality(data.levels || []);
        if (data.levels?.length) {
          hls.currentLevel = data.levels.length - 1;
        }
        video.play().catch(() => {});
        updateLiveStats();
      });
      hls.on(window.Hls.Events.LEVEL_SWITCHED, updateLiveStats);
      hls.on(window.Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) {
          return;
        }
        message.hidden = false;
        message.querySelector("strong").textContent = "直播连接中断";
        message.querySelector("p").textContent = "正在尝试恢复播放。";
        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
        } else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          destroyLivePlayer();
          message.hidden = false;
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = source;
      video.play().catch(() => {});
    } else {
      message.querySelector("strong").textContent = "浏览器不支持 HLS 直播";
      message.querySelector("p").textContent = "请使用最新版 Chrome、Edge 或 Safari。";
      return;
    }

    video.addEventListener(
      "canplay",
      () => {
        message.hidden = true;
        updateLiveButton();
        updateLiveStats();
      },
      { once: true }
    );
    app.liveStatsTimer = window.setInterval(updateLiveStats, 1000);
  }

  function toggleLivePlayback() {
    const video = $("[data-live-video]");
    if (video.paused) {
      if (
        app.hls?.liveSyncPosition &&
        Math.abs(video.currentTime - app.hls.liveSyncPosition) > 20
      ) {
        video.currentTime = app.hls.liveSyncPosition;
      }
      video.play().catch(() => {});
    } else {
      video.pause();
    }
    updateLiveButton();
  }

  document.addEventListener("click", (event) => {
    const scheduleButton = event.target.closest("[data-schedule-match]");
    if (scheduleButton) {
      toggleSchedule(scheduleButton.dataset.scheduleMatch, scheduleButton);
      return;
    }
    const watchButton = event.target.closest("[data-watch-live]");
    if (watchButton) {
      openLivePlayer(watchButton.dataset.watchLive);
      return;
    }
    const filterButton = event.target.closest("[data-radar-filter]");
    if (filterButton) {
      app.filter = filterButton.dataset.radarFilter;
      for (const button of document.querySelectorAll("[data-radar-filter]")) {
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.radarFilter === app.filter)
        );
      }
      renderMatches();
      return;
    }
    if (event.target.closest("[data-refresh]")) {
      loadSource();
    }
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-live-close]")) {
      $("[data-live-dialog]").close();
      return;
    }
    if (event.target.closest("[data-live-toggle]")) {
      toggleLivePlayback();
      return;
    }
    if (event.target.closest("[data-live-mute]")) {
      const video = $("[data-live-video]");
      video.muted = !video.muted;
      event.target.closest("[data-live-mute]").innerHTML = `<i data-lucide="${
        video.muted ? "volume-x" : "volume-2"
      }"></i>`;
      refreshIcons();
      return;
    }
    if (event.target.closest("[data-live-mask]")) {
      $("[data-live-shield]").classList.toggle("is-hidden");
      return;
    }
    if (event.target.closest("[data-live-fullscreen]")) {
      const stage = $("[data-live-stage]");
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        stage.requestFullscreen?.();
      }
    }
  });

  $("[data-live-quality]").addEventListener("change", (event) => {
    if (!app.hls) {
      return;
    }
    app.hls.currentLevel = Number(event.target.value);
    updateLiveStats();
  });

  $("[data-live-dialog]").addEventListener("close", destroyLivePlayer);
  $("[data-live-video]").addEventListener("play", updateLiveButton);
  $("[data-live-video]").addEventListener("pause", updateLiveButton);

  document.addEventListener("input", (event) => {
    if (!event.target.matches("[data-radar-search]")) {
      return;
    }
    app.query = event.target.value;
    renderMatches();
  });

  $("[data-radar-league]").addEventListener("change", (event) => {
    app.league = event.target.value;
    renderMatches();
  });

  loadSource();
})();

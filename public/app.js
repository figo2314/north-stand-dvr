(() => {
  "use strict";

  const HOME_BACKDROP_INTERVAL_MS = 9_000;
  const HOME_MUSIC_STATE_KEY = "north-stand-music-state";

  const app = {
    data: null,
    availableReplays: [],
    view: "home",
    activeRecording: null,
    playerHls: null,
    progressTimer: null,
    lastSavedProgress: 0,
    maskDraft: null,
    revealTarget: null,
    deleteTarget: null,
    cancelRecordingTarget: null,
    previewFixtureId: null,
    previewTimer: null,
    logs: [],
    logLevel: "",
    logQuery: "",
    m3uChannels: [],
    channelSources: [],
    tvConfig: null,
    homeMusicReady: false,
    homeMusicShouldPlay: false,
    homeMusicUserPaused: false,
    homeMusicAutoplayArmed: false,
    homeMusicAutoplayScheduled: false,
    homeMusicPlaylist: [],
    homeMusicIndex: 0,
    homeMusicPlayTask: null,
    homeMusicRetryTimer: null,
    homeMusicUnmuteTimer: null,
    homeMusicLastSavedSecond: -1,
    homeBackdropIndex: 0
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || payload.message || "请求失败");
    }
    return payload;
  }

  function refreshIcons() {
    if (window.lucide) {
      window.lucide.createIcons({
        attrs: {
          "aria-hidden": "true"
        }
      });
    }
  }

  function toast(title, message = "", type = "success") {
    const region = $("[data-toast-region]");
    const item = document.createElement("div");
    item.className = `toast${type === "error" ? " is-error" : ""}`;
    item.innerHTML = `
      <i data-lucide="${type === "error" ? "circle-alert" : "circle-check"}"></i>
      <div>
        <strong>${escapeHtml(title)}</strong>
        ${message ? `<span>${escapeHtml(message)}</span>` : ""}
      </div>
    `;
    region.append(item);
    refreshIcons();
    window.setTimeout(() => item.remove(), 4200);
  }

  function readHomeMusicState() {
    try {
      const state = JSON.parse(
        window.localStorage.getItem(HOME_MUSIC_STATE_KEY) || "null"
      );
      return state && typeof state === "object" ? state : null;
    } catch {
      return null;
    }
  }

  function saveHomeMusicState() {
    const audio = $("[data-home-music]");
    if (!audio || !app.homeMusicPlaylist.length) {
      return;
    }
    try {
      window.localStorage.setItem(
        HOME_MUSIC_STATE_KEY,
        JSON.stringify({
          playlist: app.homeMusicPlaylist,
          index: app.homeMusicIndex,
          currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
          playing: app.homeMusicShouldPlay,
          userPaused: app.homeMusicUserPaused,
          updatedAt: Date.now()
        })
      );
    } catch {
      // Playback continues even when browser storage is unavailable.
    }
  }

  function restoreHomeMusicPosition(audio, time) {
    const resumeTime = Math.max(0, Number(time) || 0);
    if (!resumeTime) {
      return;
    }
    const restore = () => {
      try {
        audio.currentTime = Math.min(
          resumeTime,
          Number.isFinite(audio.duration) ? Math.max(0, audio.duration - 0.5) : resumeTime
        );
      } catch {
        // Some formats reject seeks until enough media is buffered.
      }
    };
    if (audio.readyState >= 1) {
      restore();
    } else {
      audio.addEventListener("loadedmetadata", restore, { once: true });
    }
  }

  function updateHomeMusicMetadata() {
    if (
      !app.homeMusicReady ||
      !("mediaSession" in navigator) ||
      typeof window.MediaMetadata !== "function"
    ) {
      return;
    }

    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: "The Angel (North London Forever)",
      artist: "Louis Dunford",
      album: "The Popham EP"
    });
  }

  function updateHomeMusicUI() {
    const audio = $("[data-home-music]");
    const buttons = $$("[data-music-toggle]");
    const labels = $$("[data-music-label]");
    if (!audio || !buttons.length || !labels.length) {
      return;
    }

    const playing = app.homeMusicReady && !audio.paused && !audio.ended;
    const ready = app.homeMusicReady;
    const accessibleLabel = playing ? "暂停队歌" : "播放队歌";
    for (const button of buttons) {
      button.classList.toggle("is-playing", playing);
      button.setAttribute("aria-pressed", String(playing));
      button.dataset.musicState = !ready
        ? "loading"
        : playing
          ? "playing"
          : "ready";
      button.setAttribute("aria-label", accessibleLabel);
      button.title = accessibleLabel;
    }
    for (const label of labels) {
      label.textContent = accessibleLabel;
    }
  }

  function handleHomeMusicPlay() {
    app.homeMusicShouldPlay = true;
    app.homeMusicUserPaused = false;
    updateHomeMusicUI();
    scheduleHomeMusicUnmute();
  }

  function pauseHomeMusic() {
    clearHomeMusicRetry();
    clearHomeMusicUnmute();
    const audio = $("[data-home-music]");
    if (audio && !audio.paused) {
      audio.pause();
    }
  }

  function clearHomeMusicUnmute() {
    if (app.homeMusicUnmuteTimer) {
      window.clearTimeout(app.homeMusicUnmuteTimer);
      app.homeMusicUnmuteTimer = null;
    }
  }

  function scheduleHomeMusicUnmute() {
    const audio = $("[data-home-music]");
    clearHomeMusicUnmute();
    if (!audio?.muted) {
      return;
    }
    app.homeMusicUnmuteTimer = window.setTimeout(() => {
      app.homeMusicUnmuteTimer = null;
      if (!audio.paused && !app.homeMusicUserPaused) {
        audio.muted = false;
      }
    }, 520);
  }

  function clearHomeMusicRetry() {
    if (app.homeMusicRetryTimer) {
      window.clearTimeout(app.homeMusicRetryTimer);
      app.homeMusicRetryTimer = null;
    }
  }

  function clearHomeMusicAutoplayWait() {
    if (!app.homeMusicAutoplayArmed) {
      return;
    }
    document.removeEventListener("pointerdown", startHomeMusicFromGesture, true);
    document.removeEventListener("keydown", startHomeMusicFromGesture, true);
    document.removeEventListener("touchstart", startHomeMusicFromGesture, true);
    app.homeMusicAutoplayArmed = false;
  }

  function startHomeMusicFromGesture(event) {
    if (event.target.closest?.("[data-music-toggle]")) {
      clearHomeMusicAutoplayWait();
      return;
    }
    const audio = $("[data-home-music]");
    if (audio) {
      audio.muted = false;
    }
    playHomeMusic();
  }

  function armHomeMusicAutoplay() {
    if (app.homeMusicAutoplayArmed || app.homeMusicUserPaused) {
      return;
    }
    app.homeMusicAutoplayArmed = true;
    document.addEventListener("pointerdown", startHomeMusicFromGesture, true);
    document.addEventListener("keydown", startHomeMusicFromGesture, true);
    document.addEventListener("touchstart", startHomeMusicFromGesture, true);
  }

  async function startMutedHomeMusic({ announce = false } = {}) {
    const audio = $("[data-home-music]");
    const player = $("[data-player-layer]");
    if (
      !app.homeMusicReady ||
      !audio?.src ||
      app.homeMusicUserPaused ||
      document.visibilityState === "hidden" ||
      (player && !player.hidden)
    ) {
      return false;
    }
    if (!audio.paused) {
      app.homeMusicShouldPlay = true;
      clearHomeMusicAutoplayWait();
      return true;
    }

    audio.muted = true;
    try {
      await audio.play();
      app.homeMusicShouldPlay = true;
      app.homeMusicUserPaused = false;
      clearHomeMusicAutoplayWait();
      scheduleHomeMusicUnmute();
      saveHomeMusicState();
      return true;
    } catch {
      audio.muted = false;
      armHomeMusicAutoplay();
      if (announce) {
        toast("浏览器阻止了自动播放", "在页面任意位置点一下即可开始队歌。", "error");
      }
      updateHomeMusicUI();
      return false;
    }
  }

  function playHomeMusic(options = {}) {
    if (app.homeMusicPlayTask) {
      return app.homeMusicPlayTask;
    }

    const task = playHomeMusicNow(options);
    app.homeMusicPlayTask = task;
    task.finally(() => {
      if (app.homeMusicPlayTask === task) {
        app.homeMusicPlayTask = null;
      }
    });
    return task;
  }

  async function playHomeMusicNow({ announce = false } = {}) {
    const audio = $("[data-home-music]");
    if (!app.homeMusicReady || !audio?.src) {
      return false;
    }
    if (!audio.paused) {
      app.homeMusicShouldPlay = true;
      clearHomeMusicAutoplayWait();
      return true;
    }

    clearHomeMusicRetry();
    clearHomeMusicUnmute();
    audio.muted = false;
    try {
      await audio.play();
      app.homeMusicShouldPlay = true;
      app.homeMusicUserPaused = false;
      clearHomeMusicAutoplayWait();
      saveHomeMusicState();
      return true;
    } catch {
      app.homeMusicRetryTimer = window.setTimeout(() => {
        app.homeMusicRetryTimer = null;
        startMutedHomeMusic({ announce });
      }, 950);
      updateHomeMusicUI();
      return false;
    }
  }

  function setHomeMusicTrack(index, { autoplay = false } = {}) {
    const audio = $("[data-home-music]");
    if (!audio || !app.homeMusicPlaylist.length) {
      return;
    }

    const count = app.homeMusicPlaylist.length;
    app.homeMusicIndex = ((index % count) + count) % count;
    const nextSource = app.homeMusicPlaylist[app.homeMusicIndex];
    audio.dataset.musicIndex = String(app.homeMusicIndex);
    if (audio.getAttribute("src") !== nextSource) {
      audio.src = nextSource;
      audio.load();
    }
    updateHomeMusicUI();
    updateHomeMusicMetadata();
    if (autoplay) {
      playHomeMusic();
    }
  }

  function advanceHomeMusic() {
    if (app.homeMusicUserPaused) {
      updateHomeMusicUI();
      return;
    }
    setHomeMusicTrack(app.homeMusicIndex + 1, { autoplay: true });
    saveHomeMusicState();
  }

  function scheduleHomeMusicAutoplay() {
    if (app.homeMusicAutoplayScheduled) {
      return;
    }
    app.homeMusicAutoplayScheduled = true;

    const start = () => {
      window.setTimeout(() => {
        if (!app.homeMusicUserPaused) {
          startMutedHomeMusic();
        }
      }, 80);
    };

    if (document.readyState === "complete") {
      start();
    } else {
      window.addEventListener("load", start, { once: true });
    }
  }

  function initializeHomeMusic() {
    const audio = $("[data-home-music]");
    if (!audio) {
      return;
    }
    try {
      app.homeMusicPlaylist = JSON.parse(
        audio.dataset.homeMusicPlaylist || "[]"
      ).filter((source) => typeof source === "string" && source);
    } catch {
      app.homeMusicPlaylist = [];
    }
    if (!app.homeMusicPlaylist.length && audio.getAttribute("src")) {
      app.homeMusicPlaylist = [audio.getAttribute("src")];
    }
    if (!app.homeMusicPlaylist.length) {
      return;
    }

    const saved = readHomeMusicState();
    const savedIndex = Number(saved?.index);
    app.homeMusicIndex = Number.isInteger(savedIndex) ? savedIndex : 0;
    app.homeMusicUserPaused = Boolean(saved?.userPaused);
    app.homeMusicShouldPlay = Boolean(saved?.playing && !saved?.userPaused);

    audio.volume = 0.62;
    app.homeMusicReady = true;
    setHomeMusicTrack(app.homeMusicIndex);
    restoreHomeMusicPosition(audio, saved?.currentTime);
    if (!audio.paused) {
      handleHomeMusicPlay();
    } else if (!app.homeMusicUserPaused && (!saved || saved.playing !== false)) {
      scheduleHomeMusicAutoplay();
    }
  }

  async function toggleHomeMusic() {
    const audio = $("[data-home-music]");
    if (!app.homeMusicReady || !audio?.src) {
      toast("队歌资源不可用", "请检查音频文件是否已随项目发布。", "error");
      return;
    }

    if (!audio.paused) {
      app.homeMusicUserPaused = true;
      app.homeMusicShouldPlay = false;
      clearHomeMusicAutoplayWait();
      clearHomeMusicUnmute();
      audio.pause();
      saveHomeMusicState();
      return;
    }

    app.homeMusicUserPaused = false;
    await playHomeMusic({ announce: true });
  }

  function initializeHomeBackdrop() {
    const backdrop = $("[data-home-backdrop]");
    const layers = $$("[data-home-backdrop-layer]", backdrop || document);
    if (!backdrop || layers.length < 2) {
      return;
    }

    backdrop.dataset.backdropIndex = "0";
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    window.setInterval(() => {
      if (
        app.view !== "home" ||
        document.visibilityState === "hidden" ||
        document.body.classList.contains("is-home-library")
      ) {
        return;
      }

      const current = app.homeBackdropIndex;
      const next = (current + 1) % layers.length;
      layers[current].classList.remove("is-active");
      layers[next].classList.add("is-active");
      app.homeBackdropIndex = next;
      backdrop.dataset.backdropIndex = String(next);
    }, HOME_BACKDROP_INTERVAL_MS);
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024 ** 3) {
      return `${Math.max(1, Math.round(value / 1024 ** 2))} MB`;
    }
    return `${(value / 1024 ** 3).toFixed(value >= 10 * 1024 ** 3 ? 0 : 1)} GB`;
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (hours) {
      return `${hours} 小时 ${String(minutes).padStart(2, "0")} 分`;
    }
    return `${minutes} 分钟`;
  }

  function formatClock(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = total % 60;
    return hours
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }

  function dateKey(date) {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  }

  function formatFixtureDate(dateValue) {
    const date = new Date(dateValue);
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const time = new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);

    if (dateKey(date) === dateKey(now)) {
      return `今天 ${time}`;
    }
    if (dateKey(date) === dateKey(tomorrow)) {
      return `明天 ${time}`;
    }
    return `${new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      weekday: "short"
    }).format(date)} ${time}`;
  }

  function formatLibraryDate(dateValue) {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      weekday: "short"
    }).format(new Date(dateValue));
  }

  function toLocalInputValue(dateValue) {
    const date = dateValue ? new Date(dateValue) : new Date();
    const pad = (number) => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate()
    )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function nextDefaultKickoff() {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(3, 0, 0, 0);
    return date;
  }

  function statusLabel(status) {
    const labels = {
      scheduled: "等待录制",
      recording: "正在录制",
      recorded: "已录制",
      deleted: "录像已删除",
      ready: "可播放",
      failed: "录制失败",
      missed: "错过窗口",
      "needs-source": "待填直播源",
      "ffmpeg-unavailable": "录制引擎异常"
    };
    return labels[status] || status || "未知状态";
  }

  function statusIcon(status) {
    const icons = {
      scheduled: "clock-3",
      recording: "radio",
      recorded: "check",
      deleted: "trash-2",
      ready: "check",
      failed: "circle-x",
      missed: "circle-slash-2",
      "needs-source": "link-2-off",
      "ffmpeg-unavailable": "triangle-alert"
    };
    return icons[status] || "circle";
  }

  function maskStyle(mask) {
    const safe = mask || {};
    return [
      `--mask-x:${Number(safe.x) || 0}%`,
      `--mask-y:${Number(safe.y) || 0}%`,
      `--mask-width:${Number(safe.width) || 37}%`,
      `--mask-height:${Number(safe.height) || 11}%`,
      `--mask-color:${safe.color || "#05070a"}`
    ].join(";");
  }

  function applyMaskStyles() {
    const style = maskStyle(app.data?.settings?.mask);
    for (const element of $$("[data-mask-preview], [data-mask-canvas], [data-video-stage]")) {
      element.setAttribute("style", style);
    }
  }

  function destroyPlayerHls() {
    app.playerHls?.destroy();
    app.playerHls = null;
  }

  function renderRecordingResult(recording) {
    if (recording.sourceType === "channel-replay") {
      return `
        <span class="recording-result is-live">
          <i data-lucide="radio"></i>
          当前可回放
        </span>
      `;
    }
    if (recording.score) {
      return `
        <span class="recording-result is-revealed">
          <i data-lucide="eye"></i>
          ${escapeHtml(recording.score.home)} : ${escapeHtml(recording.score.away)}
        </span>
      `;
    }
    return `
      <span class="recording-result">
        <i data-lucide="lock-keyhole"></i>
        比分已封存
      </span>
    `;
  }

  function renderAvailableReplayRow(replay) {
    const checkedAt = replay.checkedAt ? formatLibraryDate(replay.checkedAt) : "刚刚";
    const variants =
      Array.isArray(replay.variants) && replay.variants.length
        ? replay.variants
        : [
            {
              channelId: replay.channelId,
              label: replay.commentary || "默认解说",
              quality: replay.quality || "已连接"
            }
          ];
    const variantCount = variants.length;
    const selectedChannelId = replay.channelId || variants[0].channelId;
    const variantPicker =
      variantCount > 1
        ? `
          <label class="replay-variant-picker">
            <span><i data-lucide="mic-2"></i>解说</span>
            <select data-replay-variant="${escapeHtml(replay.id)}">
              ${variants
                .map(
                  (variant) => `
                    <option
                      value="${escapeHtml(variant.channelId)}"
                      ${variant.channelId === selectedChannelId ? "selected" : ""}
                    >${escapeHtml(
                      `${variant.label} · ${variant.quality || "已连接"}`
                    )}</option>
                  `
                )
                .join("")}
            </select>
          </label>
        `
        : `
          <span class="replay-variant-single">
            <i data-lucide="mic-2"></i>
            ${escapeHtml(variants[0].label || "默认解说")}
          </span>
        `;
    return `
      <article class="recording-row is-channel-replay" data-replay-id="${escapeHtml(
        replay.id
      )}">
        <div class="recording-visual">
          <img
            src="${escapeHtml(replay.thumbnail)}"
            alt=""
            loading="lazy"
          />
          <span class="spoiler-tape is-live">
            <i data-lucide="radio"></i>
            当前可回放
          </span>
          <span class="recording-length">${escapeHtml(
            replay.quality || "HLS 回放"
          )}</span>
        </div>
        <div class="recording-copy">
          <div class="recording-kicker">
            <span>${escapeHtml(replay.competition || "足球回放")}</span>
            <span aria-hidden="true">·</span>
            <span>${escapeHtml(checkedAt)}检测</span>
          </div>
          <h3>${escapeHtml(replay.title)}</h3>
          <div class="recording-meta">
            <span>
              <i data-lucide="radio-tower"></i>
              ${escapeHtml(replay.sourceLabel || "直播源")}
            </span>
            <span>
              <i data-lucide="layers-3"></i>
              ${variantCount} 条可播线路
            </span>
          </div>
          ${renderRecordingResult(replay)}
        </div>
        <div class="recording-actions recording-actions--replay">
          ${variantPicker}
          <button class="play-button" type="button" data-play="${escapeHtml(
            replay.id
          )}">
            <i data-lucide="play"></i>
            播放回放
          </button>
          <button
            class="subtle-button"
            type="button"
            data-refresh-replays
          >
            <i data-lucide="refresh-cw"></i>
            重新检测
          </button>
        </div>
      </article>
    `;
  }

  async function loadAvailableReplays({ force = false, quiet = true } = {}) {
    try {
      const payload = await api(
        `/api/replays/available${force ? "?refresh=1" : ""}`
      );
      app.availableReplays = Array.isArray(payload.replays)
        ? payload.replays
        : [];
      renderRecordings();
      renderMobileHome();
    } catch (error) {
      if (!quiet) {
        toast("无法读取当前回放", error.message, "error");
      }
    }
  }

  function renderRecordings() {
    const list = $("[data-recording-list]");
    const recordings = app.data?.recordings || [];
    const ready = recordings.filter((recording) => recording.status === "ready");
    const availableReplays = app.availableReplays || [];
    const summary = $("[data-ready-summary]");

    if (summary) {
      const replayCopy = availableReplays.length
        ? `${availableReplays.length} 场线上回放当前可播`
        : "";
      const localCopy = ready.length
        ? `${ready.length} 段本地录像已就绪，合计 ${formatBytes(
            ready.reduce(
              (sum, recording) => sum + Number(recording.sizeBytes || 0),
              0
            )
          )}`
        : "";
      summary.textContent =
        [replayCopy, localCopy].filter(Boolean).join(" · ") ||
        "正在检测咪咕及其他可播放的线上回放…";
    }

    if (!ready.length && !availableReplays.length) {
      list.innerHTML = `
        <div class="empty-library">
          <div>
            <i data-lucide="clapperboard"></i>
            <h3>暂时没有可回放的内容</h3>
            <p>服务会持续检测足球回放源；只有确认当前可播的场次才会出现在这里。也可以扫描录像目录或导入本地视频。</p>
          </div>
        </div>
      `;
      refreshIcons();
      return;
    }

    const localRows = ready
      .sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt))
      .map((recording) => {
        const hidden = !recording.score;
        return `
          <article class="recording-row" data-recording-id="${escapeHtml(recording.id)}">
            <div class="recording-visual">
              <img
                src="${escapeHtml(recording.thumbnail)}"
                alt=""
                loading="lazy"
              />
              <span class="spoiler-tape">
                <i data-lucide="shield-check"></i>
                无剧透封面
              </span>
              <span class="recording-length">${escapeHtml(
                recording.durationSeconds ? formatDuration(recording.durationSeconds) : "时长待识别"
              )}</span>
            </div>
            <div class="recording-copy">
              <div class="recording-kicker">
                <span>${escapeHtml(recording.competition || "足球比赛")}</span>
                <span aria-hidden="true">·</span>
                <span>${escapeHtml(formatLibraryDate(recording.playedAt))}</span>
              </div>
              <h3>${escapeHtml(recording.title)}</h3>
              <div class="recording-meta">
                <span>
                  <i data-lucide="hard-drive"></i>
                  ${escapeHtml(formatBytes(recording.sizeBytes))}
                </span>
                <span>
                  <i data-lucide="clock-3"></i>
                  ${escapeHtml(
                    recording.watchedSeconds
                      ? `已看 ${formatDuration(recording.watchedSeconds)}`
                      : "还没开始"
                  )}
                </span>
              </div>
              ${renderRecordingResult(recording)}
            </div>
            <div class="recording-actions">
              <button class="play-button" type="button" data-play="${escapeHtml(recording.id)}">
                <i data-lucide="play"></i>
                直接播放
              </button>
              ${
                hidden
                  ? `<button class="subtle-button" type="button" data-reveal="${escapeHtml(
                      recording.id
                    )}">揭晓比分</button>`
                  : `<button class="subtle-button" type="button" data-play="${escapeHtml(
                      recording.id
                    )}">继续观看</button>`
              }
              <button
                class="subtle-button subtle-button--danger"
                type="button"
                data-delete-recording="${escapeHtml(recording.id)}"
              >
                <i data-lucide="trash-2"></i>
                删除录像
              </button>
            </div>
          </article>
        `;
      })
      .join("");
    const replayGroup = availableReplays.length
      ? `
        <div class="library-group-heading">
          <div>
            <i data-lucide="radio"></i>
            <h3>线上回放</h3>
          </div>
          <span>咪咕及其他已检测可播线路</span>
        </div>
        ${availableReplays.map(renderAvailableReplayRow).join("")}
      `
      : "";
    const localGroup = ready.length
      ? `
        <div class="library-group-heading">
          <div>
            <i data-lucide="hard-drive"></i>
            <h3>本地录像</h3>
          </div>
          <span>保存在北看台录像目录</span>
        </div>
        ${localRows}
      `
      : "";
    list.innerHTML = [replayGroup, localGroup].join("");
    refreshIcons();
  }

  function nextRecordableFixture() {
    const now = Date.now();
    const fixtures = (app.data?.fixtures || [])
      .filter((fixture) => fixture.record && new Date(fixture.kickoffAt).getTime() >= now)
      .sort((a, b) => new Date(a.kickoffAt) - new Date(b.kickoffAt));
    return fixtures[0] || null;
  }

  function renderMobileHome() {
    const recordings = app.data?.recordings || [];
    const readyCount = recordings.filter(
      (recording) => recording.status === "ready"
    ).length;
    const replayCount = app.availableReplays.length;
    const activeJob = app.data?.health?.activeJobs?.[0] || null;
    const activeFixture = activeJob
      ? app.data?.fixtures?.find((fixture) => fixture.id === activeJob.fixtureId)
      : null;
    const nextFixture = nextRecordableFixture();
    const title = $("[data-mobile-status-title]");
    const copy = $("[data-mobile-status-copy]");
    const beacon = $("[data-mobile-status-beacon]");
    if (!title || !copy || !beacon) {
      return;
    }
    const recordingCount = $("[data-mobile-recording-count]");
    if (recordingCount) {
      recordingCount.textContent = String(readyCount + replayCount);
    }
    beacon.classList.remove("is-ready", "is-error");
    if (activeFixture) {
      title.textContent = "正在录制";
      copy.textContent = `${activeFixture.home} vs ${activeFixture.away}`;
      beacon.classList.add("is-ready");
    } else if (!app.data?.health?.ffmpeg?.available) {
      title.textContent = "录制引擎待检查";
      copy.textContent = "FFmpeg 或录像目录可能不可用";
      beacon.classList.add("is-error");
    } else if (nextFixture) {
      title.textContent = "下一场已就位";
      copy.textContent = `${nextFixture.home} vs ${nextFixture.away} · ${new Intl.DateTimeFormat(
        "zh-CN",
        {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false
        }
      ).format(new Date(nextFixture.kickoffAt))}`;
      beacon.classList.add("is-ready");
    } else {
      title.textContent = "今晚空闲";
      copy.textContent = "可以安排下一场比赛";
      beacon.classList.add("is-ready");
    }
  }

  function renderNextFixture() {
    const container = $("[data-next-fixture]");
    const fixture = nextRecordableFixture();

    if (!fixture) {
      container.innerHTML = `<p class="empty-inline">还没有安排下一场。</p>`;
      return;
    }

    const stateClass =
      fixture.status === "failed" || fixture.status === "ffmpeg-unavailable"
        ? "is-error"
        : fixture.status === "needs-source"
          ? "is-warning"
          : "";

    container.innerHTML = `
      <div class="next-fixture">
        <p class="next-fixture__match">${escapeHtml(fixture.home)} vs ${escapeHtml(
          fixture.away
        )}</p>
        <p class="next-fixture__competition">${escapeHtml(
          fixture.competition || "足球比赛"
        )}${fixture.isDemo ? " · 演示赛程" : ""}</p>
        <div class="next-fixture__time">
          <strong>${escapeHtml(
            new Intl.DateTimeFormat("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false
            }).format(new Date(fixture.kickoffAt))
          )}</strong>
          <span>${escapeHtml(formatFixtureDate(fixture.kickoffAt))}</span>
        </div>
        <span class="fixture-state ${stateClass}">
          <i data-lucide="${statusIcon(fixture.status)}"></i>
          ${escapeHtml(statusLabel(fixture.status))}
        </span>
      </div>
    `;
  }

  function renderHealth() {
    const health = app.data?.health || {};
    const disk = health.disk;
    const settings = app.data?.settings || {};

    if (disk) {
      $("[data-free-space]").textContent = `剩余 ${formatBytes(disk.freeBytes)}`;
      $("[data-disk-total]").textContent = `共 ${formatBytes(disk.totalBytes)}`;
      const usedPercent = disk.totalBytes
        ? Math.min(100, Math.max(0, (disk.usedBytes / disk.totalBytes) * 100))
        : 0;
      $("[data-disk-bar]").style.width = `${usedPercent}%`;
    } else {
      $("[data-free-space]").textContent = health.diskError ? "目录不可用" : "无法读取";
      $("[data-disk-total]").textContent = "";
      $("[data-disk-bar]").style.width = "0%";
    }

    const ffmpegNode = $("[data-ffmpeg-state]");
    ffmpegNode.textContent = health.ffmpeg?.available ? "FFmpeg 就绪" : "FFmpeg 不可用";
    ffmpegNode.classList.toggle("is-error", !health.ffmpeg?.available);
    $("[data-active-jobs]").textContent = `${health.activeJobs?.length || 0} 场`;
    $("[data-mask-strategy]").textContent = settings.burnInMask
      ? "写入录像文件"
      : "播放器遮罩";
    $("[data-app-version]").textContent = health.version || "未知";

    const railStatus = $("[data-rail-status]");
    const railStrong = $("strong", railStatus);
    const beacon = $(".status-beacon", railStatus);
    beacon.classList.remove("is-ready", "is-error");

    if (health.activeJobs?.length) {
      railStrong.textContent = `${health.activeJobs.length} 场正在录制`;
      beacon.classList.add("is-ready");
    } else if (!health.ffmpeg?.available) {
      railStrong.textContent = "录制引擎需检查";
      beacon.classList.add("is-error");
    } else {
      railStrong.textContent = "录制环境正常";
      beacon.classList.add("is-ready");
    }

    renderOvernightStrip();
    renderMobileHome();
  }

  function renderOvernightStrip() {
    const health = app.data?.health || {};
    const recordings = app.data?.recordings || [];
    const title = $("#overnight-title");
    const copy = $("[data-overnight-copy]");
    const state = $("[data-overnight-state]");
    const readyCount = recordings.filter((recording) => recording.status === "ready").length;

    state.classList.remove("is-warning", "is-error");

    if (health.activeJobs?.length) {
      title.textContent = "现在有一场正在录制";
      copy.textContent = "录制完成前不要关闭本地服务；播放器遮罩不会改变原视频。";
      state.innerHTML = `<i data-lucide="radio"></i><span>录制任务运行中</span>`;
      state.classList.add("is-warning");
    } else if (!health.ffmpeg?.available) {
      title.textContent = "录像可以看，但还不能自动录";
      copy.textContent = "当前环境没有找到 FFmpeg。你仍然可以导入并播放已有录像。";
      state.innerHTML = `<i data-lucide="triangle-alert"></i><span>录制引擎未就绪</span>`;
      state.classList.add("is-error");
    } else if (readyCount) {
      title.textContent = `录像库里已有 ${readyCount} 场完整录像`;
      copy.textContent = "比分和缩略图信息已经封存，点开第一场就能直接看。";
      state.innerHTML = `<i data-lucide="shield-check"></i><span>无剧透保护已开启</span>`;
    } else {
      title.textContent = "等待第一场录像";
      copy.textContent = "先安排比赛，或者扫描已有录像目录。";
      state.innerHTML = `<i data-lucide="shield-check"></i><span>保护策略已就绪</span>`;
    }

    refreshIcons();
  }

  function renderSchedule() {
    const container = $("[data-schedule-table]");
    const fixtures = [...(app.data?.fixtures || [])].sort(
      (a, b) => new Date(a.kickoffAt) - new Date(b.kickoffAt)
    );
    const activeJobs = new Map(
      (app.data?.health?.activeJobs || []).map((job) => [job.fixtureId, job])
    );

    if (!fixtures.length) {
      container.innerHTML = `
        <div class="schedule-empty">
          <i data-lucide="calendar-x-2"></i>
          <h3>还没有录制计划</h3>
          <p>添加比赛、直播流和开球时间后，服务会在窗口内自动录制。</p>
        </div>
      `;
      refreshIcons();
      return;
    }

    container.innerHTML = fixtures
      .map((fixture) => {
        const date = new Date(fixture.kickoffAt);
        const activeJob = activeJobs.get(fixture.id);
        const isRecording = fixture.status === "recording" && activeJob;
        const canRecord =
          fixture.streamUrl &&
          !["recording", "recorded"].includes(fixture.status);
        const action = isRecording
          ? `
            <button class="row-action" type="button" data-preview-fixture="${escapeHtml(
              fixture.id
            )}" aria-label="查看实时预览" title="实时预览"><i data-lucide="scan-eye"></i></button>
            <button class="row-action" type="button" data-stop-recording="${escapeHtml(
              fixture.id
            )}" aria-label="停止并保存录像" title="停止并保存"><i data-lucide="square"></i></button>
            <button class="row-action row-action--danger" type="button" data-cancel-recording="${escapeHtml(
              fixture.id
            )}" aria-label="取消并删除录像" title="取消并删除"><i data-lucide="trash-2"></i></button>
          `
          : fixture.recordingId
          ? `<button class="row-action" type="button" data-play-fixture="${escapeHtml(
              fixture.recordingId
            )}" aria-label="播放录像"><i data-lucide="play"></i></button>`
          : canRecord
            ? `<button class="row-action" type="button" data-record-now="${escapeHtml(
                fixture.id
              )}" aria-label="立即录制"><i data-lucide="radio"></i></button>`
            : `<button class="row-action" type="button" data-edit-fixture="${escapeHtml(
                fixture.id
              )}" aria-label="编辑比赛"><i data-lucide="pencil"></i></button>`;
        const progressSeconds = Number(activeJob?.progressSeconds || 0);
        const targetSeconds = Number(
          activeJob?.durationSeconds || fixture.durationMinutes * 60 || 0
        );
        const progressPercent = targetSeconds
          ? Math.min(100, Math.max(0, (progressSeconds / targetSeconds) * 100))
          : 0;

        return `
          <article class="schedule-row${isRecording ? " is-recording" : ""}">
            <div class="schedule-date">
              <strong>${escapeHtml(
                new Intl.DateTimeFormat("zh-CN", {
                  month: "2-digit",
                  day: "2-digit"
                }).format(date)
              )}</strong>
              <span>${escapeHtml(
                new Intl.DateTimeFormat("zh-CN", {
                  weekday: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false
                }).format(date)
              )}</span>
            </div>
            <div class="schedule-match">
              <strong>${escapeHtml(fixture.home)} vs ${escapeHtml(fixture.away)}</strong>
              <span>${escapeHtml(fixture.competition || "足球比赛")}${
                fixture.isDemo ? " · 演示" : ""
              }</span>
            </div>
            <div class="schedule-source" title="${escapeHtml(fixture.streamUrl || "")}">
              ${escapeHtml(fixture.streamUrl || "未填写直播源")}
            </div>
            <span class="status-pill is-${escapeHtml(fixture.status)}">
              <i data-lucide="${statusIcon(fixture.status)}"></i>
              ${escapeHtml(statusLabel(fixture.status))}
            </span>
            <div class="schedule-actions">
              <a
                class="row-action"
                href="/lineup.html?id=${encodeURIComponent(fixture.id)}"
                aria-label="查看首发阵容"
                title="首发阵容"
              >
                <i data-lucide="shirt"></i>
              </a>
              ${action}
            </div>
            ${
              isRecording
                ? `
                  <div class="schedule-progress">
                    <div class="schedule-progress__track">
                      <span style="--progress:${progressPercent}%"></span>
                    </div>
                    <div class="schedule-progress__meta">
                      <span>${escapeHtml(
                        progressSeconds ? formatClock(progressSeconds) : "等待第一帧"
                      )} / ${escapeHtml(
                        targetSeconds ? formatClock(targetSeconds) : "时长待识别"
                      )}</span>
                      <span>${escapeHtml(activeJob.speed ? `速度 ${activeJob.speed}` : "正在连接源")}</span>
                    </div>
                  </div>
                `
                : ""
            }
          </article>
        `;
      })
      .join("");
    refreshIcons();
  }

  function logEventLabel(event) {
    const labels = {
      "app.started": "服务启动",
      "recording.started": "开始录制",
      "recording.completed": "录制完成",
      "recording.failed": "录制失败",
      "recording.missed": "错过窗口",
      "recording.needs_source": "缺少直播源",
      "recording.start_failed": "启动失败",
      "recording.canceled": "取消录制",
      "recording.interrupted": "录制中断",
      "recording.deleted": "删除录像",
      "fixture.created": "加入日程",
      "fixture.removed": "移除日程",
      "settings.updated": "更新设置",
      "scheduler.failed": "调度异常",
      "request.failed": "请求失败"
    };
    return labels[event] || event || "运行事件";
  }

  function filteredLogs() {
    const query = app.logQuery.trim().toLocaleLowerCase("zh-CN");
    return app.logs.filter((entry) => {
      if (app.logLevel && entry.level !== app.logLevel) {
        return false;
      }
      if (!query) {
        return true;
      }
      return `${entry.event} ${entry.message} ${entry.fixture || ""} ${
        entry.competition || ""
      } ${entry.path || ""}`
        .toLocaleLowerCase("zh-CN")
        .includes(query);
    });
  }

  function renderLogs() {
    const list = $("[data-log-list]");
    const entries = filteredLogs();
    const counts = app.logs.reduce(
      (result, entry) => {
        result.all += 1;
        if (entry.level === "error") result.error += 1;
        else if (entry.level === "warning") result.warning += 1;
        else result.info += 1;
        return result;
      },
      { all: 0, error: 0, warning: 0, info: 0 }
    );
    for (const [level, count] of Object.entries(counts)) {
      const node = document.querySelector(`[data-log-count="${level}"]`);
      if (node) {
        node.textContent = `${
          level === "all"
            ? "全部"
            : level === "error"
              ? "错误"
              : level === "warning"
                ? "警告"
                : "信息"
        } ${count}`;
      }
    }
    $("[data-log-summary]").textContent = entries.length
      ? `显示 ${entries.length} / ${app.logs.length} 条记录，最新的在前。`
      : "当前筛选范围内没有日志。";

    if (!entries.length) {
      list.innerHTML = `
        <div class="schedule-empty">
          <i data-lucide="scroll-text"></i>
          <h3>暂无运行记录</h3>
          <p>录制调度和错误会自动记录在这里。</p>
        </div>
      `;
      refreshIcons();
      return;
    }

    list.innerHTML = entries
      .map((entry) => {
        const context = [
          entry.fixture,
          entry.path,
          entry.status ? `HTTP ${entry.status}` : "",
          entry.sizeBytes ? formatBytes(entry.sizeBytes) : "",
          entry.durationSeconds ? formatClock(entry.durationSeconds) : ""
        ]
          .filter(Boolean)
          .join(" · ");
        return `
          <article class="runtime-log is-${escapeHtml(entry.level)}">
            <span class="runtime-log__level">
              <i data-lucide="${
                entry.level === "error"
                  ? "circle-x"
                  : entry.level === "warning"
                    ? "triangle-alert"
                    : "info"
              }"></i>
              ${entry.level === "error" ? "错误" : entry.level === "warning" ? "警告" : "信息"}
            </span>
            <div class="runtime-log__body">
              <div class="runtime-log__heading">
                <strong>${escapeHtml(logEventLabel(entry.event))}</strong>
                <time>${escapeHtml(
                  new Intl.DateTimeFormat("zh-CN", {
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: false
                  }).format(new Date(entry.timestamp))
                )}</time>
              </div>
              <p>${escapeHtml(entry.message || "")}</p>
              ${context ? `<small>${escapeHtml(context)}</small>` : ""}
            </div>
          </article>
        `;
      })
      .join("");
    refreshIcons();
  }

  async function loadLogs() {
    const level = app.logLevel
      ? `&level=${encodeURIComponent(app.logLevel)}`
      : "";
    const result = await api(`/api/logs?limit=300${level}`);
    app.logs = result.entries || [];
    renderLogs();
  }

  async function clearLogs() {
    if (!window.confirm("确定清空本机运行日志吗？")) {
      return;
    }
    await api("/api/logs", { method: "DELETE" });
    app.logs = [];
    renderLogs();
    toast("运行日志已清空");
  }

  function copyDiagnostics() {
    const entries = filteredLogs();
    const text = entries
      .map((entry) => {
        const context = [
          entry.fixture,
          entry.competition,
          entry.path,
          entry.status ? `HTTP ${entry.status}` : ""
        ]
          .filter(Boolean)
          .join(" | ");
        return [
          entry.timestamp,
          String(entry.level || "info").toUpperCase(),
          entry.event,
          entry.message,
          context
        ]
          .filter(Boolean)
          .join(" | ");
      })
      .join("\n");
    copyText(text, "诊断信息");
  }

  function populateSettings() {
    const form = $("[data-settings-form]");
    const settings = app.data.settings;
    form.elements.m3uUrl.value = settings.m3uUrl || "";
    form.elements.tvRequireToken.checked = Boolean(settings.tvRequireToken);
    form.elements.recordingDir.value = settings.recordingDir;
    form.elements.preRollMinutes.value = settings.preRollMinutes;
    form.elements.postRollMinutes.value = settings.postRollMinutes;
    form.elements.diskWarningGb.value = settings.diskWarningGb;
    form.elements.spoilerMode.checked = Boolean(settings.spoilerMode);
    for (const radio of form.elements.burnInMask) {
      radio.checked = radio.value === String(Boolean(settings.burnInMask));
    }
    applyMaskStyles();
  }

  function renderChannelSources() {
    const list = $("[data-channel-source-list]");
    if (!app.channelSources.length) {
      list.innerHTML = '<p class="empty-inline">还没有配置直播源。</p>';
      return;
    }
    list.innerHTML = app.channelSources
      .map(
        (source) => `
          <div class="channel-source-row${source.enabled ? "" : " is-disabled"}">
            <div class="channel-source-row__copy">
              <strong>${escapeHtml(source.label)}</strong>
              <span title="${escapeHtml(source.url)}">${escapeHtml(
                source.url
              )}</span>
            </div>
            <div class="channel-source-row__actions">
              <button
                class="subtle-button"
                type="button"
                data-channel-source-toggle="${escapeHtml(source.id)}"
              >
                ${source.enabled ? "停用" : "启用"}
              </button>
              ${
                source.builtIn
                  ? ""
                  : `<button
                      class="subtle-button subtle-button--danger"
                      type="button"
                      data-channel-source-delete="${escapeHtml(source.id)}"
                    >
                      删除
                    </button>`
              }
            </div>
          </div>
        `
      )
      .join("");
  }

  async function loadChannelSources() {
    try {
      const payload = await api("/api/channel-sources");
      app.channelSources = payload.sources || [];
      renderChannelSources();
    } catch (error) {
      $("[data-channel-source-list]").innerHTML = `<p class="empty-inline">${escapeHtml(
        error.message
      )}</p>`;
    }
  }

  async function addChannelSource() {
    const label = $("[data-channel-source-label]").value.trim();
    const url = $("[data-channel-source-url]").value.trim();
    const fallbackUrl = $("[data-channel-source-fallback]").value.trim();
    const priority = Number($("[data-channel-source-priority]").value) || 50;
    if (!label || !url) {
      toast("请填写直播源名称和 M3U 地址", "", "error");
      return;
    }
    try {
      await api("/api/channel-sources", {
        method: "POST",
        body: JSON.stringify({ label, url, fallbackUrl, priority })
      });
      $("[data-channel-source-label]").value = "";
      $("[data-channel-source-url]").value = "";
      $("[data-channel-source-fallback]").value = "";
      $("[data-channel-source-priority]").value = "50";
      await loadChannelSources();
      toast("直播源已添加", label);
    } catch (error) {
      toast("无法添加直播源", error.message, "error");
    }
  }

  async function toggleChannelSource(id) {
    const source = app.channelSources.find((item) => item.id === id);
    if (!source) {
      return;
    }
    try {
      await api("/api/channel-sources", {
        method: "POST",
        body: JSON.stringify({
          ...source,
          enabled: !source.enabled
        })
      });
      await loadChannelSources();
    } catch (error) {
      toast("无法更新直播源", error.message, "error");
    }
  }

  async function deleteChannelSource(id) {
    const source = app.channelSources.find((item) => item.id === id);
    if (!source || source.builtIn) {
      return;
    }
    try {
      await api(`/api/channel-sources/${encodeURIComponent(id)}`, {
        method: "DELETE"
      });
      await loadChannelSources();
      toast("直播源已删除", source.label);
    } catch (error) {
      toast("无法删除直播源", error.message, "error");
    }
  }

  async function loadTvConfig() {
    try {
      app.tvConfig = await api("/api/tv/config");
      $("[data-tv-playlist-url]").value = app.tvConfig.playlistUrl || "";
      $("[data-tv-epg-url]").value = app.tvConfig.epgUrl || "";
      $("[data-tv-token]").value = app.tvConfig.token || "";
      $("[data-tv-dialog-playlist]").value = app.tvConfig.playlistUrl || "";
      $("[data-tv-dialog-epg]").value = app.tvConfig.epgUrl || "";
    } catch (error) {
      $("[data-tv-playlist-url]").value = error.message;
      $("[data-tv-dialog-playlist]").value = error.message;
    }
  }

  async function copyText(value, label) {
    if (!value) {
      toast("没有可复制的内容", "", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      toast(`${label}已复制`);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
      toast(`${label}已复制`);
    }
  }

  async function regenerateTvToken() {
    try {
      await api("/api/tv/token/regenerate", { method: "POST" });
      await loadTvConfig();
      toast("电视令牌已更新", "旧令牌和旧订阅地址会立即失效。");
    } catch (error) {
      toast("无法更新电视令牌", error.message, "error");
    }
  }

  async function testTvPlaylist() {
    const url = app.tvConfig?.playlistUrl;
    if (!url) {
      toast("订阅地址还没有准备好", "", "error");
      return;
    }
    try {
      const response = await fetch(url);
      const text = await response.text();
      const count = (text.match(/^#EXTINF/gm) || []).length;
      if (!response.ok || !count) {
        throw new Error(text.slice(0, 120) || "订阅内容为空");
      }
      toast("电视订阅可用", `共 ${count} 个频道。`);
    } catch (error) {
      toast("电视订阅测试失败", error.message, "error");
    }
  }

  function renderAll() {
    if (!app.data) {
      return;
    }
    document.title = app.data.settings.displayName || "北看台";
    for (const node of $$("[data-display-name]")) {
      node.textContent = app.data.settings.displayName || "北看台";
    }
    renderRecordings();
    renderNextFixture();
    renderHealth();
    renderSchedule();
    applyMaskStyles();
    refreshIcons();
  }

  async function loadState({ quiet = false } = {}) {
    try {
      app.data = await api("/api/state");
      renderAll();
      populateSettings();
      loadAvailableReplays();
    } catch (error) {
      if (!quiet) {
        toast("无法连接本地服务", error.message, "error");
      }
    }
  }

  function navigate(view) {
    if (!["home", "schedule", "logs", "settings"].includes(view)) {
      view = "home";
    }
    app.view = view;
    document.body.dataset.activeView = view;
    if (view === "home") {
      $('[data-view-panel="home"]')?.classList.remove("is-mobile-library");
      document.body.classList.remove("is-home-library");
    }
    for (const button of $$("[data-view]")) {
      button.classList.toggle("is-active", button.dataset.view === view);
    }
    for (const tab of $$("[data-mobile-tab]")) {
      const tabView = tab.dataset.mobileTab;
      const active = tabView === view || (view === "logs" && tabView === "settings");
      tab.classList.toggle("is-active", active);
      if (active) {
        tab.setAttribute("aria-current", "page");
      } else {
        tab.removeAttribute("aria-current");
      }
    }
    for (const panel of $$("[data-view-panel]")) {
      const active = panel.dataset.viewPanel === view;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    }
    window.history.replaceState(null, "", `#${view}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (view === "logs") {
      loadLogs().catch((error) => toast("无法读取日志", error.message, "error"));
    }
  }

  function openScheduleDialog(fixture = null) {
    const dialog = $("[data-schedule-dialog]");
    const form = $("[data-schedule-form]");
    form.reset();
    form.dataset.fixtureId = fixture?.id || "";
    form.elements.home.value = fixture?.home || "阿森纳";
    form.elements.away.value = fixture?.away || "";
    form.elements.competition.value = fixture?.competition || "英超";
    form.elements.kickoffAt.value = toLocalInputValue(
      fixture?.kickoffAt || nextDefaultKickoff()
    );
    form.elements.durationMinutes.value = fixture?.durationMinutes || 120;
    form.elements.m3uUrl.value = fixture?.m3uUrl || app.data.settings.m3uUrl || "";
    form.elements.streamUrl.value = fixture?.streamUrl || "";
    form.elements.inputFormat.value = fixture?.inputFormat || "auto";
    app.m3uChannels = [];
    $("[data-channel-browser]").hidden = true;
    $("[data-channel-results]").innerHTML = "";
    setInlineStatus($("[data-m3u-status]"), "加载后可按球队名称筛选直播频道。");
    setInlineStatus(
      $("[data-stream-status]"),
      "请只录制你有权保存的直播源。"
    );
    $(".dialog-heading h2", dialog).textContent = fixture ? "编辑比赛" : "安排一场比赛";
    dialog.showModal();
    if (form.elements.m3uUrl.value) {
      loadScheduleM3u({ silent: true });
    }
  }

  function openMaskDialog() {
    const form = $("[data-mask-form]");
    app.maskDraft = { ...app.data.settings.mask };
    const fields = ["x", "y", "width", "height", "color"];
    for (const field of fields) {
      form.elements[field].value = app.maskDraft[field];
    }
    updateMaskDraftPreview();
    $("[data-mask-dialog]").showModal();
  }

  function updateMaskDraftPreview() {
    const form = $("[data-mask-form]");
    app.maskDraft = {
      x: Number(form.elements.x.value),
      y: Number(form.elements.y.value),
      width: Number(form.elements.width.value),
      height: Number(form.elements.height.value),
      color: form.elements.color.value
    };
    const canvas = $("[data-mask-canvas]");
    canvas.setAttribute("style", maskStyle(app.maskDraft));
    $("[data-mask-x-value]").textContent = `${app.maskDraft.x}%`;
    $("[data-mask-y-value]").textContent = `${app.maskDraft.y}%`;
    $("[data-mask-width-value]").textContent = `${app.maskDraft.width}%`;
    $("[data-mask-height-value]").textContent = `${app.maskDraft.height}%`;
  }

  function applyPreset(preset) {
    const form = $("[data-mask-form]");
    const presets = {
      "top-left": { x: 3.5, y: 3 },
      "top-center": { x: 31.5, y: 3 },
      "top-right": { x: 62, y: 3 },
      "bottom-left": { x: 3.5, y: 84 }
    };
    for (const [key, value] of Object.entries(presets[preset] || {})) {
      form.elements[key].value = value;
    }
    updateMaskDraftPreview();
  }

  function setInlineStatus(element, message, type = "") {
    if (!element) {
      return;
    }
    element.textContent = message;
    element.dataset.status = type;
  }

  function renderM3uResults(query = "") {
    const results = $("[data-channel-results]");
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    const channels = app.m3uChannels
      .filter((channel) => {
        if (!normalized) {
          return true;
        }
        return `${channel.name} ${channel.group} ${channel.tvgId}`
          .toLocaleLowerCase("zh-CN")
          .includes(normalized);
      })
      .slice(0, 100);

    if (!channels.length) {
      results.innerHTML = `<div class="channel-empty">没有匹配的频道。</div>`;
      return;
    }

    results.innerHTML = channels
      .map(
        (channel) => `
          <button
            class="channel-result"
            type="button"
            data-channel-result="${escapeHtml(channel.id)}"
          >
            <span>
              <strong>${escapeHtml(channel.name)}</strong>
              <span>${escapeHtml(channel.group)}</span>
            </span>
            <em>选择</em>
          </button>
        `
      )
      .join("");
  }

  async function loadScheduleM3u({ silent = false } = {}) {
    const form = $("[data-schedule-form]");
    const button = $("[data-load-m3u]");
    const sourceUrl = form.elements.m3uUrl.value.trim();
    if (!sourceUrl) {
      setInlineStatus($("[data-m3u-status]"), "请先填写 M3U 直播源地址。", "error");
      return;
    }

    button.disabled = true;
    button.textContent = "加载中…";
    setInlineStatus($("[data-m3u-status]"), "正在读取直播源…");
    try {
      const result = await api("/api/sources/m3u", {
        method: "POST",
        body: JSON.stringify({ url: sourceUrl })
      });
      app.m3uChannels = result.channels;
      $("[data-channel-browser]").hidden = false;
      $("[data-channel-search]").value = form.elements.home.value.trim() || "";
      renderM3uResults($("[data-channel-search]").value);
      setInlineStatus(
        $("[data-m3u-status]"),
        `已加载 ${result.count} 个频道，来源已保存到设置。`
      );
      if (!silent) {
        toast("直播源已加载", `共找到 ${result.count} 个频道。`);
      }
    } catch (error) {
      app.m3uChannels = [];
      $("[data-channel-browser]").hidden = true;
      setInlineStatus($("[data-m3u-status]"), error.message, "error");
      if (!silent) {
        toast("直播源加载失败", error.message, "error");
      }
    } finally {
      button.disabled = false;
      button.textContent = "加载频道";
    }
  }

  async function probeScheduleStream() {
    const form = $("[data-schedule-form]");
    const button = $("[data-probe-stream]");
    const streamUrl = form.elements.streamUrl.value.trim();
    if (!streamUrl) {
      setInlineStatus($("[data-stream-status]"), "请先填写直播流地址。", "error");
      return;
    }

    button.disabled = true;
    button.textContent = "测试中…";
    setInlineStatus($("[data-stream-status]"), "正在用 FFmpeg 读取视频流…");
    try {
      const result = await api("/api/sources/probe", {
        method: "POST",
        body: JSON.stringify({
          url: streamUrl,
          inputFormat: form.elements.inputFormat.value
        })
      });
      setInlineStatus($("[data-stream-status]"), `测试通过：${result.message}`);
      toast("直播流可用", result.message);
    } catch (error) {
      setInlineStatus($("[data-stream-status]"), error.message, "error");
      toast("直播流测试失败", error.message, "error");
    } finally {
      button.disabled = false;
      button.textContent = "测试流";
    }
  }

  async function testSettingsM3u() {
    const form = $("[data-settings-form]");
    const button = $("[data-settings-m3u-test]");
    const sourceUrl = form.elements.m3uUrl.value.trim();
    if (!sourceUrl) {
      setInlineStatus($("[data-settings-m3u-state]"), "请先填写 M3U 地址。", "error");
      return;
    }

    button.disabled = true;
    button.textContent = "测试中…";
    setInlineStatus($("[data-settings-m3u-state]"), "正在读取频道列表…");
    try {
      const result = await api("/api/sources/m3u", {
        method: "POST",
        body: JSON.stringify({ url: sourceUrl })
      });
      app.m3uChannels = result.channels;
      setInlineStatus(
        $("[data-settings-m3u-state]"),
        `连接成功，共读取到 ${result.count} 个频道。`
      );
      toast("M3U 直播源可用", `共 ${result.count} 个频道。`);
    } catch (error) {
      setInlineStatus($("[data-settings-m3u-state]"), error.message, "error");
      toast("M3U 直播源不可用", error.message, "error");
    } finally {
      button.disabled = false;
      button.textContent = "测试源";
    }
  }

  function openPlayer(recordingId) {
    const recording =
      app.data.recordings.find((item) => item.id === recordingId) ||
      app.availableReplays.find((item) => item.id === recordingId);
    if (!recording) {
      toast("没有找到这段录像", "", "error");
      return;
    }

    const isChannelReplay = recording.sourceType === "channel-replay";
    app.activeRecording = recording;
    app.lastSavedProgress = recording.watchedSeconds || 0;
    pauseHomeMusic();
    const layer = $("[data-player-layer]");
    const video = $("[data-video]");
    const message = $("[data-player-message]");
    const shell = $(".player-shell");

    $("[data-player-title]").textContent = recording.title;
    const subtitle = $("[data-player-subtitle]");
    if (subtitle) {
      const commentary = isChannelReplay && recording.commentary
        ? `解说 ${recording.commentary} · `
        : "";
      subtitle.textContent = isChannelReplay
        ? `当前可回放 · ${commentary}${recording.quality || "HLS"} · ${
            recording.variantCount || 1
          } 条线路`
        : "比分与赛果已封存";
    }
    $("[data-score-shield]").classList.toggle(
      "is-hidden",
      isChannelReplay || !app.data.settings.spoilerMode
    );
    $("[data-player-reveal]").hidden = isChannelReplay;
    message.hidden = true;
    layer.hidden = false;
    if (window.history.state?.overlay !== "player") {
      window.history.pushState(
        { ...(window.history.state || {}), overlay: "player" },
        "",
        window.location.href
      );
    }
    document.body.style.overflow = "hidden";
    applyMaskStyles();
    updateRevealButton(recording);

    if (!recording.mediaUrl) {
      video.removeAttribute("src");
      message.hidden = false;
      return;
    }

    destroyPlayerHls();
    if (isChannelReplay && window.Hls?.isSupported()) {
      const hls = new window.Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        backBufferLength: 60
      });
      app.playerHls = hls;
      hls.loadSource(recording.mediaUrl);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {
          // Autoplay policies can wait for a direct user gesture.
        });
      });
      hls.on(window.Hls.Events.ERROR, (_, data) => {
        if (!data?.fatal) {
          return;
        }
        message.hidden = false;
        message.querySelector("strong").textContent = "回放暂时无法播放";
        message.querySelector("p").textContent = "这条回放线路可能已经下线，请回到待看录像重新检测。";
      });
    } else {
      video.src = recording.mediaUrl;
      video.currentTime = Math.min(
        Number(recording.watchedSeconds || 0),
        Number(recording.durationSeconds || 0) ||
          Number(recording.watchedSeconds || 0)
      );
      video.load();
      video.play().catch(() => {
        // Autoplay policies can wait for a direct user gesture; the play button stays available.
      });
    }
    window.setTimeout(() => shell.focus?.(), 0);
  }

  function closePlayer() {
    const video = $("[data-video]");
    savePlayerProgress(true);
    destroyPlayerHls();
    video.pause();
    video.removeAttribute("src");
    video.load();
    $("[data-player-layer]").hidden = true;
    if (window.history.state?.overlay === "player") {
      window.history.replaceState(
        { ...(window.history.state || {}), overlay: null },
        "",
        window.location.href
      );
    }
    document.body.style.overflow = "";
    app.activeRecording = null;
    window.clearInterval(app.progressTimer);
    app.progressTimer = null;
    if (app.view === "home" && !app.homeMusicUserPaused) {
      playHomeMusic();
    }
  }

  function updateRevealButton(recording) {
    const button = $("[data-player-reveal]");
    if (!recording) {
      return;
    }
    if (recording.sourceType === "channel-replay") {
      button.hidden = true;
      return;
    }
    button.hidden = false;
    if (recording.score) {
      button.innerHTML = `<i data-lucide="eye"></i>${escapeHtml(
        recording.score.home
      )} : ${escapeHtml(recording.score.away)}`;
      button.disabled = true;
    } else {
      button.innerHTML = `<i data-lucide="eye-off"></i>揭晓比分`;
      button.disabled = false;
    }
    refreshIcons();
  }

  async function savePlayerProgress(force = false) {
    const video = $("[data-video]");
    const recording = app.activeRecording;
    if (
      !recording ||
      recording.sourceType === "channel-replay" ||
      !Number.isFinite(video.currentTime)
    ) {
      return;
    }
    const current = Math.floor(video.currentTime);
    if (!force && Math.abs(current - app.lastSavedProgress) < 10) {
      return;
    }
    app.lastSavedProgress = current;
    try {
      await api(`/api/recordings/${encodeURIComponent(recording.id)}/progress`, {
        method: "PATCH",
        body: JSON.stringify({ watchedSeconds: current })
      });
      recording.watchedSeconds = current;
    } catch {
      // Progress is a convenience, not a playback blocker.
    }
  }

  function updatePlayerUI() {
    const video = $("[data-video]");
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const progress = duration ? (current / duration) * 1000 : 0;
    const timeline = $("[data-player-timeline]");
    timeline.value = progress;
    timeline.style.setProperty("--timeline-progress", `${duration ? (current / duration) * 100 : 0}%`);
    $("[data-player-current]").textContent = formatClock(current);
    $("[data-player-duration]").textContent = formatClock(duration);

    const toggle = $("[data-player-toggle]");
    toggle.innerHTML = `<i data-lucide="${video.paused ? "play" : "pause"}"></i><span class="sr-only">${
      video.paused ? "播放" : "暂停"
    }</span>`;
    refreshIcons();

    const muteButton = $("[data-player-mute]");
    muteButton.innerHTML = `<i data-lucide="${
      video.muted || video.volume === 0 ? "volume-x" : "volume-2"
    }"></i>`;
    refreshIcons();
  }

  function askReveal(recording) {
    if (!recording) {
      return;
    }
    app.revealTarget = recording;
    $("[data-reveal-dialog]").showModal();
  }

  async function revealScore() {
    const recording = app.revealTarget;
    if (!recording) {
      return;
    }
    try {
      const result = await api(
        `/api/recordings/${encodeURIComponent(recording.id)}/reveal`,
        { method: "POST", body: "{}" }
      );
      recording.score = result.score;
      toast(
        "比分已经揭晓",
        `${recording.title}：${result.score.home} : ${result.score.away}`
      );
      if (app.activeRecording?.id === recording.id) {
        updateRevealButton(recording);
      }
      renderRecordings();
    } catch (error) {
      toast("无法揭晓比分", error.message, "error");
    } finally {
      app.revealTarget = null;
    }
  }

  function askDeleteRecording(recording) {
    if (!recording) {
      return;
    }
    app.deleteTarget = recording;
    $("[data-delete-copy]").textContent = `“${recording.title}”会从本机录像库中移除，且无法撤销。`;
    $("[data-delete-dialog]").showModal();
  }

  async function deleteRecording() {
    const recording = app.deleteTarget;
    if (!recording) {
      return;
    }
    try {
      const result = await api(`/api/recordings/${encodeURIComponent(recording.id)}`, {
        method: "DELETE"
      });
      app.data.recordings = app.data.recordings.filter(
        (item) => item.id !== recording.id
      );
      if (app.activeRecording?.id === recording.id) {
        closePlayer();
      }
      toast(
        "录像已删除",
        result.fileDeleted
          ? `${recording.title} 的本地文件也已删除`
          : `${recording.title} 已从录像库移除`
      );
      renderAll();
    } catch (error) {
      toast("无法删除录像", error.message, "error");
    } finally {
      app.deleteTarget = null;
    }
  }

  function updateRecordingPreview() {
    if (!app.previewFixtureId) {
      return;
    }
    const fixture = app.data.fixtures.find(
      (item) => item.id === app.previewFixtureId
    );
    const job = app.data.health?.activeJobs?.find(
      (item) => item.fixtureId === app.previewFixtureId
    );
    if (!fixture || !job) {
      $("[data-preview-caption]").textContent = "录制已经结束。";
      return;
    }
    $("[data-preview-title]").textContent = `${fixture.home} vs ${fixture.away}`;
    $("[data-preview-caption]").textContent = `${formatClock(
      job.progressSeconds || 0
    )} / ${formatClock(job.durationSeconds || 0)}${
      job.speed ? ` · 速度 ${job.speed}` : ""
    }`;
    $("[data-preview-image]").src = `/api/fixtures/${encodeURIComponent(
      fixture.id
    )}/preview?t=${Date.now()}`;
  }

  function openRecordingPreview(fixtureId) {
    const fixture = app.data.fixtures.find((item) => item.id === fixtureId);
    if (!fixture) {
      return;
    }
    app.previewFixtureId = fixtureId;
    $("[data-preview-dialog]").showModal();
    updateRecordingPreview();
    window.clearInterval(app.previewTimer);
    app.previewTimer = window.setInterval(updateRecordingPreview, 2000);
  }

  async function stopFixtureRecording(fixtureId) {
    try {
      await api(
        `/api/fixtures/${encodeURIComponent(fixtureId)}/stop-recording`,
        { method: "POST", body: "{}" }
      );
      toast("正在停止录制", "已请求保存当前录像，完成后会进入录像库");
      window.setTimeout(() => loadState({ quiet: true }), 1200);
    } catch (error) {
      toast("无法停止录制", error.message, "error");
    }
  }

  function askCancelRecording(fixture) {
    if (!fixture) {
      return;
    }
    app.cancelRecordingTarget = fixture;
    $("[data-cancel-recording-copy]").textContent = `“${fixture.home} vs ${fixture.away}”正在写入的临时录像会被删除。`;
    $("[data-cancel-recording-dialog]").showModal();
  }

  async function cancelFixtureRecording() {
    const fixture = app.cancelRecordingTarget;
    if (!fixture) {
      return;
    }
    try {
      await api(
        `/api/fixtures/${encodeURIComponent(fixture.id)}/cancel-recording`,
        { method: "POST", body: "{}" }
      );
      if (app.previewFixtureId === fixture.id) {
        $("[data-preview-dialog]").close();
      }
      toast("正在取消录制", `${fixture.home} vs ${fixture.away} 的临时文件会被删除`);
      window.setTimeout(() => loadState({ quiet: true }), 800);
    } catch (error) {
      toast("无法取消录制", error.message, "error");
    } finally {
      app.cancelRecordingTarget = null;
    }
  }

  async function scanLibrary() {
    try {
      const result = await api("/api/library/scan", {
        method: "POST",
        body: "{}"
      });
      await loadState({ quiet: true });
      toast(
        result.count ? `发现 ${result.count} 段新录像` : "没有发现新录像",
        result.count ? "已经加入待看列表。" : "确认录像目录里包含视频文件。"
      );
    } catch (error) {
      toast("扫描失败", error.message, "error");
    }
  }

  async function saveSettings(event) {
    event?.preventDefault();
    const form = $("[data-settings-form]");
    const payload = {
      spoilerMode: form.elements.spoilerMode.checked,
      burnInMask: form.elements.burnInMask.value === "true",
      recordingDir: form.elements.recordingDir.value,
      m3uUrl: form.elements.m3uUrl.value,
      tvRequireToken: form.elements.tvRequireToken.checked,
      preRollMinutes: Number(form.elements.preRollMinutes.value),
      postRollMinutes: Number(form.elements.postRollMinutes.value),
      diskWarningGb: Number(form.elements.diskWarningGb.value)
    };
    try {
      const result = await api("/api/settings", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      app.data.settings = result.settings;
      applyMaskStyles();
      renderHealth();
      toast("设置已保存", "新的录制任务会使用这些选项。");
    } catch (error) {
      toast("设置保存失败", error.message, "error");
    }
  }

  async function saveSchedule(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (event.submitter?.value === "cancel") {
      form.closest("dialog")?.close();
      return;
    }
    const fixtureId = form.dataset.fixtureId;
    const payload = {
      home: form.elements.home.value,
      away: form.elements.away.value,
      competition: form.elements.competition.value,
      kickoffAt: new Date(form.elements.kickoffAt.value).toISOString(),
      durationMinutes: Number(form.elements.durationMinutes.value),
      streamUrl: form.elements.streamUrl.value,
      inputFormat: form.elements.inputFormat.value,
      record: true
    };

    try {
      await api(fixtureId ? `/api/fixtures/${encodeURIComponent(fixtureId)}` : "/api/fixtures", {
        method: fixtureId ? "PATCH" : "POST",
        body: JSON.stringify(payload)
      });
      $("[data-schedule-dialog]").close();
      await loadState({ quiet: true });
      toast(fixtureId ? "录制计划已更新" : "已经加入录制队列", `${payload.home} vs ${payload.away}`);
    } catch (error) {
      toast("无法保存录制计划", error.message, "error");
    }
  }

  async function saveMask(event) {
    event.preventDefault();
    if (event.submitter?.value === "cancel") {
      event.currentTarget.closest("dialog")?.close();
      return;
    }
    updateMaskDraftPreview();
    try {
      const result = await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({ mask: app.maskDraft })
      });
      app.data.settings = result.settings;
      applyMaskStyles();
      $("[data-mask-dialog]").close();
      toast("遮罩位置已更新", "播放器和后续永久遮罩都会使用这个范围。");
    } catch (error) {
      toast("遮罩保存失败", error.message, "error");
    }
  }

  async function importRecording(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (event.submitter?.value === "cancel") {
      form.closest("dialog")?.close();
      return;
    }
    const localPath = form.elements.localPath.value.trim();
    if (!localPath) {
      toast("请填写录像路径", "也可以直接扫描录像目录。", "error");
      return;
    }
    try {
      await api("/api/recordings/import", {
        method: "POST",
        body: JSON.stringify({ localPath })
      });
      $("[data-import-dialog]").close();
      form.reset();
      await loadState({ quiet: true });
      toast("录像已导入", "不会从文件名或封面显示赛果。");
    } catch (error) {
      toast("导入失败", error.message, "error");
    }
  }

  async function recordFixtureNow(fixtureId) {
    try {
      const result = await api(`/api/fixtures/${encodeURIComponent(fixtureId)}/record-now`, {
        method: "POST",
        body: "{}"
      });
      await loadState({ quiet: true });
      toast(
        result.active ? "录制已经开始" : "没有启动录制",
        result.active ? "服务会按结束时间自动收尾。" : "请检查直播源和录制引擎。",
        result.active ? "success" : "error"
      );
    } catch (error) {
      toast("无法开始录制", error.message, "error");
    }
  }

  function bindEvents() {
    document.addEventListener("change", (event) => {
      if (!event.target.matches("[data-replay-variant]")) {
        return;
      }
      const replay = app.availableReplays.find(
        (item) => item.id === event.target.dataset.replayVariant
      );
      const variant = replay?.variants?.find(
        (item) => item.channelId === event.target.value
      );
      if (!replay || !variant) {
        return;
      }
      replay.channelId = variant.channelId;
      replay.mediaUrl = variant.streamUrl;
      replay.quality = variant.quality || replay.quality;
      replay.commentary = variant.commentary || variant.label;
      const length = event.target
        .closest(".recording-row")
        ?.querySelector(".recording-length");
      if (length) {
        length.textContent = replay.quality || "HLS 回放";
      }
    });

    document.addEventListener("click", (event) => {
      const cancelButton = event.target.closest('dialog button[value="cancel"]');
      if (cancelButton) {
        event.preventDefault();
        cancelButton.closest("dialog")?.close();
        return;
      }

      if (event.target.closest("[data-music-toggle]")) {
        toggleHomeMusic();
        return;
      }

      const viewButton = event.target.closest("[data-view]");
      if (viewButton) {
        navigate(viewButton.dataset.view);
        return;
      }

      if (event.target.closest("[data-mobile-library-open]")) {
        $('[data-view-panel="home"]')?.classList.add("is-mobile-library");
        document.body.classList.add("is-home-library");
        loadAvailableReplays();
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      if (event.target.closest("[data-mobile-library-back]")) {
        $('[data-view-panel="home"]')?.classList.remove("is-mobile-library");
        document.body.classList.remove("is-home-library");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      if (event.target.closest("[data-open-schedule]")) {
        openScheduleDialog();
        return;
      }

      const editButton = event.target.closest("[data-edit-fixture]");
      if (editButton) {
        const fixture = app.data.fixtures.find(
          (item) => item.id === editButton.dataset.editFixture
        );
        if (fixture) openScheduleDialog(fixture);
        return;
      }

      const recordButton = event.target.closest("[data-record-now]");
      if (recordButton) {
        recordFixtureNow(recordButton.dataset.recordNow);
        return;
      }

      if (event.target.closest("[data-refresh-replays]")) {
        loadAvailableReplays({ force: true, quiet: false });
        return;
      }

      const playButton = event.target.closest("[data-play], [data-play-fixture]");
      if (playButton) {
        openPlayer(playButton.dataset.play || playButton.dataset.playFixture);
        return;
      }

      const revealButton = event.target.closest("[data-reveal]");
      if (revealButton) {
        const recording = app.data.recordings.find(
          (item) => item.id === revealButton.dataset.reveal
        );
        askReveal(recording);
        return;
      }

      const deleteButton = event.target.closest("[data-delete-recording]");
      if (deleteButton) {
        const recording = app.data.recordings.find(
          (item) => item.id === deleteButton.dataset.deleteRecording
        );
        askDeleteRecording(recording);
        return;
      }

      const previewButton = event.target.closest("[data-preview-fixture]");
      if (previewButton) {
        openRecordingPreview(previewButton.dataset.previewFixture);
        return;
      }

      const stopButton = event.target.closest("[data-stop-recording]");
      if (stopButton) {
        stopFixtureRecording(stopButton.dataset.stopRecording);
        return;
      }

      const cancelRecordingButton = event.target.closest("[data-cancel-recording]");
      if (cancelRecordingButton) {
        const fixture = app.data.fixtures.find(
          (item) => item.id === cancelRecordingButton.dataset.cancelRecording
        );
        askCancelRecording(fixture);
        return;
      }

      if (event.target.closest("[data-rescan]")) {
        scanLibrary();
        return;
      }

      if (event.target.closest("[data-refresh-logs]")) {
        loadLogs().catch((error) => toast("无法读取日志", error.message, "error"));
        return;
      }

      if (event.target.closest("[data-copy-logs]")) {
        copyDiagnostics();
        return;
      }

      if (event.target.closest("[data-clear-logs]")) {
        clearLogs().catch((error) => toast("无法清空日志", error.message, "error"));
        return;
      }

      if (event.target.closest("[data-import-open]")) {
        $("[data-import-dialog]").showModal();
        return;
      }

      if (event.target.closest("[data-open-tv-dialog]")) {
        $("[data-tv-dialog]").showModal();
        return;
      }

      if (event.target.closest("[data-tv-dialog-copy-playlist]")) {
        copyText($("[data-tv-dialog-playlist]").value, "M3U 订阅地址");
        return;
      }

      if (event.target.closest("[data-tv-dialog-copy-epg]")) {
        copyText($("[data-tv-dialog-epg]").value, "EPG 地址");
        return;
      }

      if (event.target.closest("[data-scan-dialog]")) {
        scanLibrary();
        $("[data-import-dialog]").close();
        return;
      }

      if (event.target.closest("[data-load-m3u]")) {
        loadScheduleM3u();
        return;
      }

      if (event.target.closest("[data-settings-m3u-test]")) {
        testSettingsM3u();
        return;
      }

      if (event.target.closest("[data-channel-source-add]")) {
        addChannelSource();
        return;
      }

      const sourceToggle = event.target.closest("[data-channel-source-toggle]");
      if (sourceToggle) {
        toggleChannelSource(sourceToggle.dataset.channelSourceToggle);
        return;
      }

      const sourceDelete = event.target.closest("[data-channel-source-delete]");
      if (sourceDelete) {
        deleteChannelSource(sourceDelete.dataset.channelSourceDelete);
        return;
      }

      if (event.target.closest("[data-tv-copy-playlist]")) {
        copyText($("[data-tv-playlist-url]").value, "M3U 订阅地址");
        return;
      }

      if (event.target.closest("[data-tv-copy-epg]")) {
        copyText($("[data-tv-epg-url]").value, "EPG 地址");
        return;
      }

      if (event.target.closest("[data-tv-copy-token]")) {
        copyText($("[data-tv-token]").value, "电视令牌");
        return;
      }

      if (event.target.closest("[data-tv-regenerate]")) {
        regenerateTvToken();
        return;
      }

      if (event.target.closest("[data-tv-test]")) {
        testTvPlaylist();
        return;
      }

      if (event.target.closest("[data-probe-stream]")) {
        probeScheduleStream();
        return;
      }

      const channelResult = event.target.closest("[data-channel-result]");
      if (channelResult) {
        const channel = app.m3uChannels.find(
          (item) => item.id === channelResult.dataset.channelResult
        );
        if (channel) {
          const form = $("[data-schedule-form]");
          form.elements.streamUrl.value = channel.streamUrl;
          form.elements.inputFormat.value = "hls";
          setInlineStatus(
            $("[data-stream-status]"),
            `已选择：${channel.name}（${channel.group}）`
          );
        }
        return;
      }

      if (event.target.closest("[data-open-mask]")) {
        openMaskDialog();
        return;
      }

      if (event.target.closest("[data-save-settings]")) {
        saveSettings();
        return;
      }

      const preset = event.target.closest("[data-mask-preset]");
      if (preset) {
        applyPreset(preset.dataset.maskPreset);
        return;
      }

      if (event.target.closest("[data-player-close]")) {
        closePlayer();
        return;
      }

      if (event.target.closest("[data-player-reveal]")) {
        if (app.activeRecording && !app.activeRecording.score) {
          askReveal(app.activeRecording);
        }
        return;
      }

      if (event.target.closest("[data-player-toggle]")) {
        const video = $("[data-video]");
        if (video.paused) {
          video.play().catch(() => {
            $("[data-player-message]").hidden = false;
          });
        } else {
          video.pause();
        }
        return;
      }

      if (event.target.closest("[data-player-back10]")) {
        const video = $("[data-video]");
        video.currentTime = Math.max(0, video.currentTime - 10);
        return;
      }

      if (event.target.closest("[data-player-forward30]")) {
        const video = $("[data-video]");
        video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 30);
        return;
      }

      if (event.target.closest("[data-player-mask]")) {
        $("[data-score-shield]").classList.toggle("is-hidden");
        return;
      }

      if (event.target.closest("[data-player-mute]")) {
        const video = $("[data-video]");
        video.muted = !video.muted;
        updatePlayerUI();
        return;
      }

      if (event.target.closest("[data-player-fullscreen]")) {
        const stage = $("[data-video-stage]");
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          stage.requestFullscreen?.();
        }
      }
    });

    $("[data-schedule-form]").addEventListener("submit", saveSchedule);
    $("[data-settings-form]").addEventListener("submit", saveSettings);
    $("[data-mask-form]").addEventListener("submit", saveMask);
    $("[data-import-form]").addEventListener("submit", importRecording);

    $("[data-mask-form]").addEventListener("input", updateMaskDraftPreview);
    $("[data-channel-search]").addEventListener("input", (event) => {
      renderM3uResults(event.target.value);
    });
    $("[data-log-search]").addEventListener("input", (event) => {
      app.logQuery = event.target.value;
      renderLogs();
    });
    $("[data-log-level]").addEventListener("change", (event) => {
      app.logLevel = event.target.value;
      loadLogs().catch((error) => toast("无法读取日志", error.message, "error"));
    });

    $("[data-reveal-dialog]").addEventListener("close", (event) => {
      if (event.currentTarget.returnValue === "confirm") {
        revealScore();
      }
    });

    $("[data-delete-dialog]").addEventListener("close", (event) => {
      if (event.currentTarget.returnValue === "confirm") {
        deleteRecording();
      }
    });

    $("[data-cancel-recording-dialog]").addEventListener("close", (event) => {
      if (event.currentTarget.returnValue === "confirm") {
        cancelFixtureRecording();
      }
    });

    $("[data-preview-dialog]").addEventListener("close", () => {
      window.clearInterval(app.previewTimer);
      app.previewTimer = null;
      app.previewFixtureId = null;
      $("[data-preview-image]").removeAttribute("src");
    });

    const homeMusic = $("[data-home-music]");
    homeMusic.addEventListener("play", () => {
      handleHomeMusicPlay();
      saveHomeMusicState();
    });
    homeMusic.addEventListener("pause", () => {
      updateHomeMusicUI();
      if (app.homeMusicUserPaused) {
        saveHomeMusicState();
      }
    });
    homeMusic.addEventListener("timeupdate", () => {
      const second = Math.floor(homeMusic.currentTime);
      if (second % 5 === 0 && second !== app.homeMusicLastSavedSecond) {
        app.homeMusicLastSavedSecond = second;
        saveHomeMusicState();
      }
    });
    homeMusic.addEventListener("ended", advanceHomeMusic);
    homeMusic.addEventListener("error", () => {
      app.homeMusicReady = false;
      updateHomeMusicUI();
      toast("队歌无法播放", "请检查发布包中的音频文件。", "error");
    });
    window.addEventListener("pagehide", saveHomeMusicState);

    const video = $("[data-video]");
    video.addEventListener("loadedmetadata", updatePlayerUI);
    video.addEventListener("timeupdate", () => {
      updatePlayerUI();
      savePlayerProgress();
    });
    video.addEventListener("play", updatePlayerUI);
    video.addEventListener("pause", updatePlayerUI);
    video.addEventListener("ended", () => {
      updatePlayerUI();
      const button = $("[data-player-reveal]");
      if (app.activeRecording && !app.activeRecording.score) {
        button.innerHTML = `<i data-lucide="eye"></i>录像结束 · 揭晓比分`;
        refreshIcons();
      }
    });
    video.addEventListener("error", () => {
      $("[data-player-message]").hidden = false;
    });

    $("[data-player-timeline]").addEventListener("input", (event) => {
      if (Number.isFinite(video.duration)) {
        video.currentTime = (Number(event.target.value) / 1000) * video.duration;
      }
    });

    $("[data-player-volume]").addEventListener("input", (event) => {
      video.volume = Number(event.target.value);
      video.muted = video.volume === 0;
      updatePlayerUI();
    });

    window.addEventListener("hashchange", () => {
      navigate(window.location.hash.slice(1) || "home");
    });

    window.addEventListener("popstate", () => {
      const player = $("[data-player-layer]");
      if (!player.hidden) {
        closePlayer();
        return;
      }
      const openDialog = document.querySelector("dialog[open]");
      if (openDialog) {
        openDialog.close();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !$("[data-player-layer]").hidden) {
        closePlayer();
      }
      if (
        event.code === "Space" &&
        !$("[data-player-layer]").hidden &&
        !["INPUT", "BUTTON"].includes(document.activeElement?.tagName)
      ) {
        event.preventDefault();
        $("[data-player-toggle]").click();
      }
    });

    window.setInterval(async () => {
      try {
        app.data.health = await api("/api/health");
        renderHealth();
        renderSchedule();
        if (app.view === "logs") {
          await loadLogs();
        }
      } catch {
        // Keep the last known status while the local service is temporarily busy.
      }
    }, 3_000);
  }

  async function boot() {
    bindEvents();
    navigate(window.location.hash.slice(1) || "home");
    initializeHomeBackdrop();
    initializeHomeMusic();
    await Promise.all([loadState(), loadChannelSources(), loadTvConfig()]);
    refreshIcons();
  }

  boot();
})();

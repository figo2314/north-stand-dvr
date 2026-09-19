(() => {
  "use strict";

  const QUALITY_STORAGE_KEY = "north-stand-channel-quality";
  const FAVORITES_STORAGE_KEY = "north-stand-channel-favorites";
  const RECENT_STORAGE_KEY = "north-stand-channel-recent";
  const CHANNEL_SCOPE = document.body.dataset.channelScope || "general";
  const FOOTBALL_PATTERN =
    /足球|英超|西甲|德甲|意甲|法甲|欧冠|欧联|世界杯|欧洲杯|中超|亚冠|世预赛|友谊赛|全场回放/;
  const QUALITY_TTL_MS = 6 * 60 * 60 * 1000;
  const DEFAULT_CHANNEL_PATTERN = /翡翠台/;
  const DEFAULT_CHANNEL_ROW_HEIGHT = 78;
  const CHANNEL_OVERSCAN = 8;
  const LEGACY_M3U_SOURCES = [
    {
      label: "myIPTV",
      url: "https://gh-proxy.org/raw.githubusercontent.com/suxuang/myIPTV/main/ipv4.m3u"
    },
    {
      label: "GitHub",
      url: "https://raw.githubusercontent.com/suxuang/myIPTV/main/ipv4.m3u"
    }
  ];

  function loadQualityCache() {
    try {
      const saved = JSON.parse(
        window.localStorage.getItem(QUALITY_STORAGE_KEY) || "{}"
      );
      return saved && typeof saved === "object" ? saved : {};
    } catch {
      return {};
    }
  }

  function loadFavorites() {
    try {
      const saved = JSON.parse(
        window.localStorage.getItem(FAVORITES_STORAGE_KEY) || "[]"
      );
      return new Set(
        Array.isArray(saved)
          ? saved.filter((value) => typeof value === "string")
          : []
      );
    } catch {
      return new Set();
    }
  }

  function loadRecent() {
    try {
      const saved = JSON.parse(
        window.localStorage.getItem(RECENT_STORAGE_KEY) || "[]"
      );
      return Array.isArray(saved)
        ? saved.filter((value) => typeof value === "string").slice(0, 20)
        : [];
    } catch {
      return [];
    }
  }

  const app = {
    channels: [],
    groups: [],
    group: "",
    favoritesOnly: false,
    recentOnly: false,
    recent: loadRecent(),
    smartSort: true,
    playableOnly: false,
    favorites: loadFavorites(),
    query: "",
    activeChannel: null,
    autoSelecting: false,
    footballAttempts: new Set(),
    hls: null,
    statsTimer: null,
    fallbackTimer: null,
    wakeLock: null,
    brightness: 1,
    playbackStartedAt: 0,
    stutterEvents: [],
    qualityPrompted: new Set(),
    pendingQualitySwitch: null,
    scrollFrame: null,
    channelWindow: null,
    hudTimer: null,
    controlsTimer: null,
    playbackMode: "live",
    seeking: false,
    gesture: null,
    lastTapAt: 0,
    settings: null,
    sourceLabels: [],
    epg: {},
    epgUrls: [],
    detailChannel: null,
    jadeAttempts: new Set(),
    qualityCache: loadQualityCache(),
    qualityQueue: [],
    qualityQueued: new Set(),
    qualityActive: new Set(),
    qualityPreflightKeys: new Set(),
    qualityPreflightTotal: 0,
    qualityObserver: null,
    channelRowHeight: DEFAULT_CHANNEL_ROW_HEIGHT
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
    window.lucide?.createIcons({ attrs: { "aria-hidden": "true" } });
  }

  function currentChannelRowHeight() {
    const raw = window
      .getComputedStyle(document.body || document.documentElement)
      .getPropertyValue("--channel-row-height")
      .trim();
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value > 0
      ? value
      : DEFAULT_CHANNEL_ROW_HEIGHT;
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
    window.setTimeout(() => item.remove(), 4200);
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

  function formatClock(value) {
    const totalSeconds = Math.max(0, Math.floor(Number(value) || 0));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (part) => String(part).padStart(2, "0");
    return hours
      ? `${hours}:${pad(minutes)}:${pad(seconds)}`
      : `${pad(minutes)}:${pad(seconds)}`;
  }

  function updateReplayProgress() {
    const video = $("[data-channel-video]");
    const progress = $("[data-channel-replay-progress]");
    const seek = $("[data-channel-seek]");
    if (!video || !progress || !seek) {
      return;
    }

    const duration = Number(video.duration);
    const seekable =
      app.playbackMode === "replay" &&
      Number.isFinite(duration) &&
      duration > 0;
    progress.hidden = !seekable;
    if (!seekable) {
      return;
    }

    const current = Math.min(
      Math.max(Number(video.currentTime) || 0, 0),
      duration
    );
    seek.max = String(duration);
    if (!app.seeking) {
      seek.value = String(current);
    }
    const percentage = Math.min(100, Math.max(0, (current / duration) * 100));
    seek.style.setProperty("--channel-progress", `${percentage}%`);
    seek.setAttribute(
      "aria-valuetext",
      `已播放 ${formatClock(current)}，总时长 ${formatClock(duration)}`
    );
    $("[data-channel-progress-current]").textContent = formatClock(current);
    $("[data-channel-progress-duration]").textContent = formatClock(duration);
  }

  function channelColor(name) {
    const colors = [
      "oklch(0.5 0.18 25)",
      "oklch(0.48 0.13 255)",
      "oklch(0.5 0.12 153)",
      "oklch(0.52 0.12 305)",
      "oklch(0.55 0.13 70)"
    ];
    const hash = Array.from(String(name)).reduce(
      (sum, char) => sum + char.codePointAt(0),
      0
    );
    return colors[hash % colors.length];
  }

  function qualityKey(channel) {
    return `${channel.id}|${channel.streamUrl}`;
  }

  function isFootballChannel(channel) {
    return (
      channel.group.startsWith("体育-") ||
      FOOTBALL_PATTERN.test(`${channel.name} ${channel.group}`)
    );
  }

  function isReplayChannel(channel) {
    return /全场回放|回放|重播|集锦录像/.test(
      `${channel.name || ""} ${channel.group || ""}`
    );
  }

  function isArsenalChannel(channel) {
    return /阿森纳|Arsenal/i.test(
      `${channel.name || ""} ${channel.group || ""}`
    );
  }

  function isArsenalHighlight(channel) {
    return (
      isArsenalChannel(channel) &&
      /highlight|集锦|高光/i.test(`${channel.name || ""} ${channel.group || ""}`)
    );
  }

  function footballChannelPriority(channel) {
    if (CHANNEL_SCOPE !== "football") {
      return 0;
    }
    if (isArsenalHighlight(channel)) {
      return 100;
    }
    if (isArsenalChannel(channel)) {
      return 80;
    }
    if (isReplayChannel(channel)) {
      return 1;
    }
    if (String(channel.group).includes("今天")) {
      return 5;
    }
    if (String(channel.group).includes("明天")) {
      return 4;
    }
    return 3;
  }

  function guideForChannel(channel) {
    return (
      app.epg[channel.tvgId] ||
      app.epg[channel.tvgName] ||
      app.epg[channel.name] ||
      null
    );
  }

  function programProgress(programme) {
    const start = Date.parse(programme?.start || "");
    const stop = Date.parse(programme?.stop || "");
    if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) {
      return 0;
    }
    return Math.max(0, Math.min(100, ((Date.now() - start) / (stop - start)) * 100));
  }

  function channelScore(channel) {
    const health = freshQuality(channel);
    if (!health) {
      return footballChannelPriority(channel) * 500;
    }
    if (health.playable === false || health.quality === "暂不可用") {
      return footballChannelPriority(channel) * 500 - 10_000;
    }
    return (
      footballChannelPriority(channel) * 500 +
      2_000 +
      Math.min(600, (Number(health.height) || 0) / 2) -
      (Number(health.latencyMs) || 0) / 20 +
      Math.min(100, (Number(health.successes) || 0) * 4) -
      Math.min(2_000, (Number(health.failures) || 0) * 40)
    );
  }

  function sortChannels(channels) {
    if (!app.smartSort) {
      return channels;
    }
    return [...channels].sort(
      (left, right) => channelScore(right) - channelScore(left)
    );
  }

  function favoriteKey(channel) {
    return `${channel.name}|${channel.streamUrl}`;
  }

  function isFavorite(channel) {
    return app.favorites.has(favoriteKey(channel));
  }

  function saveFavorites() {
    window.localStorage.setItem(
      FAVORITES_STORAGE_KEY,
      JSON.stringify(Array.from(app.favorites))
    );
  }

  function recordRecent(channel) {
    const key = favoriteKey(channel);
    app.recent = [key, ...app.recent.filter((item) => item !== key)].slice(0, 20);
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(app.recent));
  }

  function toggleFavorite(channel) {
    const key = favoriteKey(channel);
    if (app.favorites.has(key)) {
      app.favorites.delete(key);
    } else {
      app.favorites.add(key);
    }
    saveFavorites();
  }

  function updateFavoriteButton(channel) {
    const button = document.querySelector(
      `[data-favorite-channel="${CSS.escape(channel.id)}"]`
    );
    if (!button) {
      return;
    }
    const favorite = isFavorite(channel);
    button.classList.toggle("is-active", favorite);
    button.setAttribute("aria-pressed", String(favorite));
    button.setAttribute(
      "aria-label",
      `${favorite ? "取消收藏" : "收藏"} ${channel.name}`
    );
    button.innerHTML = `<i data-lucide="star"></i>`;
    refreshIcons();
  }

  function formatHeight(height) {
    const value = Number(height) || 0;
    if (value >= 2160) return "4K";
    if (value >= 1080) return "1080p";
    if (value >= 720) return "720p";
    if (value >= 576) return "576p";
    if (value >= 480) return "480p";
    return value ? `${value}p` : "";
  }

  function qualityStateForChannel(channel) {
    const cached = app.qualityCache[qualityKey(channel)];
    if (cached && Date.now() - cached.checkedAt < QUALITY_TTL_MS) {
      if (cached.playable === false || cached.quality === "暂不可用") {
        return { label: "离线", tone: "offline" };
      }
      return {
        label: `可播 ${cached.quality || "已连接"}`,
        tone: "playable"
      };
    }
    return { label: "检测中", tone: "checking" };
  }

  function updateQualityTag(channel) {
    const tag = document.querySelector(
      `[data-quality-for="${CSS.escape(qualityKey(channel))}"]`
    );
    if (tag) {
      const state = qualityStateForChannel(channel);
      tag.textContent = state.label;
      tag.classList.remove("is-checking", "is-playable", "is-offline");
      tag.classList.add(`is-${state.tone}`);
    }
  }

  function saveQualityCache() {
    window.localStorage.setItem(
      QUALITY_STORAGE_KEY,
      JSON.stringify(app.qualityCache)
    );
  }

  function hasFreshQuality(channel) {
    return Boolean(freshQuality(channel));
  }

  function freshQuality(channel) {
    const cached = app.qualityCache[qualityKey(channel)];
    return cached && Date.now() - cached.checkedAt < QUALITY_TTL_MS
      ? cached
      : null;
  }

  function knownPlayableChannel() {
    return sortChannels(app.channels).find((channel) => {
      const cached = freshQuality(channel);
      return cached && cached.playable !== false && cached.quality !== "暂不可用";
    });
  }

  function preferredJadeChannel() {
    const candidates = app.channels.filter((channel) =>
      DEFAULT_CHANNEL_PATTERN.test(channel.name)
    );
    const preferredExact = candidates.find((channel) => {
      const name = channel.name.trim();
      return name === "TVB翡翠台 1080P";
    });
    if (preferredExact) {
      return preferredExact;
    }
    if (isMobilePlayback()) {
      const efficient = candidates.find((channel) => {
        return /1080p/i.test(channel.name);
      });
      if (efficient) {
        return efficient;
      }
    }
    const playable = candidates.find((channel) => {
      const cached = freshQuality(channel);
      return cached && cached.playable !== false && cached.quality !== "暂不可用";
    });
    if (playable) {
      return playable;
    }
    return candidates[0] || null;
  }

  function preferredAutoChannel() {
    if (CHANNEL_SCOPE === "football") {
      const liveChannels = app.channels.filter(
        (channel) => !isReplayChannel(channel)
      );
      const arsenalHighlight = sortChannels(app.channels).find(
        (channel) =>
          isArsenalHighlight(channel) &&
          qualityStateForChannel(channel).tone !== "offline"
      );
      if (arsenalHighlight) {
        return arsenalHighlight;
      }
      const arsenalChannel = sortChannels(liveChannels).find(
        (channel) =>
          isArsenalChannel(channel) &&
          qualityStateForChannel(channel).tone !== "offline"
      );
      if (arsenalChannel) {
        return arsenalChannel;
      }
      const playableLive = sortChannels(liveChannels).find((channel) => {
        const cached = freshQuality(channel);
        return cached && cached.playable !== false;
      });
      if (playableLive) {
        return playableLive;
      }
      return (
        sortChannels(liveChannels).find((channel) => !freshQuality(channel)) ||
        null
      );
    }
    const jade = preferredJadeChannel();
    if (jade) {
      return jade;
    }
    const playable = knownPlayableChannel();
    if (playable) {
      return playable;
    }
    return (
      sortChannels(app.channels).find((channel) => {
        const cached = freshQuality(channel);
        return !cached || cached.playable !== false;
      }) || app.channels[0]
    );
  }

  function maybeSwitchToPlayableChannel() {
    if (!app.autoSelecting || !app.activeChannel) {
      return;
    }
    const activeState = qualityStateForChannel(app.activeChannel);
    if (activeState.tone !== "offline") {
      return;
    }
    const playable = knownPlayableChannel();
    if (playable && playable.id !== app.activeChannel.id) {
      playChannel(playable.id, { autoFallback: true, autoSelect: true });
    }
  }

  function queueQualityCheck(channel, { preflight = false, front = false } = {}) {
    const key = qualityKey(channel);
    if (
      hasFreshQuality(channel) ||
      app.qualityActive.has(key) ||
      app.qualityQueued.has(key)
    ) {
      return false;
    }
    app.qualityQueued.add(key);
    if (preflight) {
      app.qualityPreflightKeys.add(key);
    }
    const item = { channel, preflight };
    if (front) {
      app.qualityQueue.unshift(item);
    } else {
      app.qualityQueue.push(item);
    }
    return true;
  }

  function updatePreflightButton() {
    const button = $("[data-channel-preflight]");
    if (!button) {
      return;
    }
    const pending = app.qualityPreflightKeys.size;
    const total = app.qualityPreflightTotal;
    button.disabled = pending > 0;
    const icon = pending > 0 ? "loader-circle" : "scan-search";
    let label = "预检列表";
    if (pending > 0) {
      label = `预检 ${Math.max(0, total - pending)}/${total}`;
    } else {
      app.qualityPreflightTotal = 0;
    }
    button.innerHTML = `
      <i data-lucide="${icon}"></i>
      <span data-preflight-label>${label}</span>
    `;
    refreshIcons();
  }

  async function probeChannel(channel) {
    let response = await fetch("/api/channels/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: channel.streamUrl,
        healthKey: channel.healthKey
      })
    });
    if (response.status === 404) {
      response = await fetch("/api/sources/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: channel.streamUrl,
          inputFormat: "hls",
          quick: true
        })
      });
    }
    return response;
  }

  async function processQualityQueue() {
    while (app.qualityQueue.length && app.qualityActive.size < 3) {
      const item = app.qualityQueue.shift();
      const { channel, preflight } = item;
      const key = qualityKey(channel);
      app.qualityQueued.delete(key);
      if (
        app.qualityActive.has(key) ||
        hasFreshQuality(channel)
      ) {
        if (preflight && app.qualityPreflightKeys.delete(key)) {
          updatePreflightButton();
        }
        continue;
      }
      app.qualityActive.add(key);
      probeChannel(channel)
        .then(async (response) => {
          const payload = await response.json();
          const match = /Video:.*?(\d{3,4})x(\d{3,4})/i.exec(
            payload.message || ""
          );
          const playable = response.ok;
          app.qualityCache[key] = {
            checkedAt: Date.now(),
            playable,
            quality: playable
              ? match
                ? formatHeight(match[2])
                : "已连接"
              : "离线"
          };
          saveQualityCache();
          updateQualityTag(channel);
          maybeSwitchToPlayableChannel();
        })
        .catch(() => {
          app.qualityCache[key] = {
            checkedAt: Date.now(),
            playable: false,
            quality: "离线"
          };
          saveQualityCache();
          updateQualityTag(channel);
          maybeSwitchToPlayableChannel();
        })
        .finally(() => {
          app.qualityActive.delete(key);
          if (app.qualityPreflightKeys.delete(key)) {
            updatePreflightButton();
          }
          processQualityQueue();
        });
    }
    updatePreflightButton();
  }

  function observeQualityRows() {
    app.qualityObserver?.disconnect();
    const root = $("[data-channel-list]");
    app.qualityObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }
          const channel = app.channels.find(
            (item) => qualityKey(item) === entry.target.dataset.qualityFor
          );
          if (channel) {
            queueQualityCheck(channel, { front: true });
          }
          app.qualityObserver.unobserve(entry.target);
        }
        processQualityQueue();
      },
      { root, rootMargin: "160px" }
    );
    for (const row of root.querySelectorAll("[data-quality-for]")) {
      app.qualityObserver.observe(row);
    }
  }

  function runQualityPreflight() {
    if (app.qualityPreflightKeys.size) {
      return;
    }
    const channels = filteredChannels();
    let queued = 0;
    for (const channel of channels) {
      const key = qualityKey(channel);
      if (hasFreshQuality(channel)) {
        continue;
      }
      if (app.qualityActive.has(key) || app.qualityQueued.has(key)) {
        app.qualityPreflightKeys.add(key);
        queued += 1;
        continue;
      }
      if (queueQualityCheck(channel, { preflight: true })) {
        queued += 1;
      }
    }
    app.qualityPreflightTotal = queued;
    updatePreflightButton();
    if (queued) {
      toast("开始预检", `正在检查当前列表的 ${queued} 个频道。`);
      processQualityQueue();
    } else {
      toast("当前列表已预检", "可播放状态仍在 6 小时缓存有效期内。");
    }
  }

  function renderGroups() {
    const container = $("[data-channel-groups]");
    container.innerHTML = [
      `<button
        type="button"
        data-channel-smart-sort
        class="${app.smartSort ? "is-active" : ""}"
      >智能排序</button>`,
      `<button
        type="button"
        data-channel-playable-only
        class="${app.playableOnly ? "is-active" : ""}"
      >只看可播</button>`,
      `<button
        type="button"
        data-channel-recent
        class="${app.recentOnly ? "is-active" : ""}"
      >最近 ${app.recent.length}</button>`,
      `<button
        type="button"
        data-channel-favorites
        class="${app.favoritesOnly ? "is-active" : ""}"
      >收藏 ${app.favorites.size}</button>`,
      `<button type="button" data-channel-group-filter="" class="${
        app.group || app.favoritesOnly ? "" : "is-active"
      }">全部 ${app.channels.length}</button>`,
      ...app.groups.map(
        (group) =>
          `<button type="button" data-channel-group-filter="${escapeHtml(
            group.name
          )}" class="${
            !app.favoritesOnly && app.group === group.name ? "is-active" : ""
          }">${escapeHtml(group.name)} ${group.count}</button>`
      )
    ].join("");
  }

  function filteredChannels() {
    const query = app.query.trim().toLocaleLowerCase("zh-CN");
    const channels = app.channels.filter((channel) => {
      if (app.recentOnly && !app.recent.includes(favoriteKey(channel))) {
        return false;
      }
      if (app.playableOnly) {
        const state = qualityStateForChannel(channel);
        if (state.tone !== "playable") {
          return false;
        }
      }
      if (app.favoritesOnly && !isFavorite(channel)) {
        return false;
      }
      if (!app.favoritesOnly && app.group && channel.group !== app.group) {
        return false;
      }
      if (!query) {
        return true;
      }
      return `${channel.name} ${channel.group}`
        .toLocaleLowerCase("zh-CN")
        .includes(query);
    });
    return sortChannels(channels);
  }

  function channelRowMarkup(channel) {
    const favorite = isFavorite(channel);
    const probe = qualityStateForChannel(channel);
    const arsenalHighlight = isArsenalHighlight(channel);
    const guide = guideForChannel(channel);
    const currentProgram = guide?.current || null;
    const progress = programProgress(currentProgram);
    const initial = escapeHtml(channel.name.slice(0, 1));
    return `
      <div
        class="channel-row${
          app.activeChannel?.id === channel.id ? " is-active" : ""
        }"
      >
        <button
          class="channel-row__main"
          type="button"
          data-channel-id="${escapeHtml(channel.id)}"
        >
          <span class="channel-mark" style="--channel-color:${channelColor(
            channel.group
          )}">
            ${
              channel.logo
                ? `<img
                    src="${escapeHtml(channel.logo)}"
                    alt=""
                    loading="lazy"
                    referrerpolicy="no-referrer"
                    onerror="this.hidden=true;this.nextElementSibling.hidden=false"
                  />
                  <span hidden>${initial}</span>`
                : initial
            }
          </span>
          <span class="channel-row__copy">
            <strong title="${escapeHtml(channel.name)}">${escapeHtml(
              channel.name
            )}</strong>
            <span>${escapeHtml(channel.group)}</span>
            ${
              currentProgram
                ? `<span
                    class="channel-row__program"
                    title="接下来：${escapeHtml(
                      guide?.next?.title || "暂无节目信息"
                    )}"
                  >
                    <span>${escapeHtml(currentProgram.title)}</span>
                    <em>${Math.round(progress)}%</em>
                  </span>`
                : ""
            }
          </span>
          <span class="channel-row__tail">
            ${
              arsenalHighlight
                ? `<span class="channel-pin" title="阿森纳 HIGHLIGHT">ARSENAL</span>`
                : ""
            }
            <span
              class="channel-quality-tag is-${probe.tone}"
              data-quality-for="${escapeHtml(qualityKey(channel))}"
            >${escapeHtml(probe.label)}</span>
            <span class="channel-row__play"><i data-lucide="play"></i></span>
          </span>
        </button>
        <button
          class="channel-info-button"
          type="button"
          data-channel-info="${escapeHtml(channel.id)}"
          aria-label="查看 ${escapeHtml(channel.name)} 详情"
          title="频道详情"
        >
          <i data-lucide="info"></i>
        </button>
        <button
          class="channel-favorite${favorite ? " is-active" : ""}"
          type="button"
          data-favorite-channel="${escapeHtml(channel.id)}"
          aria-label="${favorite ? "取消收藏" : "收藏"} ${escapeHtml(
            channel.name
          )}"
          aria-pressed="${favorite}"
          title="${favorite ? "取消收藏" : "收藏"}"
        >
          <i data-lucide="star"></i>
        </button>
      </div>
    `;
  }

  function renderChannels({ resetScroll = false } = {}) {
    const channels = filteredChannels();
    const list = $("[data-channel-list]");
    if (resetScroll) {
      list.scrollTop = 0;
    }
    const statusCounts = channels.reduce(
      (counts, channel) => {
        const tone = qualityStateForChannel(channel).tone;
        if (tone === "playable" || tone === "offline") {
          counts[tone] += 1;
        }
        return counts;
      },
      { playable: 0, offline: 0 }
    );
    $("[data-channel-summary]").textContent = [
      `${channels.length} 个频道`,
      statusCounts.playable ? `可播 ${statusCounts.playable}` : "",
      statusCounts.offline ? `离线 ${statusCounts.offline}` : ""
    ]
      .filter(Boolean)
      .join(" · ");
    if (!channels.length) {
      list.innerHTML = app.playableOnly
        ? '<div class="channel-empty">还没有确认可播的频道，先运行一次“预检列表”。</div>'
        : app.recentOnly
          ? '<div class="channel-empty">还没有最近播放记录，选择一个频道后会出现在这里。</div>'
          : app.favoritesOnly
            ? '<div class="channel-empty">收藏夹还是空的，点击频道右侧的星标即可加入。</div>'
            : '<div class="channel-empty">没有匹配的频道，换个名称或分组试试。</div>';
      return;
    }
    const viewportHeight = list.clientHeight || 620;
    const rowHeight = currentChannelRowHeight();
    app.channelRowHeight = rowHeight;
    const start = Math.max(
      0,
      Math.floor(list.scrollTop / rowHeight) - CHANNEL_OVERSCAN
    );
    const end = Math.min(
      channels.length,
      Math.ceil((list.scrollTop + viewportHeight) / rowHeight) + CHANNEL_OVERSCAN
    );
    app.channelWindow = { start, end, total: channels.length };
    list.innerHTML = `
      <div
        class="channel-virtual-spacer"
        style="height:${channels.length * rowHeight}px"
      >
        <div
          class="channel-virtual-window"
          style="transform:translateY(${start * rowHeight}px)"
        >
          ${channels.slice(start, end).map(channelRowMarkup).join("")}
        </div>
      </div>
    `;
    refreshIcons();
    observeQualityRows();
  }

  function updateButton() {
    const video = $("[data-channel-video]");
    $("[data-channel-toggle]").innerHTML = `<i data-lucide="${
      video.paused ? "play" : "pause"
    }"></i>`;
    refreshIcons();
  }

  function showPlaybackControls({ autoHide = true } = {}) {
    const panel = $(".channel-player-panel");
    panel.classList.remove("is-controls-hidden");
    window.clearTimeout(app.controlsTimer);
    if (!autoHide) {
      return;
    }
    app.controlsTimer = window.setTimeout(() => {
      const video = $("[data-channel-video]");
      const fullscreen = isFullscreen();
      const blockingPrompt =
        !$("[data-channel-message]").hidden ||
        !$("[data-channel-quality-prompt]").hidden;
      if (
        blockingPrompt ||
        (!fullscreen && video.paused)
      ) {
        return;
      }
      panel.classList.add("is-controls-hidden");
    }, 3_200);
  }

  function animateChannelSwitch() {
    const panel = $(".channel-player-panel");
    panel.classList.remove("is-channel-switching");
    void panel.offsetWidth;
    panel.classList.add("is-channel-switching");
    window.setTimeout(
      () => panel.classList.remove("is-channel-switching"),
      260
    );
  }

  function updateMediaSession(channel) {
    if (!("mediaSession" in navigator) || !("MediaMetadata" in window)) {
      return;
    }
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: channel.name,
      artist: channel.group,
      album: "北看台直播频道"
    });
  }

  async function requestWakeLock() {
    if (!navigator.wakeLock?.request || app.wakeLock) {
      return;
    }
    try {
      app.wakeLock = await navigator.wakeLock.request("screen");
      app.wakeLock.addEventListener("release", () => {
        app.wakeLock = null;
      });
    } catch {
      app.wakeLock = null;
    }
  }

  async function releaseWakeLock() {
    const lock = app.wakeLock;
    app.wakeLock = null;
    try {
      await lock?.release();
    } catch {
      // The lock may already have been released by the browser.
    }
  }

  function showGestureHud(text) {
    const hud = $("[data-channel-gesture-hud]");
    hud.textContent = text;
    hud.hidden = false;
    window.clearTimeout(app.hudTimer);
    app.hudTimer = window.setTimeout(() => {
      hud.hidden = true;
    }, 900);
  }

  function applyBrightness() {
    $("[data-channel-brightness]").style.opacity = String(
      Math.max(0, Math.min(0.75, 1 - app.brightness))
    );
  }

  async function togglePictureInPicture() {
    const video = $("[data-channel-video]");
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await video.requestPictureInPicture();
      }
    } catch {
      // Some mobile browsers expose the API but reject it for live streams.
    }
  }

  async function promptRemotePlayback() {
    const video = $("[data-channel-video]");
    try {
      await video.remote?.prompt();
    } catch {
      // The user may dismiss or the selected device may not support the stream.
    }
  }

  function lowerQualityOption() {
    const hls = app.hls;
    const channel = app.activeChannel;
    if (!hls || !channel) {
      return null;
    }
    const currentIndex =
      hls.currentLevel >= 0 ? hls.currentLevel : hls.autoLevelCapping;
    const currentLevel = hls.levels[currentIndex] || null;
    const cached = freshQuality(channel);
    const currentBitrate =
      Number(currentLevel?.bitrate) || Number(cached?.bitrate) || 0;
    const lowerLevel = hls.levels
      .map((level, index) => ({ ...level, index }))
      .filter(
        (level) =>
          Number(level.bitrate) > 0 &&
          currentBitrate > 0 &&
          Number(level.bitrate) < currentBitrate
      )
      .sort((left, right) => Number(left.bitrate) - Number(right.bitrate))[0];
    if (lowerLevel) {
      return {
        type: "level",
        levelIndex: lowerLevel.index,
        bitrate: Number(lowerLevel.bitrate),
        label: `${Math.round(Number(lowerLevel.bitrate) / 100_000) / 10} Mbps`
      };
    }
    const alternatives = app.channels
      .filter(
        (item) =>
          item.id !== channel.id &&
          DEFAULT_CHANNEL_PATTERN.test(item.name) &&
          qualityStateForChannel(item).tone !== "offline"
      )
      .map((item) => ({
        channel: item,
        bitrate: Number(freshQuality(item)?.bitrate) || 0
      }))
      .filter(
        (item) =>
          item.bitrate > 0 &&
          currentBitrate > 0 &&
          item.bitrate < currentBitrate
      )
      .sort((left, right) => left.bitrate - right.bitrate);
    if (alternatives[0]) {
      return {
        type: "channel",
        channel: alternatives[0].channel,
        bitrate: alternatives[0].bitrate,
        label: `${Math.round(alternatives[0].bitrate / 100_000) / 10} Mbps`
      };
    }
    const namedFallback = app.channels.find(
      (item) =>
        item.id !== channel.id &&
        item.name.includes("华丽翡翠台") &&
        qualityStateForChannel(item).tone !== "offline"
    );
    return namedFallback
      ? {
          type: "channel",
          channel: namedFallback,
          bitrate: 0,
          label: "省流备用线路"
        }
      : null;
  }

  function hideQualityPrompt() {
    $("[data-channel-quality-prompt]").hidden = true;
    app.pendingQualitySwitch = null;
  }

  function registerStutter() {
    const video = $("[data-channel-video]");
    const channel = app.activeChannel;
    const now = Date.now();
    if (
      !channel ||
      video.paused ||
      !app.playbackStartedAt ||
      now - app.playbackStartedAt < 8_000 ||
      app.qualityPrompted.has(channel.id)
    ) {
      return;
    }
    app.stutterEvents = app.stutterEvents.filter(
      (timestamp) => now - timestamp < 30_000
    );
    app.stutterEvents.push(now);
    if (app.stutterEvents.length < 3) {
      return;
    }
    const option = lowerQualityOption();
    if (!option) {
      return;
    }
    app.stutterEvents = [];
    app.pendingQualitySwitch = option;
    $("[data-channel-quality-copy]").textContent =
      option.type === "level"
        ? `是否将当前频道降到 ${option.label}？`
        : `是否切换到低码率翡翠线路？`;
    $("[data-channel-quality-prompt]").hidden = false;
    showPlaybackControls({ autoHide: false });
  }

  function acceptQualitySwitch() {
    const option = app.pendingQualitySwitch;
    const channel = app.activeChannel;
    if (!option || !channel) {
      hideQualityPrompt();
      return;
    }
    app.qualityPrompted.add(channel.id);
    hideQualityPrompt();
    if (option.type === "level" && app.hls) {
      app.hls.currentLevel = option.levelIndex;
      return;
    }
    if (option.channel) {
      playChannel(option.channel.id, { autoFallback: true });
    }
  }

  function setupMediaControls() {
    const video = $("[data-channel-video]");
    const pipButton = $("[data-channel-pip]");
    const castButton = $("[data-channel-cast]");
    const panel = $(".channel-player-panel");
    for (const eventName of ["pointermove", "touchstart", "click"]) {
      panel.addEventListener(eventName, () => showPlaybackControls());
    }
    if (
      document.pictureInPictureEnabled &&
      typeof video.requestPictureInPicture === "function"
    ) {
      pipButton.hidden = false;
    }
    if (video.remote && typeof video.remote.prompt === "function") {
      castButton.hidden = false;
    }
    if (!("mediaSession" in navigator)) {
      video.addEventListener("waiting", registerStutter);
      video.addEventListener("stalled", registerStutter);
      return;
    }
    const handlers = {
      play: () => video.play().catch(() => {}),
      pause: () => video.pause(),
      stop: () => video.pause(),
      nexttrack: () => {
        if (app.activeChannel) {
          playAdjacentChannel(app.activeChannel.id, 1);
        }
      },
      previoustrack: () => {
        if (app.activeChannel) {
          playAdjacentChannel(app.activeChannel.id, -1);
        }
      }
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Unsupported media actions are ignored.
      }
    }
    video.addEventListener("waiting", registerStutter);
    video.addEventListener("stalled", registerStutter);
  }

  function setupGestures() {
    const stage = $("[data-channel-stage]");
    const video = $("[data-channel-video]");
    stage.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) {
        return;
      }
      const rect = stage.getBoundingClientRect();
      app.gesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        volume: video.volume,
        brightness: app.brightness,
        leftSide: event.clientX < rect.left + rect.width / 2,
        moved: false
      };
      stage.setPointerCapture?.(event.pointerId);
    });
    stage.addEventListener("pointermove", (event) => {
      if (!app.gesture || event.pointerId !== app.gesture.pointerId) {
        return;
      }
      const deltaX = event.clientX - app.gesture.startX;
      const deltaY = event.clientY - app.gesture.startY;
      if (Math.abs(deltaY) < 12 || Math.abs(deltaY) < Math.abs(deltaX)) {
        return;
      }
      app.gesture.moved = true;
      if (app.gesture.leftSide) {
        video.volume = Math.max(
          0,
          Math.min(1, app.gesture.volume - deltaY / 260)
        );
        video.muted = video.volume === 0;
        showGestureHud(`音量 ${Math.round(video.volume * 100)}%`);
      } else {
        app.brightness = Math.max(
          0.25,
          Math.min(1, app.gesture.brightness - deltaY / 320)
        );
        applyBrightness();
        showGestureHud(`亮度 ${Math.round(app.brightness * 100)}%`);
      }
    });
    const finishGesture = (event) => {
      if (!app.gesture || event.pointerId !== app.gesture.pointerId) {
        return;
      }
      const endedAt = Date.now();
      if (
        !app.gesture.moved &&
        endedAt - app.lastTapAt < 340
      ) {
        if (video.paused) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
        app.lastTapAt = 0;
      } else if (!app.gesture.moved) {
        app.lastTapAt = endedAt;
      }
      app.gesture = null;
    };
    stage.addEventListener("pointerup", finishGesture);
    stage.addEventListener("pointercancel", finishGesture);
  }

  function updateStats() {
    const video = $("[data-channel-video]");
    const hls = app.hls;
    const level =
      hls && hls.currentLevel >= 0 ? hls.levels[hls.currentLevel] : null;
    $("[data-channel-speed]").textContent = [
      `实时 ${formatBitrate(hls?.bandwidthEstimate || 0)}`,
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
        buffer = video.buffered.end(index) - video.currentTime;
        break;
      }
    }
    $("[data-channel-buffer]").textContent = `缓冲 ${buffer.toFixed(1)} 秒`;
    if (level && hls.currentLevel >= 0) {
      $("[data-channel-quality]").value = String(hls.currentLevel);
    }
  }

  function renderQuality(levels) {
    $("[data-channel-quality]").innerHTML = [
      '<option value="-1">自动</option>',
      ...levels.map((level, index) => {
        const size = level.height ? `${level.height}p` : `线路 ${index + 1}`;
        return `<option value="${index}">${escapeHtml(
          `${size} · ${formatBitrate(level.bitrate)}`
        )}</option>`;
      })
    ].join("");
  }

  function destroyPlayer() {
    window.clearInterval(app.statsTimer);
    window.clearTimeout(app.fallbackTimer);
    window.clearTimeout(app.controlsTimer);
    releaseWakeLock();
    app.statsTimer = null;
    app.fallbackTimer = null;
    app.seeking = false;
    const progress = $("[data-channel-replay-progress]");
    if (progress) {
      progress.hidden = true;
    }
    app.hls?.destroy();
    app.hls = null;
    const video = $("[data-channel-video]");
    video.pause();
    video.removeAttribute("src");
    video.load();
  }

  async function requestLandscapePlayback() {
    const panel = $(".channel-player-panel");
    const video = $("[data-channel-video]");
    try {
      if (!isFullscreen()) {
        await enterPlaybackFullscreen(panel, video);
      }
      if (screen.orientation?.lock) {
        await screen.orientation.lock("landscape").catch(() => {});
      }
    } catch {
      // Browsers such as iOS Safari only allow rotation by physically turning the device.
    }
    video.play().catch(() => {});
  }

  function isFullscreen() {
    return Boolean(
      document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.msFullscreenElement
    );
  }

  function isIosDevice() {
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    );
  }

  async function requestElementFullscreen(element) {
    const method =
      element.requestFullscreen ||
      element.webkitRequestFullscreen ||
      element.msRequestFullscreen;
    if (!method) {
      throw new Error("当前浏览器不支持元素全屏");
    }
    return method.call(element, { navigationUI: "hide" });
  }

  async function enterPlaybackFullscreen(panel, video) {
    if (isIosDevice() && typeof video.webkitEnterFullscreen === "function") {
      video.webkitEnterFullscreen();
      return;
    }
    try {
      await requestElementFullscreen(panel);
    } catch {
      await requestElementFullscreen(video);
    }
  }

  async function togglePlaybackFullscreen() {
    const panel = $(".channel-player-panel");
    const video = $("[data-channel-video]");
    if (isFullscreen()) {
      try {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
          document.msExitFullscreen();
        }
      } catch {
        // Ignore a browser-initiated fullscreen exit.
      }
      return;
    }
    try {
      await enterPlaybackFullscreen(panel, video);
      video.play().catch(() => {});
      showPlaybackControls();
    } catch {
      toast(
        "无法自动全屏",
        "请将手机横过来，或使用浏览器菜单中的全屏选项。",
        "error"
      );
    }
  }

  function preferredLevel(levels, mode = app.playbackMode) {
    const mobile = isMobilePlayback();
    const maxHeight =
      mode === "replay"
        ? mobile
          ? 1080
          : 2160
        : mode === "football-live"
          ? 1080
          : mobile
            ? 720
            : 1080;
    for (let index = levels.length - 1; index >= 0; index -= 1) {
      const level = levels[index];
      if (
        (Number(level.height) || 0) <= maxHeight &&
        /avc1|h264/i.test(level.videoCodec || "")
      ) {
        return index;
      }
    }
    for (let index = levels.length - 1; index >= 0; index -= 1) {
      if ((Number(levels[index].height) || 0) <= maxHeight) {
        return index;
      }
    }
    return levels.length ? 0 : -1;
  }

  function isMobilePlayback() {
    return (
      window.matchMedia("(pointer: coarse)").matches ||
      window.innerWidth <= 900 ||
      (Number(navigator.hardwareConcurrency) || 8) <= 4
    );
  }

  function playNextChannel(channelId, depth) {
    if (depth >= 3) {
      return;
    }
    playAdjacentChannel(channelId, 1, {
      autoFallback: true,
      depth: depth + 1
    });
  }

  function playFallbackChannel(channel, depth) {
    if (
      CHANNEL_SCOPE === "football" &&
      !isReplayChannel(channel)
    ) {
      const nextLive =
        app.footballAttempts.size < 10
          ? sortChannels(app.channels).find(
              (item) =>
                !isReplayChannel(item) &&
                !app.footballAttempts.has(item.id) &&
                qualityStateForChannel(item).tone !== "offline"
            )
          : null;
      if (nextLive) {
        playChannel(nextLive.id, {
          autoFallback: true,
          autoSelect: true,
          depth: depth + 1
        });
        return;
      }
      const message = $("[data-channel-message]");
      message.hidden = false;
      message.querySelector("strong").textContent = "当前直播线路不可用";
      message.querySelector("p").textContent =
        "已尝试可用直播线路，请从列表选择备用线路或手动选择回放。";
      $("[data-channel-retry]").hidden = false;
      return;
    }
    if (
      isMobilePlayback() &&
      DEFAULT_CHANNEL_PATTERN.test(channel.name) &&
      app.jadeAttempts.size < 8
    ) {
      const nextJade = app.channels.find(
        (item) =>
          DEFAULT_CHANNEL_PATTERN.test(item.name) &&
          !app.jadeAttempts.has(item.id) &&
          qualityStateForChannel(item).tone !== "offline"
      );
      if (nextJade) {
        playChannel(nextJade.id, {
          autoFallback: true,
          autoSelect: true,
          depth: depth + 1
        });
        return;
      }
    }
    playNextChannel(channel.id, depth);
  }

  function playAdjacentChannel(
    channelId,
    direction,
    { autoFallback = true, depth = 0 } = {}
  ) {
    const channels = filteredChannels();
    const index = channels.findIndex((channel) => channel.id === channelId);
    const target = channels[index + direction];
    if (target) {
      playChannel(target.id, {
        autoFallback,
        autoSelect: app.autoSelecting,
        depth
      });
    }
  }

  function playChannel(
    channelId,
    { autoFallback = false, autoSelect = false, depth = 0 } = {}
  ) {
    const channel = app.channels.find((item) => item.id === channelId);
    if (!channel) {
      return;
    }
    const keepSelectedChannel = DEFAULT_CHANNEL_PATTERN.test(channel.name);
    autoFallback = autoFallback && !keepSelectedChannel;
    destroyPlayer();
    app.activeChannel = channel;
    app.autoSelecting = autoSelect && !keepSelectedChannel;
    app.playbackStartedAt = 0;
    app.stutterEvents = [];
    hideQualityPrompt();
    animateChannelSwitch();
    if (isMobilePlayback() && DEFAULT_CHANNEL_PATTERN.test(channel.name)) {
      app.jadeAttempts.add(channel.id);
    }
    if (CHANNEL_SCOPE === "football" && !isReplayChannel(channel)) {
      app.footballAttempts.add(channel.id);
    }
    if (!autoSelect) {
      recordRecent(channel);
      renderGroups();
    }
    updateMediaSession(channel);
    const currentProgram = guideForChannel(channel)?.current;
    $("[data-channel-title]").textContent = channel.name;
    $("[data-channel-group]").textContent = currentProgram
      ? `${channel.group} · ${currentProgram.title}`
      : channel.group;
    const message = $("[data-channel-message]");
    const retryButton = $("[data-channel-retry]");
    message.hidden = false;
    retryButton.hidden = true;
    message.querySelector("strong").textContent = "正在连接频道";
    message.querySelector("p").textContent = "首次连接通常需要几秒钟。";
    const video = $("[data-channel-video]");
    const source = `/api/live/proxy?url=${encodeURIComponent(channel.streamUrl)}`;
    if (autoFallback) {
      app.fallbackTimer = window.setTimeout(
        () => playFallbackChannel(channel, depth),
        10_000
      );
    }

    if (window.Hls?.isSupported()) {
      const mobile = isMobilePlayback();
      const football = CHANNEL_SCOPE === "football";
      const replay = football && isReplayChannel(channel);
      app.playbackMode = replay
        ? "replay"
        : football
          ? "football-live"
          : "live";
      const commonConfig = {
        enableWorker: true,
        startLevel: -1,
        capLevelToPlayerSize: true,
        capLevelOnFPSDrop: true,
        manifestLoadingMaxRetry: 4,
        levelLoadingMaxRetry: 6,
        fragLoadingMaxRetry: 6
      };
      const hlsConfig = replay
        ? {
            ...commonConfig,
            lowLatencyMode: false,
            maxBufferLength: mobile ? 30 : 60,
            maxMaxBufferLength: mobile ? 60 : 120,
            backBufferLength: mobile ? 30 : 60,
            maxStarvationDelay: 10,
            abrEwmaDefaultEstimate: mobile ? 6_000_000 : 12_000_000,
            abrBandWidthFactor: mobile ? 0.88 : 0.95,
            abrBandWidthUpFactor: mobile ? 0.78 : 0.82,
            maxFragLookUpTolerance: 0.25
          }
        : football
          ? {
              ...commonConfig,
              lowLatencyMode: true,
              liveSyncDurationCount: mobile ? 3 : 3,
              maxBufferLength: mobile ? 20 : 36,
              maxMaxBufferLength: mobile ? 36 : 72,
              backBufferLength: mobile ? 12 : 30,
              maxLiveSyncPlaybackRate: mobile ? 1.05 : 1.12,
              maxStarvationDelay: mobile ? 6 : 8,
              abrEwmaDefaultEstimate: mobile ? 6_000_000 : 8_000_000,
              abrBandWidthFactor: mobile ? 0.86 : 0.92,
              abrBandWidthUpFactor: mobile ? 0.8 : 0.8
            }
          : {
              ...commonConfig,
              lowLatencyMode: true,
              liveSyncDurationCount: mobile ? 2 : 3,
              maxBufferLength: mobile ? 12 : 30,
              maxMaxBufferLength: mobile ? 20 : 60,
              backBufferLength: mobile ? 8 : 30,
              maxLiveSyncPlaybackRate: mobile ? 1.05 : 1.5,
              maxStarvationDelay: mobile ? 4 : 8,
              abrEwmaDefaultEstimate: mobile ? 2_000_000 : 8_000_000,
              abrBandWidthFactor: mobile ? 0.8 : 0.95,
              abrBandWidthUpFactor: mobile ? 0.7 : 0.75
            };
      const hls = new window.Hls(hlsConfig);
      app.hls = hls;
      hls.loadSource(source);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, (_, data) => {
        renderQuality(data.levels || []);
        const preferredIndex = preferredLevel(
          data.levels || [],
          app.playbackMode
        );
        const preferredLevelInfo = data.levels?.[preferredIndex] || null;
        const maxHeight = Math.max(
          0,
          ...(data.levels || []).map((level) => Number(level.height) || 0)
        );
        if (maxHeight) {
          app.qualityCache[qualityKey(channel)] = {
            checkedAt: Date.now(),
            quality: formatHeight(preferredLevelInfo?.height || maxHeight),
            bitrate: Number(preferredLevelInfo?.bitrate) || 0
          };
          saveQualityCache();
          updateQualityTag(channel);
        }
        if (data.levels?.length) {
          hls.autoLevelCapping = preferredIndex;
          hls.currentLevel = -1;
        }
        video.play().catch(() => {});
        updateStats();
      });
      hls.on(window.Hls.Events.LEVEL_SWITCHED, updateStats);
      hls.on(window.Hls.Events.ERROR, (_, data) => {
        if (data.details === window.Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
          registerStutter();
          return;
        }
        if (!data.fatal) {
          return;
        }
        message.hidden = false;
        message.querySelector("strong").textContent = "频道暂时无法播放";
        message.querySelector("p").textContent = "可能是频道当前离线，稍后重试。";
        retryButton.hidden = false;
        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
        } else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
          if (autoFallback) {
            window.clearTimeout(app.fallbackTimer);
            window.setTimeout(
              () => playFallbackChannel(channel, depth),
              800
            );
          } else {
            hls.recoverMediaError();
          }
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = source;
      video.play().catch(() => {});
    } else {
      message.querySelector("strong").textContent = "浏览器不支持 HLS";
      return;
    }

    video.addEventListener(
      "canplay",
      () => {
        app.playbackStartedAt = Date.now();
        message.hidden = true;
        retryButton.hidden = true;
        requestWakeLock();
        if ("mediaSession" in navigator) {
          navigator.mediaSession.playbackState = "playing";
        }
        window.clearTimeout(app.fallbackTimer);
        app.fallbackTimer = null;
        updateButton();
        updateStats();
        showPlaybackControls();
      },
      { once: true }
    );
    app.statsTimer = window.setInterval(updateStats, 1000);
    renderChannels();
    showPlaybackControls();
  }

  async function loadEpg(urls) {
    if (!urls?.length) {
      return;
    }
    try {
      const response = await fetch("/api/epg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "节目单读取失败");
      }
      app.epg = payload.channels || {};
      renderChannels();
      if (app.activeChannel) {
        const currentProgram = guideForChannel(app.activeChannel)?.current;
        $("[data-channel-group]").textContent = currentProgram
          ? `${app.activeChannel.group} · ${currentProgram.title}`
          : app.activeChannel.group;
      }
    } catch {
      // EPG is optional and must never block live playback.
    }
  }

  function healthTrendMarkup(health) {
    const history = Array.isArray(health?.history) ? health.history : [];
    if (!history.length) {
      return `
        <div class="channel-health-card">
          <div>
            <span>线路趋势</span>
            <strong>暂无连续检测记录</strong>
          </div>
        </div>
      `;
    }
    const successes = history.filter((item) => item.playable).length;
    const averageLatency = Math.round(
      history.reduce((sum, item) => sum + (Number(item.latencyMs) || 0), 0) /
        history.length
    );
    const maxLatency = Math.max(
      1,
      ...history.map((item) => Number(item.latencyMs) || 0)
    );
    return `
      <div class="channel-health-card">
        <div class="channel-health-card__heading">
          <div>
            <span>线路趋势</span>
            <strong>最近 ${history.length} 次 · 成功 ${Math.round(
              (successes / history.length) * 100
            )}% · 平均 ${averageLatency} ms</strong>
          </div>
        </div>
        <div class="channel-health-bars" aria-label="最近连接延迟">
          ${history
            .map((item) => {
              const latency = Number(item.latencyMs) || 0;
              const height = Math.max(12, Math.round((latency / maxLatency) * 38));
              return `<span
                class="${item.playable ? "is-ok" : "is-fail"}"
                style="height:${item.playable ? height : 38}px"
                title="${item.playable ? `${latency} ms` : "连接失败"}"
              ></span>`;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  function openChannelDetail(channelId) {
    const channel = app.channels.find((item) => item.id === channelId);
    if (!channel) {
      return;
    }
    app.detailChannel = channel;
    const guide = guideForChannel(channel);
    const health = freshQuality(channel);
    $("[data-channel-detail-title]").textContent = channel.name;
    $("[data-channel-detail-body]").innerHTML = `
      <div class="channel-detail-grid">
        <div class="channel-detail-card">
          <span>分组</span>
          <strong>${escapeHtml(channel.group)}</strong>
        </div>
        <div class="channel-detail-card">
          <span>播放状态</span>
          <strong>${escapeHtml(qualityStateForChannel(channel).label)}</strong>
        </div>
        <div class="channel-detail-card">
          <span>当前节目</span>
          <strong>${escapeHtml(guide?.current?.title || "暂无节目信息")}</strong>
        </div>
        <div class="channel-detail-card">
          <span>接下来</span>
          <strong>${escapeHtml(guide?.next?.title || "暂无节目信息")}</strong>
        </div>
        <div class="channel-detail-card">
          <span>来源</span>
          <strong>${escapeHtml(channel.sourceLabel || "频道源")}</strong>
        </div>
        <div class="channel-detail-card">
          <span>连接耗时</span>
          <strong>${
            health?.latencyMs ? `${health.latencyMs} ms` : "尚未检测"
          }</strong>
        </div>
      </div>
      ${healthTrendMarkup(health)}
    `;
    refreshIcons();
    if (window.history.state?.overlay !== "channel-detail") {
      window.history.pushState(
        { ...(window.history.state || {}), overlay: "channel-detail" },
        "",
        window.location.href
      );
    }
    $("[data-channel-detail-dialog]").showModal();
  }

  async function loadLegacyCatalog() {
    const stateResponse = await fetch("/api/state");
    const statePayload = stateResponse.ok
      ? await stateResponse.json()
      : { settings: {} };
    const customUrl = String(statePayload.settings?.m3uUrl || "").trim();
    const sources = [
      ...LEGACY_M3U_SOURCES,
      ...(customUrl ? [{ label: "设置源", url: customUrl }] : [])
    ];
    const playlists = (
      await Promise.allSettled(
        sources.map(async (source) => {
          const response = await fetch("/api/sources/m3u", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: source.url })
          });
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload.error || "直播源读取失败");
          }
          return { ...payload, label: source.label };
        })
      )
    )
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);
    if (!playlists.length) {
      throw new Error("直播源读取失败");
    }
    const seen = new Set();
    const channels = playlists
      .flatMap((playlist) => playlist.channels)
      .filter((channel) => {
        const key = `${channel.name}|${channel.streamUrl}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    return {
      count: channels.length,
      channels,
      sources: playlists.map((playlist) => ({
        label: playlist.label,
        count: playlist.channels.length,
        error: null
      })),
      epgUrls: []
    };
  }

  async function loadChannels({ force = false } = {}) {
    const state = $("[data-source-state]");
    state.className = "channel-source-state";
    state.innerHTML = '<i data-lucide="loader-circle"></i>正在读取直播源';
    refreshIcons();
    try {
      const response = await fetch(`/api/channels${force ? "?refresh=1" : ""}`);
      if (response.status === 404) {
        const legacy = await loadLegacyCatalog();
        return applyChannelCatalog(legacy);
      }
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "直播源读取失败");
      }
      applyChannelCatalog(payload);
    } catch (error) {
      state.className = "channel-source-state is-error";
      state.innerHTML = `<i data-lucide="triangle-alert"></i>${escapeHtml(
        error.message
      )}`;
      refreshIcons();
      toast("无法读取频道", error.message, "error");
    }
  }

  function applyChannelCatalog(payload) {
    const state = $("[data-source-state]");
    app.channels = payload.channels.filter((channel) =>
      CHANNEL_SCOPE === "football"
        ? isFootballChannel(channel)
        : !channel.group.startsWith("体育-")
    );
    app.jadeAttempts.clear();
    app.footballAttempts.clear();
    app.qualityPrompted.clear();
    app.epgUrls = payload.epgUrls || [];
    app.sourceLabels = payload.sources
      .filter((source) => source.count > 0)
      .map((source) => source.label);
    if (!app.sourceLabels.length) {
      app.sourceLabels = ["后端频道源"];
    }
    for (const channel of app.channels) {
      const checkedAt = Date.parse(channel.health?.checkedAt || "");
      if (!Number.isNaN(checkedAt)) {
        app.qualityCache[qualityKey(channel)] = {
          ...channel.health,
          checkedAt
        };
      }
    }
    const failedSources = payload.sources.filter((source) => source.error);
    if (failedSources.length) {
      toast(
        "部分直播源读取失败",
        failedSources.map((source) => source.label).join("、"),
        "error"
      );
    }
    const groupMap = new Map();
    for (const channel of app.channels) {
      groupMap.set(channel.group, (groupMap.get(channel.group) || 0) + 1);
    }
    app.groups = Array.from(groupMap, ([name, count]) => ({ name, count }));
    const initialChannel = preferredAutoChannel();
    app.group =
      CHANNEL_SCOPE === "football"
        ? ""
        : initialChannel && DEFAULT_CHANNEL_PATTERN.test(initialChannel.name)
        ? initialChannel.group
        : app.groups[0]?.name || "";
    renderGroups();
    renderChannels();
    loadEpg(payload.epgUrls || []);
    state.className = "channel-source-state is-ready";
    state.innerHTML = `<i data-lucide="circle-check"></i>${
      app.channels.length
    } 个频道 · ${escapeHtml(app.sourceLabels.join(" + "))}`;
    if (initialChannel) {
      playChannel(initialChannel.id, {
        autoFallback: true,
        autoSelect: true
      });
    }
    refreshIcons();
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-channel-quality-switch]")) {
      acceptQualitySwitch();
      return;
    }
    if (event.target.closest("[data-channel-quality-keep]")) {
      if (app.activeChannel) {
        app.qualityPrompted.add(app.activeChannel.id);
      }
      hideQualityPrompt();
      return;
    }
    if (event.target.closest("[data-channel-detail-play]")) {
      const channel = app.detailChannel;
      $("[data-channel-detail-dialog]").close();
      if (channel) {
        playChannel(channel.id, { autoFallback: true });
      }
      return;
    }
    const infoButton = event.target.closest("[data-channel-info]");
    if (infoButton) {
      openChannelDetail(infoButton.dataset.channelInfo);
      return;
    }
    if (event.target.closest("[data-channel-retry]")) {
      if (app.activeChannel) {
        playChannel(app.activeChannel.id);
      }
      return;
    }
    if (event.target.closest("[data-channel-smart-sort]")) {
      app.smartSort = !app.smartSort;
      renderGroups();
      renderChannels({ resetScroll: true });
      return;
    }
    if (event.target.closest("[data-channel-playable-only]")) {
      app.playableOnly = !app.playableOnly;
      renderGroups();
      renderChannels({ resetScroll: true });
      return;
    }
    const favoriteButton = event.target.closest("[data-favorite-channel]");
    if (favoriteButton) {
      const channel = app.channels.find(
        (item) => item.id === favoriteButton.dataset.favoriteChannel
      );
      if (!channel) {
        return;
      }
      const wasFavorite = isFavorite(channel);
      toggleFavorite(channel);
      if (app.favoritesOnly && wasFavorite) {
        renderGroups();
        renderChannels();
      } else {
        updateFavoriteButton(channel);
        renderGroups();
      }
      return;
    }
    const channelButton = event.target.closest("[data-channel-id]");
    if (channelButton) {
      app.jadeAttempts.clear();
      app.footballAttempts.clear();
      app.qualityPrompted.clear();
      playChannel(channelButton.dataset.channelId, { autoFallback: true });
      return;
    }
    if (event.target.closest("[data-channel-favorites]")) {
      app.favoritesOnly = true;
      app.recentOnly = false;
      app.group = "";
      renderGroups();
      renderChannels({ resetScroll: true });
      return;
    }
    if (event.target.closest("[data-channel-recent]")) {
      app.recentOnly = true;
      app.favoritesOnly = false;
      app.group = "";
      renderGroups();
      renderChannels({ resetScroll: true });
      return;
    }
    const groupButton = event.target.closest("[data-channel-group-filter]");
    if (groupButton) {
      app.favoritesOnly = false;
      app.recentOnly = false;
      app.group = groupButton.dataset.channelGroupFilter;
      renderGroups();
      renderChannels({ resetScroll: true });
      return;
    }
    if (event.target.closest("[data-channel-refresh]")) {
      loadChannels({ force: true });
      return;
    }
    if (event.target.closest("[data-channel-preflight]")) {
      runQualityPreflight();
      return;
    }
    if (event.target.closest("[data-channel-toggle]")) {
      const video = $("[data-channel-video]");
      if (video.paused) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
      updateButton();
      return;
    }
    if (event.target.closest("[data-channel-mute]")) {
      const video = $("[data-channel-video]");
      video.muted = !video.muted;
      event.target.closest("[data-channel-mute]").innerHTML = `<i data-lucide="${
        video.muted ? "volume-x" : "volume-2"
      }"></i>`;
      refreshIcons();
      return;
    }
    if (event.target.closest("[data-channel-landscape]")) {
      requestLandscapePlayback();
      return;
    }
    if (event.target.closest("[data-channel-pip]")) {
      togglePictureInPicture();
      return;
    }
    if (event.target.closest("[data-channel-cast]")) {
      promptRemotePlayback();
      return;
    }
    if (event.target.closest("[data-channel-fullscreen]")) {
      togglePlaybackFullscreen();
    }
  });

  document.addEventListener("input", (event) => {
    if (event.target.matches("[data-channel-seek]")) {
      const video = $("[data-channel-video]");
      const duration = Number(video.duration);
      const nextTime = Number(event.target.value);
      if (
        app.playbackMode !== "replay" ||
        !Number.isFinite(duration) ||
        duration <= 0 ||
        !Number.isFinite(nextTime)
      ) {
        return;
      }
      app.seeking = true;
      video.currentTime = Math.min(Math.max(nextTime, 0), duration);
      updateReplayProgress();
      return;
    }
    if (!event.target.matches("[data-channel-search]")) {
      return;
    }
    app.query = event.target.value;
    renderChannels({ resetScroll: true });
  });

  $("[data-channel-list]").addEventListener("scroll", () => {
    if (app.scrollFrame) {
      return;
    }
    app.scrollFrame = window.requestAnimationFrame(() => {
      app.scrollFrame = null;
      const list = $("[data-channel-list]");
      const viewportHeight = list.clientHeight || 620;
      const rowHeight = app.channelRowHeight || currentChannelRowHeight();
      const start = Math.max(
        0,
        Math.floor(list.scrollTop / rowHeight) - CHANNEL_OVERSCAN
      );
      const end = Math.min(
        app.channelWindow?.total ?? Number.POSITIVE_INFINITY,
        Math.ceil((list.scrollTop + viewportHeight) / rowHeight) +
          CHANNEL_OVERSCAN
      );
      if (
        app.channelWindow?.start === start &&
        app.channelWindow?.end === end
      ) {
        return;
      }
      renderChannels();
    });
  });

  $("[data-channel-quality]").addEventListener("change", (event) => {
    if (!app.hls) {
      return;
    }
    const level = Number(event.target.value);
    if (level < 0) {
      app.hls.autoLevelCapping = preferredLevel(
        app.hls.levels,
        app.playbackMode
      );
      app.hls.currentLevel = -1;
    } else {
      app.hls.autoLevelCapping = -1;
      app.hls.currentLevel = level;
    }
    updateStats();
  });
  $("[data-channel-video]").addEventListener("play", updateButton);
  $("[data-channel-video]").addEventListener("pause", updateButton);
  for (const eventName of [
    "loadedmetadata",
    "durationchange",
    "timeupdate",
    "seeked",
    "ended"
  ]) {
    $("[data-channel-video]").addEventListener(eventName, updateReplayProgress);
  }
  for (const eventName of [
    "change",
    "pointerup",
    "pointercancel",
    "touchend",
    "touchcancel",
    "blur"
  ]) {
    $("[data-channel-seek]").addEventListener(eventName, () => {
      app.seeking = false;
      updateReplayProgress();
    });
  }
  $("[data-channel-video]").addEventListener("play", () => {
    requestWakeLock();
    showPlaybackControls();
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = "playing";
    }
  });
  $("[data-channel-video]").addEventListener("pause", () => {
    releaseWakeLock();
    showPlaybackControls({ autoHide: false });
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = "paused";
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (
      document.visibilityState === "visible" &&
      !$("[data-channel-video]").paused
    ) {
      requestWakeLock();
    }
  });
  window.addEventListener("resize", () => {
    const rowHeight = currentChannelRowHeight();
    if (rowHeight === app.channelRowHeight) {
      return;
    }
    app.channelRowHeight = rowHeight;
    renderChannels();
  });
  for (const eventName of [
    "fullscreenchange",
    "webkitfullscreenchange",
    "msfullscreenchange"
  ]) {
    document.addEventListener(eventName, () => {
      const panel = $(".channel-player-panel");
      const video = $("[data-channel-video]");
      panel.classList.remove("is-controls-hidden");
      if (isFullscreen()) {
        showPlaybackControls();
      } else {
        screen.orientation?.unlock?.();
        showPlaybackControls({ autoHide: !video.paused });
      }
    });
  }
  $("[data-channel-detail-dialog]").addEventListener("close", () => {
    app.detailChannel = null;
    if (window.history.state?.overlay === "channel-detail") {
      window.history.replaceState(
        { ...(window.history.state || {}), overlay: null },
        "",
        window.location.href
      );
    }
  });
  window.addEventListener("popstate", () => {
    const dialog = $("[data-channel-detail-dialog]");
    if (dialog.open) {
      dialog.close();
    }
  });

  setupMediaControls();
  setupGestures();
  applyBrightness();
  window.setInterval(() => {
    if (Object.keys(app.epg).length) {
      renderChannels();
    }
  }, 60_000);
  window.setInterval(() => {
    loadEpg(app.epgUrls);
  }, 11 * 60_000);
  loadChannels();
})();

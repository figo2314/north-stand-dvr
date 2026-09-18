(() => {
  "use strict";

  const QUALITY_STORAGE_KEY = "north-stand-channel-quality";
  const FAVORITES_STORAGE_KEY = "north-stand-channel-favorites";
  const QUALITY_TTL_MS = 6 * 60 * 60 * 1000;
  const BUILTIN_M3U_SOURCES = [
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

  const app = {
    channels: [],
    groups: [],
    group: "",
    favoritesOnly: false,
    favorites: loadFavorites(),
    query: "",
    activeChannel: null,
    autoSelecting: false,
    hls: null,
    statsTimer: null,
    fallbackTimer: null,
    settings: null,
    sourceLabels: [],
    qualityCache: loadQualityCache(),
    qualityQueue: [],
    qualityQueued: new Set(),
    qualityActive: new Set(),
    qualityPreflightKeys: new Set(),
    qualityPreflightTotal: 0,
    qualityObserver: null
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
    return app.channels.find((channel) => {
      const cached = freshQuality(channel);
      return cached && cached.playable !== false && cached.quality !== "暂不可用";
    });
  }

  function preferredAutoChannel() {
    const playable = knownPlayableChannel();
    if (playable) {
      return playable;
    }
    return (
      app.channels.find((channel) => {
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
      fetch("/api/sources/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: channel.streamUrl,
          inputFormat: "hls",
          quick: true
        })
      })
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
    return app.channels.filter((channel) => {
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
  }

  function renderChannels() {
    const channels = filteredChannels();
    const list = $("[data-channel-list]");
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
      list.innerHTML = app.favoritesOnly
        ? '<div class="channel-empty">收藏夹还是空的，点击频道右侧的星标即可加入。</div>'
        : '<div class="channel-empty">没有匹配的频道，换个名称或分组试试。</div>';
      return;
    }
    list.innerHTML = channels
      .map(
        (channel) => {
          const favorite = isFavorite(channel);
          const probe = qualityStateForChannel(channel);
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
              )}">${escapeHtml(channel.name.slice(0, 1))}</span>
              <span class="channel-row__copy">
                <strong>${escapeHtml(channel.name)}</strong>
                <span>${escapeHtml(channel.group)}</span>
              </span>
              <span class="channel-row__tail">
                <span
                  class="channel-quality-tag is-${probe.tone}"
                  data-quality-for="${escapeHtml(qualityKey(channel))}"
                >${escapeHtml(probe.label)}</span>
                <span class="channel-row__play"><i data-lucide="play"></i></span>
              </span>
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
      )
      .join("");
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
    app.statsTimer = null;
    app.fallbackTimer = null;
    app.hls?.destroy();
    app.hls = null;
    const video = $("[data-channel-video]");
    video.pause();
    video.removeAttribute("src");
    video.load();
  }

  function preferredLevel(levels) {
    for (let index = levels.length - 1; index >= 0; index -= 1) {
      if (/avc1|h264/i.test(levels[index].videoCodec || "")) {
        return index;
      }
    }
    return levels.length ? levels.length - 1 : -1;
  }

  function playNextChannel(channelId, depth) {
    if (depth >= 3) {
      return;
    }
    const channels = filteredChannels();
    const index = channels.findIndex((channel) => channel.id === channelId);
    const next = channels[index + 1];
    if (next) {
      playChannel(next.id, {
        autoFallback: true,
        autoSelect: app.autoSelecting,
        depth: depth + 1
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
    destroyPlayer();
    app.activeChannel = channel;
    app.autoSelecting = autoSelect;
    $("[data-channel-title]").textContent = channel.name;
    $("[data-channel-group]").textContent = channel.group;
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
        () => playNextChannel(channel.id, depth),
        10_000
      );
    }

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
        renderQuality(data.levels || []);
        const maxHeight = Math.max(
          0,
          ...(data.levels || []).map((level) => Number(level.height) || 0)
        );
        if (maxHeight) {
          app.qualityCache[qualityKey(channel)] = {
            checkedAt: Date.now(),
            quality: formatHeight(maxHeight)
          };
          saveQualityCache();
          updateQualityTag(channel);
        }
        if (data.levels?.length) {
          hls.currentLevel = preferredLevel(data.levels);
        }
        video.play().catch(() => {});
        updateStats();
      });
      hls.on(window.Hls.Events.LEVEL_SWITCHED, updateStats);
      hls.on(window.Hls.Events.ERROR, (_, data) => {
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
              () => playNextChannel(channel.id, depth),
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
        message.hidden = true;
        retryButton.hidden = true;
        window.clearTimeout(app.fallbackTimer);
        app.fallbackTimer = null;
        updateButton();
        updateStats();
      },
      { once: true }
    );
    app.statsTimer = window.setInterval(updateStats, 1000);
    renderChannels();
  }

  async function loadChannels() {
    const state = $("[data-source-state]");
    state.className = "channel-source-state";
    state.innerHTML = '<i data-lucide="loader-circle"></i>正在读取直播源';
    refreshIcons();
    try {
      const stateResponse = await fetch("/api/state");
      if (!stateResponse.ok) {
        throw new Error("无法读取本机设置");
      }
      const statePayload = await stateResponse.json();
      app.settings = statePayload.settings || {};
      const m3uUrl = String(app.settings.m3uUrl || "").trim();
      const loadPlaylist = async (url) => {
        const response = await fetch("/api/sources/m3u", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url })
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "直播源读取失败");
        }
        return payload;
      };
      const loadBuiltinPlaylist = async () => {
        let lastError;
        for (const source of BUILTIN_M3U_SOURCES) {
          try {
            const payload = await loadPlaylist(source.url);
            return { ...payload, label: source.label };
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError || new Error("内置直播源读取失败");
      };

      const [builtinResult, customResult] = await Promise.allSettled([
        loadBuiltinPlaylist(),
        m3uUrl ? loadPlaylist(m3uUrl) : Promise.resolve(null)
      ]);
      const playlists = [];
      if (builtinResult.status === "fulfilled") {
        playlists.push(builtinResult.value);
      }
      if (customResult.status === "fulfilled" && customResult.value) {
        playlists.push({ ...customResult.value, label: "设置源" });
      }
      if (!playlists.length) {
        const error =
          builtinResult.status === "rejected"
            ? builtinResult.reason
            : customResult.reason;
        throw error || new Error("直播源读取失败");
      }

      const seen = new Set();
      app.channels = playlists
        .flatMap((playlist) => playlist.channels)
        .filter((channel) => !channel.group.startsWith("体育-"))
        .filter((channel) => {
          const key = `${channel.name}|${channel.streamUrl}`;
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        });
      app.sourceLabels = playlists.map((playlist) => playlist.label);

      if (customResult.status === "rejected" && m3uUrl) {
        toast("设置源读取失败", customResult.reason.message, "error");
      }
      const groupMap = new Map();
      for (const channel of app.channels) {
        groupMap.set(channel.group, (groupMap.get(channel.group) || 0) + 1);
      }
      app.groups = Array.from(groupMap, ([name, count]) => ({ name, count }));
      app.group = app.groups[0]?.name || "";
      renderGroups();
      renderChannels();
      state.className = "channel-source-state is-ready";
      state.innerHTML = `<i data-lucide="circle-check"></i>${
        app.channels.length
      } 个频道 · ${escapeHtml(app.sourceLabels.join(" + "))}`;
      const initialChannel = preferredAutoChannel();
      if (initialChannel) {
        playChannel(initialChannel.id, {
          autoFallback: true,
          autoSelect: true
        });
      }
      refreshIcons();
    } catch (error) {
      state.className = "channel-source-state is-error";
      state.innerHTML = `<i data-lucide="triangle-alert"></i>${escapeHtml(
        error.message
      )}`;
      refreshIcons();
      toast("无法读取频道", error.message, "error");
    }
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-channel-retry]")) {
      if (app.activeChannel) {
        playChannel(app.activeChannel.id);
      }
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
      playChannel(channelButton.dataset.channelId, { autoFallback: true });
      return;
    }
    if (event.target.closest("[data-channel-favorites]")) {
      app.favoritesOnly = true;
      app.group = "";
      renderGroups();
      renderChannels();
      return;
    }
    const groupButton = event.target.closest("[data-channel-group-filter]");
    if (groupButton) {
      app.favoritesOnly = false;
      app.group = groupButton.dataset.channelGroupFilter;
      renderGroups();
      renderChannels();
      return;
    }
    if (event.target.closest("[data-channel-refresh]")) {
      loadChannels();
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
    if (event.target.closest("[data-channel-fullscreen]")) {
      const stage = $("[data-channel-stage]");
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        stage.requestFullscreen?.();
      }
    }
  });

  document.addEventListener("input", (event) => {
    if (!event.target.matches("[data-channel-search]")) {
      return;
    }
    app.query = event.target.value;
    renderChannels();
  });

  $("[data-channel-quality]").addEventListener("change", (event) => {
    if (!app.hls) {
      return;
    }
    app.hls.currentLevel = Number(event.target.value);
    updateStats();
  });
  $("[data-channel-video]").addEventListener("play", updateButton);
  $("[data-channel-video]").addEventListener("pause", updateButton);

  loadChannels();
})();

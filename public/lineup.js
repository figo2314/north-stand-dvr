(() => {
  "use strict";

  const app = {
    fixture: null,
    loading: false
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
      <div><strong>${escapeHtml(title)}</strong>${
        message ? `<span>${escapeHtml(message)}</span>` : ""
      }</div>
    `;
    $("[data-toast-region]").append(item);
    refreshIcons();
    window.setTimeout(() => item.remove(), 4200);
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
      throw new Error(payload.error || "请求失败");
    }
    return payload;
  }

  function rowsForLineup(team) {
    if (team.startXI?.some((player) => player.grid)) {
      const rows = new Map();
      for (const player of team.startXI) {
        const row = Number(String(player.grid).split(":")[0]) || 1;
        rows.set(row, [...(rows.get(row) || []), player]);
      }
      return [...rows.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, players]) => players);
    }
    const formation = String(team.formation || "")
      .split("-")
      .map(Number)
      .filter(Boolean);
    if (!formation.length) {
      return [team.startXI.slice(0, 1), team.startXI.slice(1)];
    }
    const players = [...(team.startXI || [])];
    const rows = [players.splice(0, 1)];
    for (const count of formation) {
      rows.push(players.splice(0, count));
    }
    if (players.length) {
      rows.push(players);
    }
    return rows.filter((row) => row.length);
  }

  function renderPitch(selector, team) {
    const container = $(selector);
    container.innerHTML = rowsForLineup(team)
      .map(
        (row) => `
          <div class="lineup-row" style="--players:${row.length}">
            ${row
              .map(
                (player) => `
                  <span class="lineup-player">
                    <b>${escapeHtml(player.number ?? "")}</b>
                    <strong>${escapeHtml(player.name)}</strong>
                  </span>
                `
              )
              .join("")}
          </div>
        `
      )
      .join("");
  }

  function teamText(team) {
    return [
      `${team.name || ""} ${team.formation || ""}`.trim(),
      ...rowsForLineup(team).map((row) =>
        row.map((player) => player.name).join("，")
      ),
      `替补：${(team.substitutes || []).map((player) => player.name).join("，")}`
    ].join("\n");
  }

  function render() {
    const fixture = app.fixture;
    if (!fixture) {
      return;
    }
    const lineup = fixture.lineup || {};
    const status = lineup.status || "not-available";
    const labels = {
      confirmed: "官方首发",
      manual: "手动阵容",
      partial: "部分阵容",
      "not-available": "官方首发尚未公布",
      "match-not-found": "没有匹配到官方比赛",
      error: "查询失败"
    };
    $("[data-lineup-title]").textContent = `${fixture.home} vs ${fixture.away}`;
    $("[data-lineup-competition]").textContent =
      fixture.competition || "足球比赛";
    $("[data-lineup-kickoff]").textContent = new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date(fixture.kickoffAt));
    const statusNode = $("[data-lineup-status]");
    statusNode.textContent = labels[status] || status;
    statusNode.classList.toggle(
      "is-ready",
      status === "confirmed" || status === "manual"
    );
    statusNode.classList.toggle("is-partial", status === "partial");
    statusNode.classList.toggle("is-error", status === "error");
    $("[data-lineup-provider]").textContent =
      lineup.provider === "manual" ? "手动录入" : "API-Football";
    $("[data-lineup-home-name]").textContent =
      lineup.home?.name || fixture.home;
    $("[data-lineup-away-name]").textContent =
      lineup.away?.name || fixture.away;
    $("[data-lineup-home-formation]").textContent =
      lineup.home?.formation || "阵型待识别";
    $("[data-lineup-away-formation]").textContent =
      lineup.away?.formation || "阵型待识别";

    const hasLineup = Boolean(lineup.home && lineup.away);
    $("[data-lineup-pitches]").hidden = !hasLineup;
    $("[data-lineup-details]").hidden = !hasLineup;
    if (hasLineup) {
      renderPitch("[data-lineup-home-pitch]", lineup.home);
      renderPitch("[data-lineup-away-pitch]", lineup.away);
      $("[data-lineup-home-subs]").innerHTML = (lineup.home.substitutes || [])
        .map((player) => `<span>${escapeHtml(player.name)}</span>`)
        .join("");
      $("[data-lineup-away-subs]").innerHTML = (lineup.away.substitutes || [])
        .map((player) => `<span>${escapeHtml(player.name)}</span>`)
        .join("");
      $("[data-lineup-home-text]").value = teamText(lineup.home);
      $("[data-lineup-away-text]").value = teamText(lineup.away);
    } else {
      const state = $("[data-lineup-state]");
      state.hidden = false;
      state.innerHTML = `
        <strong>${escapeHtml(labels[status] || "暂无阵容")}</strong>
        <p>${escapeHtml(
          lineup.error || "通常会在开赛前 20 到 60 分钟公布。"
        )}</p>
      `;
    }
  }

  async function loadFixture() {
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) {
      throw new Error("缺少比赛 ID");
    }
    const state = await api("/api/state");
    app.fixture = state.fixtures.find((fixture) => fixture.id === id);
    if (!app.fixture) {
      throw new Error("没有找到这场比赛");
    }
    render();
  }

  async function refreshLineup() {
    if (!app.fixture || app.loading) {
      return;
    }
    app.loading = true;
    const button = $("[data-lineup-refresh]");
    button.disabled = true;
    try {
      const result = await api(
        `/api/fixtures/${encodeURIComponent(app.fixture.id)}/lineup/refresh`,
        { method: "POST" }
      );
      app.fixture.lineup = result.lineup;
      render();
      toast("阵容查询完成", result.lineup.error || "已更新最新结果。");
    } catch (error) {
      toast("阵容查询失败", error.message, "error");
    } finally {
      app.loading = false;
      button.disabled = false;
    }
  }

  async function saveManualLineup() {
    if (!app.fixture) {
      return;
    }
    try {
      const result = await api(
        `/api/fixtures/${encodeURIComponent(app.fixture.id)}/lineup/manual`,
        {
          method: "POST",
          body: JSON.stringify({
            homeText: $("[data-lineup-home-text]").value,
            awayText: $("[data-lineup-away-text]").value
          })
        }
      );
      app.fixture.lineup = result.lineup;
      render();
      toast("手动阵容已保存");
    } catch (error) {
      toast("无法保存阵容", error.message, "error");
    }
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-lineup-refresh]")) {
      refreshLineup();
      return;
    }
    if (event.target.closest("[data-lineup-save]")) {
      saveManualLineup();
    }
  });

  loadFixture()
    .then(() => {
      if (!app.fixture?.lineup) {
        refreshLineup();
      }
    })
    .catch((error) => {
      $("[data-lineup-state]").hidden = false;
      $("[data-lineup-state]").textContent = error.message;
      toast("无法读取阵容", error.message, "error");
    })
    .finally(refreshIcons);
})();

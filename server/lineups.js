const TEAM_ALIASES = new Map([
  ["阿森纳", "arsenal"],
  ["曼联", "manchester united"],
  ["曼城", "manchester city"],
  ["利物浦", "liverpool"],
  ["切尔西", "chelsea"],
  ["热刺", "tottenham hotspur"],
  ["托特纳姆热刺", "tottenham hotspur"],
  ["纽卡斯尔联", "newcastle united"],
  ["纽卡斯尔", "newcastle united"],
  ["埃弗顿", "everton"],
  ["阿斯顿维拉", "aston villa"],
  ["西汉姆联", "west ham united"],
  ["布莱顿", "brighton"],
  ["水晶宫", "crystal palace"],
  ["布伦特福德", "brentford"],
  ["富勒姆", "fulham"],
  ["狼队", "wolverhampton wanderers"],
  ["诺丁汉森林", "nottingham forest"],
  ["伯恩茅斯", "bournemouth"],
  ["伯恩利", "burnley"],
  ["谢菲尔德联", "sheffield united"],
  ["利兹联", "leeds united"],
  ["莱斯特城", "leicester city"],
  ["南安普顿", "southampton"],
  ["皇家马德里", "real madrid"],
  ["皇马", "real madrid"],
  ["巴塞罗那", "barcelona"],
  ["巴萨", "barcelona"],
  ["马德里竞技", "atletico madrid"],
  ["塞维利亚", "sevilla"],
  ["皇家贝蒂斯", "real betis"],
  ["赫塔菲", "getafe"],
  ["巴列卡诺", "rayo vallecano"],
  ["西班牙人", "espanyol"],
  ["瓦伦西亚", "valencia"],
  ["比利亚雷亚尔", "villarreal"],
  ["毕尔巴鄂竞技", "athletic bilbao"],
  ["埃尔切", "elche"],
  ["尤文图斯", "juventus"],
  ["国际米兰", "inter"],
  ["AC米兰", "ac milan"],
  ["那不勒斯", "napoli"],
  ["罗马", "roma"],
  ["拉齐奥", "lazio"],
  ["拜仁慕尼黑", "bayern munich"],
  ["多特蒙德", "borussia dortmund"],
  ["莱比锡", "rb leipzig"],
  ["勒沃库森", "bayer leverkusen"],
  ["巴黎圣日耳曼", "paris saint germain"],
  ["马赛", "marseille"],
  ["本菲卡", "benfica"],
  ["波尔图", "porto"],
  ["里斯本竞技", "sporting cp"]
]);

const LEAGUE_ALIASES = new Map([
  ["英超", "premier league"],
  ["西甲", "laliga"],
  ["德甲", "bundesliga"],
  ["意甲", "serie a"],
  ["法甲", "ligue 1"],
  ["欧冠", "champions league"],
  ["欧联", "europa league"],
  ["英冠", "championship"]
]);

const fixtureDateCache = new Map();
const sportsDbDateCache = new Map();
const sportsDbTeamCache = new Map();
const sportsDbTeamEventsCache = new Map();

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(fc|cf|afc|sc|ac|as|sv|club|football)\b/g, " ")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function canonicalTeam(value) {
  const raw = String(value || "").trim();
  if (TEAM_ALIASES.has(raw)) {
    return TEAM_ALIASES.get(raw);
  }
  const normalized = normalizeName(raw);
  for (const [alias, canonical] of TEAM_ALIASES) {
    const normalizedAlias = normalizeName(alias);
    if (
      normalized === normalizedAlias ||
      normalized.includes(normalizedAlias) ||
      normalizedAlias.includes(normalized)
    ) {
      return canonical;
    }
  }
  return normalized;
}

function teamAffinity(left, right) {
  const a = canonicalTeam(left);
  const b = canonicalTeam(right);
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }
  if (a.includes(b) || b.includes(a)) {
    return 0.82;
  }
  const leftTokens = new Set(a.split(" ").filter(Boolean));
  const rightTokens = new Set(b.split(" ").filter(Boolean));
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const total = new Set([...leftTokens, ...rightTokens]).size || 1;
  return (overlap / total) * 0.7;
}

function leagueAffinity(left, right) {
  const raw = String(left || "").trim();
  const canonical = LEAGUE_ALIASES.get(raw) || normalizeName(raw);
  const provider = normalizeName(right);
  if (!canonical || !provider) {
    return 0;
  }
  return canonical === provider || provider.includes(canonical) ? 1 : 0;
}

function timeAffinity(left, right) {
  const differenceMinutes =
    Math.abs(Date.parse(left) - Date.parse(right)) / 60_000;
  if (!Number.isFinite(differenceMinutes)) {
    return 0;
  }
  if (differenceMinutes <= 10) return 1;
  if (differenceMinutes <= 30) return 0.9;
  if (differenceMinutes <= 120) return 0.72;
  if (differenceMinutes <= 480) return 0.42;
  return 0.1;
}

function scoreFixtureMatch(fixture, providerFixture) {
  const home = teamAffinity(
    fixture.home,
    providerFixture.teams?.home?.name
  );
  const away = teamAffinity(
    fixture.away,
    providerFixture.teams?.away?.name
  );
  const time = timeAffinity(
    fixture.kickoffAt,
    providerFixture.fixture?.date
  );
  const league = leagueAffinity(
    fixture.competition,
    providerFixture.league?.name
  );
  return {
    home,
    away,
    time,
    league,
    total: home * 0.4 + away * 0.4 + time * 0.15 + league * 0.05
  };
}

function chooseFixtureMatch(fixture, providerFixtures) {
  let best = null;
  for (const providerFixture of providerFixtures) {
    const score = scoreFixtureMatch(fixture, providerFixture);
    if (
      score.home < 0.55 ||
      score.away < 0.55 ||
      score.time < 0.2 ||
      score.total < 0.68
    ) {
      continue;
    }
    if (!best || score.total > best.score.total) {
      best = { providerFixture, score };
    }
  }
  return best;
}

function apiHeaders() {
  const key = process.env.FOOTBALL_API_KEY;
  if (!key) {
    const error = new Error("没有配置 FOOTBALL_API_KEY");
    error.status = 503;
    throw error;
  }
  return {
    "x-apisports-key": key,
    Accept: "application/json"
  };
}

async function apiRequest(pathname, params = {}) {
  const base = String(
    process.env.FOOTBALL_API_BASE || "https://v3.football.api-sports.io"
  ).replace(/\/$/, "");
  const url = new URL(`${base}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url, {
    headers: apiHeaders()
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || Object.keys(payload.errors || {}).length) {
    const message =
      Object.values(payload.errors || {})[0] ||
      payload.message ||
      `足球数据接口返回 HTTP ${response.status}`;
    const error = new Error(String(message));
    error.status = response.status >= 400 && response.status < 500 ? 502 : 503;
    throw error;
  }
  return {
    payload,
    remaining: Number(
      response.headers.get("x-ratelimit-requests-remaining") || 0
    )
  };
}

async function fixturesForDate(date) {
  const cached = fixtureDateCache.get(date);
  if (cached && Date.now() - cached.loadedAt < 30 * 60 * 1000) {
    return cached;
  }
  const { payload, remaining } = await apiRequest("/fixtures", {
    date,
    timezone: "UTC"
  });
  const result = {
    loadedAt: Date.now(),
    remaining,
    fixtures: payload.response || []
  };
  fixtureDateCache.set(date, result);
  return result;
}

function dateVariants(isoDate) {
  const date = new Date(isoDate);
  const values = [];
  for (const offset of [0, -1, 1]) {
    const current = new Date(date);
    current.setUTCDate(current.getUTCDate() + offset);
    values.push(current.toISOString().slice(0, 10));
  }
  return [...new Set(values)];
}

async function resolveProviderFixture(fixture) {
  if (fixture.providerFixtureId) {
    return fixture.providerFixtureId;
  }
  for (const date of dateVariants(fixture.kickoffAt)) {
    const result = await fixturesForDate(date);
    const match = chooseFixtureMatch(fixture, result.fixtures);
    if (match) {
      return match.providerFixture.id;
    }
  }
  return null;
}

function normalizePlayer(entry) {
  return {
    id: entry.player?.id || null,
    name: entry.player?.name || "",
    number: entry.player?.number ?? null,
    position: entry.player?.pos || "",
    grid: entry.player?.grid || ""
  };
}

function normalizeTeamLineup(team) {
  return {
    providerTeamId: team.team?.id || null,
    name: team.team?.name || "",
    logo: team.team?.logo || "",
    formation: team.formation || "",
    startXI: (team.startXI || []).map(normalizePlayer),
    substitutes: (team.substitutes || []).map(normalizePlayer),
    coach: {
      id: team.coach?.id || null,
      name: team.coach?.name || "",
      photo: team.coach?.photo || ""
    }
  };
}

function orderLineups(fixture, teams) {
  if (teams.length < 2) {
    return { home: normalizeTeamLineup(teams[0] || {}), away: null };
  }
  const [first, second] = teams;
  const firstHome = teamAffinity(fixture.home, first.team?.name);
  const secondHome = teamAffinity(fixture.home, second.team?.name);
  const homeTeam = firstHome >= secondHome ? first : second;
  const awayTeam = firstHome >= secondHome ? second : first;
  return {
    home: normalizeTeamLineup(homeTeam),
    away: normalizeTeamLineup(awayTeam)
  };
}

async function fetchProviderLineups(providerFixtureId) {
  const { payload, remaining } = await apiRequest("/fixtures/lineups", {
    fixture: providerFixtureId
  });
  return {
    teams: payload.response || [],
    remaining
  };
}

function eventKickoff(event) {
  const time = String(event.strTime || "00:00:00");
  return `${event.dateEvent}T${time}Z`;
}

function scoreSportsDbEvent(fixture, event) {
  const home = teamAffinity(fixture.home, event.strHomeTeam);
  const away = teamAffinity(fixture.away, event.strAwayTeam);
  const time = timeAffinity(fixture.kickoffAt, eventKickoff(event));
  const league = leagueAffinity(
    fixture.competition,
    event.strLeague || event.strLeagueAlternate
  );
  return {
    home,
    away,
    time,
    league,
    total: home * 0.4 + away * 0.4 + time * 0.15 + league * 0.05
  };
}

function chooseSportsDbEvent(fixture, events) {
  let best = null;
  for (const event of events) {
    const score = scoreSportsDbEvent(fixture, event);
    if (
      score.home < 0.55 ||
      score.away < 0.55 ||
      score.time < 0.2 ||
      score.total < 0.68
    ) {
      continue;
    }
    if (!best || score.total > best.score.total) {
      best = { event, score };
    }
  }
  return best;
}

async function sportsDbRequest(pathname, params = {}) {
  const url = new URL(
    `https://www.thesportsdb.com/api/v1/json/3${pathname}`
  );
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "NorthStandDVR/1.0"
    }
  });
  if (!response.ok) {
    throw new Error(`TheSportsDB 返回 HTTP ${response.status}`);
  }
  return response.json();
}

async function sportsDbEventsForDate(date) {
  const cached = sportsDbDateCache.get(date);
  if (cached && Date.now() - cached.loadedAt < 30 * 60 * 1000) {
    return cached.events;
  }
  const payload = await sportsDbRequest("/eventsday.php", {
    d: date,
    s: "Soccer"
  });
  const events = payload.events || [];
  sportsDbDateCache.set(date, { loadedAt: Date.now(), events });
  return events;
}

async function searchSportsDbTeam(name) {
  const canonical = canonicalTeam(name);
  if (!canonical) {
    return null;
  }
  const cached = sportsDbTeamCache.get(canonical);
  if (cached && Date.now() - cached.loadedAt < 24 * 60 * 60 * 1000) {
    return cached.team;
  }
  const payload = await sportsDbRequest("/searchteams.php", {
    t: canonical
  });
  const team =
    (payload.teams || []).find(
      (item) => String(item.strSport || "").toLowerCase() === "soccer"
    ) || null;
  sportsDbTeamCache.set(canonical, {
    loadedAt: Date.now(),
    team
  });
  return team;
}

async function sportsDbTeamEvents(teamId) {
  const cached = sportsDbTeamEventsCache.get(teamId);
  if (cached && Date.now() - cached.loadedAt < 30 * 60 * 1000) {
    return cached.events;
  }
  const [next, last] = await Promise.all([
    sportsDbRequest("/eventsnext.php", { id: teamId }),
    sportsDbRequest("/eventslast.php", { id: teamId })
  ]);
  const events = [...(next.events || []), ...(last.results || [])];
  sportsDbTeamEventsCache.set(teamId, {
    loadedAt: Date.now(),
    events
  });
  return events;
}

async function resolveSportsDbEvent(fixture) {
  if (fixture.sportsDbEventId) {
    return fixture.sportsDbEventId;
  }
  for (const date of dateVariants(fixture.kickoffAt)) {
    const events = await sportsDbEventsForDate(date);
    const match = chooseSportsDbEvent(fixture, events);
    if (match) {
      return match.event.idEvent;
    }
  }
  for (const teamName of [fixture.home, fixture.away]) {
    const team = await searchSportsDbTeam(teamName);
    if (!team?.idTeam) {
      continue;
    }
    const events = await sportsDbTeamEvents(team.idTeam);
    const match = chooseSportsDbEvent(fixture, events);
    if (match) {
      return match.event.idEvent;
    }
  }
  return null;
}

function assignFormationGrids(players, formation) {
  const rows = String(formation || "")
    .split("-")
    .map(Number)
    .filter(Boolean);
  if (!rows.length) {
    return players;
  }
  const output = players.map((player) => ({ ...player }));
  let offset = 0;
  const groups = [1, ...rows];
  groups.forEach((count, rowIndex) => {
    for (let column = 0; column < count; column += 1) {
      const player = output[offset + column];
      if (player) {
        player.grid = `${rowIndex + 1}:${column + 1}`;
      }
    }
    offset += count;
  });
  return output;
}

function sportsDbPositionOrder(position) {
  const value = String(position || "").toLowerCase();
  if (value.includes("goalkeeper")) return 0;
  if (value.includes("back") || value.includes("defender")) return 1;
  if (value.includes("midfield")) return 2;
  if (
    value.includes("winger") ||
    value.includes("forward") ||
    value.includes("striker")
  ) {
    return 4;
  }
  return 2;
}

function deriveSportsDbFormation(starters) {
  const lines = [0, 0, 0];
  for (const entry of starters) {
    const order = sportsDbPositionOrder(entry.strPosition);
    if (order === 1) {
      lines[0] += 1;
    } else if (order === 2) {
      lines[1] += 1;
    } else if (order === 4) {
      lines[2] += 1;
    }
  }
  return lines.every((count) => count > 0) ? lines.join("-") : "";
}

function normalizeSportsDbLineup(fixture, entries) {
  const groups = {
    home: entries.filter((entry) => String(entry.strHome).toLowerCase() === "yes"),
    away: entries.filter((entry) => String(entry.strHome).toLowerCase() === "no")
  };
  if (!groups.home.length || !groups.away.length) {
    groups.home = entries.filter(
      (entry) => teamAffinity(fixture.home, entry.strTeam) >= 0.55
    );
    groups.away = entries.filter(
      (entry) => teamAffinity(fixture.away, entry.strTeam) >= 0.55
    );
  }
  const normalize = (items) => {
    const startersSource = items
      .filter(
        (entry) =>
          !/^(yes|true|1)$/i.test(String(entry.strSubstitute || ""))
      )
      .map((entry, index) => ({ ...entry, sourceIndex: index }))
      .sort(
        (left, right) =>
          sportsDbPositionOrder(left.strPosition) -
            sportsDbPositionOrder(right.strPosition) ||
          left.sourceIndex - right.sourceIndex
      );
    const formation =
      items.find((entry) => entry.strFormation)?.strFormation ||
      deriveSportsDbFormation(startersSource);
    const starters = assignFormationGrids(
      startersSource,
      formation
    );
    const substitutes = items.filter((entry) =>
      /^(yes|true|1)$/i.test(String(entry.strSubstitute || ""))
    );
    const team = items[0] || {};
    return {
      providerTeamId: team.idTeam || null,
      name: team.strTeam || "",
      logo: team.strTeamBadge || "",
      formation,
      startXI: starters.map((entry) => ({
        id: entry.idPlayer || null,
        name: entry.strPlayer || "",
        number:
          entry.intSquadNumber || entry.strNumber
            ? Number(entry.intSquadNumber || entry.strNumber)
            : null,
        position: entry.strPosition || "",
        grid: entry.grid || ""
      })),
      substitutes: substitutes.map((entry) => ({
        id: entry.idPlayer || null,
        name: entry.strPlayer || "",
        number:
          entry.intSquadNumber || entry.strNumber
            ? Number(entry.intSquadNumber || entry.strNumber)
            : null,
        position: entry.strPosition || "",
        grid: ""
      })),
      coach: { id: null, name: "", photo: "" }
    };
  };
  return {
    home: normalize(groups.home),
    away: normalize(groups.away)
  };
}

async function refreshWithSportsDb(fixture) {
  const eventId = await resolveSportsDbEvent(fixture);
  if (!eventId) {
    return null;
  }
  const payload = await sportsDbRequest("/lookuplineup.php", {
    id: eventId
  });
  const entries = Array.isArray(payload.lineup)
    ? payload.lineup
    : [];
  if (!entries.length) {
    return {
      status: "not-available",
      provider: "thesportsdb",
      providerFixtureId: eventId,
      error: "TheSportsDB 暂未公布首发"
    };
  }
  const teams = normalizeSportsDbLineup(fixture, entries);
  const complete =
    teams.home.startXI.length >= 11 && teams.away.startXI.length >= 11;
  return {
    status: complete ? "confirmed" : "partial",
    provider: "thesportsdb",
    providerFixtureId: eventId,
    ...teams,
    error: complete
      ? null
      : "TheSportsDB 免费版只返回部分阵容，可手动补全"
  };
}

async function refreshFixtureLineup(fixture, { force = false } = {}) {
  const now = Date.now();
  const previous = fixture.lineup || {};
  if (
    !force &&
    previous.status === "confirmed" &&
    previous.fetchedAt &&
    now - Date.parse(previous.fetchedAt) < 2 * 60 * 60 * 1000
  ) {
    return fixture.lineup;
  }
  const provider = String(
    process.env.FOOTBALL_API_PROVIDER || "auto"
  ).toLowerCase();
  let sportsDbResult = null;
  let sportsDbError = null;

  if (provider === "auto" || provider === "thesportsdb") {
    try {
      sportsDbResult = await refreshWithSportsDb(fixture);
      if (sportsDbResult?.status === "confirmed") {
        const lineup = finalizeLineup(previous, sportsDbResult, now);
        await storeUpdateFixtureLineup(
          fixture,
          lineup,
          lineup.providerFixtureId
        );
        return lineup;
      }
    } catch (error) {
      sportsDbError = error;
    }
    if (provider === "thesportsdb") {
      const lineup = finalizeLineup(
        previous,
        sportsDbResult || {
          status: "error",
          provider: "thesportsdb",
          error: sportsDbError?.message || "没有匹配到 TheSportsDB 比赛"
        },
        now
      );
      await storeUpdateFixtureLineup(
        fixture,
        lineup,
        lineup.providerFixtureId
      );
      return lineup;
    }
  }

  try {
    const providerFixtureId =
      fixture.providerFixtureId || (await resolveProviderFixture(fixture));
    if (!providerFixtureId) {
      const fallback = sportsDbResult || {
        status: "match-not-found",
        provider: "api-football",
        error:
          sportsDbError?.message ||
          "没有匹配到官方比赛，可手动粘贴首发"
      };
      const lineup = finalizeLineup(previous, fallback, now);
      await storeUpdateFixtureLineup(fixture, lineup, null);
      return lineup;
    }
    const result = await fetchProviderLineups(providerFixtureId);
    if (!result.teams.length) {
      const lineup = finalizeLineup(
        previous,
        {
          status: "not-available",
          provider: "api-football",
          providerFixtureId,
          quotaRemaining: result.remaining,
          error: "官方首发尚未公布"
        },
        now
      );
      await storeUpdateFixtureLineup(fixture, lineup, providerFixtureId);
      return lineup;
    }
    const teams = orderLineups(fixture, result.teams);
    const lineup = finalizeLineup(
      { attempts: previous.attempts },
      {
        status: "confirmed",
        provider: "api-football",
        providerFixtureId,
        quotaRemaining: result.remaining,
        home: teams.home,
        away: teams.away,
        error: null
      },
      now
    );
    await storeUpdateFixtureLineup(fixture, lineup, providerFixtureId);
    return lineup;
  } catch (error) {
    const fallback = sportsDbResult || {
      status: "error",
      provider: "api-football",
      error: error.message
    };
    const lineup = finalizeLineup(previous, fallback, now);
    await storeUpdateFixtureLineup(
      fixture,
      lineup,
      lineup.providerFixtureId || null
    );
    return lineup;
  }
}

function finalizeLineup(previous, value, now = Date.now()) {
  return {
    ...previous,
    ...value,
    fetchedAt: new Date(now).toISOString(),
    lastAttemptAt: new Date(now).toISOString(),
    attempts: (Number(previous?.attempts) || 0) + 1
  };
}

let storeUpdateFixtureLineup = async () => {};

function setLineupStoreUpdater(updater) {
  storeUpdateFixtureLineup = updater;
}

function lineupRefreshDue(fixture, now = Date.now()) {
  if (fixture.captureMode === "replay") {
    return false;
  }
  const kickoff = Date.parse(fixture.kickoffAt);
  if (!Number.isFinite(kickoff)) {
    return false;
  }
  if (now < kickoff - 3 * 60 * 60 * 1000 || now > kickoff + 6 * 60 * 60 * 1000) {
    return false;
  }
  if (fixture.lineup?.status === "confirmed") {
    return false;
  }
  const lastAttempt = Date.parse(fixture.lineup?.lastAttemptAt || 0);
  const minutesToKickoff = (kickoff - now) / 60_000;
  const intervalMinutes =
    minutesToKickoff <= 30 ? 5 : minutesToKickoff <= 90 ? 10 : 20;
  return !lastAttempt || now - lastAttempt >= intervalMinutes * 60_000;
}

function parseManualTeam(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let formation = "";
  const startingLines = [];
  const substitutes = [];
  let inSubstitutes = false;
  for (const line of lines) {
    if (/^替补\s*[:：]/.test(line)) {
      inSubstitutes = true;
      substitutes.push(
        ...line
          .replace(/^替补\s*[:：]/, "")
          .split(/[,，;；]+/)
          .map((name) => name.trim())
          .filter(Boolean)
      );
      continue;
    }
    if (inSubstitutes) {
      substitutes.push(
        ...line
          .split(/[,，;；]+/)
          .map((name) => name.trim())
          .filter(Boolean)
      );
      continue;
    }
    const formationMatch = /(\d(?:-\d){1,3})/.exec(line);
    if (formationMatch && !formation) {
      formation = formationMatch[1];
      continue;
    }
    startingLines.push(line);
  }
  const splitPlayers = (value) =>
    value
      .split(/[,，;；]+/)
      .map((name) => name.trim())
      .filter(Boolean);
  const startXI = startingLines.flatMap(splitPlayers);
  return {
    formation,
    startXI: startXI.map((name, index) => ({
      id: null,
      name,
      number: null,
      position: index === 0 ? "G" : "P",
      grid: index === 0 ? "1:1" : ""
    })),
    substitutes: substitutes.map((name) => ({
      id: null,
      name,
      number: null,
      position: "",
      grid: ""
    })),
    coach: { id: null, name: "", photo: "" }
  };
}

module.exports = {
  apiRequest,
  canonicalTeam,
  chooseFixtureMatch,
  lineups: {
    parseManualTeam
  },
  lineupRefreshDue,
  normalizeSportsDbLineup,
  parseManualTeam,
  refreshFixtureLineup,
  resolveProviderFixture,
  scoreFixtureMatch,
  setLineupStoreUpdater,
  teamAffinity
};

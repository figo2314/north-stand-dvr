const test = require("node:test");
const assert = require("node:assert/strict");
const {
  canonicalTeam,
  chooseFixtureMatch,
  lineupRefreshDue,
  normalizeSportsDbLineup,
  parseManualTeam,
  teamAffinity
} = require("../server/lineups");

test("team aliases match Chinese fixture names to provider names", () => {
  assert.equal(canonicalTeam("阿森纳"), "arsenal");
  assert.equal(teamAffinity("皇家马德里", "Real Madrid"), 1);
  assert.ok(teamAffinity("纽卡斯尔联", "Newcastle United") >= 0.8);
});

test("chooseFixtureMatch selects the closest kickoff and team pairing", () => {
  const fixture = {
    home: "布伦特福德",
    away: "切尔西",
    competition: "英超",
    kickoffAt: "2026-09-18T18:30:00.000Z"
  };
  const result = chooseFixtureMatch(fixture, [
    {
      fixture: { id: 100, date: "2026-09-18T18:30:00.000Z" },
      league: { name: "Premier League" },
      teams: {
        home: { name: "Brentford" },
        away: { name: "Chelsea" }
      }
    },
    {
      fixture: { id: 101, date: "2026-09-19T18:30:00.000Z" },
      league: { name: "Premier League" },
      teams: {
        home: { name: "Brentford" },
        away: { name: "Chelsea" }
      }
    }
  ]);
  assert.equal(result.providerFixture.fixture.id, 100);
});

test("lineupRefreshDue limits checks near kickoff and skips confirmed lineups", () => {
  const kickoffAt = "2026-09-19T12:00:00.000Z";
  assert.equal(
    lineupRefreshDue(
      { kickoffAt, lineup: null },
      Date.parse("2026-09-19T11:00:00.000Z")
    ),
    true
  );
  assert.equal(
    lineupRefreshDue(
      { kickoffAt, lineup: { status: "confirmed" } },
      Date.parse("2026-09-19T11:00:00.000Z")
    ),
    false
  );
});

test("parseManualTeam understands formation, starters, and substitutes", () => {
  const lineup = parseManualTeam(
    [
      "阿森纳 4-3-3",
      "拉亚，廷贝尔，萨利巴，加布里埃尔，卡拉菲奥里",
      "厄德高，赖斯，梅里诺",
      "萨卡，哈弗茨，马丁内利",
      "替补：拉姆斯代尔，富安健洋，热苏斯"
    ].join("\n")
  );
  assert.equal(lineup.formation, "4-3-3");
  assert.equal(lineup.startXI.length, 11);
  assert.equal(lineup.substitutes.length, 3);
  assert.equal(lineup.startXI[0].name, "拉亚");
});

test("normalizeSportsDbLineup derives formation and player grids", () => {
  const positions = [
    "Goalkeeper",
    "Centre-Back",
    "Centre-Back",
    "Left-Back",
    "Right-Back",
    "Central Midfield",
    "Central Midfield",
    "Attacking Midfield",
    "Left Winger",
    "Right Winger",
    "Striker"
  ];
  const entries = [];
  for (const home of ["Yes", "No"]) {
    positions.forEach((position, index) => {
      entries.push({
        strHome: home,
        strSubstitute: "No",
        strTeam: home === "Yes" ? "Arsenal" : "Chelsea",
        strPlayer: `${home}-${index}`,
        strPosition: position,
        intSquadNumber: index + 1
      });
    });
  }
  const lineup = normalizeSportsDbLineup(
    { home: "阿森纳", away: "切尔西" },
    entries
  );
  assert.equal(lineup.home.formation, "4-3-3");
  assert.equal(lineup.home.startXI.length, 11);
  assert.match(lineup.home.startXI.at(-1).grid, /^4:/);
});

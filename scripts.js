// ──────────────── CONFIGURATION ────────────────
const GITHUB_USERNAME = "EveHaddox";
const REPO_NAME       = "Games-Leaderboard";

const RAW_BASE_URL = `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${REPO_NAME}/main`;
const API_BASE_URL = `https://api.github.com/repos/${GITHUB_USERNAME}/${REPO_NAME}`;

const GAMES_JSON_PATH      = "games.json";
const LOCAL_STORAGE_TOKEN_KEY = "github_access_token";


// ──────────────── UTILITY: GitHub file fetch & commit ────────────────
async function fetchGames() {
  const url = `${RAW_BASE_URL}/${GAMES_JSON_PATH}?cachebust=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch games.json");
  return await res.json();
}

async function getFileSHAandContent() {
  const endpoint = `${API_BASE_URL}/contents/${GAMES_JSON_PATH}`;
  const accessToken = localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
  const headers = { Accept: "application/vnd.github.v3+json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(endpoint, { headers });
  if (res.status === 404) return { sha: null, content: btoa("[]") };
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`GitHub API error: ${msg}`);
  }
  const data = await res.json();
  return { sha: data.sha, content: data.content };
}

async function commitGames(newGamesArray, commitMessage) {
  const accessToken = localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
  if (!accessToken) throw new Error("No GitHub token found.");
  const { sha, content: oldBase64 } = await getFileSHAandContent();
  const newContentString = JSON.stringify(newGamesArray, null, 2);
  const newContentBase64 = btoa(unescape(encodeURIComponent(newContentString)));

  const endpoint = `${API_BASE_URL}/contents/${GAMES_JSON_PATH}`;
  const body = {
    message: commitMessage,
    content: newContentBase64,
    ...(sha ? { sha } : {}),
    branch: "main"
  };
  const res = await fetch(endpoint, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error("GitHub commit failed: " + errText);
  }
  return await res.json();
}


// ──────────────── ADMIN: PAT-based login ────────────────
function savePAT() {
  console.log("savePAT() called"); // for debugging
  const pat = document.getElementById("pat-input").value.trim();
  if (!pat) {
    alert("Token cannot be empty.");
    return;
  }
  localStorage.setItem(LOCAL_STORAGE_TOKEN_KEY, pat);
  window.location.reload();
}

function logout() {
  localStorage.removeItem(LOCAL_STORAGE_TOKEN_KEY);
  window.location.reload();
}

/**
 * On admin page load, show PAT input if no token.
 * Otherwise show the “Add Game” form.
 */
function onAdminPageLoad() {
  const token = localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
  if (token) {
    document.getElementById("pat-section").style.display = "none";
    document.getElementById("game-form-container").style.display = "block";
  } else {
    document.getElementById("pat-section").style.display = "block";
    document.getElementById("game-form-container").style.display = "none";
  }
}


// ──────────────── LEADERBOARD & PLAYER PAGE LOGIC ────────────────

function computePlayerStats(gamesArray) {
  const stats = new Map();
  function ensurePlayer(name) {
    if (!stats.has(name)) stats.set(name, { wins: 0, losses: 0, played: 0 });
  }
  gamesArray.forEach((game) => {
    const winnerIdx = game.winningTeamIndex;
    game.teams.forEach((teamPlayers, teamIdx) => {
      const isWinnerTeam = teamIdx === winnerIdx;
      teamPlayers.forEach((player) => {
        ensurePlayer(player);
        const pstats = stats.get(player);
        pstats.played += 1;
        if (isWinnerTeam) pstats.wins += 1;
        else pstats.losses += 1;
      });
    });
  });
  return stats;
}

async function renderLeaderboard() {
  let games;
  try {
    games = await fetchGames();
  } catch (err) {
    document.getElementById("leaderboard").innerText = "Error loading data: " + err;
    return;
  }
  const statsMap = computePlayerStats(games);
  const rows = Array.from(statsMap.entries())
    .map(([player, s]) => ({ player, ...s }))
    .sort((a, b) => b.wins - a.wins || b.played - a.played);

  const table = document.createElement("table");
  const headerRow = document.createElement("tr");
  ["Player", "Wins", "Losses", "Played"].forEach((heading) => {
    const th = document.createElement("th");
    th.innerText = heading;
    headerRow.appendChild(th);
  });
  table.appendChild(headerRow);

  rows.forEach((rowData) => {
    const tr = document.createElement("tr");
    const nameCell = document.createElement("td");
    const a = document.createElement("a");
    a.href = `player.html?user=${encodeURIComponent(rowData.player)}`;
    a.innerText = rowData.player;
    nameCell.appendChild(a);
    tr.appendChild(nameCell);

    ["wins", "losses", "played"].forEach((field) => {
      const td = document.createElement("td");
      td.innerText = rowData[field];
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });

  const container = document.getElementById("leaderboard");
  container.innerHTML = "";
  container.appendChild(table);
}

function getUserFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("user");
}

async function renderPlayerPage() {
  const player = getUserFromQuery();
  if (!player) {
    document.getElementById("player-games").innerText = "No player specified.";
    return;
  }
  document.getElementById("player-name").innerText = player;

  let games;
  try {
    games = await fetchGames();
  } catch (err) {
    document.getElementById("player-games").innerText = "Error loading data: " + err;
    return;
  }

  const filtered = games.filter((game) =>
    game.teams.some((team) => team.includes(player))
  );

  if (filtered.length === 0) {
    document.getElementById("player-games").innerText =
      `No games found for “${player}”.`;
    return;
  }

  const table = document.createElement("table");
  const headerRow = document.createElement("tr");
  ["Date/Time", "Game Name", "Team (You + Allies)", "Opponents", "Result"].forEach((h) => {
    const th = document.createElement("th");
    th.innerText = h;
    headerRow.appendChild(th);
  });
  table.appendChild(headerRow);

  filtered.forEach((game) => {
    const tr = document.createElement("tr");

    const dtCell = document.createElement("td");
    const dt = new Date(game.timestamp);
    dtCell.innerText = dt.toUTCString().replace(/ GMT$/, "");
    tr.appendChild(dtCell);

    const gnCell = document.createElement("td");
    gnCell.innerText = game.gameName;
    tr.appendChild(gnCell);

    const myTeamIdx = game.teams.findIndex((team) => team.includes(player));
    const myTeam = game.teams[myTeamIdx];
    const teamCell = document.createElement("td");
    teamCell.innerText = myTeam.join(", ");
    tr.appendChild(teamCell);

    const opponents = game.teams
      .filter((_, idx) => idx !== myTeamIdx)
      .flat();
    const oppCell = document.createElement("td");
    oppCell.innerText = opponents.join(", ");
    tr.appendChild(oppCell);

    const resCell = document.createElement("td");
    resCell.innerText = (myTeamIdx === game.winningTeamIndex) ? "W" : "L";
    tr.appendChild(resCell);

    table.appendChild(tr);
  });

  const container = document.getElementById("player-games");
  container.innerHTML = "";
  container.appendChild(table);
}


// ──────────────── ADMIN: Add‐Game form handler ────────────────
async function onAddGameFormSubmit(event) {
  event.preventDefault();

  const gameName = document.getElementById("gameName").value.trim();
  const winningTeamIndex = parseInt(
    document.getElementById("winningTeam").value,
    10
  );

  const teamsRaw = document.getElementById("teams").value.trim().split("\n");
  const teams = teamsRaw.map((line) =>
    line
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p !== "")
  );

  if (teams.length < 2) {
    alert("You must specify at least two teams (one per line).");
    return;
  }
  if (winningTeamIndex < 0 || winningTeamIndex >= teams.length) {
    alert("Invalid winning team index.");
    return;
  }
  if (gameName === "") {
    alert("Game name cannot be empty.");
    return;
  }

  const newGame = {
    timestamp: new Date().toISOString(),
    gameName,
    teams,
    winningTeamIndex
  };

  try {
    const { sha, content: oldBase64 } = await getFileSHAandContent();
    const oldArray = JSON.parse(atob(oldBase64));

    const newArray = oldArray.concat(newGame);
    const commitMsg = `Add game: ${gameName} (winner: Team ${winningTeamIndex + 1})`;
    await commitGames(newArray, commitMsg);

    alert("Game added successfully!");
    window.location.reload();
  } catch (err) {
    console.error(err);
    alert("Error adding game: " + err.message);
  }
}


// ──────────────── ON-LOAD BINDINGS ────────────────
function initPage() {
  const pageId = document.body.dataset.page;
  if (pageId === "index") {
    renderLeaderboard();
  } else if (pageId === "player") {
    renderPlayerPage();
  } else if (pageId === "admin") {
    onAdminPageLoad();
    document.getElementById("save-pat-button").onclick = savePAT;
    document.getElementById("logout-button").onclick    = logout;
    document.getElementById("add-game-form").onsubmit  = onAddGameFormSubmit;
  }
}

document.addEventListener("DOMContentLoaded", initPage);

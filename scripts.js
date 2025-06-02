// scripts.js

// ──────────────── CONFIGURATION ────────────────

// 1. Put your exact GitHub username and repo name here (do NOT change these to placeholders!)
const GITHUB_USERNAME = "EveHaddox";
const REPO_NAME       = "Games-Leaderboard";

// 2. Derive the raw + API base URLs from the above
const RAW_BASE_URL = `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${REPO_NAME}/main`;
const API_BASE_URL = `https://api.github.com/repos/${GITHUB_USERNAME}/${REPO_NAME}`;

const GAMES_JSON_PATH      = "games.json";
const LOCAL_STORAGE_TOKEN_KEY = "github_access_token"; // key under which we store the PAT


// ──────────────── UTILITY: Fetch the current games.json ────────────────

/**
 * Fetch the raw games.json (as JSON) from raw.githubusercontent.com
 * @returns {Promise<Array>}  Resolves to an array of game objects.
 */
async function fetchGames() {
  const url = `${RAW_BASE_URL}/${GAMES_JSON_PATH}?cachebust=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch games.json");
  return await res.json();
}


// ──────────────── UTILITY: Fetch the file SHA and content via GitHub API ────────────────

/**
 * Fetches the file metadata (SHA and Base64 content) from GitHub API
 * @returns {Promise<{ sha: string|null, content: string }>}
 */
async function getFileSHAandContent() {
  const endpoint = `${API_BASE_URL}/contents/${GAMES_JSON_PATH}`;
  const accessToken = localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
  const headers = { Accept: "application/vnd.github.v3+json" };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const res = await fetch(endpoint, { headers });
  if (res.status === 404) {
    // If the file doesn’t exist yet, return an empty array and null SHA
    return { sha: null, content: btoa("[]") };
  }
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`GitHub API error: ${msg}`);
  }
  const data = await res.json();
  return {
    sha: data.sha,
    content: data.content // Base64‐encoded
  };
}


// ──────────────── UTILITY: Commit updated games.json back to GitHub ────────────────

/**
 * Updates games.json by committing `newGamesArray` to the repo.
 * The PAT must already be in localStorage under LOCAL_STORAGE_TOKEN_KEY.
 *
 * @param {Array}  newGamesArray  JavaScript array of game objects (JSON‐stringified inside).
 * @param {string} commitMessage  The commit message to use.
 */
async function commitGames(newGamesArray, commitMessage) {
  const accessToken = localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
  if (!accessToken) {
    throw new Error("No GitHub token found. Please paste a valid PAT first.");
  }

  // 1. Get existing SHA & content
  const { sha, content: oldContentBase64 } = await getFileSHAandContent();
  // (We don’t strictly need oldGames, but we decode it for sanity.)
  const oldGames = JSON.parse(atob(oldContentBase64));

  // 2. Prepare the updated content
  const newContentString = JSON.stringify(newGamesArray, null, 2);
  // GitHub requires Base64‐encoded, UTF‐8-safe
  const newContentBase64 = btoa(unescape(encodeURIComponent(newContentString)));

  // 3. PUT to GitHub API
  const endpoint = `${API_BASE_URL}/contents/${GAMES_JSON_PATH}`;
  const body = {
    message: commitMessage,
    content: newContentBase64,
    // if sha === null, omit it so GitHub creates the file; otherwise it updates
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


// ──────────────── ADMIN: PAT-based login (no OAuth) ────────────────

/**
 * Called when the admin clicks "Save Token". Stores the PAT in localStorage and reloads.
 */
function savePAT() {
  const pat = document.getElementById("pat-input").value.trim();
  if (!pat) {
    alert("Token cannot be empty.");
    return;
  }
  localStorage.setItem(LOCAL_STORAGE_TOKEN_KEY, pat);
  window.location.reload();
}

/**
 * Clears the stored PAT and reloads (logs out).
 */
function logout() {
  localStorage.removeItem(LOCAL_STORAGE_TOKEN_KEY);
  window.location.reload();
}

/**
 * On admin.html load:
 * - If a PAT is already in localStorage, hide the PAT‐input section and show the game form.
 * - Otherwise, show just the PAT‐input box.
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


// ──────────────── LEADERBOARD: Compute stats and render ────────────────

/**
 * Given an array of game objects, compute a Map of player → stats (wins, losses, played).
 * @param {Array} gamesArray
 * @returns {Map<string, { wins: number, losses: number, played: number }>}
 */
function computePlayerStats(gamesArray) {
  const stats = new Map();

  function ensurePlayer(name) {
    if (!stats.has(name)) {
      stats.set(name, { wins: 0, losses: 0, played: 0 });
    }
  }

  gamesArray.forEach((game) => {
    const winnerIdx = game.winningTeamIndex;
    game.teams.forEach((teamPlayers, teamIdx) => {
      const isWinnerTeam = (teamIdx === winnerIdx);
      teamPlayers.forEach((player) => {
        ensurePlayer(player);
        const pstats = stats.get(player);
        pstats.played += 1;
        if (isWinnerTeam) {
          pstats.wins += 1;
        } else {
          pstats.losses += 1;
        }
      });
    });
  });

  return stats;
}


/**
 * Renders the leaderboard table inside <div id="leaderboard"></div>
 */
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


// ──────────────── PLAYER PAGE: Extract user from URL, render their games ────────────────

/**
 * Reads “?user=...” from URL and returns it (or null if missing).
 */
function getUserFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("user");
}

/**
 * Renders a given player’s game history inside <div id="player-games"></div>
 */
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

  // Filter games where this player appears in any team
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

    // 1) Date/Time
    const dtCell = document.createElement("td");
    const dt = new Date(game.timestamp);
    dtCell.innerText = dt.toUTCString().replace(/ GMT$/, "");
    tr.appendChild(dtCell);

    // 2) Game Name
    const gnCell = document.createElement("td");
    gnCell.innerText = game.gameName;
    tr.appendChild(gnCell);

    // 3) Team (you + allies)
    const myTeamIdx = game.teams.findIndex((team) => team.includes(player));
    const myTeam = game.teams[myTeamIdx];
    const teamCell = document.createElement("td");
    teamCell.innerText = myTeam.join(", ");
    tr.appendChild(teamCell);

    // 4) Opponents (flatten all other teams)
    const opponents = game.teams
      .filter((_, idx) => idx !== myTeamIdx)
      .flat();
    const oppCell = document.createElement("td");
    oppCell.innerText = opponents.join(", ");
    tr.appendChild(oppCell);

    // 5) Result
    const resCell = document.createElement("td");
    resCell.innerText = (myTeamIdx === game.winningTeamIndex) ? "W" : "L";
    tr.appendChild(resCell);

    table.appendChild(tr);
  });

  const container = document.getElementById("player-games");
  container.innerHTML = "";
  container.appendChild(table);
}


// ──────────────── ADMIN: Handle “Add Game” form submission ────────────────

/**
 * Called when admin submits the “Add Game” form.
 * Gathers form data, builds a new game object, appends to existing array, then commits via API.
 */
async function onAddGameFormSubmit(event) {
  event.preventDefault();

  // 1) Gather form values
  const gameName = document.getElementById("gameName").value.trim();
  const winningTeamIndex = parseInt(
    document.getElementById("winningTeam").value,
    10
  );

  // Teams are entered one line per team, comma-separated players
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

  // Build the new game object
  const newGame = {
    timestamp: new Date().toISOString(),
    gameName,
    teams,
    winningTeamIndex
  };

  // 2) Fetch existing games, append, and commit
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

/**
 * Call this in each page’s <script> section to initialize that page.
 */
function initPage() {
  const pageId = document.body.dataset.page; // e.g. “index”, “player”, “admin”
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

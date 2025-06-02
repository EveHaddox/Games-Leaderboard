// scripts.js

// ──────────────── CONFIGURATION ────────────────

// 1. Replace these placeholders:
const GITHUB_USERNAME = "EveHaddox";
const REPO_NAME       = "Games-Leaderboard";
const OAUTH_CLIENT_ID = "<YOUR-OAUTH-CLIENT-ID>";

// 2. Derive some constants:
const RAW_BASE_URL = `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${REPO_NAME}/main`;
const API_BASE_URL = `https://api.github.com/repos/${GITHUB_USERNAME}/${REPO_NAME}`;

const GAMES_JSON_PATH = "games.json";  // path within the repo
const LOCAL_STORAGE_TOKEN_KEY = "github_access_token";


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
 * @returns {Promise<{ sha: string, content: string }>}
 */
async function getFileSHAandContent() {
  const endpoint = `${API_BASE_URL}/contents/${GAMES_JSON_PATH}`;
  const accessToken = localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
  const headers = {
    Accept: "application/vnd.github.v3+json"
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(endpoint, { headers });
  if (res.status === 404) {
    // If the file doesn’t exist, return empty array and null SHA
    return { sha: null, content: btoa("[]") };
  }
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`GitHub API error: ${msg}`);
  }
  const data = await res.json();
  return {
    sha: data.sha,
    content: data.content,               // Base64‐encoded string
  };
}


// ──────────────── UTILITY: Commit updated games.json back to GitHub ────────────────

/**
 * Updates games.json by committing `newGamesArray` to the repo.
 * @param {Array} newGamesArray  JavaScript array of game objects (will be JSON.stringified).
 * @param {string} commitMessage
 */
async function commitGames(newGamesArray, commitMessage) {
  const accessToken = localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
  if (!accessToken) throw new Error("Not authenticated");

  // 1. Get existing SHA & content
  const { sha, content: oldContentBase64 } = await getFileSHAandContent();
  const oldGames = JSON.parse(atob(oldContentBase64)); // just for sanity; not strictly needed

  // 2. Prepare new content
  const newContentString = JSON.stringify(newGamesArray, null, 2);
  const newContentBase64 = btoa(unescape(encodeURIComponent(newContentString)));

  // 3. PUT to GitHub API
  const endpoint = `${API_BASE_URL}/contents/${GAMES_JSON_PATH}`;
  const body = {
    message: commitMessage,
    content: newContentBase64,
    sha: sha,                  // if sha===null, omit it so it creates a new file
    branch: "main"
  };

  const res = await fetch(endpoint, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Accept": "application/vnd.github.v3+json",
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


// ──────────────── OAUTH: Redirect to GitHub for Implicit Grant ────────────────

/**
 * Redirects the browser to GitHub’s OAuth authorize endpoint.
 */
function loginWithGitHub() {
  const params = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    scope: "repo",           // “repo” scope is needed to write to the private/public repo
    allow_signup: "false"    // optional: prevent signups
  });
  const oauthURL = `https://github.com/login/oauth/authorize?${params.toString()}`;
  window.location.href = oauthURL;
}


/**
 * After GitHub redirects back to admin.html#access_token=…, call this to parse the token.
 * @returns {string|null}  token or null if not present
 */
function parseAccessTokenFromHash() {
  const hash = window.location.hash.substring(1); // remove “#”
  const params = new URLSearchParams(hash);
  return params.get("access_token");
}


// ──────────────── ADMIN: Check token & show/hide login vs. form ────────────────

/**
 * Called on admin.html load. If there’s an access_token in URL, store it.
 * Then check localStorage for a token. If present, show the “Add game” form. Otherwise show login button.
 */
function onAdminPageLoad() {
  const tokenFromHash = parseAccessTokenFromHash();
  if (tokenFromHash) {
    localStorage.setItem(LOCAL_STORAGE_TOKEN_KEY, tokenFromHash);

    // Clean up the URL so token isn’t visible
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  const storedToken = localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
  if (storedToken) {
    document.getElementById("not-logged-in").style.display = "none";
    document.getElementById("game-form-container").style.display = "block";
  } else {
    document.getElementById("not-logged-in").style.display = "block";
    document.getElementById("game-form-container").style.display = "none";
  }
}

/**
 * Logs out by removing token from localStorage and reloading.
 */
function logout() {
  localStorage.removeItem(LOCAL_STORAGE_TOKEN_KEY);
  window.location.reload();
}


// ──────────────── LEADERBOARD: Compute stats and render ────────────────

/**
 * Given an array of game objects, compute a map of player → stats.
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
    // For each team
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
  // Convert to array and sort by wins desc
  const rows = Array.from(statsMap.entries())
    .map(([player, s]) => ({ player, ...s }))
    .sort((a, b) => b.wins - a.wins || b.played - a.played);

  // Build HTML table
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
    // Player name as a link to player.html?user=<name>
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
  container.innerHTML = ""; // clear any “Loading…”
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

  // Filter games where this player is in one of the teams
  const filtered = games.filter((game) =>
    game.teams.some((team) => team.includes(player))
  );

  if (filtered.length === 0) {
    document.getElementById("player-games").innerText = "No games found for “" + player + "”.";
    return;
  }

  // Build a table
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


// ──────────────── ADMIN: Handle “Add game” form submission ────────────────

/**
 * Called when admin submits the “Add game” form.
 * Gathers form data, builds a new game object, appends to existing array, then commits via API.
 */
async function onAddGameFormSubmit(event) {
  event.preventDefault();

  // 1) Gather form values
  const gameName = document.getElementById("gameName").value.trim();
  const winningTeamIndex = parseInt(document.getElementById("winningTeam").value, 10);

  // We assume teams are entered as multi-line inputs; each line = one team, players separated by commas
  const teamsRaw = document.getElementById("teams").value.trim().split("\n");
  // Convert to array-of-arrays of trimmed player names (lowercased or as-is—let’s keep case consistent)
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

  // Build new game object
  const newGame = {
    timestamp: new Date().toISOString(), // UTC
    gameName,
    teams,
    winningTeamIndex
  };

  // 2) Fetch existing games, push newGame, commit
  try {
    // a) Get existing games array
    const { sha, content: oldBase64 } = await getFileSHAandContent();
    const oldArray = JSON.parse(atob(oldBase64));

    const newArray = oldArray.concat(newGame);

    const commitMsg = `Add game: ${gameName} (winner: Team ${winningTeamIndex + 1})`;
    await commitGames(newArray, commitMsg);

    // Success—reload or show a message
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
  const pageId = document.body.dataset.page; // we’ll set <body data-page="index">, etc.
  if (pageId === "index") {
    renderLeaderboard();
  } else if (pageId === "player") {
    renderPlayerPage();
  } else if (pageId === "admin") {
    onAdminPageLoad();
    document.getElementById("login-button").onclick = loginWithGitHub;
    document.getElementById("logout-button").onclick = logout;
    document.getElementById("add-game-form").onsubmit = onAddGameFormSubmit;
  }
}

// Run initPage once DOM is loaded
document.addEventListener("DOMContentLoaded", initPage);

// scripts.js

// ──────────────── CONFIGURATION ────────────────
const GITHUB_USERNAME       = "EveHaddox";
const REPO_NAME             = "Games-Leaderboard";

const RAW_BASE_URL          = `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${REPO_NAME}/main`;
const API_BASE_URL          = `https://api.github.com/repos/${GITHUB_USERNAME}/${REPO_NAME}`;

const GAMES_JSON_PATH       = "games.json";
const LOCAL_STORAGE_TOKEN_KEY = "github_access_token"; // stores the PAT under this key


// ──────────────── UTILITY: Fetch games.json ────────────────
async function fetchGames() {
  const url = `${RAW_BASE_URL}/${GAMES_JSON_PATH}?cachebust=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch games.json");
  return await res.json();
}

// ──────────────── UTILITY: Get file SHA + content ────────────────
async function getFileSHAandContent() {
  const endpoint = `${API_BASE_URL}/contents/${GAMES_JSON_PATH}`;
  const accessToken = localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
  const headers = { Accept: "application/vnd.github.v3+json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(endpoint, { headers });
  if (res.status === 404) {
    // If file doesn’t exist yet, return empty array + null SHA
    return { sha: null, content: btoa("[]") };
  }
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`GitHub API error: ${msg}`);
  }
  const data = await res.json();
  return { sha: data.sha, content: data.content };
}

// ──────────────── UTILITY: Commit updated games.json ────────────────
async function commitGames(newGamesArray, commitMessage) {
  const accessToken = localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
  if (!accessToken) {
    throw new Error("No GitHub token found. Please paste a valid PAT first.");
  }

  const { sha, content: oldContentBase64 } = await getFileSHAandContent();
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


// ──────────────── ADMIN: PAT‐based login ────────────────
function savePAT() {
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
 * On admin.html load:
 * 1. If no PAT saved, show the PAT‐input section.
 * 2. Otherwise, show the Add Game form, populate datalist, and bind dynamic inputs.
 */
async function onAdminPageLoad() {
  const token = localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
  if (token) {
    document.getElementById("pat-section").style.display = "none";
    document.getElementById("game-form-container").style.display = "block";

    // 1. Populate autocomplete datalist from existing games.json
    await populatePlayerDatalist();

    // 2. Initialize (and bind) dynamic team/player inputs
    initializeTeamInputs();

    // 3. Update the Winning Team <select> based on current team count
    updateWinningTeamOptions();
  } else {
    document.getElementById("pat-section").style.display = "block";
    document.getElementById("game-form-container").style.display = "none";
  }
}


// ──────────────── AUTOCOMPLETE: Populate <datalist> from existing players ────────────────
async function populatePlayerDatalist() {
  const datalist = document.getElementById("player-names-list");
  datalist.innerHTML = ""; // clear any old options

  let games;
  try {
    games = await fetchGames();
  } catch (err) {
    console.warn("Could not fetch games for autocomplete:", err);
    return;
  }
  const nameSet = new Set();
  games.forEach((game) => {
    game.teams.forEach((team) => {
      team.forEach((player) => {
        nameSet.add(player);
      });
    });
  });

  // Sort alphabetically
  const sortedNames = Array.from(nameSet).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );

  sortedNames.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    datalist.appendChild(option);
  });
}


// ──────────────── DYNAMIC TEAM/PLAYER INPUT LOGIC ────────────────

/**
 * Create a new <input class="player-input" list="player-names-list"> inside playersListDiv,
 * bind its events, and ensure trailing‐empty cleanup logic.
 */
function appendPlayerInput(playersListDiv) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "player-input";
  input.placeholder = "Player name…";
  input.setAttribute("list", "player-names-list");

  // Event: on input → if this is the last non-empty, append a new blank; then clean up trailing empties
  input.addEventListener("input", () => {
    const allInputs = playersListDiv.querySelectorAll(".player-input");
    const lastInput = allInputs[allInputs.length - 1];

    // 1) If this input is last AND non-empty, append a new blank one
    if (input === lastInput && input.value.trim() !== "") {
      appendPlayerInput(playersListDiv);
    }

    // 2) Remove extra trailing empty inputs: while the last two are both empty, remove the last
    cleanUpTrailingEmptyInputs(playersListDiv);
  });

  playersListDiv.appendChild(input);
}

/**
 * After any input event, ensure only one trailing empty input remains.
 * If the last two inputs are both empty, remove the last, repeat until only one empty is left.
 */
function cleanUpTrailingEmptyInputs(playersListDiv) {
  let inputs = playersListDiv.querySelectorAll(".player-input");
  // Convert NodeList → Array for easy manipulation
  inputs = Array.from(inputs);

  // Keep removing the last input if:
  // - There are at least two inputs, AND
  // - Both the last input and the one before it have empty value
  while (
    inputs.length >= 2 &&
    inputs[inputs.length - 1].value.trim() === "" &&
    inputs[inputs.length - 2].value.trim() === ""
  ) {
    const toRemove = inputs.pop();
    playersListDiv.removeChild(toRemove);
    inputs = playersListDiv.querySelectorAll(".player-input");
    inputs = Array.from(inputs);
  }
}

/**
 * When “+ Add Team” is clicked, create a new .team-section (with one blank player-input),
 * give it the correct data-team-index, and update the Winning Team dropdown.
 */
function addNewTeamSection() {
  const teamsContainer = document.getElementById("teams-container");
  const existingTeams = teamsContainer.querySelectorAll(".team-section");
  const newTeamIndex = existingTeams.length;

  // Wrapper <div class="team-section" data-team-index="X">
  const teamDiv = document.createElement("div");
  teamDiv.className = "team-section";
  teamDiv.setAttribute("data-team-index", newTeamIndex);

  // Header: “Team N”
  const header = document.createElement("div");
  header.className = "team-header";
  header.innerText = `Team ${newTeamIndex + 1}`;
  teamDiv.appendChild(header);

  // .players-list container
  const playersListDiv = document.createElement("div");
  playersListDiv.className = "players-list";
  teamDiv.appendChild(playersListDiv);

  // Add the first player input
  appendPlayerInput(playersListDiv);

  // Append new teamDiv
  teamsContainer.appendChild(teamDiv);

  // Refresh Winning Team <select> options
  updateWinningTeamOptions();
}

/**
 * For all existing .team-section elements:
 * 1. If there’s no .player-input at all, create one.
 * 2. Otherwise, ensure each existing .player-input has its “input” event bound.
 */
function initializeTeamInputs() {
  const teamsContainer = document.getElementById("teams-container");
  const teamDivs = teamsContainer.querySelectorAll(".team-section");

  teamDivs.forEach((teamDiv) => {
    const playersListDiv = teamDiv.querySelector(".players-list");
    let inputs = playersListDiv.querySelectorAll(".player-input");

    // If no input exists, add one
    if (inputs.length === 0) {
      appendPlayerInput(playersListDiv);
      inputs = playersListDiv.querySelectorAll(".player-input");
    }

    // Bind “input” event to each existing field if not already bound
    inputs.forEach((input) => {
      if (!input.dataset.bound) {
        input.setAttribute("list", "player-names-list");
        input.addEventListener("input", () => {
          const allInputs = playersListDiv.querySelectorAll(".player-input");
          const lastInput = allInputs[allInputs.length - 1];
          if (input === lastInput && input.value.trim() !== "") {
            appendPlayerInput(playersListDiv);
          }
          cleanUpTrailingEmptyInputs(playersListDiv);
        });
        input.setAttribute("data-bound", "true");
      }
    });

    // After binding, ensure no extra trailing blank inputs
    cleanUpTrailingEmptyInputs(playersListDiv);
  });
}

/**
 * Rebuild the “Winning Team” <select> so its options = “Team 1”, “Team 2”, … up to current count.
 */
function updateWinningTeamOptions() {
  const select = document.getElementById("winningTeam");
  const teamsContainer = document.getElementById("teams-container");
  const teamCount = teamsContainer.querySelectorAll(".team-section").length;

  // Clear out old options
  select.innerHTML = "";

  for (let i = 0; i < teamCount; i++) {
    const opt = document.createElement("option");
    opt.value = i.toString();
    opt.innerText = `Team ${i + 1}`;
    select.appendChild(opt);
  }
}


// ──────────────── LEADERBOARD: Compute stats & render ────────────────

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


// ──────────────── PLAYER PAGE: Extract user & render history ────────────────

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
    document.getElementById("player-games").innerText = `No games found for “${player}”.`;
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

    // Date/Time
    const dtCell = document.createElement("td");
    const dt = new Date(game.timestamp);
    dtCell.innerText = dt.toUTCString().replace(/ GMT$/, "");
    tr.appendChild(dtCell);

    // Game Name
    const gnCell = document.createElement("td");
    gnCell.innerText = game.gameName;
    tr.appendChild(gnCell);

    // Team (you + allies)
    const myTeamIdx = game.teams.findIndex((team) => team.includes(player));
    const myTeam = game.teams[myTeamIdx];
    const teamCell = document.createElement("td");
    teamCell.innerText = myTeam.join(", ");
    tr.appendChild(teamCell);

    // Opponents
    const opponents = game.teams
      .filter((_, idx) => idx !== myTeamIdx)
      .flat();
    const oppCell = document.createElement("td");
    oppCell.innerText = opponents.join(", ");
    tr.appendChild(oppCell);

    // Result
    const resCell = document.createElement("td");
    resCell.innerText = (myTeamIdx === game.winningTeamIndex) ? "W" : "L";
    tr.appendChild(resCell);

    table.appendChild(tr);
  });

  const container = document.getElementById("player-games");
  container.innerHTML = "";
  container.appendChild(table);
}


// ──────────────── ADMIN: Handle “Add Game” submit ────────────────
async function onAddGameFormSubmit(event) {
  event.preventDefault();

  // 1) Read gameName & winningTeamIndex
  const gameName = document.getElementById("gameName").value.trim();
  const winningTeamIndex = parseInt(
    document.getElementById("winningTeam").value,
    10
  );

  if (!gameName) {
    alert("Game name cannot be empty.");
    return;
  }

  // 2) Gather teams: for each .team-section, collect non-empty player names
  const teamsContainer = document.getElementById("teams-container");
  const teamDivs = teamsContainer.querySelectorAll(".team-section");
  const teams = [];

  teamDivs.forEach((teamDiv) => {
    const playerInputs = teamDiv.querySelectorAll(".player-input");
    const names = Array.from(playerInputs)
      .map((inp) => inp.value.trim())
      .filter((n) => n !== "");
    if (names.length > 0) {
      teams.push(names);
    }
  });

  if (teams.length < 2) {
    alert("Please enter at least two teams, each with at least one player.");
    return;
  }
  if (winningTeamIndex < 0 || winningTeamIndex >= teams.length) {
    alert("Invalid winning team index.");
    return;
  }

  // 3) Build and commit the new game object
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
    document.getElementById("add-team-button").onclick  = addNewTeamSection;
    document.getElementById("add-game-form").onsubmit  = onAddGameFormSubmit;
  }
}

document.addEventListener("DOMContentLoaded", initPage);

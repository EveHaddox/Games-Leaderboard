// scripts.js

// ──────────────── CONFIGURATION ────────────────
const GITHUB_USERNAME       = "EveHaddox";
const REPO_NAME             = "Games-Leaderboard";

const RAW_BASE_URL          = `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${REPO_NAME}/main`;
const API_BASE_URL          = `https://api.github.com/repos/${GITHUB_USERNAME}/${REPO_NAME}`;

const GAMES_JSON_PATH       = "games.json";
const LOCAL_STORAGE_TOKEN_KEY = "github_access_token"; // stores the PAT in localStorage


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
 * 1. Toggle between login inputs vs. “Leaderboard/Log Out” buttons.
 * 2. Populate autocomplete datalist.
 * 3. Initialize team inputs (including “Remove Team” on team ≥3).
 * 4. Update the “Winning Team” dropdown.
 */
async function onAdminPageLoad() {
  const token = localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
  if (token) {
    document.getElementById("pat-login").style.display = "none";
    document.getElementById("post-login-buttons").style.display = "flex";
    document.getElementById("game-form-container").style.display = "block";

    await populatePlayerDatalist();
    initializeTeamInputs();
    updateWinningTeamOptions();
  } else {
    document.getElementById("pat-login").style.display = "flex";
    document.getElementById("post-login-buttons").style.display = "none";
    document.getElementById("game-form-container").style.display = "none";
  }
}


// ──────────────── AUTOCOMPLETE: Populate <datalist> from existing players ────────────────
async function populatePlayerDatalist() {
  const datalist = document.getElementById("player-names-list");
  datalist.innerHTML = "";

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
 * bind its events (append new blank + cleanup), and append.
 */
function appendPlayerInput(playersListDiv) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "player-input";
  input.placeholder = "Player name…";
  input.setAttribute("list", "player-names-list");

  input.addEventListener("input", () => {
    const allInputs = playersListDiv.querySelectorAll(".player-input");
    const lastInput = allInputs[allInputs.length - 1];

    if (input === lastInput && input.value.trim() !== "") {
      appendPlayerInput(playersListDiv);
    }
    cleanUpTrailingEmptyInputs(playersListDiv);
  });

  playersListDiv.appendChild(input);
}

/**
 * Remove extra trailing empty inputs: if the last two are both empty, remove the last, repeat.
 */
function cleanUpTrailingEmptyInputs(playersListDiv) {
  let inputs = Array.from(playersListDiv.querySelectorAll(".player-input"));
  while (
    inputs.length >= 2 &&
    inputs[inputs.length - 1].value.trim() === "" &&
    inputs[inputs.length - 2].value.trim() === ""
  ) {
    const toRemove = inputs.pop();
    playersListDiv.removeChild(toRemove);
    inputs = Array.from(playersListDiv.querySelectorAll(".player-input"));
  }
}

/**
 * Add a new team section (with remove button because index ≥ 2) to #teams-container.
 */
function addNewTeamSection() {
  const teamsContainer = document.getElementById("teams-container");
  const existingTeams = teamsContainer.querySelectorAll(".team-section");
  const newTeamIndex = existingTeams.length; // 2 → first removable team

  // Wrapper <div class="team-section" data-team-index="X">
  const teamDiv = document.createElement("div");
  teamDiv.className = "team-section";
  teamDiv.setAttribute("data-team-index", newTeamIndex);

  // Header container (flex): title + remove button
  const headerContainer = document.createElement("div");
  headerContainer.className = "team-header-container";

  const header = document.createElement("div");
  header.className = "team-header";
  header.innerText = `Team ${newTeamIndex + 1}`;
  headerContainer.appendChild(header);

  // Remove‐button only for teams ≥ 2
  const removeBtn = document.createElement("button");
  removeBtn.className = "remove-team-button";
  removeBtn.innerText = "Remove";
  removeBtn.addEventListener("click", () => removeTeamSection(newTeamIndex));
  headerContainer.appendChild(removeBtn);

  teamDiv.appendChild(headerContainer);

  // .players-list container with first input
  const playersListDiv = document.createElement("div");
  playersListDiv.className = "players-list";
  teamDiv.appendChild(playersListDiv);

  appendPlayerInput(playersListDiv);

  teamsContainer.appendChild(teamDiv);
  updateWinningTeamOptions();
}

/**
 * Remove the team section at index `idx`, then re-index all remaining teams,
 * update their headers, and refresh “Winning Team” <select>.
 */
function removeTeamSection(idx) {
  const teamsContainer = document.getElementById("teams-container");
  const teamDivs = Array.from(teamsContainer.querySelectorAll(".team-section"));

  // Prevent removing Team 0 or Team 1
  if (idx < 2) return;

  // 1) Remove the specific team‐div
  const teamToRemove = teamDivs[idx];
  teamsContainer.removeChild(teamToRemove);

  // 2) Re-index all remaining teams
  const updatedTeamDivs = Array.from(teamsContainer.querySelectorAll(".team-section"));
  updatedTeamDivs.forEach((div, newIndex) => {
    div.setAttribute("data-team-index", newIndex);

    // Update header text
    const headerDiv = div.querySelector(".team-header");
    headerDiv.innerText = `Team ${newIndex + 1}`;

    // If this team now qualifies for a remove‐button (i.e. newIndex ≥ 2)
    let removeBtn = div.querySelector(".remove-team-button");
    if (newIndex >= 2) {
      if (!removeBtn) {
        // Create a new remove button if missing
        removeBtn = document.createElement("button");
        removeBtn.className = "remove-team-button";
        removeBtn.innerText = "Remove";
        removeBtn.addEventListener("click", () => removeTeamSection(newIndex));
        div.querySelector(".team-header-container").appendChild(removeBtn);
      } else {
        // Rebind with correct index
        removeBtn.replaceWith(removeBtn.cloneNode(true));
        const newRemove = div.querySelector(".remove-team-button");
        newRemove.addEventListener("click", () => removeTeamSection(newIndex));
      }
    } else {
      // newIndex < 2 → remove any existing remove‐button
      if (removeBtn) removeBtn.remove();
    }
  });

  // 3) Refresh the Winning Team dropdown
  updateWinningTeamOptions();
}

/**
 * Initialize team inputs for the first two teams, plus bind any dynamically added teams.
 */
function initializeTeamInputs() {
  const teamsContainer = document.getElementById("teams-container");
  const teamDivs = teamsContainer.querySelectorAll(".team-section");

  teamDivs.forEach((teamDiv, index) => {
    const playersListDiv = teamDiv.querySelector(".players-list");
    let inputs = playersListDiv.querySelectorAll(".player-input");

    // If no input exists, add one
    if (inputs.length === 0) {
      appendPlayerInput(playersListDiv);
      inputs = playersListDiv.querySelectorAll(".player-input");
    }

    // Bind “input” event on existing inputs if not yet bound
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
        input.dataset.bound = "true";
      }
    });

    // If index ≥ 2 and remove‐button doesn’t exist, create it
    if (index >= 2 && !teamDiv.querySelector(".remove-team-button")) {
      const headerContainer = teamDiv.querySelector(".team-header-container");
      const removeBtn = document.createElement("button");
      removeBtn.className = "remove-team-button";
      removeBtn.innerText = "Remove";
      removeBtn.addEventListener("click", () => removeTeamSection(index));
      headerContainer.appendChild(removeBtn);
    }

    cleanUpTrailingEmptyInputs(playersListDiv);
  });
}

/**
 * Rebuild the “Winning Team” <select> so it matches the current number of teams.
 */
function updateWinningTeamOptions() {
  const select = document.getElementById("winningTeam");
  const teamsContainer = document.getElementById("teams-container");
  const teamCount = teamsContainer.querySelectorAll(".team-section").length;

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

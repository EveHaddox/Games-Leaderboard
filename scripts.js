// scripts.js

// ──────────────── CONFIGURATION ────────────────
const GITHUB_USERNAME         = "EveHaddox";
const REPO_NAME               = "Games-Leaderboard";

const RAW_BASE_URL            = `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${REPO_NAME}/main`;
const API_BASE_URL            = `https://api.github.com/repos/${GITHUB_USERNAME}/${REPO_NAME}`;

const GAMES_JSON_PATH         = "games.json";
const GAME_OPTIONS_PATH       = "gameOptions.json";
const LOCAL_STORAGE_TOKEN_KEY = "github_access_token"; // stores the PAT in localStorage


// ──────────────── GENERIC JSON FETCH ────────────────
async function fetchJSON(path) {
  const url = `${RAW_BASE_URL}/${path}?cachebust=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${path}`);
  return await res.json();
}

// ──────────────── GENERIC GET FILE SHA & CONTENT ────────────────
async function getFileSHAandContent(path) {
  const endpoint = `${API_BASE_URL}/contents/${path}`;
  const accessToken = localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
  const headers = { Accept: "application/vnd.github.v3+json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(endpoint, { headers });
  if (res.status === 404) {
    return { sha: null, content: btoa("[]") };
  }
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`GitHub API error (${path}): ${msg}`);
  }
  const data = await res.json();
  return { sha: data.sha, content: data.content };
}

// ──────────────── GENERIC COMMIT JSON BACK TO GITHUB ────────────────
async function commitJSON(newArray, path, commitMessage) {
  const accessToken = localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
  if (!accessToken) throw new Error(`No GitHub token found. Please paste a valid PAT first.`);

  const { sha, content: oldContentBase64 } = await getFileSHAandContent(path);
  const newContentString = JSON.stringify(newArray, null, 2);
  const newContentBase64 = btoa(unescape(encodeURIComponent(newContentString)));

  const endpoint = `${API_BASE_URL}/contents/${path}`;
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
    throw new Error(`GitHub commit failed (${path}): ${errText}`);
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
  window.location.href = "index.html";
}

/**
 * On admin.html load:
 * 1. Toggle between login inputs vs. Admin header buttons.
 * 2. Populate game‐dropdown (inside a try/catch so errors don’t break other pages).
 * 3. Populate player autocomplete.
 * 4. Initialize team inputs.
 * 5. Update “Winning Team” dropdown.
 */
async function onAdminPageLoad() {
  const token = localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
  if (token) {
    document.getElementById("pat-login").style.display = "none";
    document.getElementById("post-login-buttons").style.display = "flex";
    document.getElementById("game-form-container").style.display = "block";

    // 1) Populate game dropdown, but catch errors so index/player pages aren’t affected
    try {
      await populateGameDropdown();
    } catch (err) {
      console.warn("Could not populate game dropdown:", err);
      const select = document.getElementById("gameName");
      if (select) {
        select.innerHTML = `<option value="" disabled selected>(no games)</option>`;
      }
    }

    // 2) Populate the player‐name datalist
    try {
      await populatePlayerDatalist();
    } catch (err) {
      console.warn("Could not populate player datalist:", err);
    }

    // 3) Initialize dynamic team/player inputs and winning‐team dropdown
    initializeTeamInputs();
    updateWinningTeamOptions();
  } else {
    document.getElementById("pat-login").style.display = "flex";
    document.getElementById("post-login-buttons").style.display = "none";
    document.getElementById("game-form-container").style.display = "none";
  }
}


// ──────────────── POPULATE GAME DROPDOWN ────────────────
async function populateGameDropdown() {
  const select = document.getElementById("gameName");
  if (!select) return; // If we’re not on admin.html, skip

  select.innerHTML = "";  // Clear out any old options

  let options;
  try {
    options = await fetchJSON(GAME_OPTIONS_PATH);
  } catch (err) {
    // If fetch fails (e.g. file missing), show placeholder
    select.innerHTML = `<option value="" disabled selected>(no games defined)</option>`;
    return;
  }

  // If the JSON is empty or not an array, also show placeholder
  if (!Array.isArray(options) || options.length === 0) {
    select.innerHTML = `<option value="" disabled selected>(no games defined)</option>`;
    return;
  }

  // Otherwise, build a real <select> list
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.innerText = "-- Select Game --";
  placeholder.disabled = true;
  placeholder.selected = true;
  select.appendChild(placeholder);

  options.forEach((gameName) => {
    const opt = document.createElement("option");
    opt.value = gameName;
    opt.innerText = gameName;
    select.appendChild(opt);
  });
}



// ──────────────── POPULATE PLAYER DATALIST ────────────────
async function populatePlayerDatalist() {
  const datalist = document.getElementById("player-names-list");
  if (!datalist) return;

  datalist.innerHTML = "";
  const games = await fetchJSON(GAMES_JSON_PATH);
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

function addNewTeamSection() {
  const teamsContainer = document.getElementById("teams-container");
  const existingTeams = teamsContainer.querySelectorAll(".team-section");
  const newTeamIndex = existingTeams.length;

  const teamDiv = document.createElement("div");
  teamDiv.className = "team-section";
  teamDiv.setAttribute("data-team-index", newTeamIndex);

  const headerContainer = document.createElement("div");
  headerContainer.className = "team-header-container";

  const header = document.createElement("div");
  header.className = "team-header";
  header.innerText = `Team ${newTeamIndex + 1}`;
  headerContainer.appendChild(header);

  const removeBtn = document.createElement("button");
  removeBtn.className = "remove-team-button";
  removeBtn.innerText = "Remove";
  removeBtn.addEventListener("click", () => removeTeamSection(newTeamIndex));
  headerContainer.appendChild(removeBtn);

  teamDiv.appendChild(headerContainer);

  const playersListDiv = document.createElement("div");
  playersListDiv.className = "players-list";
  teamDiv.appendChild(playersListDiv);

  appendPlayerInput(playersListDiv);

  teamsContainer.appendChild(teamDiv);
  updateWinningTeamOptions();
}

function removeTeamSection(idx) {
  const teamsContainer = document.getElementById("teams-container");
  let teamDivs = Array.from(teamsContainer.querySelectorAll(".team-section"));

  if (idx < 2) return;

  const teamToRemove = teamDivs[idx];
  teamsContainer.removeChild(teamToRemove);

  teamDivs = Array.from(teamsContainer.querySelectorAll(".team-section"));
  teamDivs.forEach((div, newIndex) => {
    div.setAttribute("data-team-index", newIndex);
    const headerDiv = div.querySelector(".team-header");
    headerDiv.innerText = `Team ${newIndex + 1}`;

    let removeBtn = div.querySelector(".remove-team-button");
    if (newIndex >= 2) {
      if (!removeBtn) {
        removeBtn = document.createElement("button");
        removeBtn.className = "remove-team-button";
        removeBtn.innerText = "Remove";
        removeBtn.addEventListener("click", () => removeTeamSection(newIndex));
        div.querySelector(".team-header-container").appendChild(removeBtn);
      } else {
        const newRemove = removeBtn.cloneNode(true);
        newRemove.addEventListener("click", () => removeTeamSection(newIndex));
        removeBtn.replaceWith(newRemove);
      }
    } else {
      if (removeBtn) removeBtn.remove();
    }
  });

  updateWinningTeamOptions();
}

function initializeTeamInputs() {
  const teamsContainer = document.getElementById("teams-container");
  const teamDivs = teamsContainer.querySelectorAll(".team-section");

  teamDivs.forEach((teamDiv, index) => {
    const playersListDiv = teamDiv.querySelector(".players-list");
    let inputs = playersListDiv.querySelectorAll(".player-input");

    if (inputs.length === 0) {
      appendPlayerInput(playersListDiv);
      inputs = playersListDiv.querySelectorAll(".player-input");
    }

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


// ──────────────── ADD GAME: Handle form submit ────────────────
async function onAddGameFormSubmit(event) {
  event.preventDefault();

  const gameName = document.getElementById("gameName").value;
  const winningTeamIndex = parseInt(document.getElementById("winningTeam").value, 10);

  if (!gameName) {
    alert("Please select a game.");
    return;
  }

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

  const newGame = {
    timestamp: new Date().toISOString(),
    gameName,
    teams,
    winningTeamIndex
  };

  try {
    const { sha, content: oldBase64 } = await getFileSHAandContent(GAMES_JSON_PATH);
    const oldArray = JSON.parse(atob(oldBase64));

    const newArray = oldArray.concat(newGame);
    const commitMsg = `Add game: ${gameName} (winner: Team ${winningTeamIndex + 1})`;
    await commitJSON(newArray, GAMES_JSON_PATH, commitMsg);

    alert("Game added successfully!");
    window.location.reload();
  } catch (err) {
    console.error(err);
    alert("Error adding game: " + err.message);
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
    games = await fetchJSON(GAMES_JSON_PATH);
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
    games = await fetchJSON(GAMES_JSON_PATH);
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


// ──────────────── ON-LOAD BINDINGS ────────────────
function initPage() {
  const pageId = document.body.dataset.page;
  if (pageId === "index") {
    renderLeaderboard();
  } else if (pageId === "player") {
    renderPlayerPage();
  } else if (pageId === "admin") {
    onAdminPageLoad();
    document.getElementById("save-pat-button").onclick   = savePAT;
    document.getElementById("logout-button").onclick     = logout;
    document.getElementById("add-team-button").onclick   = addNewTeamSection;
    document.getElementById("add-game-form").onsubmit    = onAddGameFormSubmit;
  }
}

document.addEventListener("DOMContentLoaded", initPage);

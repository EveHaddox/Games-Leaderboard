// scripts.js

// ──────────────── CONFIGURATION ────────────────
const GITHUB_USERNAME         = "EveHaddox";
const REPO_NAME               = "Games-Leaderboard";

const RAW_BASE_URL            = `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${REPO_NAME}/main`;
const API_BASE_URL            = `https://api.github.com/repos/${GITHUB_USERNAME}/${REPO_NAME}`;

const GAMES_JSON_PATH         = "games.json";
const GAME_OPTIONS_PATH       = "gameOptions.json";
const SEASONS_PATH            = "seasons.json";
const LOCAL_STORAGE_TOKEN_KEY = "github_access_token";


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
    // If seasons.json doesn’t exist yet, return an empty structure
    if (path === SEASONS_PATH) {
      return {
        sha: null,
        content: btoa(JSON.stringify({ current: "", all: [] })),
      };
    }
    // If gameOptions.json or games.json missing, treat as empty array
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
async function commitJSON(newArrayOrObj, path, commitMessage) {
  const accessToken = localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
  if (!accessToken)
    throw new Error(`No GitHub token found. Please paste a valid PAT first.`);

  const { sha, content: oldContentBase64 } = await getFileSHAandContent(path);
  const newContentString = JSON.stringify(newArrayOrObj, null, 2);
  const newContentBase64 = btoa(unescape(encodeURIComponent(newContentString)));

  const endpoint = `${API_BASE_URL}/contents/${path}`;
  const body = {
    message: commitMessage,
    content: newContentBase64,
    ...(sha ? { sha } : {}),
    branch: "main",
  };

  const res = await fetch(endpoint, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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


// ──────────────── ON-LOAD BINDINGS ────────────────
function initPage() {
  const pageId = document.body.dataset.page;
  if (pageId === "index") {
    initLeaderboardPage();
  } else if (pageId === "player") {
    renderPlayerPage();
  } else if (pageId === "admin") {
    onAdminPageLoad();
    document.getElementById("save-pat-button").onclick = savePAT;
    document.getElementById("logout-button").onclick = logout;
    document.getElementById("add-team-button").onclick = addNewTeamSection;
    document.getElementById("add-game-form").onsubmit = onAddGameFormSubmit;
  }
}
document.addEventListener("DOMContentLoaded", initPage);


// ──────────────── ADMIN PAGE: Populate current season & dropdowns ────────────────
async function onAdminPageLoad() {
  const token = localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
  if (token) {
    document.getElementById("pat-login").style.display = "none";
    document.getElementById("post-login-buttons").style.display = "flex";
    document.getElementById("game-form-container").style.display = "block";

    // 1) Fetch seasons.json to get “current” and list of all seasons
    let seasonsData;
    try {
      seasonsData = await fetchJSON(SEASONS_PATH);
    } catch (err) {
      console.warn("Could not fetch seasons.json:", err);
      seasonsData = { current: "", all: [] };
    }
    const { current, all } = seasonsData;

    // 2) Populate the read-only current season display & hidden input
    const displayDiv = document.getElementById("current-season-display");
    const hiddenInput = document.getElementById("season");
    if (displayDiv) displayDiv.innerText = current || "(no season defined)";
    if (hiddenInput) hiddenInput.value = current;

    // 3) Populate game dropdown
    try {
      await populateGameDropdown();
    } catch (err) {
      console.warn("Could not populate game dropdown:", err);
      const select = document.getElementById("gameName");
      if (select) {
        select.innerHTML = `<option value="" disabled selected>(no games)</option>`;
      }
    }

    // 4) Populate player datalist
    try {
      await populatePlayerDatalist();
    } catch (err) {
      console.warn("Could not populate player datalist:", err);
    }

    // 5) Initialize dynamic team inputs
    initializeTeamInputs();
    updateWinningTeamOptions();
  } else {
    document.getElementById("pat-login").style.display = "flex";
    document.getElementById("post-login-buttons").style.display = "none";
    document.getElementById("game-form-container").style.display = "none";
  }
}


// ──────────────── POPULATE GAME DROPDOWN (Admin) ────────────────
async function populateGameDropdown() {
  const select = document.getElementById("gameName");
  if (!select) return;

  select.innerHTML = "";
  const options = await fetchJSON(GAME_OPTIONS_PATH);

  if (!options || options.length === 0) {
    select.innerHTML = `<option value="" disabled selected>(no games defined)</option>`;
    return;
  }

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


// ──────────────── POPULATE PLAYER DATALIST (Admin) ────────────────
async function populatePlayerDatalist() {
  const datalist = document.getElementById("player-names-list");
  if (!datalist) return;

  datalist.innerHTML = "";
  const games = await fetchJSON(GAMES_JSON_PATH);
  const nameSet = new Set();
  games.forEach((game) => {
    game.teams.forEach((team) => {
      team.forEach((player) => nameSet.add(player));
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


// ──────────────── DYNAMIC TEAM/PLAYER INPUT LOGIC (Admin) ────────────────
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
  if (!select) return;
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


// ──────────────── ADD GAME: Handle form submit (Admin) ────────────────
async function onAddGameFormSubmit(event) {
  event.preventDefault();

  // Season is a hidden field, already set to “current”
  const season = document.getElementById("season").value;
  const gameName = document.getElementById("gameName").value;
  const winningTeamIndex = parseInt(
    document.getElementById("winningTeam").value,
    10
  );

  if (!season) {
    alert("No current season defined.");
    return;
  }
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

  // Build and commit the new game object (always uses the current season)
  const newGame = {
    timestamp: new Date().toISOString(),
    season,
    gameName,
    teams,
    winningTeamIndex,
  };

  try {
    const { sha, content: oldBase64 } = await getFileSHAandContent(GAMES_JSON_PATH);
    const oldArray = JSON.parse(atob(oldBase64));

    const newArray = oldArray.concat(newGame);
    const commitMsg = `Add game: ${gameName}, season: ${season}, winner: Team ${
      winningTeamIndex + 1
    }`;
    await commitJSON(newArray, GAMES_JSON_PATH, commitMsg);

    alert("Game added successfully!");
    window.location.reload();
  } catch (err) {
    console.error(err);
    alert("Error adding game: " + err.message);
  }
}


// ──────────────── LEADERBOARD PAGE SETUP ────────────────
async function initLeaderboardPage() {
  // 1) Populate season filter dropdown with all seasons (current pre-selected)
  try {
    await populateSeasonFilter();
  } catch (err) {
    console.warn("Could not populate season filter:", err);
    const seasonSelect = document.getElementById("season-filter");
    if (seasonSelect) {
      seasonSelect.innerHTML = `<option value="" disabled selected>(no seasons)</option>`;
    }
  }

  // 2) Populate game filter dropdown (All Games + each game name)
  try {
    await populateGameFilter();
  } catch (err) {
    console.warn("Could not populate game filter:", err);
    const gameSelect = document.getElementById("game-filter");
    if (gameSelect) {
      gameSelect.innerHTML = `<option value="__all__" selected>All Games</option>`;
    }
  }

  // 3) When either filter changes, re-render
  const seasonSelect = document.getElementById("season-filter");
  if (seasonSelect) {
    seasonSelect.addEventListener("change", () => {
      const gameVal = document.getElementById("game-filter").value;
      renderLeaderboard(seasonSelect.value, gameVal);
    });
  }

  const gameSelect = document.getElementById("game-filter");
  if (gameSelect) {
    gameSelect.addEventListener("change", () => {
      const seasonVal = document.getElementById("season-filter").value;
      renderLeaderboard(seasonVal, gameSelect.value);
    });
  }

  // 4) Initial render: season = current season, game = "__all__"
  const initialSeason = document.getElementById("season-filter")?.value || "";
  renderLeaderboard(initialSeason, "__all__");
}

/**
 * Populate <select id="season-filter"> with all seasons, marking current.
 */
async function populateSeasonFilter() {
  const select = document.getElementById("season-filter");
  if (!select) return;

  const data = await fetchJSON(SEASONS_PATH);
  const { current, all } = data;
  select.innerHTML = "";

  all.forEach((seasonName) => {
    const opt = document.createElement("option");
    opt.value = seasonName;
    opt.innerText = seasonName;
    if (seasonName === current) opt.selected = true;
    select.appendChild(opt);
  });
}

/**
 * Populate <select id="game-filter"> with "All Games" + each game.
 */
async function populateGameFilter() {
  const select = document.getElementById("game-filter");
  if (!select) return;

  const options = await fetchJSON(GAME_OPTIONS_PATH);
  select.innerHTML = `<option value="__all__" selected>All Games</option>`;

  options.forEach((gameName) => {
    const opt = document.createElement("option");
    opt.value = gameName;
    opt.innerText = gameName;
    select.appendChild(opt);
  });
}


// ──────────────── LEADERBOARD: Compute stats & render with filters ────────────────
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

/**
 * Render the leaderboard table, filtered by season & gameName.
 * @param {string} seasonFilter - a specific season name.
 * @param {string} gameFilter - "__all__" or a specific gameName.
 */
async function renderLeaderboard(seasonFilter, gameFilter) {
  let allGames;
  try {
    allGames = await fetchJSON(GAMES_JSON_PATH);
  } catch (err) {
    document.getElementById("leaderboard").innerText = "Error loading data: " + err;
    return;
  }

  // 1) Filter by season
  let filteredGames = allGames.filter((g) => g.season === seasonFilter);

  // 2) Filter by game if requested
  if (gameFilter && gameFilter !== "__all__") {
    filteredGames = filteredGames.filter((g) => g.gameName === gameFilter);
  }

  // 3) Compute stats on filteredGames
  const statsMap = computePlayerStats(filteredGames);

  // 4) Convert to array and sort by wins desc, then played desc
  const rows = Array.from(statsMap.entries())
    .map(([player, s]) => ({ player, ...s }))
    .sort((a, b) => b.wins - a.wins || b.played - a.played);

  // 5) Build HTML table
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

  let allGames;
  try {
    allGames = await fetchJSON(GAMES_JSON_PATH);
  } catch (err) {
    document.getElementById("player-games").innerText = "Error loading data: " + err;
    return;
  }

  const filtered = allGames.filter((game) =>
    game.teams.some((team) => team.includes(player))
  );

  if (filtered.length === 0) {
    document.getElementById("player-games").innerText = `No games found for “${player}”.`;
    return;
  }

  const table = document.createElement("table");
  const headerRow = document.createElement("tr");
  ["Date/Time", "Season", "Game Name", "Team (You + Allies)", "Opponents", "Result"].forEach(
    (h) => {
      const th = document.createElement("th");
      th.innerText = h;
      headerRow.appendChild(th);
    }
  );
  table.appendChild(headerRow);

  filtered.forEach((game) => {
    const tr = document.createElement("tr");

    // Date/Time
    const dtCell = document.createElement("td");
    const dt = new Date(game.timestamp);
    dtCell.innerText = dt.toUTCString().replace(/ GMT$/, "");
    tr.appendChild(dtCell);

    // Season
    const sCell = document.createElement("td");
    sCell.innerText = game.season || "";
    tr.appendChild(sCell);

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
    resCell.innerText = myTeamIdx === game.winningTeamIndex ? "W" : "L";
    tr.appendChild(resCell);

    table.appendChild(tr);
  });

  const container = document.getElementById("player-games");
  container.innerHTML = "";
  container.appendChild(table);
}

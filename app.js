const DEFAULT_SETTINGS = {
  bronzeWeight: 15,
  silverWeight: 30,
  goldWeight: 90,
  platinumWeight: 300,
  platinumBonus: 300,
  difficultyPenalty: 1
};

const LOCAL_GAMES_KEY = "trophyRoiGamesSupabaseV2";
const LOCAL_SETTINGS_KEY = "trophyRoiSettingsSupabaseV2";

let settings = JSON.parse(localStorage.getItem(LOCAL_SETTINGS_KEY)) || { ...DEFAULT_SETTINGS };
let games = JSON.parse(localStorage.getItem(LOCAL_GAMES_KEY)) || [];
let supabaseClient = null;
let currentUser = null;
let currentProfile = null;
let editingId = null;

window.addEventListener("DOMContentLoaded", init);

async function init() {
  initializeSupabase();
  hydrateSettingsForm();
  render();

  if (!supabaseClient) {
    document.getElementById("setupWarning").hidden = false;
    setCloudStatus("Local mode", "offline");
    return;
  }

  const { data } = await supabaseClient.auth.getSession();
  currentUser = data.session?.user || null;

  if (!currentUser) {
    window.location.href = "login.html";
    return;
  }

  await loadProfile();
  await refreshAuthUI();

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;
    if (!currentUser) {
      window.location.href = "login.html";
      return;
    }
    await loadProfile();
    await refreshAuthUI();
    await syncFromCloud();
  });

  await syncFromCloud();
}

function initializeSupabase() {
  const url = window.TROPHY_ROI_SUPABASE_URL;
  const key = window.TROPHY_ROI_SUPABASE_ANON_KEY;
  const missing = !url || !key || url.includes("PASTE_") || key.includes("PASTE_");
  if (missing || !window.supabase) { supabaseClient = null; return; }
  supabaseClient = window.supabase.createClient(url, key);
}

async function refreshAuthUI() {
  const username = currentProfile?.username || currentUser?.user_metadata?.username || "Trophy Hunter";
  document.getElementById("displayName").textContent = username;
  document.getElementById("avatarInitial").textContent = username.slice(0, 1).toUpperCase();
  document.getElementById("userEmail").textContent = currentUser?.email || "";
  document.getElementById("username").value = currentProfile?.username || "";
  setCloudStatus("Cloud sync on", "online");
}

function setCloudStatus(text, mode) {
  const el = document.getElementById("cloudStatus");
  const stat = document.getElementById("statusText");
  if (el) { el.textContent = text; el.className = `status-pill ${mode || ""}`; }
  if (stat) stat.textContent = text;
}

async function loadProfile() {
  if (!supabaseClient || !currentUser) return;

  const { data, error } = await supabaseClient.from("profiles").select("*").eq("id", currentUser.id).maybeSingle();
  if (error) { toast(error.message); currentProfile = null; return; }

  if (data) { currentProfile = data; return; }

  const username = cleanUsername(currentUser.user_metadata?.username || "");
  const { data: inserted, error: insertError } = await supabaseClient
    .from("profiles")
    .insert({ id: currentUser.id, username: username || null })
    .select()
    .single();
  if (insertError) { toast(insertError.message); currentProfile = null; return; }
  currentProfile = inserted;
}

async function saveUsername() {
  if (!supabaseClient || !currentUser) return toast("Sign in first.");
  const username = cleanUsername(raw("username"));
  if (!isValidUsername(username)) return toast("Username must be 3–24 characters and can use letters, numbers, underscores, hyphens, and periods.");

  const { data, error } = await supabaseClient
    .from("profiles")
    .upsert({ id: currentUser.id, username }, { onConflict: "id" })
    .select()
    .single();

  if (error) return toast(error.message.includes("duplicate") ? "That username is already taken." : error.message);
  currentProfile = data;
  await refreshAuthUI();
  toast("Username saved.");
}

async function signOut() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  currentUser = null;
  window.location.href = "login.html";
}

function dbGameToLocal(row) {
  return {
    id: row.id,
    title: row.title,
    difficulty: Number(row.difficulty),
    hours: Number(row.hours),
    bronzeTotal: row.bronze_total,
    silverTotal: row.silver_total,
    goldTotal: row.gold_total,
    platinumTotal: row.platinum_total,
    bronzeEarned: row.bronze_earned,
    silverEarned: row.silver_earned,
    goldEarned: row.gold_earned,
    platinumEarned: row.platinum_earned,
    bronzeCompletable: row.bronze_completable,
    silverCompletable: row.silver_completable,
    goldCompletable: row.gold_completable,
    platinumCompletable: row.platinum_completable,
    notes: row.notes || ""
  };
}

function localGameToDb(game) {
  return {
    user_id: currentUser.id,
    title: game.title,
    difficulty: game.difficulty,
    hours: game.hours,
    bronze_total: game.bronzeTotal,
    silver_total: game.silverTotal,
    gold_total: game.goldTotal,
    platinum_total: game.platinumTotal,
    bronze_earned: game.bronzeEarned,
    silver_earned: game.silverEarned,
    gold_earned: game.goldEarned,
    platinum_earned: game.platinumEarned,
    bronze_completable: game.bronzeCompletable,
    silver_completable: game.silverCompletable,
    gold_completable: game.goldCompletable,
    platinum_completable: game.platinumCompletable,
    notes: game.notes || ""
  };
}

function dbSettingsToLocal(row) {
  return {
    bronzeWeight: Number(row.bronze_weight),
    silverWeight: Number(row.silver_weight),
    goldWeight: Number(row.gold_weight),
    platinumWeight: Number(row.platinum_weight),
    platinumBonus: Number(row.platinum_bonus),
    difficultyPenalty: Number(row.difficulty_penalty)
  };
}

function localSettingsToDb() {
  return {
    user_id: currentUser.id,
    bronze_weight: settings.bronzeWeight,
    silver_weight: settings.silverWeight,
    gold_weight: settings.goldWeight,
    platinum_weight: settings.platinumWeight,
    platinum_bonus: settings.platinumBonus,
    difficulty_penalty: settings.difficultyPenalty
  };
}

async function syncFromCloud() {
  if (!supabaseClient || !currentUser) return;
  const { data: settingsRows, error: settingsError } = await supabaseClient.from("roi_settings").select("*").eq("user_id", currentUser.id).limit(1);
  if (settingsError) return toast(settingsError.message);
  if (settingsRows && settingsRows.length > 0) { settings = dbSettingsToLocal(settingsRows[0]); saveLocalSettings(); }
  else { await saveSettingsToCloud(); }

  const { data: gameRows, error: gamesError } = await supabaseClient.from("games").select("*").eq("user_id", currentUser.id).order("created_at", { ascending: true });
  if (gamesError) return toast(gamesError.message);
  games = (gameRows || []).map(dbGameToLocal);
  saveLocalGames(); hydrateSettingsForm(); render(); toast("Synced from Supabase.");
}

async function syncLocalToCloud() {
  if (!supabaseClient || !currentUser) return toast("Sign in first.");
  await saveSettingsToCloud();
  for (const game of games) {
    const payload = localGameToDb(game);
    if (isUuid(game.id)) payload.id = game.id;
    const { error } = await supabaseClient.from("games").upsert(payload, { onConflict: "id" });
    if (error) return toast(error.message);
  }
  await syncFromCloud(); toast("Local data uploaded to Supabase.");
}

async function saveSettingsToCloud() {
  if (!supabaseClient || !currentUser) return;
  const { error } = await supabaseClient.from("roi_settings").upsert(localSettingsToDb(), { onConflict: "user_id" });
  if (error) toast(error.message);
}

async function saveGameToCloud(game) {
  if (!supabaseClient || !currentUser) return null;
  const payload = localGameToDb(game);
  if (isUuid(game.id)) payload.id = game.id;
  const { data, error } = await supabaseClient.from("games").upsert(payload, { onConflict: "id" }).select().single();
  if (error) { toast(error.message); return null; }
  return dbGameToLocal(data);
}

async function deleteGameFromCloud(id) {
  if (!supabaseClient || !currentUser || !isUuid(id)) return;
  const { error } = await supabaseClient.from("games").delete().eq("id", id).eq("user_id", currentUser.id);
  if (error) toast(error.message);
}

function val(id) { return Number(document.getElementById(id).value) || 0; }
function raw(id) { return document.getElementById(id).value; }
function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value)); }
function cleanUsername(username) { return String(username || "").trim(); }
function isValidUsername(username) { return /^[A-Za-z0-9_.-]{3,24}$/.test(username); }

function weightedPoints(bronze, silver, gold, platinum) {
  return (bronze * settings.bronzeWeight) + (silver * settings.silverWeight) + (gold * settings.goldWeight) + (platinum * settings.platinumWeight);
}

async function saveSettings() {
  settings = { bronzeWeight: val("bronzeWeight"), silverWeight: val("silverWeight"), goldWeight: val("goldWeight"), platinumWeight: val("platinumWeight"), platinumBonus: val("platinumBonus"), difficultyPenalty: Number(raw("difficultyPenalty")) || 1 };
  saveLocalSettings(); await saveSettingsToCloud(); render(); toast("Weights saved.");
}
function saveLocalSettings() { localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(settings)); }
function saveLocalGames() { localStorage.setItem(LOCAL_GAMES_KEY, JSON.stringify(games)); }
async function resetWeights() { settings = { ...DEFAULT_SETTINGS }; saveLocalSettings(); hydrateSettingsForm(); await saveSettingsToCloud(); render(); toast("Weights reset."); }

async function addGame() {
  const game = readGameForm();
  const errors = validateGame(game);
  if (errors.length > 0) return toast(errors.join("\n"));
  fillDefaultCompletable(game);
  if (editingId) {
    game.id = editingId;
    const saved = await saveGameToCloud(game);
    games = games.map(g => String(g.id) === String(editingId) ? (saved || game) : g);
    editingId = null;
    document.getElementById("addGameButton").textContent = "Add Game";
    document.getElementById("formTitle").textContent = "Add Game";
    toast("Game updated.");
  } else {
    game.id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    const saved = await saveGameToCloud(game);
    games.push(saved || game);
    toast(currentUser ? "Game saved to Supabase." : "Game saved locally.");
  }
  saveLocalGames(); clearForm(); render();
}

function readGameForm() {
  return { id: null, title: raw("title").trim(), difficulty: val("difficulty"), hours: Number(raw("hours")) || 0, bronzeTotal: val("bronzeTotal"), silverTotal: val("silverTotal"), goldTotal: val("goldTotal"), platinumTotal: val("platinumTotal"), bronzeEarned: val("bronzeEarned"), silverEarned: val("silverEarned"), goldEarned: val("goldEarned"), platinumEarned: val("platinumEarned"), bronzeCompletable: raw("bronzeCompletable") === "" ? null : val("bronzeCompletable"), silverCompletable: raw("silverCompletable") === "" ? null : val("silverCompletable"), goldCompletable: raw("goldCompletable") === "" ? null : val("goldCompletable"), platinumCompletable: raw("platinumCompletable") === "yes", notes: raw("notes").trim() };
}

function validateGame(game) {
  const errors = [];
  if (!game.title) errors.push("Please enter a game title.");
  if (!game.difficulty || game.difficulty < 1 || game.difficulty > 10) errors.push("Difficulty must be between 1 and 10.");
  if (!game.hours || game.hours <= 0) errors.push("Estimated hours must be greater than 0.");
  if ((game.bronzeTotal + game.silverTotal + game.goldTotal + game.platinumTotal) <= 0) errors.push("Please enter at least one total trophy.");
  ["bronze", "silver", "gold", "platinum"].forEach(type => {
    const total = game[type + "Total"]; const earned = game[type + "Earned"]; const completable = game[type + "Completable"];
    if (earned > total) errors.push(`${type} earned cannot be greater than ${type} total.`);
    const remaining = total - earned;
    if (completable !== null && completable !== undefined && completable > remaining) errors.push(`${type} completable cannot be greater than ${type} remaining.`);
  });
  if (game.platinumTotal > 1 || game.platinumEarned > 1) errors.push("Platinum total and platinum earned should usually be 0 or 1.");
  return errors;
}

function fillDefaultCompletable(game) {
  ["bronze", "silver", "gold"].forEach(type => { if (game[type + "Completable"] === null || game[type + "Completable"] === undefined) game[type + "Completable"] = Math.max(game[type + "Total"] - game[type + "Earned"], 0); });
  const platinumRemaining = Math.max(game.platinumTotal - game.platinumEarned, 0);
  game.platinumCompletableCount = game.platinumCompletable ? platinumRemaining : 0;
}

function calculateGame(game) {
  fillDefaultCompletable(game);
  const totalPoints = weightedPoints(game.bronzeTotal, game.silverTotal, game.goldTotal, game.platinumTotal);
  const earnedPoints = weightedPoints(game.bronzeEarned, game.silverEarned, game.goldEarned, game.platinumEarned);
  const bronzeRemaining = Math.max(game.bronzeTotal - game.bronzeEarned, 0);
  const silverRemaining = Math.max(game.silverTotal - game.silverEarned, 0);
  const goldRemaining = Math.max(game.goldTotal - game.goldEarned, 0);
  const platinumRemaining = Math.max(game.platinumTotal - game.platinumEarned, 0);
  const bronzeCompletable = Math.min(game.bronzeCompletable, bronzeRemaining);
  const silverCompletable = Math.min(game.silverCompletable, silverRemaining);
  const goldCompletable = Math.min(game.goldCompletable, goldRemaining);
  const platinumCompletable = game.platinumCompletable ? platinumRemaining : 0;
  const remainingPoints = weightedPoints(bronzeRemaining, silverRemaining, goldRemaining, platinumRemaining);
  const completablePoints = weightedPoints(bronzeCompletable, silverCompletable, goldCompletable, platinumCompletable);
  const blockedPoints = remainingPoints - completablePoints;
  const pointsPerHour = game.hours ? completablePoints / game.hours : 0;
  const platinumBonus = platinumCompletable > 0 ? settings.platinumBonus : 0;
  const difficultyFactor = Math.pow(game.difficulty, settings.difficultyPenalty || 1);
  const overallScore = game.hours ? (completablePoints + platinumBonus) / (game.hours * difficultyFactor) : 0;
  return { totalPoints, earnedPoints, remainingPoints, completablePoints, blockedPoints, pointsPerHour, platinumCompletable, overallScore, bronzeCompletable, silverCompletable, goldCompletable };
}

function hydrateSettingsForm() { ["bronzeWeight","silverWeight","goldWeight","platinumWeight","platinumBonus","difficultyPenalty"].forEach(id => document.getElementById(id).value = settings[id]); }

function render() {
  hydrateSettingsForm();
  const sortBy = document.getElementById("sortBy").value;
  const rankedGames = getRankedGames(sortBy);
  const best = getRankedGames("overallScore")[0];
  const bestCalc = best ? calculateGame(best) : null;
  document.getElementById("bestGame").textContent = best ? best.title : "None";
  document.getElementById("bestPointsPerHour").textContent = bestCalc ? bestCalc.pointsPerHour.toFixed(2) : "0";
  document.getElementById("totalCompletablePoints").textContent = games.reduce((sum, game) => sum + calculateGame(game).completablePoints, 0).toFixed(0);
  document.getElementById("totalHours").textContent = games.reduce((sum, game) => sum + Number(game.hours), 0).toFixed(1);
  document.getElementById("gameCount").textContent = games.length;
  document.getElementById("emptyState").hidden = rankedGames.length > 0;

  const table = document.getElementById("gameTable"); table.innerHTML = "";
  rankedGames.forEach((game, index) => {
    const calc = calculateGame(game); const row = document.createElement("tr");
    row.innerHTML = `<td>${index + 1}</td><td><strong>${escapeHtml(game.title)}</strong></td><td>${game.difficulty}/10</td><td>${game.hours}</td><td>${calc.totalPoints.toFixed(0)}</td><td>${calc.earnedPoints.toFixed(0)}</td><td>${calc.completablePoints.toFixed(0)}</td><td>${calc.blockedPoints.toFixed(0)}</td><td>B:${calc.bronzeCompletable} / S:${calc.silverCompletable} / G:${calc.goldCompletable} / P:${calc.platinumCompletable}</td><td>${calc.platinumCompletable > 0 ? '<span class="pill">Obtainable</span>' : '<span class="muted">No</span>'}</td><td>${calc.pointsPerHour.toFixed(2)}</td><td>${calc.overallScore.toFixed(2)}</td><td>${escapeHtml(game.notes || "")}</td><td class="actions"><button class="secondary" onclick="editGame('${game.id}')">Edit</button><button class="danger" onclick="deleteGame('${game.id}')">Delete</button></td>`;
    table.appendChild(row);
  });
  renderRecommendation();
}

function getRankedGames(sortBy) {
  const query = (document.getElementById("searchInput")?.value || "").trim().toLowerCase();
  return [...games].filter(g => !query || g.title.toLowerCase().includes(query) || (g.notes || "").toLowerCase().includes(query)).sort((a, b) => {
    const ca = calculateGame(a); const cb = calculateGame(b);
    if (sortBy === "hours" || sortBy === "difficulty") return a[sortBy] - b[sortBy];
    return cb[sortBy] - ca[sortBy];
  });
}

function renderRecommendation() {
  const recommendation = document.getElementById("recommendation");
  if (games.length === 0) { recommendation.textContent = "Add a game to get a recommendation."; return; }
  const best = getRankedGames("overallScore")[0]; const calc = calculateGame(best);
  recommendation.innerHTML = `<p><strong>${escapeHtml(best.title)}</strong> is your best next game based on weighted ROI.</p><ul><li>${calc.completablePoints.toFixed(0)} completable weighted points</li><li>${calc.blockedPoints.toFixed(0)} blocked or unobtainable weighted points</li><li>${best.hours} estimated hours</li><li>${best.difficulty}/10 difficulty</li><li>${calc.pointsPerHour.toFixed(2)} weighted points per hour</li><li>Completable trophies: Bronze ${calc.bronzeCompletable}, Silver ${calc.silverCompletable}, Gold ${calc.goldCompletable}, Platinum ${calc.platinumCompletable}</li><li>${calc.platinumCompletable > 0 ? "Platinum is obtainable, so it receives your platinum bonus." : "No obtainable platinum bonus applied."}</li></ul>`;
}

function editGame(id) {
  const game = games.find(g => String(g.id) === String(id)); if (!game) return;
  editingId = game.id; document.getElementById("addGameButton").textContent = "Update Game"; document.getElementById("formTitle").textContent = "Edit Game";
  ["title","difficulty","hours","bronzeTotal","silverTotal","goldTotal","platinumTotal","bronzeEarned","silverEarned","goldEarned","platinumEarned","bronzeCompletable","silverCompletable","goldCompletable","notes"].forEach(id => document.getElementById(id).value = game[id] ?? "");
  document.getElementById("platinumCompletable").value = game.platinumCompletable ? "yes" : "no";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteGame(id) { if (!confirm("Delete this game?")) return; await deleteGameFromCloud(id); games = games.filter(game => String(game.id) !== String(id)); saveLocalGames(); render(); toast("Game deleted."); }

async function clearAll() {
  if (!confirm("Clear all saved games and settings? This also deletes cloud games if you are signed in.")) return;
  if (supabaseClient && currentUser) {
    const { error: gamesError } = await supabaseClient.from("games").delete().eq("user_id", currentUser.id);
    const { error: settingsError } = await supabaseClient.from("roi_settings").delete().eq("user_id", currentUser.id);
    if (gamesError || settingsError) toast((gamesError || settingsError).message);
  }
  localStorage.removeItem(LOCAL_GAMES_KEY); localStorage.removeItem(LOCAL_SETTINGS_KEY); games = []; settings = { ...DEFAULT_SETTINGS }; hydrateSettingsForm(); render(); toast("Cleared.");
}

function clearForm() { ["title","difficulty","hours","bronzeTotal","silverTotal","goldTotal","platinumTotal","bronzeEarned","silverEarned","goldEarned","platinumEarned","bronzeCompletable","silverCompletable","goldCompletable","notes"].forEach(id => document.getElementById(id).value = ""); document.getElementById("platinumCompletable").value = "yes"; editingId = null; document.getElementById("addGameButton").textContent = "Add Game"; document.getElementById("formTitle").textContent = "Add Game"; }

function exportData() { downloadFile("trophy-roi-optimizer-backup.json", JSON.stringify({ settings, games }, null, 2), "application/json"); }
function downloadRankingsCSV() {
  if (games.length === 0) return toast("Add at least one game before downloading rankings.");
  const rankedGames = getRankedGames(document.getElementById("sortBy").value);
  const headers = ["Rank","Game","Difficulty","Hours","Total Weighted Points","Earned Weighted Points","Completable Weighted Points","Blocked Weighted Points","Bronze Completable","Silver Completable","Gold Completable","Platinum Completable","Platinum Obtainable","Weighted Points Per Hour","Overall ROI","Notes"];
  const rows = rankedGames.map((game, index) => { const calc = calculateGame(game); return [index + 1, game.title, game.difficulty, game.hours, calc.totalPoints.toFixed(0), calc.earnedPoints.toFixed(0), calc.completablePoints.toFixed(0), calc.blockedPoints.toFixed(0), calc.bronzeCompletable, calc.silverCompletable, calc.goldCompletable, calc.platinumCompletable, calc.platinumCompletable > 0 ? "Yes" : "No", calc.pointsPerHour.toFixed(2), calc.overallScore.toFixed(2), game.notes || ""]; });
  const csv = [headers, ...rows].map(row => row.map(csvEscape).join(",")).join("\n");
  downloadFile(`trophy-roi-rankings-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv;charset=utf-8;");
}
function importData(event) { const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = async e => { try { const imported = JSON.parse(e.target.result); settings = imported.settings || settings; games = imported.games || []; saveLocalSettings(); saveLocalGames(); hydrateSettingsForm(); render(); if (currentUser) await syncLocalToCloud(); toast("Backup imported."); } catch { toast("Invalid backup file."); } }; reader.readAsText(file); }
function csvEscape(value) { const text = String(value); return text.includes(",") || text.includes('"') || text.includes("\n") ? '"' + text.replace(/"/g, '""') + '"' : text; }
function downloadFile(filename, content, type) { const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); }
function escapeHtml(text) { const div = document.createElement("div"); div.textContent = text; return div.innerHTML; }
let toastTimer; function toast(message) { const el = document.getElementById("toast"); el.textContent = message; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3500); }

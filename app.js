// Mint Time Getter — OpenSea API v2
// Paste contract → auto-detect chain → fetch real phases → live DD:HH:MM:SS countdowns
// API key stored in localStorage, set once via Settings gear

// ─── State ────────────────────────────────────────────────────────────────────
let currentData       = null;
let countdownInterval = null;
let selectedTimezone  = "local";

// ─── DOM ──────────────────────────────────────────────────────────────────────
const contractInput   = document.getElementById("contractInput");
const networkSelect   = document.getElementById("networkSelect");
const searchForm      = document.getElementById("searchForm");
const tzSelect        = document.getElementById("tzSelect");
const localTzLabel    = document.getElementById("localTzLabel");
const searchBtn       = document.getElementById("searchBtn");
const searchBtnText   = document.getElementById("searchBtnText");
const apiKeyInput     = document.getElementById("apiKeyInput");
const toggleApiKey    = document.getElementById("toggleApiKey");
const openSettings    = document.getElementById("openSettings");
const closeSettings   = document.getElementById("closeSettings");
const saveSettings    = document.getElementById("saveSettings");
const settingsOverlay = document.getElementById("settingsOverlay");
const keyIndicator    = document.getElementById("keyIndicator");
const apiKeyStatus    = document.getElementById("apiKeyStatus");

// ─── OpenSea chains OpenSea accepts ──────────────────────────────────────────
// All chains we'll probe in order when network = "auto"
const ALL_CHAINS = [
    "base", "ethereum", "matic", "arbitrum", "optimism",
    "zora", "blast", "apechain", "solana"
];

const CHAIN_MAP = {
    ethereum:  "ethereum",
    base:      "base",
    polygon:   "matic",
    arbitrum:  "arbitrum",
    optimism:  "optimism",
    zora:      "zora",
    blast:     "blast",
    ape_chain: "apechain",
    solana:    "solana"
};

const CHAIN_DISPLAY = {
    ethereum: "Ethereum", base: "Base", matic: "Polygon",
    arbitrum: "Arbitrum", optimism: "Optimism", zora: "Zora",
    blast: "Blast", apechain: "Ape Chain", solana: "Solana"
};

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    // Timezone label
    try {
        localTzLabel.textContent =
            new Date().toLocaleTimeString("en-us", { timeZoneName: "short" }).split(" ")[2] || "Local";
    } catch { /**/ }

    // Restore saved API key
    const savedKey = localStorage.getItem("os_api_key") || "";
    apiKeyInput.value = savedKey;
    updateKeyIndicator(savedKey);

    // Settings modal
    openSettings.addEventListener("click", () => settingsOverlay.classList.remove("hidden"));
    closeSettings.addEventListener("click", closeModal);
    settingsOverlay.addEventListener("click", (e) => { if (e.target === settingsOverlay) closeModal(); });
    saveSettings.addEventListener("click", () => {
        const key = apiKeyInput.value.trim();
        localStorage.setItem("os_api_key", key);
        updateKeyIndicator(key);
        apiKeyStatus.textContent = key ? "✓ API key saved!" : "⚠ No key saved.";
        apiKeyStatus.style.color = key ? "var(--accent-green)" : "var(--accent-amber)";
        setTimeout(closeModal, 800);
    });

    toggleApiKey.addEventListener("click", () => {
        apiKeyInput.type = apiKeyInput.type === "password" ? "text" : "password";
        toggleApiKey.textContent = apiKeyInput.type === "password" ? "👁" : "🙈";
    });

    // Timezone change
    tzSelect.addEventListener("change", (e) => {
        selectedTimezone = e.target.value;
        if (currentData) renderTimeline(currentData);
    });

    // Search
    searchForm.addEventListener("submit", handleSearch);

    // Copy contract
    document.getElementById("copyContractBtn").addEventListener("click", copyAddress);
});

function closeModal() { settingsOverlay.classList.add("hidden"); }

function updateKeyIndicator(key) {
    keyIndicator.className = "key-dot " + (key ? "green" : "red");
    keyIndicator.title     = key ? "API key set ✓" : "No API key — click to configure";
}

function getApiKey() {
    return (localStorage.getItem("os_api_key") || "").trim();
}

// ─── Search Handler ───────────────────────────────────────────────────────────
async function handleSearch(e) {
    e.preventDefault();
    const address = contractInput.value.trim();
    if (!address) return;

    const apiKey = getApiKey();
    if (!apiKey) {
        // Open settings instead of failing silently
        settingsOverlay.classList.remove("hidden");
        apiKeyStatus.textContent = "⚠ Please paste your OpenSea API key to continue.";
        apiKeyStatus.style.color = "var(--accent-amber)";
        return;
    }

    setLoading(true);
    try {
        const network = networkSelect.value;
        const data    = await fetchFromOpenSea(address, network, apiKey);
        currentData   = data;
        renderUI(data);
    } catch (err) {
        console.error("Fetch error:", err);
        renderError(address, err.message);
    } finally {
        setLoading(false);
    }
}

// ─── OpenSea API ──────────────────────────────────────────────────────────────
async function fetchFromOpenSea(address, networkSetting, apiKey) {
    const headers = { "Accept": "application/json", "x-api-key": apiKey };

    // Build list of chains to try
    let chainsToTry;
    if (networkSetting === "auto") {
        chainsToTry = ALL_CHAINS;
    } else {
        const mapped = CHAIN_MAP[networkSetting] || networkSetting;
        chainsToTry  = [mapped, ...ALL_CHAINS.filter(c => c !== mapped)];
    }

    // Step 1 — Resolve contract → slug (try chains until one works)
    let slug      = null;
    let foundChain = null;

    for (const chain of chainsToTry) {
        try {
            const url = `https://api.opensea.io/api/v2/chain/${chain}/contract/${address}`;
            const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
            if (res.status === 401) throw new Error("Invalid OpenSea API key. Click ⚙️ Settings to update it.");
            if (res.status === 429) throw new Error("OpenSea rate limit hit. Wait a moment and try again.");
            if (!res.ok) continue;
            const json = await res.json();
            if (json.collection) { slug = json.collection; foundChain = chain; break; }
        } catch (err) {
            if (err.message.includes("Invalid OpenSea") || err.message.includes("rate limit")) throw err;
            // Network error or 404 — try next chain
        }
    }

    if (!slug) {
        throw new Error(
            `Contract ${shortenAddress(address)} not found on any supported network. ` +
            `Double-check the address or select the correct network manually.`
        );
    }

    // Step 2 — Get collection metadata
    let colName  = slug;
    let colThumb = "";
    let supply   = "—";
    let verified = false;

    try {
        const colRes  = await fetch(`https://api.opensea.io/api/v2/collections/${slug}`, { headers, signal: AbortSignal.timeout(8000) });
        if (colRes.ok) {
            const col = await colRes.json();
            colName  = col.name  || slug;
            colThumb = col.image_url || col.banner_image_url || "";
            supply   = col.total_supply ? String(col.total_supply) : "—";
            verified = col.safelist_request_status === "verified" || col.safelist_status === "verified";
        }
    } catch { /* use slug as name */ }

    // Step 3 — Get drop / mint phases
    let phases = [];

    try {
        const dropRes = await fetch(`https://api.opensea.io/api/v2/drops/${slug}`, { headers, signal: AbortSignal.timeout(8000) });

        if (dropRes.ok) {
            const drop = await dropRes.json();
            phases = parseOpenSeaDrop(drop);
        } else if (dropRes.status === 404) {
            // No drop on OpenSea — collection exists but no active/upcoming drop
            throw new Error(
                `"${colName}" has no active or scheduled mint drop on OpenSea. ` +
                `The collection may have sold out or the drop isn't listed yet.`
            );
        }
    } catch (err) {
        if (err.message.includes("no active") || err.message.includes("sold out")) throw err;
        throw new Error(`Could not fetch drop data for "${colName}": ${err.message}`);
    }

    if (phases.length === 0) {
        throw new Error(`"${colName}" was found but has no mint phases scheduled on OpenSea yet.`);
    }

    return {
        name:     colName,
        contract: address,
        network:  CHAIN_DISPLAY[foundChain] || foundChain,
        thumb:    colThumb,
        supply,
        verified,
        phases
    };
}

function parseOpenSeaDrop(drop) {
    const phases = [];

    // Collect all stage objects from the drop response
    const rawStages = [];
    if (Array.isArray(drop.stages))       rawStages.push(...drop.stages);
    if (Array.isArray(drop.mint_stages))  rawStages.push(...drop.mint_stages);

    // active_stage and next_stage may be standalone objects
    for (const candidate of [drop.active_stage, drop.next_stage, drop]) {
        if (!candidate) continue;
        if (candidate.start_time || candidate.startTime || candidate.open_time) {
            const already = rawStages.some(s =>
                (s.stage && s.stage === candidate.stage) ||
                (s.start_time && s.start_time === candidate.start_time)
            );
            if (!already) rawStages.push(candidate);
        }
    }

    rawStages.forEach((stage, i) => {
        const startTime = parseTimestamp(
            stage.start_time || stage.startTime || stage.start_date || stage.open_time
        );
        const endTime = parseTimestamp(
            stage.end_time || stage.endTime || stage.end_date || stage.close_time
        );
        if (!startTime) return;

        // Determine if allowlist or public
        const key      = (stage.stage || stage.name || stage.label || "").toLowerCase();
        const isWl     = !!stage.merkle_root
            || key.includes("allow") || key.includes("wl")
            || key.includes("whitelist") || key.includes("presale")
            || key.includes("guild") || key.includes("partner");
        const type     = isWl ? "Allowlist" : "Public";

        const name     = stage.name || stage.label || stage.stage
            || (isWl ? "Allowlist Mint" : "Public Mint");

        const priceWei = stage.price || stage.mint_price || stage.fee || 0;
        const priceEth = priceWei > 0 ? (priceWei / 1e18).toFixed(4) : "0.00";
        const priceUsd = stage.price_usd
            ? `$${stage.price_usd}`
            : (priceWei > 0 ? `$${(priceWei / 1e18 * 2600).toFixed(2)}` : "FREE");

        const walletLimit = stage.mint_limit_per_wallet
            ?? stage.max_per_wallet ?? stage.wallet_limit
            ?? stage.quantity_limit_per_wallet;
        const limitStr = (!walletLimit || walletLimit === 0)
            ? "UNLIMITED"
            : `${walletLimit} PER WALLET`;

        phases.push({
            id: `os_${i}`,
            name,
            type,
            startTime,
            endTime: endTime || startTime + 7200000,
            priceEth,
            priceUsd,
            limit: limitStr
        });
    });

    return phases.sort((a, b) => a.startTime - b.startTime);
}

// ─── UI ───────────────────────────────────────────────────────────────────────
function renderUI(data) {
    document.getElementById("collectionTitle").textContent = data.name;
    document.getElementById("collectionThumb").src =
        data.thumb || "https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?w=200&auto=format&fit=crop&q=80";
    document.getElementById("contractDisplay").childNodes[0].textContent = shortenAddress(data.contract) + " ";
    document.getElementById("verifiedBadge").style.display = data.verified ? "inline-flex" : "none";
    setText("networkBadge",   `Network: ${data.network}`);
    setText("totalPhasesTag", `${data.phases.length} Phase${data.phases.length !== 1 ? "s" : ""}`);
    setText("supplyTag",      `Supply: ${data.supply}`);
    renderTimeline(data);
    startTicker();
}

function renderTimeline(data) {
    const container = document.getElementById("mintTimeline");
    container.innerHTML = "";
    const now = Date.now();
    let live = 0, upcoming = 0, ended = 0, heroPhase = null;

    data.phases.forEach(phase => {
        const isLive     = now >= phase.startTime && now <= phase.endTime;
        const isUpcoming = now <  phase.startTime;
        const isEnded    = now >  phase.endTime;

        if (isLive)     { live++;     if (!heroPhase) heroPhase = phase; }
        if (isUpcoming) { upcoming++; if (!heroPhase) heroPhase = phase; }
        if (isEnded)    ended++;

        let badgeClass = "ended", badgeText = "ENDED";
        if (isLive)     { badgeClass = "active";   badgeText = `LIVE NOW • Ends in ${fmtDuration(phase.endTime - now)}`; }
        if (isUpcoming) { badgeClass = "upcoming"; badgeText = `STARTS IN: ${fmtDuration(phase.startTime - now)}`; }

        const priceLabel = (phase.priceUsd === "FREE" || phase.priceEth === "0.00")
            ? "FREE"
            : `${phase.priceUsd} (${phase.priceEth} ETH)`;

        const div = document.createElement("div");
        div.className = `timeline-item${isLive ? " active-phase" : ""}${isUpcoming ? " upcoming-phase" : ""}${isEnded ? " ended-phase" : ""}`;
        div.dataset.phaseId = phase.id;
        div.innerHTML = `
            <div class="timeline-node"><div class="node-icon"></div></div>
            <div class="phase-header-row">
                <div class="phase-title-group">
                    <span class="phase-title">${phase.name}</span>
                    <span class="type-tag ${phase.type.toLowerCase()}">${phase.type}</span>
                </div>
                <div class="item-countdown-badge ${badgeClass}" id="badge-${phase.id}">${badgeText}</div>
            </div>
            <div class="phase-details">
                <div class="time-row">Starts: <strong>${formatDate(phase.startTime)}</strong></div>
                <div class="time-row">Ends:   <strong>${formatDate(phase.endTime)}</strong></div>
                <div class="price-limit-row">
                    <span class="price-val">${priceLabel}</span>
                    <span class="divider-pipe">|</span>
                    <span class="limit-val">LIMIT ${phase.limit}</span>
                </div>
            </div>`;
        container.appendChild(div);
    });

    setText("liveCount",     String(live));
    setText("upcomingCount", String(upcoming));
    setText("endedCount",    String(ended));
    updateHero(heroPhase || data.phases[data.phases.length - 1], now);
}

function updateHero(phase, now) {
    if (!phase) return;
    const isLive     = now >= phase.startTime && now <= phase.endTime;
    const isUpcoming = now <  phase.startTime;
    setText("heroPhaseTitle", phase.name);
    const card = document.getElementById("heroCountdownCard");
    if (isLive) {
        setText("heroStatusText", "CURRENT ACTIVE PHASE");
        const mins = Math.floor((now - phase.startTime) / 60000);
        setText("heroSubtext", `Started ${mins > 0 ? mins + "m ago" : "just now"} • Countdown to end:`);
        card.style.borderColor = "rgba(16,185,129,0.5)";
    } else if (isUpcoming) {
        setText("heroStatusText", "NEXT UPCOMING PHASE");
        setText("heroSubtext", `Starts: ${formatDate(phase.startTime)}`);
        card.style.borderColor = "rgba(245,158,11,0.5)";
    } else {
        setText("heroStatusText", "MINT CONCLUDED");
        setText("heroSubtext", "All phases ended.");
        card.style.borderColor = "rgba(90,90,106,0.4)";
    }
    const target = isLive ? phase.endTime : phase.startTime;
    setCountdown(Math.max(0, target - now));
}

function renderError(address, message) {
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    setText("collectionTitle", "COULD NOT FETCH");
    setText("heroStatusText",  "ERROR");
    setText("heroPhaseTitle",  message);
    setText("heroSubtext",     "Check the contract address and network, then try again.");
    setText("cdDays","--"); setText("cdHours","--"); setText("cdMins","--"); setText("cdSecs","--");
    setText("liveCount","0"); setText("upcomingCount","0"); setText("endedCount","0");
    document.getElementById("contractDisplay").childNodes[0].textContent = shortenAddress(address) + " ";
    document.getElementById("mintTimeline").innerHTML =
        `<div class="timeline-item" style="text-align:center;padding:40px;color:var(--text-muted)">⚠️ ${message}</div>`;
}

// ─── Live Ticker ──────────────────────────────────────────────────────────────
function startTicker() {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
        if (!currentData) return;
        const now = Date.now();
        let heroPhase = null;

        currentData.phases.forEach(phase => {
            const isLive     = now >= phase.startTime && now <= phase.endTime;
            const isUpcoming = now <  phase.startTime;
            if ((isLive || isUpcoming) && !heroPhase) heroPhase = phase;

            const badge = document.getElementById(`badge-${phase.id}`);
            if (!badge) return;
            if (isLive) {
                badge.className   = "item-countdown-badge active";
                badge.textContent = `LIVE NOW • Ends in ${fmtDuration(phase.endTime - now)}`;
            } else if (isUpcoming) {
                badge.className   = "item-countdown-badge upcoming";
                badge.textContent = `STARTS IN: ${fmtDuration(phase.startTime - now)}`;
            } else {
                badge.className   = "item-countdown-badge ended";
                badge.textContent = "ENDED";
            }
        });

        if (heroPhase) {
            const isLive = now >= heroPhase.startTime && now <= heroPhase.endTime;
            setCountdown(Math.max(0, (isLive ? heroPhase.endTime : heroPhase.startTime) - now));
        }
    }, 1000);
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function setCountdown(ms) {
    const { days, hours, minutes, seconds } = getDurationParts(ms);
    setText("cdDays",  pad(days));
    setText("cdHours", pad(hours));
    setText("cdMins",  pad(minutes));
    setText("cdSecs",  pad(seconds));
}

function parseTimestamp(val) {
    if (!val) return null;
    if (typeof val === "number") return val > 1e10 ? val : val * 1000;
    if (typeof val === "string") {
        const d = new Date(val);
        if (!isNaN(d)) return d.getTime();
        const n = Number(val);
        if (!isNaN(n) && n > 0) return n > 1e10 ? n : n * 1000;
    }
    return null;
}

function getDurationParts(ms) {
    const s = Math.floor(ms / 1000);
    return { days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60 };
}

function fmtDuration(ms) {
    if (ms <= 0) return "00d 00h 00m 00s";
    const { days, hours, minutes, seconds } = getDurationParts(ms);
    return `${pad(days)}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
}

function formatDate(timestamp) {
    const date = new Date(timestamp);
    const opts = { month: "long", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true };
    if (selectedTimezone !== "local") opts.timeZone = selectedTimezone;
    const formatted = new Intl.DateTimeFormat("en-US", opts).format(date);
    const offsetHrs  = -date.getTimezoneOffset() / 60;
    const tz = selectedTimezone === "local"
        ? ` GMT${offsetHrs >= 0 ? "+" + offsetHrs : offsetHrs}`
        : selectedTimezone === "UTC" ? " UTC"
        : ` (${selectedTimezone.split("/")[1] || selectedTimezone})`;
    return formatted + tz;
}

function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function pad(n) { return String(n).padStart(2, "0"); }
function shortenAddress(a) { return a && a.length > 10 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a; }

function copyAddress() {
    if (!currentData) return;
    navigator.clipboard.writeText(currentData.contract);
    const btn = document.getElementById("copyContractBtn");
    btn.textContent = "✓";
    setTimeout(() => { btn.textContent = "📋"; }, 2000);
}

function setLoading(on) {
    searchBtn.disabled     = on;
    searchBtn.style.opacity = on ? "0.6" : "1";
    searchBtnText.textContent = on ? "Fetching..." : "Fetch Schedule";
}

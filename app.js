// Mint Time Getter — Powered by OpenSea API v2
// Flow: contract address → OpenSea slug → OpenSea drop phases → live DD:HH:MM:SS countdown

// ─── State ────────────────────────────────────────────────────────────────────
let currentData       = null;
let countdownInterval = null;
let selectedTimezone  = "local";

// ─── DOM ──────────────────────────────────────────────────────────────────────
const contractInput = document.getElementById("contractInput");
const networkSelect = document.getElementById("networkSelect");
const searchForm    = document.getElementById("searchForm");
const tzSelect      = document.getElementById("tzSelect");
const localTzLabel  = document.getElementById("localTzLabel");
const searchBtn     = document.getElementById("searchBtn");
const apiKeyInput   = document.getElementById("apiKeyInput");
const toggleApiKey  = document.getElementById("toggleApiKey");

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    try {
        const tzAbbr = new Date().toLocaleTimeString("en-us", { timeZoneName: "short" }).split(" ")[2] || "Local";
        localTzLabel.textContent = tzAbbr;
    } catch { localTzLabel.textContent = "Local"; }

    // Restore saved API key
    const savedKey = localStorage.getItem("os_api_key");
    if (savedKey) apiKeyInput.value = savedKey;

    // Toggle show/hide API key
    toggleApiKey.addEventListener("click", () => {
        apiKeyInput.type = apiKeyInput.type === "password" ? "text" : "password";
        toggleApiKey.textContent = apiKeyInput.type === "password" ? "👁" : "🙈";
    });

    // Save API key on change
    apiKeyInput.addEventListener("change", () => {
        localStorage.setItem("os_api_key", apiKeyInput.value.trim());
    });

    searchForm.addEventListener("submit", handleSearch);
    tzSelect.addEventListener("change", (e) => {
        selectedTimezone = e.target.value;
        if (currentData) renderTimeline(currentData);
    });
    document.getElementById("copyContractBtn").addEventListener("click", copyAddress);
    renderEmpty();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getApiKey() {
    const key = (apiKeyInput.value || "").trim();
    return key || null;
}

function osHeaders() {
    const key = getApiKey();
    const headers = { "Accept": "application/json" };
    if (key) headers["x-api-key"] = key;
    return headers;
}

// OpenSea chain slug map
const OS_CHAINS = {
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

// ─── Empty / Error States ─────────────────────────────────────────────────────
function renderEmpty() {
    setText("collectionTitle", "ENTER CONTRACT ADDRESS");
    setText("networkBadge",    "Network: Select above");
    setText("totalPhasesTag",  "0 Mint Phases");
    setText("supplyTag",       "Supply: —");
    setText("heroPhaseTitle",  "AWAITING CONTRACT");
    setText("heroStatusText",  "SEARCH TO FETCH");
    setText("heroSubtext",     "Paste any OpenSea NFT contract address to fetch the live mint schedule");
    setText("cdDays","00"); setText("cdHours","00"); setText("cdMins","00"); setText("cdSecs","00");
    setText("liveCount","0"); setText("upcomingCount","0"); setText("endedCount","0");
    document.getElementById("collectionThumb").src =
        "https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?w=200&auto=format&fit=crop&q=80";
    document.getElementById("contractDisplay").childNodes[0].textContent = "Paste address above to start ";
    document.getElementById("mintTimeline").innerHTML =
        `<div class="timeline-item" style="text-align:center;padding:40px;color:var(--text-muted)">
            🔍 Enter an NFT contract address above to fetch the live mint schedule.
         </div>`;
}

function renderError(address, message) {
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    setText("collectionTitle", "COULD NOT FETCH COLLECTION");
    setText("networkBadge",    `Network: ${capitalize(networkSelect.value)}`);
    setText("totalPhasesTag",  "—");
    setText("supplyTag",       "—");
    setText("heroPhaseTitle",  "FETCH FAILED");
    setText("heroStatusText",  "ERROR");
    setText("heroSubtext",     message);
    setText("cdDays","--"); setText("cdHours","--"); setText("cdMins","--"); setText("cdSecs","--");
    setText("liveCount","0"); setText("upcomingCount","0"); setText("endedCount","0");
    document.getElementById("contractDisplay").childNodes[0].textContent = shortenAddress(address) + " ";
    document.getElementById("mintTimeline").innerHTML =
        `<div class="timeline-item" style="text-align:center;padding:40px;color:var(--text-muted)">
            ⚠️ ${message}
         </div>`;
}

// ─── Search Handler ───────────────────────────────────────────────────────────
async function handleSearch(e) {
    e.preventDefault();
    const address = contractInput.value.trim();
    const network = networkSelect.value;
    if (!address) return;

    if (!getApiKey()) {
        renderError(address, "Please paste your OpenSea API key in the field above. Get one free at opensea.io/developers.");
        return;
    }

    setLoading(true);
    try {
        const data = await fetchFromOpenSea(address, network);
        currentData = data;
        renderUI(data);
    } catch (err) {
        console.error("OpenSea fetch error:", err);
        renderError(address, err.message);
    } finally {
        setLoading(false);
    }
}

// ─── OpenSea API Fetcher ──────────────────────────────────────────────────────
async function fetchFromOpenSea(address, network) {
    const chain = OS_CHAINS[network] || network;

    // Step 1: Resolve contract → collection slug
    const contractUrl = `https://api.opensea.io/api/v2/chain/${chain}/contract/${address}`;
    const contractRes = await fetch(contractUrl, { headers: osHeaders(), signal: AbortSignal.timeout(10000) });

    if (contractRes.status === 401) throw new Error("Invalid OpenSea API key. Please check your key and try again.");
    if (contractRes.status === 404) throw new Error(`Contract ${shortenAddress(address)} not found on ${capitalize(network)}. Try selecting a different network.`);
    if (!contractRes.ok)            throw new Error(`OpenSea API error ${contractRes.status}. Please try again.`);

    const contractData = await contractRes.json();
    const slug         = contractData.collection;
    if (!slug) throw new Error("Collection slug not found for this contract.");

    // Step 2: Get collection metadata (name, image, supply)
    const colUrl = `https://api.opensea.io/api/v2/collections/${slug}`;
    const colRes = await fetch(colUrl, { headers: osHeaders(), signal: AbortSignal.timeout(10000) });
    const colData = colRes.ok ? await colRes.json() : {};

    const collectionName  = colData.name || slug;
    const collectionThumb = colData.image_url || colData.banner_image_url || "";
    const totalSupply     = colData.total_supply ? String(colData.total_supply) : "—";
    const verified        = colData.safelist_request_status === "verified" || colData.safelist_status === "verified";

    // Step 3: Get drop/mint schedule
    const dropUrl = `https://api.opensea.io/api/v2/drops/${slug}`;
    const dropRes = await fetch(dropUrl, { headers: osHeaders(), signal: AbortSignal.timeout(10000) });

    if (dropRes.status === 404) {
        // Collection exists but no drop/mint scheduled on OpenSea
        throw new Error(`"${collectionName}" has no active or scheduled mint drop on OpenSea. The collection may have already minted out or the drop is not listed yet.`);
    }
    if (!dropRes.ok) throw new Error(`Could not fetch drop data for "${collectionName}". OpenSea status: ${dropRes.status}`);

    const dropData = await dropRes.json();

    // Step 4: Parse phases from drop data
    const phases = parseOpenSeaDrop(dropData, collectionName);

    if (phases.length === 0) {
        throw new Error(`"${collectionName}" drop found but no mint phases are scheduled yet.`);
    }

    return {
        name:     collectionName,
        contract: address,
        network,
        thumb:    collectionThumb,
        supply:   totalSupply,
        verified,
        phases
    };
}

function parseOpenSeaDrop(drop, collectionName) {
    const phases = [];

    // OpenSea drop can have: active_stage, next_stage, stages[]
    const rawStages = drop.stages || drop.mint_stages || [];

    // Also include active_stage and next_stage if not in stages[]
    if (drop.active_stage) {
        const exists = rawStages.find(s => s.stage === drop.active_stage.stage);
        if (!exists) rawStages.unshift(drop.active_stage);
    }
    if (drop.next_stage) {
        const exists = rawStages.find(s => s.stage === drop.next_stage.stage);
        if (!exists) rawStages.push(drop.next_stage);
    }

    rawStages.forEach((stage, i) => {
        const startTime = parseTimestamp(stage.start_time || stage.startTime || stage.start_date || stage.open_time);
        const endTime   = parseTimestamp(stage.end_time   || stage.endTime   || stage.end_date   || stage.close_time);

        if (!startTime) return; // skip stages with no time

        // Determine phase type
        const stageKey    = (stage.stage || stage.name || stage.label || "").toLowerCase();
        const isMerkle    = !!stage.merkle_root || stageKey.includes("allow") || stageKey.includes("wl") || stageKey.includes("whitelist") || stageKey.includes("presale");
        const phaseType   = isMerkle ? "Allowlist" : "Public";

        // Phase name
        const phaseName = stage.name || stage.label || stage.stage
            || (isMerkle ? "Allowlist Mint" : "Public Mint");

        // Price
        const priceWei = stage.price || stage.mint_price || stage.fee || 0;
        const priceEth = priceWei > 0 ? (priceWei / 1e18).toFixed(4) : "0.00";
        const priceUsd = stage.price_usd || (priceWei > 0 ? `$${(priceWei / 1e18 * 2600).toFixed(2)}` : "FREE");

        // Wallet limit
        const walletLimit = stage.mint_limit_per_wallet
            ?? stage.max_per_wallet
            ?? stage.wallet_limit
            ?? stage.quantity_limit_per_wallet
            ?? 1;
        const limitStr = walletLimit === 0 || walletLimit === null
            ? "UNLIMITED"
            : `${walletLimit} PER WALLET`;

        phases.push({
            id:        `os_${i}`,
            name:      phaseName,
            type:      phaseType,
            startTime,
            endTime:   endTime || startTime + 3600000,
            priceEth,
            priceUsd:  String(priceUsd),
            limit:     limitStr
        });
    });

    // Sort by start time ascending
    return phases.sort((a, b) => a.startTime - b.startTime);
}

// ─── UI Rendering ─────────────────────────────────────────────────────────────
function renderUI(data) {
    document.getElementById("collectionTitle").textContent = data.name;
    document.getElementById("collectionThumb").src         = data.thumb ||
        "https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?w=200&auto=format&fit=crop&q=80";
    document.getElementById("contractDisplay").childNodes[0].textContent = shortenAddress(data.contract) + " ";
    document.getElementById("verifiedBadge").style.display = data.verified ? "inline-flex" : "none";
    setText("networkBadge",   `Network: ${capitalize(data.network)}`);
    setText("totalPhasesTag", `${data.phases.length} Mint Phase${data.phases.length !== 1 ? "s" : ""}`);
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
        if (isEnded)    { ended++; }

        let badgeClass = "ended", badgeText = "ENDED";
        if (isLive)     { badgeClass = "active";   badgeText = `LIVE NOW • Ends in ${fmtDuration(phase.endTime - now)}`; }
        if (isUpcoming) { badgeClass = "upcoming"; badgeText = `STARTS IN: ${fmtDuration(phase.startTime - now)}`; }

        const priceDisplay = (phase.priceUsd === "FREE" || phase.priceUsd === "0.00")
            ? "FREE"
            : phase.priceUsd.startsWith("$") ? phase.priceUsd : `$${phase.priceUsd}`;

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
                <div class="time-row">Ends: <strong>${formatDate(phase.endTime)}</strong></div>
                <div class="price-limit-row">
                    <span class="price-val">${priceDisplay} (${phase.priceEth} ETH)</span>
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
        setText("heroSubtext", `Phase started ${mins > 0 ? mins + " minutes ago" : "just now"} • Live countdown remaining:`);
        card.style.borderColor = "rgba(16,185,129,0.5)";
    } else if (isUpcoming) {
        setText("heroStatusText", "NEXT UPCOMING PHASE");
        setText("heroSubtext", `Starts on ${formatDate(phase.startTime)}`);
        card.style.borderColor = "rgba(245,158,11,0.5)";
    } else {
        setText("heroStatusText", "MINT CONCLUDED");
        setText("heroSubtext", "All phases have ended.");
        card.style.borderColor = "rgba(90,90,106,0.5)";
    }
    const target = isLive ? phase.endTime : phase.startTime;
    setCountdown(Math.max(0, target - now));
}

function setCountdown(ms) {
    const { days, hours, minutes, seconds } = getDurationParts(ms);
    setText("cdDays",  pad(days));
    setText("cdHours", pad(hours));
    setText("cdMins",  pad(minutes));
    setText("cdSecs",  pad(seconds));
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

// ─── Utility Functions ────────────────────────────────────────────────────────
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
function pad(n)             { return String(n).padStart(2, "0"); }
function shortenAddress(a)  { return a && a.length > 10 ? `${a.slice(0,6)}...${a.slice(-4)}` : a; }
function capitalize(s)      { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function copyAddress() {
    if (!currentData) return;
    navigator.clipboard.writeText(currentData.contract);
    const btn = document.getElementById("copyContractBtn");
    btn.textContent = "✓ Copied!";
    setTimeout(() => { btn.textContent = "📋"; }, 2000);
}

function setLoading(on) {
    searchBtn.disabled = on;
    searchBtn.style.opacity = on ? "0.6" : "1";
    searchBtn.querySelector("span").textContent = on ? "Fetching..." : "Fetch Mint Schedule";
}

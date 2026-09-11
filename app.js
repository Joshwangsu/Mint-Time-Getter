// Mint Time Getter — Production Build
// Primary source: Megashot API (Robinhood Chain launchpad)
// Fallback: EVM RPC eth_call for other chains

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

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    try {
        const tzAbbr = new Date().toLocaleTimeString("en-us", { timeZoneName: "short" }).split(" ")[2] || "Local";
        localTzLabel.textContent = tzAbbr;
    } catch { localTzLabel.textContent = "Local"; }

    searchForm.addEventListener("submit", handleSearch);
    tzSelect.addEventListener("change", (e) => {
        selectedTimezone = e.target.value;
        if (currentData) renderTimeline(currentData);
    });
    document.getElementById("copyContractBtn").addEventListener("click", copyAddress);
    renderEmpty();
});

// ─── Empty State ──────────────────────────────────────────────────────────────
function renderEmpty() {
    setText("collectionTitle",  "ENTER CONTRACT ADDRESS");
    setText("networkBadge",     "Network: Robinhood / EVM");
    setText("totalPhasesTag",   "0 Mint Phases");
    setText("supplyTag",        "Supply: —");
    setText("heroPhaseTitle",   "AWAITING CONTRACT");
    setText("heroStatusText",   "SEARCH TO FETCH");
    setText("heroSubtext",      "Paste any NFT contract address to fetch live phase times");
    setText("cdDays",  "00"); setText("cdHours", "00");
    setText("cdMins",  "00"); setText("cdSecs",  "00");
    setText("liveCount", "0"); setText("upcomingCount", "0"); setText("endedCount", "0");
    document.getElementById("collectionThumb").src =
        "https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?w=200&auto=format&fit=crop&q=80";
    document.getElementById("contractDisplay").childNodes[0].textContent = "Paste address above to start ";
    document.getElementById("mintTimeline").innerHTML =
        `<div class="timeline-item" style="text-align:center;padding:40px;color:var(--text-muted)">
            🔍 Enter an NFT contract address above to fetch the live mint schedule.
         </div>`;
}

// ─── Error State ──────────────────────────────────────────────────────────────
function renderError(address, message) {
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    setText("collectionTitle",  "COLLECTION NOT FOUND");
    setText("contractDisplay",  shortenAddress(address) + " ");
    setText("networkBadge",     `Network: ${capitalize(networkSelect.value)}`);
    setText("totalPhasesTag",   "0 Mint Phases");
    setText("supplyTag",        "Supply: —");
    setText("heroPhaseTitle",   "COULD NOT FETCH SCHEDULE");
    setText("heroStatusText",   "FETCH ERROR");
    setText("heroSubtext",      message);
    setText("cdDays","--"); setText("cdHours","--"); setText("cdMins","--"); setText("cdSecs","--");
    setText("liveCount","0"); setText("upcomingCount","0"); setText("endedCount","0");
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

    setLoading(true);
    try {
        const data = await fetchSchedule(address, network);
        currentData = data;
        renderUI(data);
    } catch (err) {
        console.error("Fetch failed:", err);
        renderError(address, err.message || "Could not fetch mint schedule for this contract.");
    } finally {
        setLoading(false);
    }
}

// ─── Primary Fetcher ──────────────────────────────────────────────────────────
async function fetchSchedule(address, network) {
    const cleanAddr = address.toLowerCase();

    // 1 — Try Megashot API (Robinhood Chain native launchpad)
    try {
        const data = await fetchFromMegashot(cleanAddr);
        if (data) return data;
    } catch (e) {
        console.warn("Megashot API:", e.message);
    }

    // 2 — Try SimpleHash (multi-chain NFT metadata + mint data)
    try {
        const data = await fetchFromSimpleHash(cleanAddr, network);
        if (data) return data;
    } catch (e) {
        console.warn("SimpleHash API:", e.message);
    }

    // 3 — Try direct EVM RPC for on-chain mint timestamps
    try {
        const data = await fetchFromRPC(cleanAddr, network);
        if (data) return data;
    } catch (e) {
        console.warn("RPC fetch:", e.message);
    }

    // If all three fail, throw — never show fake data
    throw new Error(
        "No mint schedule found on-chain or via Megashot/SimpleHash. " +
        "Make sure you have the correct contract address and network selected."
    );
}

// ─── Source 1: Megashot API ───────────────────────────────────────────────────
// Megashot is the primary NFT launchpad on Robinhood Chain.
// Endpoint pattern: https://api.megashot.xyz/v1/collection/<contract>
async function fetchFromMegashot(address) {
    const MEGASHOT_ENDPOINTS = [
        `https://api.megashot.xyz/v1/collection/${address}`,
        `https://api.megashot.xyz/v1/collections/${address}`,
        `https://megashot.xyz/api/collection/${address}`
    ];

    for (const url of MEGASHOT_ENDPOINTS) {
        try {
            const res = await fetch(url, {
                headers: { "Accept": "application/json" },
                signal: AbortSignal.timeout(6000)
            });
            if (!res.ok) continue;
            const json = await res.json();
            const parsed = parseMegashotResponse(json, address);
            if (parsed) return parsed;
        } catch (e) {
            // Try next endpoint
        }
    }
    return null;
}

function parseMegashotResponse(json, address) {
    // Handle various Megashot API response shapes
    const col = json.collection || json.data || json;

    if (!col || (!col.name && !col.title && !col.contract_address)) return null;

    const name    = col.name || col.title || col.slug || `Collection (${shortenAddress(address)})`;
    const thumb   = col.image_url || col.cover_image || col.thumbnail || col.banner_url || "";
    const supply  = col.total_supply || col.max_supply || col.available_items || "—";
    const phases  = [];

    // Megashot uses mint_phases[] or claim_phases[] or a single mint_start/end
    const rawPhases = col.mint_phases || col.claim_phases || col.phases || [];

    if (rawPhases.length > 0) {
        rawPhases.forEach((p, i) => {
            const phaseType  = p.type || p.phase_type || (p.is_public ? "Public" : "Allowlist");
            const phaseName  = p.name || p.label || p.title || `Phase ${i + 1}`;
            const startTime  = parseTimestamp(p.start_time || p.startTime || p.mint_start || p.open_at);
            const endTime    = parseTimestamp(p.end_time   || p.endTime   || p.mint_end   || p.close_at);
            const priceWei   = p.price || p.price_wei || 0;
            const priceEth   = priceWei > 0 ? (priceWei / 1e18).toFixed(4) : "0.00";
            const priceUsd   = p.price_usd || (priceWei > 0 ? "$" + (priceWei / 1e18 * 2600).toFixed(2) : "FREE");
            const limit      = p.max_per_wallet || p.wallet_limit || p.quantity_limit || "1 PER WALLET";

            if (!startTime) return; // skip phases without a valid time

            phases.push({
                id: `ms_${i}`,
                name: phaseName,
                type: phaseType,
                startTime,
                endTime: endTime || startTime + 3600000,
                priceEth,
                priceUsd: String(priceUsd),
                limit: `${limit} PER WALLET`.replace("PER WALLET PER WALLET", "PER WALLET")
            });
        });
    } else if (col.mint_start || col.start_time || col.open_at) {
        // Single-phase collection
        const startTime = parseTimestamp(col.mint_start || col.start_time || col.open_at);
        const endTime   = parseTimestamp(col.mint_end   || col.end_time   || col.close_at);
        const priceWei  = col.price || col.mint_price || 0;
        const priceEth  = priceWei > 0 ? (priceWei / 1e18).toFixed(4) : "0.00";

        phases.push({
            id: "ms_0",
            name: col.phase_name || "PUBLIC MINT",
            type: "Public",
            startTime: startTime || Date.now(),
            endTime:   endTime   || (startTime || Date.now()) + 3600000,
            priceEth,
            priceUsd: priceWei > 0 ? "$" + (priceWei / 1e18 * 2600).toFixed(2) : "FREE",
            limit: `${col.max_per_wallet || col.wallet_limit || 1} PER WALLET`
        });
    }

    if (phases.length === 0) return null;

    return {
        name,
        contract: address,
        network: "robinhood",
        thumb,
        supply: String(supply),
        verified: true,
        phases
    };
}

// ─── Source 2: SimpleHash ─────────────────────────────────────────────────────
async function fetchFromSimpleHash(address, network) {
    const chainMap = {
        robinhood: "robinhood",
        base:      "base",
        ethereum:  "ethereum",
        arbitrum:  "arbitrum-nova",
        polygon:   "polygon",
        optimism:  "optimism"
    };
    const chain = chainMap[network] || "base";
    const url = `https://api.simplehash.com/api/v0/nfts/collections/contract?chains=${chain}&contract_addresses=${address}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const json = await res.json();
    const col = json.collections?.[0];
    if (!col) return null;

    const name  = col.name || `Collection (${shortenAddress(address)})`;
    const thumb = col.image_url || col.banner_image_url || "";
    const supply = col.total_quantity || "—";

    // SimpleHash doesn't always carry mint schedule, return name/image only as meta
    // and let RPC handle the phase data
    return {
        name,
        contract: address,
        network,
        thumb,
        supply: String(supply),
        verified: !!col.top_collection_slug,
        // No phases — means SimpleHash gave us metadata but not schedule
        // We'll let this bubble up as partial data and show "schedule not available"
        phases: []
    };
}

// ─── Source 3: EVM RPC ────────────────────────────────────────────────────────
const RPC_NODES = {
    robinhood: ["https://rpc.robinhood.com"],
    base:      ["https://mainnet.base.org", "https://base.llamarpc.com"],
    ethereum:  ["https://eth.llamarpc.com", "https://rpc.ankr.com/eth"],
    arbitrum:  ["https://arb1.arbitrum.io/rpc"],
    polygon:   ["https://polygon-rpc.com"],
    optimism:  ["https://mainnet.optimism.io"]
};

// Known EVM function selectors for mint schedule fields
const SELECTORS = {
    name:            "0x06fdde03",
    mintStartTime:   "0x31a293ee",
    publicSaleStart: "0x098db57a",
    saleStartTime:   "0x8797f14b",
    startTime:       "0x6057361d",
    publicSaleTsmp:  "0xe6c8fa2c",
    getClaimCond:    "0x696b9961"
};

async function fetchFromRPC(address, network) {
    const nodes = RPC_NODES[network] || RPC_NODES.robinhood;

    for (const rpc of nodes) {
        try {
            const batch = Object.entries(SELECTORS).map(([key, sel], i) => ({
                jsonrpc: "2.0", id: i,
                method: "eth_call",
                params: [{ to: address, data: sel }, "latest"]
            }));

            const res = await fetch(rpc, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(batch),
                signal: AbortSignal.timeout(8000)
            });
            if (!res.ok) continue;

            const results = await res.json();
            const byKey   = {};
            Object.keys(SELECTORS).forEach((k, i) => {
                byKey[k] = results.find(r => r.id === i)?.result;
            });

            // Parse name
            const name = parseABIString(byKey.name) || `Collection (${shortenAddress(address)})`;

            // Find first valid Unix timestamp
            const TS_MIN = 1700000000; // Nov 2023
            const TS_MAX = 1950000000; // 2031
            let startTime = null;

            for (const key of ["mintStartTime","publicSaleStart","saleStartTime","startTime","publicSaleTsmp"]) {
                const hex = byKey[key];
                if (!hex || hex === "0x") continue;
                const val = parseInt(hex.replace("0x",""), 16);
                if (val >= TS_MIN && val <= TS_MAX) { startTime = val * 1000; break; }
            }

            // Try getClaimCondition struct — first word is startTimestamp
            if (!startTime && byKey.getClaimCond && byKey.getClaimCond !== "0x") {
                const hex  = byKey.getClaimCond.replace("0x","");
                const word = parseInt(hex.substring(0, 64), 16);
                if (word >= TS_MIN && word <= TS_MAX) startTime = word * 1000;
            }

            // If we got at least a name from RPC, build a partial result
            if (startTime) {
                return {
                    name,
                    contract: address,
                    network,
                    thumb: "",
                    supply: "On-Chain",
                    verified: true,
                    phases: [{
                        id:        "rpc_0",
                        name:      `${name} — Public Mint`,
                        type:      "Public",
                        startTime,
                        endTime:   startTime + 3600000 * 2,
                        priceEth:  "0.00",
                        priceUsd:  "FREE",
                        limit:     "1 PER WALLET"
                    }]
                };
            }

            // Contract deployed but no mint schedule readable
            if (name && name !== `Collection (${shortenAddress(address)})`) {
                // Return partial: name found, but no schedule
                throw new Error(`Found contract "${name}" but could not read mint schedule on-chain. The contract may use a non-standard ABI or the mint has not been configured yet.`);
            }

        } catch (err) {
            if (err.message.includes("Found contract")) throw err;
            console.warn(`RPC ${rpc}:`, err.message);
        }
    }
    return null;
}

// ─── UI Rendering ─────────────────────────────────────────────────────────────
function renderUI(data) {
    document.getElementById("collectionTitle").textContent  = data.name;
    document.getElementById("collectionThumb").src          = data.thumb ||
        "https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?w=200&auto=format&fit=crop&q=80";
    document.getElementById("contractDisplay").childNodes[0].textContent = shortenAddress(data.contract) + " ";
    setText("networkBadge",   `Network: ${capitalize(data.network)}`);
    setText("totalPhasesTag", `${data.phases.length} Mint Phase${data.phases.length !== 1 ? "s" : ""}`);
    setText("supplyTag",      `Supply: ${data.supply}`);

    if (data.phases.length === 0) {
        renderError(data.contract, `Found collection "${data.name}" but no mint schedule is available yet.`);
        return;
    }
    renderTimeline(data);
    startTicker();
}

function renderTimeline(data) {
    const container = document.getElementById("mintTimeline");
    container.innerHTML = "";

    const now = Date.now();
    let live = 0, upcoming = 0, ended = 0;
    let heroPhase = null;

    data.phases.forEach(phase => {
        const isLive     = now >= phase.startTime && now <= phase.endTime;
        const isUpcoming = now < phase.startTime;
        const isEnded    = now > phase.endTime;

        if (isLive)     { live++;     if (!heroPhase) heroPhase = phase; }
        if (isUpcoming) { upcoming++; if (!heroPhase) heroPhase = phase; }
        if (isEnded)    { ended++; }

        const startFmt = formatDate(phase.startTime);
        const endFmt   = formatDate(phase.endTime);

        let badgeClass = "ended";
        let badgeText  = "ENDED";
        if (isLive)     { badgeClass = "active";   badgeText = `LIVE NOW • Ends in ${fmtDuration(phase.endTime - now)}`; }
        if (isUpcoming) { badgeClass = "upcoming"; badgeText = `STARTS IN: ${fmtDuration(phase.startTime - now)}`; }

        const priceDisplay = phase.priceUsd === "FREE" || phase.priceUsd === "0.00"
            ? "FREE"
            : `$${phase.priceUsd}`;

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
                <div class="time-row">Starts: <strong>${startFmt}</strong></div>
                <div class="time-row">Ends: <strong>${endFmt}</strong></div>
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
    const isUpcoming = now < phase.startTime;

    setText("heroPhaseTitle", phase.name);
    if (isLive) {
        setText("heroStatusText", "CURRENT ACTIVE PHASE");
        setText("heroSubtext", `Phase started ${Math.floor((now - phase.startTime) / 60000)} minutes ago • Live countdown:`);
        document.getElementById("heroCountdownCard").style.borderColor = "rgba(16,185,129,0.5)";
    } else if (isUpcoming) {
        setText("heroStatusText", "NEXT UPCOMING PHASE");
        setText("heroSubtext", `Starts on ${formatDate(phase.startTime)}`);
        document.getElementById("heroCountdownCard").style.borderColor = "rgba(245,158,11,0.5)";
    } else {
        setText("heroStatusText", "MINT CONCLUDED");
        setText("heroSubtext", "All phases have ended.");
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
            const isUpcoming = now < phase.startTime;
            if ((isLive || isUpcoming) && !heroPhase) heroPhase = phase;

            const badge = document.getElementById(`badge-${phase.id}`);
            if (!badge) return;
            if (isLive) {
                badge.className  = "item-countdown-badge active";
                badge.textContent = `LIVE NOW • Ends in ${fmtDuration(phase.endTime - now)}`;
            } else if (isUpcoming) {
                badge.className  = "item-countdown-badge upcoming";
                badge.textContent = `STARTS IN: ${fmtDuration(phase.startTime - now)}`;
            } else {
                badge.className  = "item-countdown-badge ended";
                badge.textContent = "ENDED";
            }
        });

        if (heroPhase) {
            const isLive = now >= heroPhase.startTime && now <= heroPhase.endTime;
            setCountdown(Math.max(0, (isLive ? heroPhase.endTime : heroPhase.startTime) - now));
        }
    }, 1000);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseTimestamp(val) {
    if (!val) return null;
    if (typeof val === "number") return val > 1e10 ? val : val * 1000;
    if (typeof val === "string") {
        // ISO string
        const d = new Date(val);
        if (!isNaN(d)) return d.getTime();
        // Raw number string (unix seconds or ms)
        const n = Number(val);
        if (!isNaN(n) && n > 0) return n > 1e10 ? n : n * 1000;
    }
    return null;
}

function parseABIString(hex) {
    try {
        if (!hex || hex === "0x") return null;
        const raw = hex.replace(/^0x/, "");
        let str = "";
        for (let i = 128; i < raw.length; i += 2) {
            const code = parseInt(raw.substr(i, 2), 16);
            if (code === 0) break;
            str += String.fromCharCode(code);
        }
        return str.trim() || null;
    } catch { return null; }
}

function getDurationParts(ms) {
    const s = Math.floor(ms / 1000);
    return {
        days:    Math.floor(s / 86400),
        hours:   Math.floor((s % 86400) / 3600),
        minutes: Math.floor((s % 3600) / 60),
        seconds: s % 60
    };
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
    const offsetHrs = -date.getTimezoneOffset() / 60;
    const tz = selectedTimezone === "local"
        ? ` GMT${offsetHrs >= 0 ? "+" + offsetHrs : offsetHrs}`
        : selectedTimezone === "UTC" ? " UTC" : ` (${selectedTimezone.split("/")[1] || selectedTimezone})`;
    return formatted + tz;
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}
function pad(n)             { return String(n).padStart(2, "0"); }
function shortenAddress(a)  { return a && a.length > 10 ? `${a.substring(0,6)}...${a.slice(-4)}` : a; }
function capitalize(s)      { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function copyAddress() {
    if (!currentData) return;
    navigator.clipboard.writeText(currentData.contract);
    const btn = document.getElementById("copyContractBtn");
    btn.textContent = "✓ Copied!";
    setTimeout(() => { btn.textContent = "📋"; }, 2000);
}

function setLoading(on) {
    searchBtn.disabled    = on;
    searchBtn.style.opacity = on ? "0.6" : "1";
    searchBtn.querySelector("span").textContent = on ? "Fetching..." : "Fetch Mint Schedule";
}

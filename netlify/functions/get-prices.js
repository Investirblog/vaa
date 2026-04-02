const https = require("https");
 
const ETFS = {
  offensive: [
    { isin: "IE000XZSV718", ticker: "SPYL.L", shortName: "S&P 500", name: "SPDR S&P 500", type: "equity" },
    { isin: "IE0006WW1TQ4", ticker: "EXUS.DE", shortName: "World ex-US", name: "MSCI World ex-USA", type: "equity" },
    { isin: "IE00BKM4GZ66", ticker: "EIMI.L", shortName: "Émergents", name: "iShares MSCI EM IMI", type: "equity" },
    { isin: "IE00BDBRDM35", ticker: "AGGG.L", shortName: "Global Agg EUR", name: "iShares Global Aggregate EUR Hdg", type: "bond" },
  ],
  defensive: [
    { isin: "IE00BF59RX87", ticker: "JREB.MI", shortName: "Corp Bond EUR", name: "JPMorgan EUR Corp Bond", type: "bond" },
    { isin: "IE00BMYHQM42", ticker: "GOVA.AS", shortName: "Govt Bond EUR", name: "SPDR Bloomberg Euro Govt Bond", type: "bond" },
    { isin: "CASH", ticker: "CASH", shortName: "Cash", name: "Liquidités (MeDirect)", type: "cash" },
  ],
};
 
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Cache-Control": "no-cache",
      },
    };
    const req = https.get(url, options, (res) => {
      // Handle redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}
 
// Try v8 API first, fallback to v7
async function fetchYahoo(ticker) {
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = Math.floor((Date.now() - 15 * 31 * 24 * 60 * 60 * 1000) / 1000);
 
  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${period1}&period2=${period2}&interval=1mo&includePrePost=false`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${period1}&period2=${period2}&interval=1mo&includePrePost=false`,
    `https://query1.finance.yahoo.com/v7/finance/download/${ticker}?period1=${period1}&period2=${period2}&interval=1mo&events=history`,
  ];
 
  for (const url of urls) {
    try {
      const raw = await fetchUrl(url);
      console.log(`[${ticker}] URL: ${url.substring(0, 60)} — Response length: ${raw.length} — Start: ${raw.substring(0, 80)}`);
      if (raw.length < 50) continue;
 
      // Try JSON parse (v8 API)
      if (raw.startsWith("{")) {
        const json = JSON.parse(raw);
        if (json?.chart?.result?.[0]) return { format: "v8", data: json };
        if (json?.chart?.error) {
          console.log(`[${ticker}] Yahoo error: ${JSON.stringify(json.chart.error)}`);
          continue;
        }
      }
 
      // Try CSV parse (v7 download)
      if (raw.includes("Date,Open")) {
        return { format: "csv", data: raw };
      }
    } catch (e) {
      console.log(`[${ticker}] Fetch error for ${url}: ${e.message}`);
    }
  }
  return null;
}
 
function parseV8(data) {
  const result = data?.chart?.result?.[0];
  if (!result) return null;
  const timestamps = result.timestamp || result.timestamps;
  const closes = result.indicators?.adjclose?.[0]?.adjclose || result.indicators?.quote?.[0]?.close;
  if (!timestamps || !closes) return null;
  return timestamps
    .map((t, i) => ({ date: new Date(t * 1000), price: closes[i] }))
    .filter((d) => d.price != null)
    .sort((a, b) => b.date - a.date);
}
 
function parseCSV(csv) {
  const lines = csv.trim().split("\n").slice(1); // skip header
  return lines
    .map((line) => {
      const parts = line.split(",");
      const date = new Date(parts[0]);
      const close = parseFloat(parts[4]); // Adj Close column
      return { date, price: isNaN(close) ? null : close };
    })
    .filter((d) => d.price != null)
    .sort((a, b) => b.date - a.date);
}
 
async function getMonthlyPrices(ticker) {
  if (ticker === "CASH") return { ticker, prices: null, isCash: true };
  try {
    const result = await fetchYahoo(ticker);
    if (!result) return { ticker, prices: null, error: "No response from Yahoo" };
 
    let prices;
    if (result.format === "v8") {
      prices = parseV8(result.data);
    } else {
      prices = parseCSV(result.data);
    }
 
    if (!prices || prices.length === 0) return { ticker, prices: null, error: "Empty price array" };
    console.log(`[${ticker}] OK — ${prices.length} monthly points, latest: ${prices[0]?.price}`);
    return { ticker, prices };
  } catch (e) {
    console.log(`[${ticker}] Exception: ${e.message}`);
    return { ticker, prices: null, error: e.message };
  }
}
 
function computeScore(prices) {
  if (!prices || prices.length < 13) return null;
  const p0 = prices[0].price;
  const p1 = prices[1]?.price;
  const p3 = prices[3]?.price;
  const p6 = prices[6]?.price;
  const p12 = prices[12]?.price;
  if (!p1 || !p3 || !p6 || !p12) return null;
  return 12 * (p0 / p1 - 1) + 4 * (p0 / p3 - 1) + 2 * (p0 / p6 - 1) + (p0 / p12 - 1);
}
 
function computeMM10(prices) {
  if (!prices || prices.length < 11) return null;
  const last10 = prices.slice(1, 11);
  return last10.reduce((s, d) => s + d.price, 0) / 10;
}
 
const handler = async function (event, context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };
  try {
    const allEtfs = [...ETFS.offensive, ...ETFS.defensive];
    const results = await Promise.all(allEtfs.map((e) => getMonthlyPrices(e.ticker)));
    const priceMap = {};
    results.forEach((r) => { priceMap[r.ticker] = r; });
 
    const enriched = allEtfs.map((etf) => {
      if (etf.ticker === "CASH") return { ...etf, isCash: true, score13612W: null, mm10: null, aboveMM10: null, currentPrice: null, priceChange1M: null };
      const prices = priceMap[etf.ticker]?.prices;
      const currentPrice = prices?.[0]?.price ?? null;
      const score = computeScore(prices);
      const mm10 = computeMM10(prices);
      const priceChange1M = prices?.[1] ? ((prices[0].price - prices[1].price) / prices[1].price) * 100 : null;
      return {
        ...etf,
        currentPrice: currentPrice ? Math.round(currentPrice * 100) / 100 : null,
        score13612W: score !== null ? Math.round(score * 10000) / 10000 : null,
        mm10: mm10 !== null ? Math.round(mm10 * 100) / 100 : null,
        aboveMM10: mm10 !== null && currentPrice !== null ? currentPrice > mm10 : null,
        priceChange1M: priceChange1M !== null ? Math.round(priceChange1M * 100) / 100 : null,
        error: priceMap[etf.ticker]?.error || null,
        lastDate: prices?.[0]?.date || null,
      };
    });
 
    const offensiveResults = enriched.filter((e) => ETFS.offensive.find((o) => o.ticker === e.ticker));
    const defensiveResults = enriched.filter((e) => ETFS.defensive.find((d) => d.ticker === e.ticker));
    const negativeCount = offensiveResults.filter((e) => e.score13612W !== null && e.score13612W < 0).length;
 
    let vaaMode, vaaReco;
    if (offensiveResults.every((e) => e.score13612W !== null) && negativeCount === 0) {
      const best = [...offensiveResults].sort((a, b) => b.score13612W - a.score13612W)[0];
      vaaMode = "OFFENSIF"; vaaReco = best?.shortName || "—";
    } else if (negativeCount > 0) {
      const bestDef = defensiveResults.filter((e) => !e.isCash && e.score13612W !== null).sort((a, b) => b.score13612W - a.score13612W)[0];
      vaaMode = "DÉFENSIF"; vaaReco = bestDef && bestDef.score13612W > 0 ? bestDef.shortName : "Cash (MeDirect)";
    } else {
      vaaMode = "INCONNU"; vaaReco = "Données insuffisantes";
    }
 
    const faberNeg = offensiveResults.filter((e) => e.aboveMM10 === false).length;
    let faberMode, faberReco;
    if (faberNeg >= 2) {
      const bestDef = defensiveResults.filter((e) => !e.isCash && e.score13612W !== null).sort((a, b) => b.score13612W - a.score13612W)[0];
      faberMode = "DÉFENSIF"; faberReco = bestDef && bestDef.score13612W > 0 ? bestDef.shortName : "Cash (MeDirect)";
    } else {
      const held = offensiveResults.filter((e) => e.aboveMM10 === true);
      faberMode = "OFFENSIF"; faberReco = held.map((e) => e.shortName).join(" + ") || "Attendre signal";
    }
 
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        etfs: { offensive: offensiveResults, defensive: defensiveResults },
        vaa: { mode: vaaMode, recommendation: vaaReco, negativeCount, breadthScore: `${negativeCount}/4 scores négatifs` },
        faber: { mode: faberMode, recommendation: faberReco, negativeCount: faberNeg, breadthScore: `${faberNeg}/4 sous MM10` },
        updatedAt: new Date().toISOString(),
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
 
module.exports = { handler };

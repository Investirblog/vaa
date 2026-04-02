const https = require("https");

const ETFS = {
  offensive: [
    { isin: "IE000XZSV718", ticker: "SPYL.L", shortName: "S&P 500", name: "SPDR S&P 500", type: "equity" },
    { isin: "IE0006WW1TQ4", ticker: "EXUS.DE", shortName: "World ex-US", name: "MSCI World ex-USA", type: "equity" },
    { isin: "IE00BKM4GZ66", ticker: "EIMI.L", shortName: "Émergents", name: "iShares MSCI EM IMI", type: "equity" },
    { isin: "IE00BDBRDM35", ticker: "0GGH.L", shortName: "Global Agg EUR", name: "iShares Global Aggregate EUR Hdg", type: "bond" },
  ],
  defensive: [
    { isin: "IE00BF59RX87", ticker: "IEBC.AS", shortName: "Corp Bond EUR", name: "iShares € Corp Bond", type: "bond" },
    { isin: "IE00BMYHQM42", ticker: "GOVA.AS", shortName: "Govt Bond EUR", name: "SPDR Bloomberg Euro Govt Bond", type: "bond" },
    { isin: "CASH", ticker: "CASH", shortName: "Cash", name: "Liquidités (MeDirect)", type: "cash" },
  ],
};

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
      },
    };
    https.get(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

async function getMonthlyPrices(ticker) {
  if (ticker === "CASH") return { ticker, prices: null, isCash: true };
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = Math.floor((Date.now() - 14 * 31 * 24 * 60 * 60 * 1000) / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${period1}&period2=${period2}&interval=1mo`;
  try {
    const raw = await fetchUrl(url);
    const json = JSON.parse(raw);
    const result = json?.chart?.result?.[0];
    if (!result) return { ticker, prices: null, error: "No result" };
    const timestamps = result.timestamp || result.timestamps;
    const closes = result.indicators?.adjclose?.[0]?.adjclose || result.indicators?.quote?.[0]?.close;
    if (!timestamps || !closes) return { ticker, prices: null, error: "No OHLC" };
    const monthly = timestamps
      .map((t, i) => ({ date: new Date(t * 1000), price: closes[i] }))
      .filter((d) => d.price != null)
      .sort((a, b) => b.date - a.date);
    return { ticker, prices: monthly };
  } catch (e) {
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

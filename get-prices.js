const https = require("https");

// ETF configuration
const ETFS = {
  offensive: [
    {
      isin: "IE000XZSV718",
      ticker: "SPYL.L",
      name: "SPDR S&P 500",
      shortName: "S&P 500",
      type: "equity",
    },
    {
      isin: "IE0006WW1TQ4",
      ticker: "EXUS.DE",
      name: "MSCI World ex-USA",
      shortName: "World ex-US",
      type: "equity",
    },
    {
      isin: "IE00BKM4GZ66",
      ticker: "EIMI.L",
      name: "iShares MSCI EM IMI",
      shortName: "Émergents",
      type: "equity",
    },
    {
      isin: "IE00BDBRDM35",
      ticker: "AGGH.L",
      name: "iShares Global Aggregate EUR Hdg",
      shortName: "Global Agg EUR",
      type: "bond",
    },
  ],
  defensive: [
    {
      isin: "IE00BF59RX87",
      ticker: "IEBC.AS",
      name: "iShares € Corp Bond",
      shortName: "Corp Bond EUR",
      type: "bond",
    },
    {
      isin: "IE00BMYHQM42",
      ticker: "GLDE.DE",
      name: "SPDR Bloomberg Euro Govt Bond",
      shortName: "Govt Bond EUR",
      type: "bond",
    },
    {
      isin: "CASH",
      ticker: "CASH",
      name: "Liquidités (MeDirect)",
      shortName: "Cash",
      type: "cash",
    },
  ],
};

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
      },
    };
    https
      .get(url, options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

async function getMonthlyPrices(ticker, monthsNeeded = 14) {
  if (ticker === "CASH") {
    return { ticker, prices: null, isCash: true };
  }

  const period2 = Math.floor(Date.now() / 1000);
  const period1 = Math.floor(
    (Date.now() - monthsNeeded * 31 * 24 * 60 * 60 * 1000) / 1000
  );
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${period1}&period2=${period2}&interval=1mo`;

  try {
    const raw = await fetchUrl(url);
    const json = JSON.parse(raw);
    const result = json?.chart?.result?.[0];
    if (!result) return { ticker, prices: null, error: "No data" };

    const timestamps = result.timestamps || result.timestamp;
    const closes =
      result.indicators?.adjclose?.[0]?.adjclose ||
      result.indicators?.quote?.[0]?.close;

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

function computeScore13612W(prices) {
  if (!prices || prices.length < 13) return null;
  const p0 = prices[0].price;
  const p1 = prices[1].price;
  const p3 = prices[3]?.price;
  const p6 = prices[6]?.price;
  const p12 = prices[12]?.price;
  if (!p1 || !p3 || !p6 || !p12) return null;
  return (
    12 * (p0 / p1 - 1) +
    4 * (p0 / p3 - 1) +
    2 * (p0 / p6 - 1) +
    (p0 / p12 - 1)
  );
}

function computeMM10(prices) {
  if (!prices || prices.length < 11) return null;
  const last10 = prices.slice(1, 11);
  const avg = last10.reduce((s, d) => s + d.price, 0) / 10;
  return avg;
}

exports.handler = async function (event, context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  try {
    const allEtfs = [...ETFS.offensive, ...ETFS.defensive];
    const results = await Promise.all(
      allEtfs.map((etf) => getMonthlyPrices(etf.ticker))
    );

    const priceMap = {};
    results.forEach((r) => {
      priceMap[r.ticker] = r;
    });

    const enriched = allEtfs.map((etf) => {
      if (etf.ticker === "CASH") {
        return {
          ...etf,
          currentPrice: null,
          score13612W: null,
          mm10: null,
          isCash: true,
          // Cash rate annualisé ~1.30% → score mensuel approximatif
          cashRateAnnual: 1.3,
        };
      }

      const priceData = priceMap[etf.ticker];
      const prices = priceData?.prices;
      const currentPrice = prices?.[0]?.price ?? null;
      const score = computeScore13612W(prices);
      const mm10 = computeMM10(prices);
      const priceChange1M =
        prices && prices[1]
          ? ((prices[0].price - prices[1].price) / prices[1].price) * 100
          : null;

      return {
        ...etf,
        currentPrice,
        score13612W: score !== null ? Math.round(score * 10000) / 10000 : null,
        mm10: mm10 !== null ? Math.round(mm10 * 100) / 100 : null,
        aboveMM10: mm10 !== null && currentPrice !== null ? currentPrice > mm10 : null,
        priceChange1M:
          priceChange1M !== null
            ? Math.round(priceChange1M * 100) / 100
            : null,
        error: priceData?.error || null,
        lastDate: prices?.[0]?.date || null,
      };
    });

    // VAA decision logic
    const offensiveResults = enriched.filter((e) =>
      ETFS.offensive.find((o) => o.ticker === e.ticker)
    );
    const defensiveResults = enriched.filter((e) =>
      ETFS.defensive.find((d) => d.ticker === e.ticker)
    );

    const negativeCount = offensiveResults.filter(
      (e) => e.score13612W !== null && e.score13612W < 0
    ).length;

    const unknownCount = offensiveResults.filter(
      (e) => e.score13612W === null && !e.isCash
    ).length;

    let mode, recommendation, breadthScore;

    breadthScore = `${negativeCount}/4 scores négatifs`;

    if (unknownCount > 0) {
      mode = "UNKNOWN";
      recommendation = "Données insuffisantes pour décider";
    } else if (negativeCount === 0) {
      // All positive → best offensive
      const bestOffensive = offensiveResults
        .filter((e) => e.score13612W !== null)
        .sort((a, b) => b.score13612W - a.score13612W)[0];
      mode = "OFFENSIF";
      recommendation = bestOffensive?.shortName || "—";
    } else {
      // Any negative → best defensive
      const bestDefensive = defensiveResults
        .filter((e) => !e.isCash && e.score13612W !== null)
        .sort((a, b) => b.score13612W - a.score13612W)[0];

      mode = "DÉFENSIF";
      if (bestDefensive && bestDefensive.score13612W > 0) {
        recommendation = bestDefensive.shortName;
      } else {
        recommendation = "Cash (MeDirect)";
      }
    }

    // Also compute Faber hybrid signal
    const faberNegativeCount = offensiveResults.filter(
      (e) => e.aboveMM10 === false
    ).length;

    let faberMode, faberReco;
    if (faberNegativeCount >= 2) {
      const bestDefFaber = defensiveResults
        .filter((e) => !e.isCash && e.score13612W !== null)
        .sort((a, b) => b.score13612W - a.score13612W)[0];
      faberMode = "DÉFENSIF";
      faberReco =
        bestDefFaber && bestDefFaber.score13612W > 0
          ? bestDefFaber.shortName
          : "Cash (MeDirect)";
    } else {
      const faberOffensiveHeld = offensiveResults.filter(
        (e) => e.aboveMM10 === true
      );
      faberMode = "OFFENSIF";
      faberReco =
        faberOffensiveHeld.map((e) => e.shortName).join(" + ") ||
        "Attendre signal";
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        etfs: { offensive: offensiveResults, defensive: defensiveResults },
        vaa: { mode, recommendation, breadthScore, negativeCount },
        faber: {
          mode: faberMode,
          recommendation: faberReco,
          negativeCount: faberNegativeCount,
          breadthScore: `${faberNegativeCount}/4 sous MM10`,
        },
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

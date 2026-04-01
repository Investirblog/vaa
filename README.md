# VAA Tracker

Outil de suivi de la stratégie Vigilant Asset Allocation (Keller & Keuning) adapté aux ETFs UCITS pour investisseurs belges/européens.

## ETFs configurés

### Univers offensif
| Poste | ISIN | Nom |
|---|---|---|
| S&P 500 | IE000XZSV718 | SPDR S&P 500 UCITS (Acc) |
| World ex-US | IE0006WW1TQ4 | MSCI World ex-USA (Acc) |
| Émergents | IE00BKM4GZ66 | iShares Core MSCI EM IMI (Acc) |
| Global Agg | IE00BDBRDM35 | iShares Global Aggregate EUR Hedged (Acc) |

### Univers défensif
| Poste | ISIN | Nom |
|---|---|---|
| Corp Bond | IE00BF59RX87 | iShares € Corp Bond (Acc) |
| Govt Bond | IE00BMYHQM42 | SPDR Bloomberg Euro Govt Bond (Acc) |
| Cash | — | MeDirect (compte épargne 1,30%) |

## Deux stratégies affichées

**VAA pure** : si 1+ ETF offensif a un score 13612W < 0 → 100% sur le meilleur défensif.

**Faber + Breadth** : si 2+ ETFs offensifs sous leur MM10 mensuelle → bascule défensif. Sinon, on détient les ETFs offensifs au-dessus de la MM10.

## Déploiement Netlify

1. Crée un repo GitHub avec ce dossier
2. Connecte-le à Netlify (Build: `public/`, Functions: `netlify/functions/`)
3. Déploie — pas de variable d'environnement nécessaire

## Usage local

```bash
npm install -g netlify-cli
netlify dev
```

## Tickers Yahoo Finance utilisés

| ISIN | Ticker Yahoo |
|---|---|
| IE000XZSV718 | SPYL.L |
| IE0006WW1TQ4 | EXUS.DE |
| IE00BKM4GZ66 | EIMI.L |
| IE00BDBRDM35 | AGGH.L |
| IE00BF59RX87 | IEBC.AS |
| IE00BMYHQM42 | GLDE.DE |

> Note : les tickers Yahoo peuvent changer. Vérifier sur finance.yahoo.com si une valeur retourne null.

## Fréquence d'utilisation

Une fois par mois, en fin de mois sur clôture. Ne pas re-vérifier en cours de mois.

# Zoltar operator bots

This directory holds three independent operator services and the code they share. This page owns the behaviour that is identical across them; each bot's own README covers everything else.

| Directory | Service | Dashboard |
| --- | --- | --- |
| [`chaos/`](./chaos/README.md) | Randomized transaction operator for Zoltar, Statoblast, OpenOracle, and Trading | `http://127.0.0.1:4193` |
| [`liquidator/`](./liquidator/README.md) | Statoblast security-pool liquidation and REP vault maintenance | `http://127.0.0.1:4183` |
| [`open-oracle-arbitrager/`](./open-oracle-arbitrager/README.md) | OpenOracle dispute arbitrage and third-party settlement | `http://127.0.0.1:4173` |
| `shared/` | Ethereum, connectivity, quorum, block synchronization, signer gate, dashboard, and transaction-submission primitives | — |

## Contents

- [Install](#install)
- [Environment variables](#environment-variables)
- [Signer lock](#signer-lock)
- [RPC agreement requirement](#rpc-agreement-requirement)
- [Dashboard access](#dashboard-access)
- [Shared configuration sections](#shared-configuration-sections)
- [Independent market consensus](#independent-market-consensus)

## Install

The bots are workspaces of the repository root, so one install from the root covers all of them:

```bash
bun install --frozen-lockfile
cd bots/<bot>
```

Each bot also ships a Compose service. Every Compose project joins the external `zoltar` network and mounts the external `zoltar-bot-signer-locks` volume, so create both once per Docker host:

```bash
docker network inspect zoltar >/dev/null 2>&1 || docker network create zoltar
docker volume create zoltar-bot-signer-locks >/dev/null
```

Compose restarts a container only while Docker and the host remain available. A direct Bun process needs an external supervisor.

## Environment variables

Operator settings live in each bot's JSON file. The environment supplies only the values below.

| Variable | Applies to | Default | Effect |
| --- | --- | --- | --- |
| `ZOLTAR_CHAOS_CONFIG` | chaos | `bots/chaos/.state/operator.json` | Path of the operator file. |
| `ZOLTAR_LIQUIDATOR_CONFIG` | liquidator | `bots/liquidator/.state/operator.json` | Path of the operator file. |
| `OPEN_ORACLE_ARBITRAGER_CONFIG` | arbitrager | `bots/open-oracle-arbitrager/.state/operator.json` | Path of the operator file. |
| `ZOLTAR_BOT_SIGNER_LOCK_ROOT` | all | `zoltar-bot-locks` under the system temporary directory | Directory of the chain-and-signer lock. See [signer lock](#signer-lock). |
| `ZOLTAR_BOT_RPC_QUORUM` | all | `1` | `1` or `2`. Supplies the agreement requirement only when the operator file omits `connectivity.rpcQuorum`. Any other value stops settings parsing. |
| `SCAN_BLOCK_TIME_MS` | all | `12000` on Mainnet and Sepolia; none on other chains | Positive integer. Block interval, in milliseconds, that the scan status log uses to report a scan as lagging. Without a value on another chain, the log reports lag only from the observed head distance. |
| `ZOLTAR_BOT_DASHBOARD_LOOPBACK_PUBLISHED` | all | unset | `true` asserts that a `0.0.0.0` container listener is published only on host loopback. See [dashboard access](#dashboard-access). |
| `ZOLTAR_BOT_DASHBOARD_PASSWORD` | liquidator, arbitrager | unset | HTTP Basic password for a network-bound dashboard. Chaos ignores it. |
| `ZOLTAR_BOT_DASHBOARD_PUBLIC_AUTHORITY` | liquidator, arbitrager | unset | Host and port that browsers use to reach a network-bound dashboard. Chaos ignores it. |

The shipped Compose services set `ZOLTAR_BOT_DASHBOARD_LOOPBACK_PUBLISHED` and `ZOLTAR_BOT_SIGNER_LOCK_ROOT`. The chaos and liquidator services also pass `ZOLTAR_BOT_RPC_QUORUM` through from the host; the arbitrager service does not, because the arbitrager keeps its agreement requirement in its saved settings. None of them forwards `SCAN_BLOCK_TIME_MS`; add it to the service's `environment` to use it in a container.

## Signer lock

Every bot takes one chain-and-signer lock before it uses a signer, so two processes cannot sign with the same key on the same chain.

- Compose sets `ZOLTAR_BOT_SIGNER_LOCK_ROOT=.state/process-locks` and mounts the fixed `zoltar-bot-signer-locks` volume there. The chaos, liquidator, and arbitrager containers on one Docker host therefore share one lock, even across Compose project names.
- A direct Bun process uses `ZOLTAR_BOT_SIGNER_LOCK_ROOT` when it is set to a non-empty path (an operator-owned directory with mode `0700`), otherwise a `zoltar-bot-locks` directory under the system temporary directory.
- Processes that share a signer must resolve the same lock root. The lock does not fence another host: use one signer per host or add an external lease.
- Any manually created container must mount `zoltar-bot-signer-locks` at `.state/process-locks`.

If the host or state storage is lost, restore the complete bot state before resuming live execution with the same signer. Do not reuse that signer from incomplete recovery state.

## RPC agreement requirement

`connectivity.rpcQuorum` is saved per operator file or chain profile and is `1` or `2`.

- **`1` (default).** The primary `readRpcUrl` is sufficient; `quorumRpcUrls` is optional corroboration. The bot trusts that provider completely.
- **`2`.** Live execution requires at least two `quorumRpcUrls` in addition to the primary reader, three read endpoints in total. Every read endpoint must use a distinct origin; a different path on one origin is not an independent provider.

Under either setting, only a retryable transport failure makes a reader unavailable. The configured number of readers must respond and every responding reader must agree exactly before a transaction is signed. Under `2`, one transport-unavailable reader is reported as degraded without stopping an otherwise healthy two-reader quorum. A malformed or contradictory response is a safety fault and fails closed.

Agreement catches disagreement between providers. It does not help when every endpoint shares one compromised upstream, implementation bug, or correlated failure, so use independently operated providers.

Chaos applies stricter rules to the same setting; see its [RPC and submission configuration](./chaos/OPERATOR_REFERENCE.md#rpc-and-submission-configuration).

## Dashboard access

Each dashboard controls signer and execution settings. Do not publish one on a public interface.

- **Native loopback.** `runtime.uiHost: "127.0.0.1"` needs no password.
- **Shipped Compose service.** The process listens on the container interface while Docker publishes the port only on host loopback, and `ZOLTAR_BOT_DASHBOARD_LOOPBACK_PUBLISHED=true` asserts that pairing. No password is required. Connect from another machine through a trusted tunnel to the host rather than changing the port binding.
- **Network-bound listener (liquidator and arbitrager only).** With `runtime.uiHost: "0.0.0.0"` and no loopback assertion, startup requires `ZOLTAR_BOT_DASHBOARD_PASSWORD` of at least 16 characters and `ZOLTAR_BOT_DASHBOARD_PUBLIC_AUTHORITY`. Set the authority to the exact browser authority, including the port when the browser URL includes one, for example `10.0.0.4:4183`. For a custom container, remove `ZOLTAR_BOT_DASHBOARD_LOOPBACK_PUBLISHED` and pass both variables explicitly. The browser's HTTP Basic prompt uses username `operator` and that password.
- **Chaos.** The chaos dashboard has no password. A `0.0.0.0` listener starts only with the loopback assertion; keep it loopback-only or behind an access-controlled encrypted tunnel.

Basic authentication protects access but does not encrypt the private key or settings in transit. Keep a network-bound listener on a trusted network or behind an authenticated TLS proxy. Mutating requests must also be same-origin and arrive on the loopback or configured authority, and JSON request bodies are capped at 1 MiB.

`/healthz` reports process liveness without dashboard authentication. The Compose health checks use it.

Loopback RPC URLs refer to the container itself, so use a container-reachable RPC address when the node runs elsewhere. Do not attach a bot to a Docker network shared with untrusted containers, and do not bake private keys or RPC credentials into an image.

## Shared configuration sections

All three operator files use these two sections. A key without a default is required.

### `connectivity`

| Key | Type | Range | Default | Effect |
| --- | --- | --- | --- | --- |
| `readRpcUrl` | string | one URL | required | Primary read endpoint. |
| `publicRpcUrls` | string array | 1–8 URLs | required | Endpoints that receive public transaction broadcasts. Required even when submission is private. |
| `quorumRpcUrls` | string array | 0–8 URLs, each on an origin distinct from every other read endpoint | required | Independent readers. See [RPC agreement requirement](#rpc-agreement-requirement). |
| `rpcQuorum` | number | `1` or `2` | `ZOLTAR_BOT_RPC_QUORUM`, else `1` | Read agreement requirement. |

### `submission`

| Key | Type | Range | Default | Effect |
| --- | --- | --- | --- | --- |
| `mode` | string | `public` or `private` | required | Public mempool broadcast or private relay bundles. |
| `relayUrls` | string array | 0–8 URLs; at least one in private mode | required | Private relays. Each URL must use HTTPS or loopback HTTP and cannot embed credentials, query parameters, or fragments. |
| `minimumBundleRelaySuccesses` | number | `1`–`8` in public mode; `1` through the number of distinct relay origins in private mode | `1` | Number of distinct relay origins that must accept a private submission. |

## Independent market consensus

The liquidator and the arbitrager use the same market observer as an off-chain manipulation guard for the REP/ETH price. The guarded estimate never replaces an on-chain price in protocol arithmetic and never authorizes a transaction by itself.

### Centralized exchange sources

The observer uses CCXT's public unified `fetchTicker` and `fetchOrderBook` APIs; no exchange credentials are needed. Each `centralizedMarkets.sources` entry names one exchange:

```json
"sources": [
  { "exchangeId": "kraken", "repMarket": "REP/USD", "ethMarket": "ETH/USD" },
  { "exchangeId": "anotherexchange", "repMarket": "REP/ETH", "ethMarket": null }
]
```

- `exchangeId` is a lowercase CCXT exchange id and must be unique across sources.
- `repMarket` is a unified `REP/QUOTE` market.
- `ethMarket` must be exactly `ETH/<REP quote>` when REP is not quoted in ETH, and must be absent or `null` for a direct `REP/ETH` book.

Only configure symbols verified on that venue. The example names illustrate the schema and do not assert that a venue currently lists REP. Operators must also verify that each configured ticker represents the declared REP contract.

The bot converts each venue into REP per ETH, sums executable bid and ask depth inside `depthBps`, and uses the median of fresh venue prices. An estimate is reliable only with `minimumSourceCount` independent exchanges, the minimum two-sided depth, and no more than `maximumVenueDispersionBps` disagreement.

A cross-quoted observation is fresh only when both its REP order book and ETH ticker are fresh. Exchange-provided timestamps are retained, using the older one for a cross-quoted observation, so polling a cached response cannot extend freshness or satisfy the temporal-persistence rule. Required consensus does not admit an observation without a native order-book timestamp and, for cross quotes, a native ETH-ticker timestamp.

### DEX sources and group agreement

When `venueConsensus` is configured, the bot also reads each explicit constant-product REP/WETH pair in `dexSources` directly from the chain. It probes both trade directions at `dexProbeDepthEth` and grants one vote per distinct `sourceId`. Pair addresses are explicit so an untrusted discovery service cannot insert a venue. Multiple pools controlled by one venue must share a failure domain and receive one vote. CEX exchange ids and DEX source ids share one namespace, so one failure domain cannot vote in both groups.

```json
"venueConsensus": {
  "allowSingleGroupFallback": false,
  "dexProbeDepthEth": "1",
  "dexSources": [
    { "sourceId": "uniswap-v2", "pair": "0x0000000000000000000000000000000000000000", "feeBps": 30 },
    { "sourceId": "sushiswap-v2", "pair": "0x0000000000000000000000000000000000000000", "feeBps": 30 }
  ],
  "maximumGroupDeviationBps": 500,
  "minimumDexAskDepthEth": "0.5",
  "minimumDexBidDepthEth": "0.5",
  "minimumDexSourceCount": 2,
  "minimumSourceObservationCount": 2,
  "minimumSourceObservationSpanMilliseconds": 10000,
  "minimumTotalSourceCount": 3
}
```

The pair addresses above are placeholders.

The CEX and DEX groups are aggregated separately:

- If both groups are reliable, they must agree within `maximumGroupDeviationBps`.
- If both are coherent but disagree, or neither has quorum, price-dependent actions stop in required mode, because the bot cannot identify the truthful group.
- If one group is dispersed while the other has its quorum and the total source count, the coherent group supplies the reference only when `allowSingleGroupFallback` is enabled. Only sources in that group count toward the total-source quorum, and the dashboard warns that venue independence is reduced.

`minimumSourceObservationCount` and `minimumSourceObservationSpanMilliseconds` require each source to remain coherent across polls before it can vote, so a one-block or one-request spike cannot immediately become a trusted reference. The current price regime itself must persist for the configured count and span: old observations cannot warm up a newly changed price, and leaving then returning to an earlier regime restarts its history.

DEX reserve reads are pinned to the scanned canonical block. Polling the same block again cannot build persistence, and a changed canonical hash discards the accumulated DEX history. Immediately before a price-dependent action, the bot rereads the retained constant-product evidence at its exact block hash and requires every available configured RPC response to agree with the retained snapshot.

### Required and advisory modes

- **`requiredForExecution: true`.** `venueConsensus` is mandatory. The configuration is rejected unless `minimumSourceCount` is at least `2`, `minimumDexSourceCount` is at least `2`, `minimumTotalSourceCount` is at least `3`, the configured source lists can satisfy those minimums, `minimumSourceObservationCount` is at least `2`, and the observation span is at least one second and no longer than `maximumObservationAgeMilliseconds`. At run time the CEX, DEX, total-source, and temporal rules fail closed.
- **`requiredForExecution: false`.** Healthy independent evidence can still reject an outlying price, but unavailable or unreliable evidence is advisory.

Evidence is keyed by exact chain and REP token. Fork REP tokens without their own market evidence do not inherit the root token's estimate. Saving a new market configuration clears all accumulated evidence; replacement sources must establish their own temporal history.

### `centralizedMarkets` keys

Every key except `venueConsensus` is required, and inside `venueConsensus` every key is required. The code has no defaults for them; the Example value column shows `config/operator.example.json` in both bots. Amounts ending in `Eth` are decimal strings with at most 18 places, and every key ending in `Bps` is a JSON number.

| Key | Type | Range | Example value | Effect |
| --- | --- | --- | --- | --- |
| `assetSymbol` | string | `REP` | `REP` | Base asset of every `repMarket`. The root asset address and chain come from the selected network's deployment manifest and cannot be overridden. |
| `depthBps` | number | 1–5,000 | `500` | Price band around the order-book midpoint inside which depth counts as executable. |
| `maximumDexDeviationBps` | number | 1–10,000 | `1000` | Largest accepted distance between the price being checked (the coordinator price or the candidate hedge quote) and the guarded reference. |
| `maximumObservationAgeMilliseconds` | number | 1,000–3,600,000 | `30000` | Age after which an observation is stale. |
| `maximumVenueDispersionBps` | number | 1–10,000 | `500` | Largest accepted disagreement between venues in one group. |
| `minimumAskDepthEth`, `minimumBidDepthEth` | decimal string | ≥ 0 | `"2"` | Minimum CEX depth on each side. |
| `minimumSourceCount` | number | 1–100, not above the configured source count | `2` | Independent exchanges required for a reliable CEX estimate. |
| `orderBookLimit` | number | 1–1,000 | `20` | Order-book levels requested from each exchange. |
| `requestTimeoutMilliseconds` | number | 250–60,000 | `5000` | Timeout for each exchange request. |
| `requiredForExecution` | boolean | — | `false` | Selects required or advisory mode. |
| `sources` | array | distinct exchanges | `[]` | CEX sources. |
| `venueConsensus.allowSingleGroupFallback` | boolean | — | `false` | Permits a single coherent group to supply the reference. |
| `venueConsensus.dexProbeDepthEth` | decimal string | ≥ 0 | `"1"` | Trade size used to probe each pair in both directions. |
| `venueConsensus.dexSources` | array | distinct `sourceId` and `pair`; `feeBps` 0–1,000 | `[]` | Explicit constant-product REP/WETH pairs. |
| `venueConsensus.maximumGroupDeviationBps` | number | 1–10,000 | `500` | Largest accepted distance between the CEX and DEX groups. |
| `venueConsensus.minimumDexAskDepthEth`, `minimumDexBidDepthEth` | decimal string | ≥ 0 | `"0.5"` | Minimum DEX depth on each side. |
| `venueConsensus.minimumDexSourceCount` | number | 1–100 | `2` | Independent DEX sources required. |
| `venueConsensus.minimumSourceObservationCount` | number | 1–100 | `2` | Polls a source must remain coherent for. |
| `venueConsensus.minimumSourceObservationSpanMilliseconds` | number | 0–3,600,000 | `10000` | Time a source must remain coherent for. |
| `venueConsensus.minimumTotalSourceCount` | number | 2–200 | `3` | Independent sources required across both groups. |

### Adapter limitations

- Symbol availability, timestamps, rate limits, maintenance behaviour, and response quality remain exchange-specific. The unified API normalizes access but cannot make exchange data semantics identical.
- Operator-configured DEX sources are Uniswap-V2-style constant-product REP/WETH pairs. There is no configurable V3 or V4 source format.
- Single-group fallback weakens venue independence and is always surfaced as an operator warning.
- Required consensus fails closed. Missing depth, excessive dispersion, stale timestamps, insufficient persistence, asset mismatch, or a canonical-block failure can intentionally stop price-dependent actions.

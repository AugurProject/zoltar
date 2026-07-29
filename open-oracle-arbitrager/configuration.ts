import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getAddress, type Address, type Hex } from '@zoltar/shared/ethereum'
import { parseDeploymentManifest, type DeploymentManifest } from './deployment-auth.js'
import { validateConnectivitySettings, validateIndependentReadRpcUrls, type ConnectivitySettings } from './connectivity.js'
import { decimalWeth, parseDecimalWeth, updateStrategyFromRequest, type MutableStrategy } from './operator-state.js'
import { defaultRpcUrl, networkConfiguration, parseNetworkName, type NetworkConfiguration } from './network.js'
import { DEFAULT_RISK_LIMITS, type RiskLimits } from './safety-controls.js'
import { loadOperatorSettings } from './settings-store.js'
import { validateSubmissionSettings, type SubmissionSettings } from './transaction-submission.js'

export type Configuration = MutableStrategy & {
	connectivity: ConnectivitySettings
	coordinatorAddresses: Address[]
	deploymentManifest: DeploymentManifest | undefined
	execute: boolean
	executor: Address | undefined
	historyFile: string
	lookbackBlocks: bigint
	maxHedgeSlippageBps: bigint
	network: NetworkConfiguration
	once: boolean
	openOracle: Address
	paused: boolean
	persistedPrivateKey: Hex | undefined
	priceHistoryFile: string
	privateKey: Hex | undefined
	positionFile: string
	quorumRpcUrls: string[]
	riskLimits: RiskLimits
	router: Address | undefined
	settingsFile: string
	submission: SubmissionSettings
	tokenAddresses: Address[]
	ui: boolean
	uiPort: number
	v2Router: Address | undefined
}

function option(name: string) {
	const prefix = `--${name}=`
	return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length)
}

function options(name: string) {
	const prefix = `--${name}=`
	return process.argv.filter(argument => argument.startsWith(prefix)).map(argument => argument.slice(prefix.length))
}

function requiredAddress(name: string) {
	const value = option(name) ?? process.env['OPEN_ORACLE_ADDRESS']
	if (value === undefined) throw new Error(`Missing --${name}=0x... (or OPEN_ORACLE_ADDRESS)`)
	return getAddress(value)
}

export function printHelp() {
	console.log(`OpenOracle arbitrager

Usage:
  ./open-oracle-arbitrager/run --open-oracle=0x... [options]

Modes:
  --once                         Scan once and exit
  --ui                           Serve the local dashboard on 127.0.0.1
  --execute                      Submit guarded disputes (key from env or local UI)
  --executor-address=0x...       Deployed atomic arbitrage executor; required with --execute
  --coordinator-address=0x...    Approved Zoltar price coordinator; repeat as needed
  --deployment-manifest=PATH     Reviewed address and runtime-code-hash manifest
  --uniswap-router=0x...         Authenticated Uniswap V3 SwapRouter; required with --execute
  --uniswap-v2-router=0x...      Optional authenticated Uniswap V2 Router02 for best-route hedges
  --submission-mode=private|public Private bundles or one atomic public entry transaction
  --relay-url=https://...        Bundle relay URL; repeat for multiple relays
  --minimum-relay-successes=1   Private simulations required before bundle fanout

Strategy:
  --minimum-profit-weth=0.01     Absolute modeled net-profit floor
  --minimum-profit-bps=100       Return floor relative to direction-specific cost basis
  --max-spot-twap-ticks=100      Maximum accepted Uniswap tick deviation
  --twap-seconds=1800            Uniswap TWAP window
  --minimum-remaining-blocks=3   Inclusion buffer for block-based games
  --minimum-remaining-seconds=36 Inclusion buffer for timestamp-based games
  --max-hedge-slippage-bps=50    Maximum atomic hedge slippage
  --lifecycle-gas-reserve-weth=.01 Minimum settlement/withdrawal gas reserve
  --max-daily-gas-weth=.05       UTC-day recorded gas + projected entry/lifecycle reserve cap
  --max-position-weth=5          Maximum WETH-equivalent position notional
  --max-total-locked-weth=10     Maximum WETH-equivalent locked capital
  --poll-ms=1000                 Latest-head polling interval

Data and connectivity:
  --network=mainnet|sepolia      Expected network; defaults to mainnet
  --rpc-url=https://...          Read RPC (or ETH_RPC_URL)
  --quorum-rpc-url=https://...   Independent read RPC; repeat, at least one required for execution
  --public-rpc-url=https://...   Public submission RPC; repeat to fan out
  --rep-address=0x...            REP address; required on Sepolia
  --token-address=0x...          Explicit execution-token allowlist; repeat as needed
  --weth-address=0x...           Override the network WETH address
  --uniswap-factory=0x...        Override the Uniswap V3 factory
  --uniswap-quoter=0x...         Override the Uniswap V3 quoter
  --lookback-blocks=50000        Initial event search range
  --ui-port=4173                 Local dashboard port
  --history-file=PATH            Confirmed-submission JSONL path
  --price-history-file=PATH      Current-head pool-price JSONL path
  --position-file=PATH           Durable open-position recovery journal
  --settings-file=PATH           Persistent dashboard settings JSON path

Execution is off by default. See open-oracle-arbitrager/README.md.`)
}

export async function loadConfiguration(): Promise<Configuration> {
	const privateKeyValue = process.env['PRIVATE_KEY']
	if (privateKeyValue !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(privateKeyValue)) throw new Error('PRIVATE_KEY must be a 32-byte 0x-prefixed hex value')
	const networkName = parseNetworkName(option('network'))
	const settingsFile = resolve(option('settings-file') ?? `.open-oracle-arbitrager/settings-${networkName}.json`)
	const saved = await loadOperatorSettings(settingsFile, networkName)
	const strategy = mutableStrategy(
		saved?.strategy ?? {
			maxSpotTwapTicks: 100n,
			minimumProfitBps: 100n,
			minimumProfitWeth: 10n ** 16n,
			minimumRemainingBlocks: 3n,
			minimumRemainingSeconds: 36n,
			pollMilliseconds: 1_000,
			twapSeconds: 1_800,
		},
	)
	updateStrategyFromRequest(strategy, {
		maxSpotTwapTicks: option('max-spot-twap-ticks') ?? strategy.maxSpotTwapTicks.toString(),
		minimumProfitBps: option('minimum-profit-bps') ?? strategy.minimumProfitBps.toString(),
		minimumProfitWeth: option('minimum-profit-weth') ?? decimalWeth(strategy.minimumProfitWeth),
		minimumRemainingBlocks: option('minimum-remaining-blocks') ?? strategy.minimumRemainingBlocks.toString(),
		minimumRemainingSeconds: option('minimum-remaining-seconds') ?? strategy.minimumRemainingSeconds.toString(),
		pollMilliseconds: Number(option('poll-ms') ?? strategy.pollMilliseconds),
		twapSeconds: Number(option('twap-seconds') ?? strategy.twapSeconds),
	})
	const network = networkConfiguration(networkName, {
		factory: option('uniswap-factory') ?? process.env['UNISWAP_FACTORY_ADDRESS'],
		quoter: option('uniswap-quoter') ?? process.env['UNISWAP_QUOTER_ADDRESS'],
		rep: option('rep-address') ?? process.env['REP_ADDRESS'],
		weth: option('weth-address') ?? process.env['WETH_ADDRESS'],
	})
	const readRpcUrl = option('rpc-url') ?? process.env['ETH_RPC_URL'] ?? saved?.connectivity.readRpcUrl ?? defaultRpcUrl(networkName)
	const quorumEnvironment =
		process.env['OPEN_ORACLE_QUORUM_RPC_URLS']
			?.split(',')
			.map(value => value.trim())
			.filter(Boolean) ?? []
	const quorumRpcUrls = validateIndependentReadRpcUrls(readRpcUrl, [...quorumEnvironment, ...options('quorum-rpc-url')])
	const publicRpcUrls = options('public-rpc-url')
	const relayUrls = options('relay-url')
	const privateKey = (privateKeyValue as Hex | undefined) ?? saved?.privateKey
	const execute = process.argv.includes('--execute')
	const executorValue = option('executor-address') ?? process.env['OPEN_ORACLE_EXECUTOR_ADDRESS']
	if (execute && executorValue === undefined) throw new Error('--execute requires --executor-address=0x... (or OPEN_ORACLE_EXECUTOR_ADDRESS)')
	const routerValue = option('uniswap-router') ?? process.env['UNISWAP_ROUTER_ADDRESS']
	const v2RouterValue = option('uniswap-v2-router') ?? process.env['UNISWAP_V2_ROUTER_ADDRESS']
	if (execute && routerValue === undefined) throw new Error('--execute requires --uniswap-router=0x... (or UNISWAP_ROUTER_ADDRESS)')
	if (execute && quorumRpcUrls.length === 0) throw new Error('--execute requires at least one independent --quorum-rpc-url=https://... (or OPEN_ORACLE_QUORUM_RPC_URLS)')
	const coordinatorEnvironment =
		process.env['OPEN_ORACLE_COORDINATOR_ADDRESSES']
			?.split(',')
			.map(value => value.trim())
			.filter(Boolean) ?? []
	const coordinatorAddresses = [...new Map([...coordinatorEnvironment, ...options('coordinator-address')].map(value => getAddress(value)).map(address => [address.toLowerCase(), address])).values()]
	if (execute && coordinatorAddresses.length === 0) throw new Error('--execute requires at least one --coordinator-address=0x... (or OPEN_ORACLE_COORDINATOR_ADDRESSES)')
	const deploymentManifestPath = option('deployment-manifest') ?? process.env['OPEN_ORACLE_DEPLOYMENT_MANIFEST']
	if (execute && deploymentManifestPath === undefined) throw new Error('--execute requires --deployment-manifest=PATH (or OPEN_ORACLE_DEPLOYMENT_MANIFEST)')
	let deploymentManifest: DeploymentManifest | undefined
	if (deploymentManifestPath !== undefined) {
		let value: unknown
		try {
			value = JSON.parse(await readFile(resolve(deploymentManifestPath), 'utf8'))
		} catch (error) {
			if (error instanceof SyntaxError) throw new Error(`Deployment manifest is not valid JSON: ${error.message}`)
			throw error
		}
		deploymentManifest = parseDeploymentManifest(value)
	}
	const maxHedgeSlippageBps = BigInt(option('max-hedge-slippage-bps') ?? '50')
	if (maxHedgeSlippageBps < 0n || maxHedgeSlippageBps > 1_000n) throw new Error('max-hedge-slippage-bps must be from 0 to 1000')
	const riskLimits = {
		lifecycleGasReserveWeth: parseDecimalWeth(option('lifecycle-gas-reserve-weth') ?? decimalWeth(DEFAULT_RISK_LIMITS.lifecycleGasReserveWeth)),
		maxConcurrentPositions: 1,
		maxDailyGasSpendWeth: parseDecimalWeth(option('max-daily-gas-weth') ?? decimalWeth(DEFAULT_RISK_LIMITS.maxDailyGasSpendWeth)),
		maxPositionNotionalWeth: parseDecimalWeth(option('max-position-weth') ?? decimalWeth(DEFAULT_RISK_LIMITS.maxPositionNotionalWeth)),
		maxTotalLockedWeth: parseDecimalWeth(option('max-total-locked-weth') ?? decimalWeth(DEFAULT_RISK_LIMITS.maxTotalLockedWeth)),
	} satisfies RiskLimits
	if (riskLimits.maxPositionNotionalWeth > riskLimits.maxTotalLockedWeth) throw new Error('max-position-weth cannot exceed max-total-locked-weth')
	const submission = validateSubmissionSettings({
		minimumRelaySuccesses: Number(option('minimum-relay-successes') ?? saved?.submission.minimumRelaySuccesses ?? 1),
		mode: option('submission-mode') ?? saved?.submission.mode ?? 'private',
		relayUrls: relayUrls.length === 0 ? (saved?.submission.relayUrls ?? ['https://relay.flashbots.net']) : relayUrls,
	})
	return {
		...strategy,
		connectivity: validateConnectivitySettings({
			publicRpcUrls: publicRpcUrls.length === 0 ? (saved?.connectivity.publicRpcUrls ?? [readRpcUrl]) : publicRpcUrls,
			readRpcUrl,
		}),
		coordinatorAddresses,
		deploymentManifest,
		execute,
		executor: executorValue === undefined ? undefined : getAddress(executorValue),
		historyFile: resolve(option('history-file') ?? `.open-oracle-arbitrager/history-${networkName}.jsonl`),
		lookbackBlocks: BigInt(option('lookback-blocks') ?? '50000'),
		maxHedgeSlippageBps,
		network,
		once: process.argv.includes('--once'),
		openOracle: requiredAddress('open-oracle'),
		paused: saved?.paused ?? false,
		persistedPrivateKey: saved?.privateKey,
		priceHistoryFile: resolve(option('price-history-file') ?? `.open-oracle-arbitrager/prices-${networkName}.jsonl`),
		privateKey,
		positionFile: resolve(option('position-file') ?? `.open-oracle-arbitrager/positions-${networkName}.json`),
		quorumRpcUrls,
		riskLimits,
		router: routerValue === undefined ? undefined : getAddress(routerValue),
		settingsFile,
		submission,
		tokenAddresses: [...new Set([network.rep, ...(saved?.tokenAddresses ?? []), ...options('token-address').map(getAddress)])],
		ui: process.argv.includes('--ui'),
		uiPort: Number(option('ui-port') ?? '4173'),
		v2Router: v2RouterValue === undefined ? undefined : getAddress(v2RouterValue),
	}
}

export function mutableStrategy(config: MutableStrategy): MutableStrategy {
	return {
		maxSpotTwapTicks: config.maxSpotTwapTicks,
		minimumProfitBps: config.minimumProfitBps,
		minimumProfitWeth: config.minimumProfitWeth,
		minimumRemainingBlocks: config.minimumRemainingBlocks,
		minimumRemainingSeconds: config.minimumRemainingSeconds,
		pollMilliseconds: config.pollMilliseconds,
		twapSeconds: config.twapSeconds,
	}
}

export function applyStrategy(target: MutableStrategy, source: MutableStrategy) {
	target.maxSpotTwapTicks = source.maxSpotTwapTicks
	target.minimumProfitBps = source.minimumProfitBps
	target.minimumProfitWeth = source.minimumProfitWeth
	target.minimumRemainingBlocks = source.minimumRemainingBlocks
	target.minimumRemainingSeconds = source.minimumRemainingSeconds
	target.pollMilliseconds = source.pollMilliseconds
	target.twapSeconds = source.twapSeconds
}

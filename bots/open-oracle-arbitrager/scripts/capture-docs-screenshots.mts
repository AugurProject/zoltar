import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getAddress, keccak256, toHex } from '#ethereum'
import { startDashboardServer } from '#dashboard/dashboard-server'
import { operatorSnapshot, type OperatorSnapshot, type OperatorState } from '#state/operator-state'
import type { PositionRecord } from '#state/position-store'

const address = (value: number) => getAddress(`0x${value.toString(16).padStart(40, '0')}`)
const transactionHash = (label: string) => keccak256(toHex(label))
const now = Date.now()
const sampledAt = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString()
const wallet = address(0xa11ce)
const rep = getAddress('0x221657776846890989a759BA2973e427DfF5C9bB')
const repYes = address(0x1_0001)
const repNo = address(0x1_0002)
const openOracle = address(0x0a11ce)
const executor = address(0xecec)
const pool = address(0x3000)
const hash = transactionHash('open-oracle-documentation-fixture')
const checkedAt = sampledAt(0)

async function captureScreenshots(chromium: string, origin: string, outputDirectory: string) {
	const profile = await mkdtemp(join(tmpdir(), 'zoltar-open-oracle-docs-'))
	const child = Bun.spawn([chromium, '--headless', '--disable-gpu', '--hide-scrollbars', '--no-sandbox', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], {
		stderr: 'pipe',
		stdout: 'ignore',
	})
	try {
		const reader = child.stderr.getReader()
		const decoder = new TextDecoder()
		let diagnostics = ''
		let browserWebSocketUrl: string | undefined
		while (browserWebSocketUrl === undefined) {
			const chunk = await reader.read()
			if (chunk.done) throw new Error(`Chromium stopped before exposing DevTools: ${diagnostics.trim()}`)
			diagnostics += decoder.decode(chunk.value, { stream: true })
			browserWebSocketUrl = diagnostics.match(/DevTools listening on (ws:\/\/\S+)/)?.[1]
		}
		const socket = new WebSocket(browserWebSocketUrl)
		await new Promise<void>((resolve, reject) => {
			socket.addEventListener('open', () => resolve(), { once: true })
			socket.addEventListener('error', () => reject(new Error('Could not connect to Chromium DevTools')), { once: true })
		})
		let nextId = 1
		const pending = new Map<number, { reject: (error: Error) => void; resolve: (value: unknown) => void }>()
		socket.addEventListener('message', event => {
			const response: unknown = JSON.parse(String(event.data))
			if (typeof response !== 'object' || response === null || !('id' in response) || typeof response.id !== 'number') return
			const request = pending.get(response.id)
			if (request === undefined) return
			pending.delete(response.id)
			const error = 'error' in response && typeof response.error === 'object' && response.error !== null && 'message' in response.error && typeof response.error.message === 'string' ? response.error.message : undefined
			if (error !== undefined) request.reject(new Error(error))
			else request.resolve('result' in response ? response.result : undefined)
		})
		const command = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
			new Promise<unknown>((resolve, reject) => {
				const id = nextId++
				pending.set(id, { reject, resolve })
				socket.send(JSON.stringify({ id, method, params, sessionId }))
			})
		const target = await command('Target.createTarget', { url: `${origin}/` })
		if (typeof target !== 'object' || target === null || !('targetId' in target) || typeof target.targetId !== 'string') throw new Error('Chromium did not create a screenshot target')
		const attachment = await command('Target.attachToTarget', { flatten: true, targetId: target.targetId })
		if (typeof attachment !== 'object' || attachment === null || !('sessionId' in attachment) || typeof attachment.sessionId !== 'string') throw new Error('Chromium did not attach to the screenshot target')
		const sessionId = attachment.sessionId
		await command('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height: 900, mobile: false, width: 1440 }, sessionId)
		await command('Page.enable', {}, sessionId)
		for (const [name, section] of [
			['dashboard-overview.png', undefined],
			['dashboard-markets.png', 'markets'],
			['dashboard-markets-mobile.png', 'markets'],
			['dashboard-opportunities.png', 'operations'],
			['dashboard-opportunities-mobile.png', 'operations'],
			...(process.env['OPEN_ORACLE_CAPTURE_DEPLOYMENT'] === '1'
				? ([
						['deployment-desktop.png', 'deployment-configuration'],
						['deployment-mobile.png', 'deployment-configuration'],
						['deployment-create2.png', 'create2-form'],
					] as const)
				: []),
			...(process.env['OPEN_ORACLE_CAPTURE_CONFIGURATION'] === '1'
				? ([
						['configuration-desktop.png', 'complete-configuration'],
						['configuration-mobile.png', 'complete-configuration'],
					] as const)
				: []),
		] as const) {
			const mobile = name === 'dashboard-markets-mobile.png' || name === 'dashboard-opportunities-mobile.png' || name === 'deployment-mobile.png' || name === 'configuration-mobile.png'
			await command('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height: mobile ? 844 : 900, mobile: false, width: mobile ? 390 : 1440 }, sessionId)
			await command('Page.navigate', { url: `${origin}/` }, sessionId)
			await Bun.sleep(1_500)
			if (section !== undefined) {
				await command(
					'Runtime.evaluate',
					{
						expression: `(() => {
							const section = document.getElementById(${JSON.stringify(section)})
							if (section === null) return
							for (const scroller of document.querySelectorAll('.table-scroll')) scroller.scrollLeft = 0
							window.scrollTo(0, Math.max(0, section.getBoundingClientRect().top + window.scrollY - 16))
						})()`,
					},
					sessionId,
				)
				await Bun.sleep(250)
			}
			const capture = await command('Page.captureScreenshot', { captureBeyondViewport: false, format: 'png', fromSurface: true }, sessionId)
			if (typeof capture !== 'object' || capture === null || !('data' in capture) || typeof capture.data !== 'string') throw new Error(`Chromium did not capture ${name}`)
			await Bun.write(join(outputDirectory, name), Buffer.from(capture.data, 'base64'))
		}
		socket.close()
	} finally {
		child.kill()
		await child.exited
		await rm(profile, { force: true, recursive: true })
	}
}

const history = [
	{
		actualGasCostEth: '0.0011',
		blockNumber: '23841995',
		direction: 'sell-rep' as const,
		estimatedNetProfitWeth: '0.0184',
		estimatedProfitBeforeGasEth: '0.0202',
		executedAt: sampledAt(74),
		pool,
		poolFee: 3_000,
		reportId: '814',
		requiredToken: '42',
		requiredWeth: '0.164',
		token: rep,
		tokenSymbol: 'REPv2',
		trackedNetProfitEth: '0.0179',
		transactionHash: transactionHash('fixture-814'),
	},
	{
		actualGasCostEth: '0.0013',
		blockNumber: '23842041',
		direction: 'buy-rep' as const,
		estimatedNetProfitWeth: '0.0121',
		estimatedProfitBeforeGasEth: '0.0140',
		executedAt: sampledAt(51),
		pool,
		poolFee: 500,
		reportId: '815',
		requiredToken: '31',
		requiredWeth: '0.128',
		token: repYes,
		tokenSymbol: 'REPv2_YES',
		trackedNetProfitEth: '0.0114',
		transactionHash: transactionHash('fixture-815'),
	},
	{
		actualGasCostEth: '0.0010',
		blockNumber: '23842088',
		direction: 'sell-rep' as const,
		estimatedNetProfitWeth: '0.0158',
		estimatedProfitBeforeGasEth: '0.0174',
		executedAt: sampledAt(28),
		pool,
		poolFee: 3_000,
		reportId: '816',
		requiredToken: '38',
		requiredWeth: '0.151',
		token: repNo,
		tokenSymbol: 'REPv2_NO',
		trackedNetProfitEth: '0.0151',
		transactionHash: transactionHash('fixture-816'),
	},
]

const tokenMarkets = [
	{
		address: rep,
		balance: '184.25',
		decimals: 18,
		name: 'Reputation',
		pools: [
			{ address: address(0x3101), fee: 3_000, liquidity: '168234922505184', priceWeth: '0.00418', url: 'https://etherscan.io/address/0x0000000000000000000000000000000000003101', venue: 'Uniswap V3' },
			{ address: address(0x3102), fee: 3_000, liquidity: '8240 REPv2 / 34.18 WETH', priceWeth: '0.004147', url: 'https://etherscan.io/address/0x0000000000000000000000000000000000003102', venue: 'Uniswap V2' },
		],
		symbol: 'REPv2',
	},
	{
		address: repYes,
		balance: '71',
		decimals: 18,
		name: 'Reputation YES',
		pools: [{ address: address(0x3201), fee: 10_000, liquidity: '28100821380564', priceWeth: '0.00372', url: 'https://etherscan.io/address/0x0000000000000000000000000000000000003201', venue: 'Uniswap V3' }],
		symbol: 'REPv2_YES',
	},
	{
		address: repNo,
		balance: '55',
		decimals: 18,
		name: 'Reputation NO',
		pools: [],
		symbol: 'REPv2_NO',
	},
]

const priceHistory = tokenMarkets.flatMap(token =>
	token.pools.flatMap(poolSnapshot =>
		poolSnapshot.priceWeth === undefined
			? []
			: [35, 28, 21, 14, 7, 0].map((minutesAgo, index) => ({
					blockNumber: (23_842_080 + index * 12).toString(),
					pool: poolSnapshot.address,
					priceWeth: (Number(poolSnapshot.priceWeth) * (0.985 + index * 0.006)).toFixed(7),
					sampledAt: sampledAt(minutesAgo),
					symbol: token.symbol,
					token: token.address,
					venue: `${poolSnapshot.venue} ${(poolSnapshot.fee / 10_000).toString()}%`,
				})),
	),
)

const openPosition = {
	account: wallet,
	actualEntryGasCostEth: '0.0034',
	capitalAtRiskWeth: '0.151',
	closedAt: undefined,
	direction: 'sell-rep',
	entryTransactionHash: hash,
	entryTransactionHashes: [hash],
	gasExpenditures: [{ costEth: '0.0034', minedAt: sampledAt(1), transactionHash: hash }],
	historyOutbox: undefined,
	hedgeAmountToken: '38',
	hedgeWeth: '0.1692',
	hedgedProfitBeforeGasEth: '0.0182',
	lifecycleGasCostEth: '0',
	lifecycleReceiptRecovered: false,
	lifecycleTargetBlockNumber: undefined,
	lifecycleTokenDecimals: undefined,
	lifecycleTransactionHashes: [],
	lifecycleUpdatedAt: undefined,
	lifecycleWalletTokenBefore: undefined,
	lifecycleWalletWethBefore: undefined,
	lockedToken: '38',
	lockedWeth: '0.151',
	manualReconciliation: undefined,
	openedAt: sampledAt(1),
	realizedNetProfitEth: undefined,
	reportId: '816',
	status: 'open',
	token: repNo,
	tokenSymbol: 'REPv2_NO',
	withdrawnToken: '0',
	withdrawnWeth: '0',
} satisfies PositionRecord

const closedPositionHash = transactionHash('closed-open-oracle-documentation-fixture')
const closedPosition = {
	account: wallet,
	actualEntryGasCostEth: '0.0011',
	capitalAtRiskWeth: '0.164',
	closedAt: sampledAt(60),
	direction: 'sell-rep',
	entryTransactionHash: closedPositionHash,
	entryTransactionHashes: [closedPositionHash],
	gasExpenditures: [
		{ costEth: '0.0011', minedAt: sampledAt(74), transactionHash: closedPositionHash },
		{ costEth: '0.0008', minedAt: sampledAt(60), transactionHash: transactionHash('closed-lifecycle-documentation-fixture') },
	],
	historyOutbox: undefined,
	hedgeAmountToken: '42',
	hedgeWeth: '0.1955',
	hedgedProfitBeforeGasEth: '0.0315',
	lifecycleGasCostEth: '0.0008',
	lifecycleReceiptRecovered: true,
	lifecycleSettlerRewardEth: '0.002',
	lifecycleTargetBlockNumber: undefined,
	lifecycleTokenDecimals: undefined,
	lifecycleTransactionHashes: [],
	lifecycleUpdatedAt: sampledAt(60),
	lifecycleWalletTokenBefore: undefined,
	lifecycleWalletWethBefore: undefined,
	lockedToken: '42',
	lockedWeth: '0.164',
	manualReconciliation: undefined,
	openedAt: sampledAt(74),
	realizedNetProfitEth: '0.0316',
	reportId: '814',
	status: 'closed',
	token: rep,
	tokenSymbol: 'REPv2',
	withdrawnToken: '42',
	withdrawnWeth: '0.164',
} satisfies PositionRecord

const positions = [openPosition, closedPosition]
const positionDerivedSnapshot = operatorSnapshot(
	{
		activeReportCount: 0,
		balances: undefined,
		blockNumber: '23842152',
		blockTimestamp: Math.floor((now - 4_000) / 1_000).toString(),
		centralizedMarket: {
			assetId: rep,
			askDepthAttoEth: 63n * 10n ** 17n,
			bidDepthAttoEth: 71n * 10n ** 17n,
			chainId: 1,
			maximumPriceRepPerEth: 1042n * 10n ** 16n,
			minimumPriceRepPerEth: 1031n * 10n ** 16n,
			observations: [
				{ assetId: rep, askDepthAttoEth: 34n * 10n ** 17n, bestAskQuote: '9.72', bestBidQuote: '9.68', bidDepthAttoEth: 38n * 10n ** 17n, chainId: 1, ethTickerTimestamp: now, exchangeId: 'kraken', observedAt: now, orderBookTimestamp: now, priceRepPerEth: 1031n * 10n ** 16n, repMarket: 'REP/USD', usesEthTicker: true },
				{
					assetId: rep,
					askDepthAttoEth: 29n * 10n ** 17n,
					bestAskQuote: '0.097',
					bestBidQuote: '0.096',
					bidDepthAttoEth: 33n * 10n ** 17n,
					chainId: 1,
					ethTickerTimestamp: undefined,
					exchangeId: 'coinbase',
					observedAt: now,
					orderBookTimestamp: now,
					priceRepPerEth: 1042n * 10n ** 16n,
					repMarket: 'REP/ETH',
					usesEthTicker: false,
				},
			],
			priceRepPerEth: 10365n * 10n ** 15n,
			reasons: [],
			reliable: true,
		},
		marketConsensus: {
			assetId: rep,
			cex: {
				askDepthAttoEth: 63n * 10n ** 17n,
				bidDepthAttoEth: 71n * 10n ** 17n,
				kind: 'cex',
				maximumPriceRepPerEth: 1042n * 10n ** 16n,
				minimumPriceRepPerEth: 1031n * 10n ** 16n,
				observations: [
					{ assetId: rep, askDepthAttoEth: 34n * 10n ** 17n, bidDepthAttoEth: 38n * 10n ** 17n, chainId: 1, kind: 'cex', observationId: 'kraken:1', observedAt: now, priceRepPerEth: 1031n * 10n ** 16n, sourceId: 'kraken' },
					{ assetId: rep, askDepthAttoEth: 29n * 10n ** 17n, bidDepthAttoEth: 33n * 10n ** 17n, chainId: 1, kind: 'cex', observationId: 'coinbase:1', observedAt: now, priceRepPerEth: 1042n * 10n ** 16n, sourceId: 'coinbase' },
				],
				priceRepPerEth: 10365n * 10n ** 15n,
				reasons: [],
				reliable: true,
			},
			chainId: 1,
			dex: {
				askDepthAttoEth: 48n * 10n ** 17n,
				bidDepthAttoEth: 52n * 10n ** 17n,
				kind: 'dex',
				maximumPriceRepPerEth: 1041n * 10n ** 16n,
				minimumPriceRepPerEth: 1037n * 10n ** 16n,
				observations: [
					{ assetId: rep, askDepthAttoEth: 24n * 10n ** 17n, bidDepthAttoEth: 26n * 10n ** 17n, chainId: 1, kind: 'dex', observationId: 'uniswap-v2:1', observedAt: now, priceRepPerEth: 1037n * 10n ** 16n, sourceId: 'uniswap-v2' },
					{ assetId: rep, askDepthAttoEth: 24n * 10n ** 17n, bidDepthAttoEth: 26n * 10n ** 17n, chainId: 1, kind: 'dex', observationId: 'uniswap-v3:1', observedAt: now, priceRepPerEth: 1041n * 10n ** 16n, sourceId: 'uniswap-v3' },
				],
				priceRepPerEth: 1039n * 10n ** 16n,
				reasons: [],
				reliable: true,
			},
			priceRepPerEth: 103775n * 10n ** 14n,
			reasons: [],
			reliable: true,
			sourceCount: 4,
		},
		endpointChecks: [],
		executionHistory: [],
		gameCapital: { eth: '0', totalEthWeth: '0', weth: '0' },
		lastError: undefined,
		lastPollAt: undefined,
		operationLog: [],
		opportunities: [],
		paused: false,
		positions,
		priceHistory: [],
		reportPaths: [],
		status: 'running',
		tokenAddresses: [],
		tokenMarkets: [],
		transactionActivity: [],
	} satisfies OperatorState,
	{
		maxSpotTwapTicks: 120n,
		minimumProfitBps: 100n,
		minimumProfitWethAttoEth: 10n ** 16n,
		minimumRemainingBlocks: 3n,
		minimumRemainingSeconds: 36n,
		pollMilliseconds: 12_000,
		twapSeconds: 1_800,
	},
	{ minimumBundleRelaySuccesses: 1, mode: 'private', relayUrls: ['https://relay.flashbots.net/'] },
	{ publicRpcUrls: ['https://rpc.example/'], readRpcUrl: 'https://read.example/' },
	{ execute: true, executor, expectedChainId: 1, explorerUrl: 'https://etherscan.io', network: 'mainnet', openOracle, queuedWallet: undefined, savedWallet: wallet, wallet },
	{ lifecycleGasReserveWethAttoEth: 10n ** 16n, maxConcurrentPositions: 2, maxDailyGasSpendWethAttoEth: 5n * 10n ** 16n, maxPositionNotionalWethAttoEth: 5n * 10n ** 18n, maxTotalLockedWethAttoEth: 10n * 10n ** 18n },
)

const snapshot = {
	activeReportCount: 3,
	balances: { availableEth: '1.842', availableRep: '184.25', availableWeth: '2.375', repValueWeth: '0.770165', totalValueWeth: '4.987165' },
	blockNumber: '23842152',
	blockTimestamp: Math.floor((now - 4_000) / 1_000).toString(),
	centralizedMarket: positionDerivedSnapshot.centralizedMarket,
	marketConsensus: positionDerivedSnapshot.marketConsensus,
	connectivity: { publicRpcUrls: ['https://rpc.example/'], readRpcUrl: 'https://read.example/' },
	deployment: positionDerivedSnapshot.deployment,
	endpointChecks: [
		{ chainId: 1, checkedAt, error: undefined, kind: 'read-rpc' as const, status: 'healthy' as const, target: 'https://read.example' },
		{ chainId: 1, checkedAt, error: undefined, kind: 'public-rpc' as const, status: 'healthy' as const, target: 'https://rpc.example' },
		{ chainId: 1, checkedAt, error: undefined, kind: 'private-relay' as const, status: 'healthy' as const, target: 'https://relay.flashbots.net' },
	],
	execute: true,
	executionHistory: history,
	executionHistoryRecordCount: history.length,
	executor,
	expectedChainId: 1,
	explorerUrl: 'https://etherscan.io',
	gameCapital: { eth: '0.06', totalEthWeth: '1.284', weth: '1.224' },
	lastError: undefined,
	lastPollAt: sampledAt(0),
	mode: 'execute' as const,
	network: 'mainnet' as const,
	openOracle,
	operationLog: [
		{ category: 'decision' as const, details: 'net 0.0158 ETH · 992 bps', level: 'info' as const, message: 'Selected profitable sell-REP dispute', reason: 'quote, TWAP, inventory, and risk checks passed', reportId: '816', timestamp: sampledAt(1) },
		{ category: 'transaction' as const, details: 'https://relay.flashbots.net', level: 'info' as const, message: 'Atomic entry accepted', reason: 'target block 23842153', reportId: '816', timestamp: sampledAt(1) },
		{ category: 'configuration' as const, details: '3 supported REP-family tokens', level: 'info' as const, message: 'Token catalog synchronized', reason: undefined, reportId: undefined, timestamp: sampledAt(2) },
	],
	opportunities: [
		{
			centralizedPriceDeviationBps: '86',
			decision: 'selected' as const,
			direction: 'sell-rep' as const,
			estimatedNetProfitEth: '0.0158',
			estimatedNetProfitWeth: '0.0158',
			executablePriceRepPerEth: '10.284',
			hasRequiredInventory: true,
			pool,
			poolFee: 3_000,
			reportId: '816',
			requiredToken: '38',
			requiredWeth: '0.151',
			timeRemaining: '27',
			token: repNo,
			tokenSymbol: 'REPv2_NO',
			venue: 'uniswap-v4' as const,
			windowUnit: 'blocks' as const,
		},
		{
			centralizedPriceDeviationBps: undefined,
			decision: 'unprofitable' as const,
			direction: 'buy-rep' as const,
			estimatedNetProfitEth: '-0.0012',
			estimatedNetProfitWeth: '-0.0012',
			executablePriceRepPerEth: '9.845',
			hasRequiredInventory: true,
			pool: address(0x3201),
			poolFee: 10_000,
			reportId: '817',
			requiredToken: '24',
			requiredWeth: '0.098',
			timeRemaining: '42',
			token: repYes,
			tokenSymbol: 'REPv2_YES',
			venue: 'uniswap-v3' as const,
			windowUnit: 'blocks' as const,
		},
	],
	paused: false,
	positionRecordCount: positionDerivedSnapshot.positionRecordCount,
	positions: positionDerivedSnapshot.positions,
	priceHistory,
	queuedWallet: undefined,
	reportPaths: [
		{
			reportId: '816',
			settled: false,
			steps: [
				{ amount1: '38', amount2: '0.151', blockNumber: '23842088', event: 'submitted' as const, reporter: address(0xb0b), transactionHash: transactionHash('submitted-816') },
				{ amount1: '40', amount2: '0.159', blockNumber: '23842112', event: 'disputed' as const, reporter: wallet, transactionHash: hash },
			],
		},
	],
	risk: positionDerivedSnapshot.risk,
	savedWallet: wallet,
	settings: { maxSpotTwapTicks: '120', minimumProfitBps: '100', minimumProfitWeth: '0.01', minimumRemainingBlocks: '3', minimumRemainingSeconds: '36', pollMilliseconds: 12_000, twapSeconds: 1_800 },
	status: 'running' as const,
	submission: { minimumBundleRelaySuccesses: 1, mode: 'private' as const, relayUrls: ['https://relay.flashbots.net/'] },
	tokenAddresses: [rep, repYes, repNo],
	tokenMarkets,
	totalActualGasCostEth: '0.0034',
	totalEstimatedNetProfitEth: '0.0463',
	totalEstimatedNetProfitWeth: '0.0463',
	totalHedgedProfitBeforeGasEth: positionDerivedSnapshot.totalHedgedProfitBeforeGasEth,
	totalOpenHedgedNetProfitEth: positionDerivedSnapshot.totalOpenHedgedNetProfitEth,
	totalRealizedNetProfitEth: positionDerivedSnapshot.totalRealizedNetProfitEth,
	totalRevenueBeforeGasEth: '0.0516',
	totalTrackedNetProfitEth: '0.0444',
	transactionActivity: [
		{
			acceptedTargets: ['https://relay.flashbots.net'],
			actualGasCostEth: undefined,
			estimatedNetProfitEth: '0.0158',
			failedTargets: [],
			hash,
			kind: 'dispute' as const,
			mode: 'private' as const,
			originalHash: hash,
			reportId: '816',
			status: 'pending' as const,
			submittedAt: sampledAt(1),
			token: repNo,
			tokenSymbol: 'REPv2_NO',
			trackedNetProfitEth: undefined,
			updatedAt: sampledAt(1),
		},
	],
	updatedAt: sampledAt(0),
	wallet,
} satisfies OperatorSnapshot

if (
	snapshot.positionRecordCount !== positions.length ||
	snapshot.risk.usage.openPositions !== 1 ||
	snapshot.risk.usage.lockedWeth !== openPosition.capitalAtRiskWeth ||
	snapshot.totalOpenHedgedNetProfitEth !== '0.0148' ||
	snapshot.totalRealizedNetProfitEth !== closedPosition.realizedNetProfitEth ||
	snapshot.totalTrackedNetProfitEth !== '0.0444'
) {
	throw new Error('OpenOracle documentation fixture position, risk, and profit totals are inconsistent')
}

const server = startDashboardServer(0, {
	getConfiguration: async () => ({
		configuration: await Bun.file(join(import.meta.dir, '..', 'config', 'operator.example.json')).json(),
		revision: 'fixture-revision',
	}),
	getSnapshot: () => snapshot,
	setPaused: () => undefined,
	updateConnectivity: () => snapshot.connectivity,
	updateConfiguration: value => value,
	updateSigner: () => ({ wallet }),
	updateStrategy: () => snapshot.settings,
	updateSubmission: () => snapshot.submission,
	updateTokens: () => snapshot.tokenAddresses,
})

try {
	if (process.argv.includes('--serve')) {
		await new Promise(() => {})
	}
	const outputDirectory = process.env['OPEN_ORACLE_SCREENSHOT_OUTPUT_DIR'] ?? join(import.meta.dir, '..', 'docs', 'assets')
	await mkdir(outputDirectory, { recursive: true })
	const chromium = process.env['CHROMIUM_PATH'] ?? '/usr/bin/chromium'
	const port = server.port
	if (port === undefined) throw new Error('Dashboard screenshot server did not expose a listening port')
	const origin = `http://${server.hostname}:${port.toString()}`
	await captureScreenshots(chromium, origin, outputDirectory)
} finally {
	server.stop(true)
}

import { chartValueBounds, uniswapPriceChartModel, uniswapPriceProvenance } from './chart-values.js'
import { demoAmmPriceHistory, demoDenseUniswapRepEthPriceHistory, demoRepEthPriceHistory, demoUniswapRepEthPriceHistory } from './demo-fixtures.js'
import {
	accountStateDuringStagedRefresh,
	activityRefreshRetention,
	canonicalPageLimit,
	classifyLiveRecords,
	collectCanonicalPages,
	contractDeploymentStatus,
	contractDeploymentTimestampLabel,
	createForegroundRefreshGate,
	createLiveRouteRefreshCoordinator,
	indexerConnectionStatus,
	indexerLagLabel,
	indexerProgressEstimate,
	isCurrentContextRequest,
	isCurrentLiveRequest,
	isNoncanonicalDetailFailure,
	mergeUniqueRecords,
	paginatedSnapshotWasReplaced,
	reconcilePaginatedTotal,
	reconcileTransactionDialogSnapshot,
	refreshPresentation,
	resolveActivityRefreshDepth,
	retainedPaginationAvailable,
	runWithForegroundReservation,
	shouldClearPendingDetailState,
	shouldContinueTransactionRestore,
	transactionRetryMode,
} from './live-update.js'

const $ = (selector) => document.querySelector(selector)
const feed = $('#feed')
const feedState = $('#feed-state')
const networkCards = $('#network-cards')
const globalNetworkFilter = $('#global-network-filter')
const dialog = $('#detail-dialog')
const detailContent = $('#detail-content')
const connection = $('.connection')
const pageUrl = new URL(location.href)
const isDemo = pageUrl.searchParams.get('demo') === '1'
const connectionDemo = pageUrl.searchParams.get('connectionDemo')
const usesDemoConnectionLabel = isDemo && connectionDemo !== 'indexer' && connectionDemo !== 'reconnecting'
const demoState = pageUrl.searchParams.get('state')
const priceDemo = pageUrl.searchParams.get('priceDemo')
const detailState = pageUrl.searchParams.get('detailState')
const networkState = pageUrl.searchParams.get('networkState')
const isSystem = location.pathname === '/system'
const isContracts = location.pathname === '/contracts'
const isRichList = location.pathname === '/richlist'
const isAddress = location.pathname === '/address'
const isActivity = !isSystem && !isContracts && !isRichList && !isAddress
const initialChainId = pageUrl.searchParams.get('chainId') ?? ''
const initialActivityFilters = {
	event: pageUrl.searchParams.get('event') ?? '',
	address: pageUrl.searchParams.get('address') ?? '',
}

let nextCursor
let appliedActivityFilters = { ...initialActivityFilters }
let demoErrorConsumed = false
let demoDetailErrorConsumed = false
let demoStateDetailRequests = 0
let demoTransactionRequests = 0
let demoLogRequests = 0
let demoRichListRequests = 0
let demoNetworkRequests = 0
let demoRouteRequestsInFlight = 0
let demoMaxRouteRequestsInFlight = 0
let demoReorgObserved = false
let demoEvictedAddress
let demoReorgRefreshErrorConsumed = false
let demoTransactionSnapshotInvalidated = false
let demoCanonicalRouteRefreshErrorConsumed = false
let demoTransactionRestoreErrorConsumed = false
let demoTransactionAppendErrorConsumed = false
let demoNetworkFallbackErrorConsumed = false
let demoRouteRefreshErrorConsumed = false
let logsRequestVersion = 0
let detailRequestVersion = 0
let detailContextVersion = 0
let pendingBlockUpdates = 0
let blockRefreshTimer
let streamHasOpened = false
let stateData
let activeStateType = 'pools'
let selectedEntityKey
let catalogRequestVersion = 0
let stateDetailRequestVersion = 0
let stateDetailContextVersion = 0
let stream
let networkLoadPromise
let networkFollowUpPromise
let latestNetworks = []
const indexerProgressSamples = new Map()
let logsAbortController
let serverClockOffsetMs = 0
let networkFreshnessThresholdMs = 48_000
let lastNetworkRequestFailed = false
let activeReorgRecovery
let canonicalRefreshRequired = false
let richListItems = []
let richListTotal = 0
let richListRequestVersion = 0
let contractItems = []
let contractRequestVersion = 0
let selectedContractAddress
let activeLog
let pendingCanonicalLog
let pendingCanonicalActivityCount
let activeAccount
let activeAccountTransactions
let activeAccountLoadMore
let pendingCanonicalAccount
let pendingAccountDialogSnapshot
let preservePendingOnDialogClose = false
let addressProfileRequestVersion = 0
let viewContextVersion = 0
let currentAddressProfile
const addressIdentityCache = new Map()
let polledReorgRefreshTimer
let requestRouteRefresh
const logRefreshGate = createForegroundRefreshGate()
const contractRefreshGate = createForegroundRefreshGate()
const richListRefreshGate = createForegroundRefreshGate()
const addressProfileRefreshGate = createForegroundRefreshGate()
const systemStateRefreshGate = createForegroundRefreshGate()
const systemDetailRefreshGate = createForegroundRefreshGate()
const detailRefreshGate = createForegroundRefreshGate()
const accountPageRefreshGate = createForegroundRefreshGate()
const canonicalIncompleteTitle = 'Chain update refresh incomplete'
const canonicalIncompleteDetail = 'Showing the prior details. Retry the chain update refresh to confirm the current state.'

const showCanonicalDialogStatus = (title, detail) => {
	if (!dialog.open) return
	$('#detail-canonical-title').textContent = title
	$('#detail-canonical-detail').textContent = detail
	$('#detail-canonical-retry').hidden = activeReorgRecovery !== undefined || !canonicalRefreshRequired
	$('#detail-canonical-status').hidden = false
}

const hideCanonicalDialogStatus = () => {
	$('#detail-canonical-status').hidden = true
}

const syncCanonicalDialogStatus = () => {
	if (!dialog.open) {
		hideCanonicalDialogStatus()
		return
	}
	if (activeReorgRecovery !== undefined) {
		showCanonicalDialogStatus(activeReorgRecovery.title, activeReorgRecovery.detail)
		return
	}
	if (canonicalRefreshRequired) {
		showCanonicalDialogStatus(canonicalIncompleteTitle, canonicalIncompleteDetail)
		return
	}
	hideCanonicalDialogStatus()
}

const updateConnectionStatus = () => {
	if (usesDemoConnectionLabel) {
		connection.className = 'connection live'
		$('#connection-label').textContent = 'Demo fixture'
		return
	}
	const network = latestNetworks.find((item) => String(item.chain_id) === selectedChainId())
	const streamState =
		connectionDemo === 'reconnecting'
			? 'closed'
			: stream?.readyState === EventSource.OPEN
				? 'open'
				: stream?.readyState === EventSource.CONNECTING || stream === undefined
					? 'connecting'
					: 'closed'
	const status = indexerConnectionStatus(network, streamState, lastNetworkRequestFailed, streamHasOpened || connectionDemo === 'reconnecting')
	connection.className = `connection ${status.tone}`
	$('#connection-label').textContent = status.label
}

const liveSnapshot = (container, selector = '[data-live-key]') =>
	new Map([...container.querySelectorAll(selector)].map((node) => [node.dataset.liveKey, node.dataset.liveSignature ?? node.textContent]))

const setLiveRecord = (node, key, value) => {
	node.dataset.liveKey = key
	node.dataset.liveSignature = typeof value === 'string' ? value : JSON.stringify(value)
	return node
}

const retryCanonicalViewOr = (fallback) => (canonicalRefreshRequired ? requestRouteRefresh(1, true) : fallback())

const renderRetryStatus = (status, message, retryAction) => {
	status.hidden = false
	status.className = 'system-status error'
	const retry = element('button', '', 'Retry')
	retry.type = 'button'
	retry.addEventListener('click', retryAction)
	status.replaceChildren(element('span', '', message), retry)
}

const animateLiveNode = (node, className) => {
	node.classList.remove('live-added', 'live-changed', className)
	requestAnimationFrame(() => {
		node.classList.add(className)
		const clear = () => node.classList.remove(className)
		node.addEventListener('animationend', clear, { once: true })
		window.setTimeout(clear, 1_600)
	})
}

const applyLiveChanges = (container, previous, { live, selector = '[data-live-key]' } = {}) => {
	const changes = { added: 0, changed: 0 }
	if (!live) return changes
	const nodes = [...container.querySelectorAll(selector)]
	const classified = classifyLiveRecords(
		previous,
		nodes.map((node) => ({ key: node.dataset.liveKey, signature: node.dataset.liveSignature })),
	)
	for (const [index, record] of classified.entries()) {
		const node = nodes[index]
		if (record.state === 'added') {
			changes.added++
			animateLiveNode(node, 'live-added')
		} else if (record.state === 'changed') {
			changes.changed++
			animateLiveNode(node, 'live-changed')
		}
	}
	return changes
}

const demoHash = `0x${'7e4b9ad70f2248c48217f9c9ef694017'.repeat(2)}`
const demoNetworks = [
	{
		chain_id: '1',
		id: 'mainnet',
		name: 'Ethereum Mainnet',
		start_block: '23180000',
		indexed_block: '23184712',
		indexed_hash: demoHash,
		indexed_timestamp: new Date(Date.now() - 19_000).toISOString(),
		observed_block: '23184712',
		finalized_block: '23184648',
		phase: 'live',
		last_poll_at: new Date().toISOString(),
		last_success_at: new Date().toISOString(),
		consecutive_failures: 0,
		last_error: null,
		explorer_base_url: 'https://etherscan.io',
	},
	{
		chain_id: '11155111',
		id: 'sepolia',
		name: 'Sepolia',
		start_block: '8970000',
		indexed_block: '8972451',
		indexed_hash: demoHash,
		indexed_timestamp: new Date(Date.now() - 46_000).toISOString(),
		observed_block: '8972466',
		finalized_block: '8972402',
		phase: 'backfilling',
		last_poll_at: new Date().toISOString(),
		last_success_at: new Date().toISOString(),
		consecutive_failures: 0,
		last_error: null,
		explorer_base_url: 'https://sepolia.etherscan.io',
	},
]
const demoNetworkItems = () => {
	if (networkState === 'stale') return demoNetworks.map((network) => ({ ...network, last_success_at: new Date(Date.now() - 120_000).toISOString() }))
	if (networkState !== 'future-start') return demoNetworks
	return demoNetworks.map((network) => ({
		...network,
		start_block: (BigInt(network.observed_block) + 1n).toString(),
		indexed_block: null,
		indexed_hash: null,
		indexed_timestamp: null,
		phase: 'live',
	}))
}
const demoContracts = demoNetworks.flatMap((network) =>
	[
		['0x7A0D94F55792C434d74a40883C6ed8545E406D12', 'Proxy Deployer', 'proxyDeployer', '22181455', true],
		['0x052c04adFF6C1BF51f52158e36441C1e99cdfDB4', 'Deployment Status Oracle', 'deploymentStatusOracle', '22181462', true],
		['0x529dcaC57677451CBfe766d88CcC133D082500df', 'OpenOracle', 'openOracle', '22181501', true],
		['0xaa280cf94Fc3531aDe40b479C17eBef53923291C', 'Zoltar', 'zoltar', undefined, true],
		['0xBea56ec12C943213408DA17f754A523A8aB38947', 'Security Pool Factory', 'securityPoolFactory', undefined, true],
	].map(([address, label, kind, deploymentBlock, exact], index) => ({
		chain_id: network.chain_id,
		address,
		label,
		kind,
		provenance: 'manifest',
		discovery_block: null,
		discovery_tx_hash: null,
		deployment_block: network.id === 'mainnet' ? (deploymentBlock ?? null) : index < 3 ? String(8_750_000 + index * 12) : null,
		deployment_timestamp:
			network.id === 'mainnet' && deploymentBlock !== undefined
				? new Date(Date.now() - (5 - index) * 86_400_000).toISOString()
				: network.id === 'sepolia' && index < 3
					? new Date(Date.now() - (3 - index) * 86_400_000).toISOString()
					: null,
		deployment_block_exact: deploymentBlock === undefined ? null : exact,
		deployment_checked_block: network.indexed_block,
		explorer_base_url: network.explorer_base_url,
	})),
)
const demoEvents = [
	'PoolAccountingCheckpoint',
	'Transfer',
	'PriceReported',
	'ClaimDeposit',
	'DeploySecurityPool',
	'ReportSubmitted',
	'UniverseInitialized',
	'BidSubmitted',
]
const demoLogs = Array.from({ length: 18 }, (_, index) => {
	const network = demoNetworks[index % 3 === 0 ? 1 : 0]
	return {
		chain_id: network.chain_id,
		network_id: network.id,
		block_number: String(BigInt(network.indexed_block) - BigInt(index)),
		block_hash: network.indexed_hash,
		block_timestamp: new Date(new Date(network.indexed_timestamp).getTime() - index * 14_000).toISOString(),
		transaction_index: index % 7,
		log_index: index + 2,
		tx_hash: demoHash.slice(0, -2) + String(index).padStart(2, '0'),
		emitter_address: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
		contract_label: index % 4 === 0 ? 'Security Pool 0x8c2f' : index % 4 === 1 ? 'OpenOracle' : index % 4 === 2 ? 'Genesis REP' : 'Security Pool Factory',
		contract_kind: 'securityPool',
		event_name: demoEvents[index % demoEvents.length],
		summary:
			index % 2 === 0
				? 'amountAttoRep=4,250.75 REP · vault=Market maker (0x19B4…E2a0)'
				: `reportId=1842 · price=0.004281 ${network.id === 'sepolia' ? 'SepoliaETH' : 'ETH'} · outcomeIndex=2`,
		decode_status: index === 7 ? 'unknown' : 'decoded',
		canonical: true,
		finalized: index > 4,
		topics: [demoHash],
		data: '0x00',
		arguments: {
			amountAttoRep: '4250750000000000000000',
			vault: '0x19B4a7C60926D8FBe420C2a49f1DB56D7800E2a0',
			coordinator: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
			recipients: ['0x7777777777777777777777777777777777777777', '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'],
		},
		display_arguments: {
			amountAttoRep: '4,250.75 REP',
			vault: 'Market maker (0x19B4a7C60926D8FBe420C2a49f1DB56D7800E2a0)',
			coordinator: 'OpenOracle (0xc9b36e44643fc5d882654ffd9791ae7171b0e9db)',
			recipients: ['Security Pool (0x7777777777777777777777777777777777777777)', '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'],
		},
		argument_schema: [
			{ index: 0, name: 'amountAttoRep', type: 'uint256' },
			{ index: 1, name: 'vault', type: 'address', indexed: true },
			{ index: 2, name: 'coordinator', type: 'address' },
			{ index: 3, name: 'recipients', type: 'address[]' },
		],
		origin_address: '0x1A620F3dC4Dba34F365C9233C34A22f8F48D2D34',
		explorer_base_url: network.explorer_base_url,
	}
})
const demoRichList = Array.from({ length: 64 }, (_, index) => {
	const network = demoNetworks[index % 3 === 0 ? 1 : 0]
	const address = `0x${(BigInt(index + 1) * 0x123456789abcdefn).toString(16).padStart(40, '0')}`
	const repBalance = BigInt(920 - index * 8) * 10n ** 18n + (index === 0 ? 123_456_789n : 0n)
	const poolCount = 1 + (index % 4)
	const vaultCount = (index + 1) % 3
	return {
		chain_id: network.chain_id,
		network_id: network.id,
		explorer_base_url: network.explorer_base_url,
		address,
		label: index === 2 ? 'Price Coordinator' : null,
		kind: index === 2 ? 'priceCoordinator' : null,
		weth_balance: (BigInt(18 + index) * 10n ** 17n + (index === 0 ? 987_654_321n : 0n)).toString(),
		native_balance: (BigInt(4 + (index % 5)) * 10n ** 17n + (index === 0 ? 456_789_123n : 0n)).toString(),
		rep_token_count: index <= 1 ? '2' : '1',
		sampled_rep_token_count: index === 0 ? '2' : '1',
		weth_token_count: '1',
		sampled_weth_token_count: '1',
		sampled_native_count: '1',
		returned_rep_token_count: index === 0 ? '2' : '1',
		returned_weth_token_count: '1',
		rep_balances_truncated: false,
		weth_balances_truncated: false,
		transaction_count: String(84 - index),
		interaction_count: String(102 - index),
		pool_count: String(poolCount),
		vault_count: String(vaultCount),
		active_vault_count: String(index % 2),
		oldest_balance_block: String(BigInt(network.indexed_block) - BigInt(index % 4)),
		last_balance_refresh: new Date(Date.now() - index * 17_000).toISOString(),
		rep_balances: [
			{
				address: demoNetworks[0].chain_id === network.chain_id ? '0x221657776846890989a759ba2973e427dff5c9bb' : '0x754bc4ca2539560f1b48a9c3d2def5b9718f2c82',
				balance: repBalance.toString(),
				contractLabel: 'Genesis REP',
				universeId: '0',
				symbol: 'REP',
				decimals: 18,
				blockNumber: network.indexed_block,
			},
			...(index === 0
				? [
						{
							address: network.id === 'sepolia' ? '0x86a1c70f2d9d6a0794458c4b2d08f2a1bd9289c1' : '0x4a0f2fc79d092e999aaa1e1e86bd4f3fdb68697b',
							balance: (repBalance / 3n).toString(),
							contractLabel: 'Child REP',
							universeId: '2',
							symbol: 'REP',
							decimals: 18,
							blockNumber: network.indexed_block,
						},
					]
				: []),
		],
		weth_balances: [
			{
				address: '0x0000000000000000000000000000000000000007',
				balance: (BigInt(18 + index) * 10n ** 17n + (index === 0 ? 987_654_321n : 0n)).toString(),
				name: 'Wrapped Ether',
				symbol: 'WETH',
				decimals: 18,
				blockNumber: network.indexed_block,
			},
		],
		native_balance_detail: {
			balance: (BigInt(4 + (index % 5)) * 10n ** 17n + (index === 0 ? 456_789_123n : 0n)).toString(),
			blockNumber: network.indexed_block,
		},
		pool_associations: Array.from({ length: poolCount }, (_, poolIndex) => ({
			address: `0x${(BigInt(index + 1) * 100n + BigInt(poolIndex + 1)).toString(16).padStart(40, 'a')}`,
			label: poolIndex === 0 ? 'Security Pool' : null,
			questionTitle:
				poolIndex === 0
					? network.id === 'sepolia'
						? 'Which client ships the next protocol release first?'
						: 'Will the 2030 global mean temperature anomaly exceed 1.5°C?'
					: null,
		})),
		vault_positions: Array.from({ length: vaultCount }, (_, vaultIndex) => ({
			poolAddress: `0x${(BigInt(index + 1) * 100n + BigInt(vaultIndex + 1)).toString(16).padStart(40, 'a')}`,
			questionTitle:
				network.id === 'sepolia' ? 'Which client ships the next protocol release first?' : 'Will the 2030 global mean temperature anomaly exceed 1.5°C?',
			repBackingUnits: String(BigInt(120 + vaultIndex) * 10n ** 18n),
			capacityOwnershipAttoRep: String(BigInt(85 + vaultIndex) * 10n ** 18n),
			claimableFeesAttoEth: String(BigInt(3 + vaultIndex) * 10n ** 16n),
			blockNumber: network.indexed_block,
		})),
	}
})
const demoInitialTransactionCounts = new Map(demoRichList.map((item) => [`${item.chain_id}:${item.address.toLowerCase()}`, Number(item.transaction_count)]))
const demoNetworkBaselines = new Map(
	demoNetworks.map((network) => [network.chain_id, { blockNumber: BigInt(network.indexed_block), timestamp: new Date(network.indexed_timestamp).getTime() }]),
)

const demoAddress = (seed) => `0x${seed.repeat(40).slice(0, 40)}`
const demoQuestions = [
	{
		chain_id: '1',
		network_id: 'mainnet',
		question_id: '8721049384720193847201',
		title: 'Will the 2030 global mean temperature anomaly exceed 1.5°C?',
		description: 'Resolves Yes when the cited annual dataset reports an anomaly strictly above 1.5°C relative to its stated pre-industrial baseline.',
		created_timestamp: new Date(Date.now() - 96 * 86_400_000).toISOString(),
		start_time: new Date(Date.now() - 90 * 86_400_000).toISOString(),
		end_time: new Date(Date.now() + 620 * 86_400_000).toISOString(),
		num_ticks: '0',
		display_value_min: '0',
		display_value_max: '0',
		answer_unit: '',
		outcome_options: ['Yes', 'No'],
		pool_count: '2',
		fork_count: '0',
	},
	{
		chain_id: '1',
		network_id: 'mainnet',
		question_id: '7346511098237401928374',
		title: 'ETH/USD reference price at 00:00 UTC on 1 January 2028',
		description: 'Scalar outcome using the designated reference venue and UTC observation window.',
		created_timestamp: new Date(Date.now() - 70 * 86_400_000).toISOString(),
		start_time: new Date(Date.now() - 60 * 86_400_000).toISOString(),
		end_time: new Date(Date.now() + 510 * 86_400_000).toISOString(),
		num_ticks: '10000000000000000000000',
		display_value_min: '0',
		display_value_max: '10000000000000000000000',
		answer_unit: 'USD',
		outcome_options: [],
		pool_count: '1',
		fork_count: '1',
	},
	{
		chain_id: '11155111',
		network_id: 'sepolia',
		question_id: '990172635410982736451',
		title: 'Which client ships the next protocol release first?',
		description: 'Testnet categorical market used to exercise pool and universe lifecycle transitions.',
		created_timestamp: new Date(Date.now() - 40 * 86_400_000).toISOString(),
		start_time: new Date(Date.now() - 35 * 86_400_000).toISOString(),
		end_time: new Date(Date.now() - 5 * 86_400_000).toISOString(),
		num_ticks: '0',
		display_value_min: '0',
		display_value_max: '0',
		answer_unit: '',
		outcome_options: ['Atlas', 'Borealis', 'Cygnus'],
		pool_count: '1',
		fork_count: '1',
	},
]
const demoPools = [
	{
		chain_id: '1',
		network_id: 'mainnet',
		pool_address: demoAddress('a'),
		parent_address: demoAddress('0'),
		universe_id: '0',
		question_id: demoQuestions[0].question_id,
		question_title: demoQuestions[0].title,
		truth_auction_address: demoAddress('b'),
		coordinator_address: demoAddress('c'),
		share_token_address: demoAddress('d'),
		security_multiplier_bps: '15000',
		initial_priority_fee_atto_eth_per_gas: '10000000000',
		initial_retention_rate: '999999800000000000',
		initial_settlement_collateral_atto_eth: '182500000000000000000',
		settlement_collateral_atto_eth: '241820000000000000000',
		total_capacity_ownership_atto_rep: '168400000000000000000',
		fee_eligible_capacity_ownership_atto_rep: '154200000000000000000',
		total_claimable_vault_fees_atto_eth: '1280000000000000000',
		unallocated_accrued_fees_atto_eth: '210000000000000000',
		current_retention_rate: '999999700000000000',
		vault_count: '7',
		child_count: '2',
		snapshot_block: '23184712',
	},
	{
		chain_id: '1',
		network_id: 'mainnet',
		pool_address: demoAddress('e'),
		parent_address: demoAddress('a'),
		universe_id: '4102938471029384710293847',
		question_id: demoQuestions[0].question_id,
		question_title: demoQuestions[0].title,
		truth_auction_address: demoAddress('f'),
		coordinator_address: demoAddress('1'),
		share_token_address: demoAddress('2'),
		security_multiplier_bps: '15000',
		initial_priority_fee_atto_eth_per_gas: '10000000000',
		initial_retention_rate: '999999800000000000',
		initial_settlement_collateral_atto_eth: '92000000000000000000',
		settlement_collateral_atto_eth: '117400000000000000000',
		total_capacity_ownership_atto_rep: '78200000000000000000',
		fee_eligible_capacity_ownership_atto_rep: '73900000000000000000',
		total_claimable_vault_fees_atto_eth: '430000000000000000',
		unallocated_accrued_fees_atto_eth: '80000000000000000',
		current_retention_rate: '999999700000000000',
		vault_count: '4',
		child_count: '0',
		snapshot_block: '23184710',
	},
	{
		chain_id: '1',
		network_id: 'mainnet',
		pool_address: demoAddress('3'),
		parent_address: demoAddress('0'),
		universe_id: '0',
		question_id: demoQuestions[1].question_id,
		question_title: demoQuestions[1].title,
		truth_auction_address: demoAddress('4'),
		coordinator_address: demoAddress('5'),
		share_token_address: demoAddress('6'),
		security_multiplier_bps: '17500',
		initial_priority_fee_atto_eth_per_gas: '12000000000',
		initial_retention_rate: '999999500000000000',
		initial_settlement_collateral_atto_eth: '44000000000000000000',
		settlement_collateral_atto_eth: '68900000000000000000',
		total_capacity_ownership_atto_rep: '35500000000000000000',
		fee_eligible_capacity_ownership_atto_rep: '32100000000000000000',
		total_claimable_vault_fees_atto_eth: '190000000000000000',
		unallocated_accrued_fees_atto_eth: '40000000000000000',
		current_retention_rate: '999999400000000000',
		vault_count: '3',
		child_count: '0',
		snapshot_block: '23184698',
	},
	{
		chain_id: '11155111',
		network_id: 'sepolia',
		pool_address: demoAddress('7'),
		parent_address: demoAddress('0'),
		universe_id: '0',
		question_id: demoQuestions[2].question_id,
		question_title: demoQuestions[2].title,
		truth_auction_address: demoAddress('8'),
		coordinator_address: demoAddress('9'),
		share_token_address: demoAddress('a1'),
		security_multiplier_bps: '15000',
		initial_priority_fee_atto_eth_per_gas: '10000000000',
		initial_retention_rate: '999999800000000000',
		initial_settlement_collateral_atto_eth: '12000000000000000000',
		settlement_collateral_atto_eth: '18400000000000000000',
		total_capacity_ownership_atto_rep: '9700000000000000000',
		fee_eligible_capacity_ownership_atto_rep: '8800000000000000000',
		total_claimable_vault_fees_atto_eth: '70000000000000000',
		unallocated_accrued_fees_atto_eth: '9000000000000000',
		current_retention_rate: '999999700000000000',
		vault_count: '5',
		child_count: '1',
		snapshot_block: '8972451',
	},
]
const demoVaults = Array.from({ length: 9 }, (_, index) => {
	const poolItem = demoPools[index % demoPools.length]
	return {
		chain_id: poolItem.chain_id,
		network_id: poolItem.network_id,
		pool_address: poolItem.pool_address,
		vault_address: demoAddress(`${(index + 2).toString(16)}f`),
		question_title: poolItem.question_title,
		rep_backing_units: String((920_000 + index * 143_000) * 1e12),
		capacity_ownership_atto_rep: String(BigInt(18 + index * 4) * 10n ** 18n),
		claimable_fees_atto_eth: String(BigInt(4 + index) * 10n ** 16n),
		fee_index: String(BigInt(1200 + index * 170) * 10n ** 15n),
		vault_fee_remainder: String(index * 13),
		resulting_total_rep_backing_units: '6410000000000000000',
		resulting_fee_eligible_capacity_ownership_atto_rep: poolItem.fee_eligible_capacity_ownership_atto_rep,
		block_number: String(23184700 - index),
	}
})
const demoUniverses = [
	{
		chain_id: '1',
		network_id: 'mainnet',
		universe_id: '0',
		parent_universe_id: '0',
		forking_outcome_index: '0',
		reputation_token_address: demoAddress('91'),
		theoretical_supply_atto_rep: '11000000000000000000000000',
		active_fork_question_id: demoQuestions[1].question_id,
		active_fork_time: new Date(Date.now() - 45 * 86_400_000).toISOString(),
		forker_address: demoAddress('77'),
		fork_threshold_atto_rep: '1200000000000000000000000',
		migration_rep_balance_atto_rep: '960000000000000000000000',
		child_count: '3',
		pool_count: '2',
	},
	{
		chain_id: '1',
		network_id: 'mainnet',
		universe_id: '4102938471029384710293847',
		parent_universe_id: '0',
		forking_outcome_index: '1',
		reputation_token_address: demoAddress('92'),
		theoretical_supply_atto_rep: '10920000000000000000000000',
		active_fork_question_id: null,
		active_fork_time: null,
		child_count: '0',
		pool_count: '1',
	},
	{
		chain_id: '1',
		network_id: 'mainnet',
		universe_id: '5102938471029384710293847',
		parent_universe_id: '0',
		forking_outcome_index: '2',
		reputation_token_address: demoAddress('93'),
		theoretical_supply_atto_rep: '10920000000000000000000000',
		active_fork_question_id: null,
		active_fork_time: null,
		child_count: '0',
		pool_count: '0',
	},
	{
		chain_id: '1',
		network_id: 'mainnet',
		universe_id: '6102938471029384710293847',
		parent_universe_id: '0',
		forking_outcome_index: '0',
		reputation_token_address: demoAddress('94'),
		theoretical_supply_atto_rep: '10920000000000000000000000',
		active_fork_question_id: null,
		active_fork_time: null,
		child_count: '0',
		pool_count: '0',
	},
	{
		chain_id: '11155111',
		network_id: 'sepolia',
		universe_id: '0',
		parent_universe_id: '0',
		forking_outcome_index: '0',
		reputation_token_address: demoAddress('95'),
		theoretical_supply_atto_rep: '7200000000000000000000000',
		active_fork_question_id: demoQuestions[2].question_id,
		active_fork_time: new Date(Date.now() - 4 * 86_400_000).toISOString(),
		forker_address: demoAddress('78'),
		fork_threshold_atto_rep: '800000000000000000000000',
		migration_rep_balance_atto_rep: '640000000000000000000000',
		child_count: '1',
		pool_count: '1',
	},
	{
		chain_id: '11155111',
		network_id: 'sepolia',
		universe_id: '8102938471029384710293847',
		parent_universe_id: '0',
		forking_outcome_index: '2',
		reputation_token_address: demoAddress('96'),
		theoretical_supply_atto_rep: '7080000000000000000000000',
		active_fork_question_id: null,
		active_fork_time: null,
		child_count: '0',
		pool_count: '0',
	},
]
const demoCatalog = {
	questions: demoQuestions,
	pools: demoPools,
	vaults: demoVaults,
	universes: demoUniverses,
	poolStates: demoPools.map((poolItem, index) => ({
		chain_id: poolItem.chain_id,
		pool_address: poolItem.pool_address,
		event_name: 'CurrentDemoState',
		state: {
			systemState: index === 1 ? '2' : '0',
			awaitingForkContinuation: index === 1,
			totalRepBackingUnits: String(BigInt(6_400_000 + index * 1_200_000) * 10n ** 12n),
			shareTokenSupplyAttoShares: String(BigInt(220 + index * 70) * 10n ** 18n),
			escalationGame: demoAddress(`${index + 4}e`),
		},
	})),
}

const demoSeries = (base, count = 12, variation = 0.32) =>
	Array.from({ length: count }, (_, index) => {
		const factor = 1 - variation + (variation * index) / Math.max(1, count - 1) + Math.sin(index * 1.4) * 0.025
		return String(BigInt(Math.max(1, Math.round(Number(base) * factor))))
	})

const demoHistory = (path) => {
	const parts = path.split('/')
	const type = parts[4]
	if (type === 'pools') {
		const poolItem = demoPools.find((item) => item.pool_address === parts[6]) ?? demoPools[0]
		const collateral = demoSeries(poolItem.settlement_collateral_atto_eth)
		const capacity = demoSeries(poolItem.total_capacity_ownership_atto_rep, 12, 0.4)
		const hasAmm = poolItem.question_id === demoQuestions[0].question_id
		const hasRepEthPrices = poolItem !== demoPools[2]
		const repEthPrices = demoRepEthPriceHistory()
		const displayedRepEthPrices =
			priceDemo === 'constant-zero'
				? [{ ...repEthPrices[0], rep_per_eth_1e18: '0' }]
				: priceDemo === 'constant-nonzero'
					? [repEthPrices[0]]
					: priceDemo === 'constant-repeated'
						? repEthPrices.slice(0, 3).map((price) => ({ ...price, rep_per_eth_1e18: repEthPrices[0].rep_per_eth_1e18 }))
						: repEthPrices
		return {
			snapshots: collateral.map((value, index) => ({
				timestamp: new Date(Date.now() - (11 - index) * 7 * 86_400_000).toISOString(),
				block_number: String(23100000 + index * 7700),
				settlement_collateral_atto_eth: value,
				total_capacity_ownership_atto_rep: capacity[index],
				total_claimable_vault_fees_atto_eth: String(BigInt(20 + index * 8) * 10n ** 16n),
				current_retention_rate: poolItem.current_retention_rate,
			})),
			events: [],
			market: hasAmm
				? {
						pair_address: demoAddress('fa'),
						pool_address: poolItem.pool_address,
						share_token_address: poolItem.share_token_address,
						universe_id: poolItem.universe_id,
						fee_bps: '30',
					}
				: undefined,
			ammPrices: hasAmm ? demoAmmPriceHistory() : [],
			repEthPrices: hasRepEthPrices ? displayedRepEthPrices : [],
			uniswapRepEthPrices: hasRepEthPrices ? (priceDemo === 'eight' ? demoDenseUniswapRepEthPriceHistory() : demoUniswapRepEthPriceHistory()) : [],
		}
	}
	if (type === 'vaults') {
		const vaultItem = demoVaults.find((item) => item.pool_address === parts[6] && item.vault_address === parts[7]) ?? demoVaults[0]
		const rep = demoSeries(vaultItem.rep_backing_units, 10, 0.45)
		const capacity = demoSeries(vaultItem.capacity_ownership_atto_rep, 10, 0.5)
		return {
			snapshots: rep.map((value, index) => ({
				timestamp: new Date(Date.now() - (9 - index) * 8 * 86_400_000).toISOString(),
				block_number: String(23110000 + index * 6800),
				rep_backing_units: value,
				capacity_ownership_atto_rep: capacity[index],
				claimable_fees_atto_eth: String(BigInt(1 + index) * 10n ** 16n),
			})),
		}
	}
	if (type === 'universes') {
		const universe = demoUniverses.find((item) => item.universe_id === parts[6]) ?? demoUniverses[0]
		const supply = Array.from({ length: 9 }, (_, index) => String((BigInt(universe.theoretical_supply_atto_rep) * BigInt(108 - index)) / 100n))
		return {
			events: supply.map((value, index) => ({
				timestamp: new Date(Date.now() - (8 - index) * 12 * 86_400_000).toISOString(),
				block_number: String(23080000 + index * 11000),
				event_name: index === 0 ? 'UniverseInitialized' : index === 4 ? 'UniverseForked' : 'MigrationRepAdded',
				theoretical_supply_atto_rep: value,
			})),
		}
	}
	return {
		pools: demoPools
			.filter((item) => item.question_id === parts[6])
			.map((item, index) => ({ ...item, timestamp: new Date(Date.now() - (50 - index * 12) * 86_400_000).toISOString() })),
		forks: [],
	}
}

let demoLiveSequence = 0
const applyDemoBlock = (payload) => {
	if (!isDemo || pageUrl.searchParams.get('streamDemo') !== '1') return
	const chainId = String(payload.chainId)
	const network = demoNetworks.find((item) => item.chain_id === chainId)
	if (network === undefined) return
	demoLiveSequence++
	const nextBlock = String(payload.blockNumber ?? BigInt(network.indexed_block) + 1n)
	const nextHash = `0x${BigInt(demoLiveSequence).toString(16).padStart(64, '0')}`
	const timestamp = new Date().toISOString()
	network.indexed_block = nextBlock
	network.indexed_hash = nextHash
	network.indexed_timestamp = timestamp
	network.observed_block = nextBlock
	network.finalized_block = String(BigInt(nextBlock) - 64n)
	network.last_poll_at = timestamp
	network.last_success_at = timestamp
	const template = demoLogs.find((item) => item.chain_id === chainId) ?? demoLogs[0]
	demoLogs.unshift({
		...template,
		block_number: nextBlock,
		block_hash: nextHash,
		block_timestamp: timestamp,
		transaction_index: 0,
		log_index: demoLiveSequence,
		tx_hash: `0x${(BigInt(demoLiveSequence) + 10_000n).toString(16).padStart(64, '0')}`,
		event_name: demoLiveSequence % 2 === 0 ? 'PoolAccountingCheckpoint' : 'Transfer',
		summary: demoLiveSequence % 2 === 0 ? 'New pool accounting checkpoint' : 'New token transfer',
	})
	if (demoLogs.length > 120) demoLogs.length = 120
	const account = demoRichList.find((item) => item.chain_id === chainId)
	if (account !== undefined) {
		account.transaction_count = String(Number(account.transaction_count) + 1)
		account.interaction_count = String(Number(account.interaction_count) + 1)
		account.native_balance = (BigInt(account.native_balance) + 10_000_000_000_000_000n).toString()
		account.native_balance_detail = { balance: account.native_balance, blockNumber: nextBlock }
		account.last_balance_refresh = timestamp
	}
	const pool = demoPools.find((item) => item.chain_id === chainId)
	if (pool !== undefined) {
		pool.snapshot_block = nextBlock
		pool.settlement_collateral_atto_eth = (BigInt(pool.settlement_collateral_atto_eth) + 10_000_000_000_000_000n).toString()
	}
}

const element = (tag, className, text) => {
	const node = document.createElement(tag)
	if (className) node.className = className
	if (text !== undefined) node.textContent = text
	return node
}

const short = (value, front = 6, back = 4) => (value ? `${value.slice(0, front)}…${value.slice(-back)}` : '—')
const shortIdentifier = (value, front = 6, back = 4) => {
	const text = String(value ?? '')
	return text.length > front + back + 1 ? short(text, front, back) : text || '—'
}
const number = (value) => (value === null || value === undefined ? '—' : new Intl.NumberFormat('en-US').format(Number(value)))
const counted = (value, singular, plural = `${singular}s`) => `${number(value)} ${Number(value) === 1 ? singular : plural}`
const time = (value) =>
	value
		? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', hour12: false }).format(new Date(value))
		: '—'
const age = (value) => {
	if (!value) return 'not indexed'
	const seconds = Math.max(0, Math.floor((Date.now() + serverClockOffsetMs - new Date(value).getTime()) / 1000))
	if (seconds < 60) return `${seconds}s ago`
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
	return `${Math.floor(seconds / 86400)}d ago`
}
const exactTimestamp = (value) => (value ? new Date(value).toISOString() : 'No indexed timestamp')
const until = (value) => {
	if (!value) return 'time unknown'
	const seconds = Math.ceil((new Date(value).getTime() - Date.now()) / 1000)
	return seconds <= 0 ? 'now' : seconds < 60 ? `in ${seconds}s` : `in ${Math.ceil(seconds / 60)}m`
}

const api = async (path, { signal } = {}) => {
	if (isDemo) {
		if (path.startsWith('/api/v1/networks')) {
			if (networkState === 'error') throw new Error('Network status could not be refreshed')
			demoNetworkRequests++
			const items = demoNetworkItems()
			return {
				items:
					pageUrl.searchParams.get('networkFallbackAfterLoad') === '1' && demoNetworkRequests > 1 ? items.filter((network) => network.chain_id !== '1') : items,
			}
		}
		if (path.startsWith('/api/v1/contracts')) {
			const chainId = new URL(path, location.origin).searchParams.get('chainId')
			return { items: demoContracts.filter((contract) => contract.chain_id === chainId) }
		}
		if (path.startsWith('/api/v1/state/catalog')) {
			if (demoReorgObserved && pageUrl.searchParams.get('canonicalRouteRefreshError') === '1' && !demoCanonicalRouteRefreshErrorConsumed) {
				demoCanonicalRouteRefreshErrorConsumed = true
				throw new Error('The system state could not be refreshed')
			}
			if (demoState === 'error' && !demoErrorConsumed) {
				demoErrorConsumed = true
				throw new Error('The state catalog could not be read from the database')
			}
			if (demoState === 'loading') return await new Promise(() => {})
			if (demoState === 'delayed') await new Promise((resolve) => setTimeout(resolve, 300))
			const request = new URL(path, location.origin)
			const chainId = request.searchParams.get('chainId')
			return Object.fromEntries(Object.entries(demoCatalog).map(([key, items]) => [key, items.filter((item) => !chainId || String(item.chain_id) === chainId)]))
		}
		if (path.startsWith('/api/v1/state/')) {
			demoStateDetailRequests++
			if (detailState === 'error' && !demoDetailErrorConsumed) {
				demoDetailErrorConsumed = true
				throw new Error('Historical checkpoints could not be read')
			}
			if (detailState === 'refresh-error' && demoStateDetailRequests === 2) throw new Error('The newest checkpoint could not be read')
			if (detailState === 'loading') return await new Promise(() => {})
			if (detailState === 'delayed') await new Promise((resolve) => setTimeout(resolve, 800))
			return demoHistory(path)
		}
		if (path.startsWith('/api/v1/address-transactions')) {
			const request = new URL(path, location.origin)
			const chainId = request.searchParams.get('chainId')
			const address = request.searchParams.get('address')?.toLowerCase()
			const cursor = request.searchParams.get('cursor')
			demoTransactionRequests++
			window.__demoTransactionRequests = demoTransactionRequests
			if (pageUrl.searchParams.get('transactionAppendDelay') === '1' && cursor !== null) await new Promise((resolve) => setTimeout(resolve, 1_500))
			if (pageUrl.searchParams.get('transactionAppendErrorOnce') === '1' && cursor !== null && !demoTransactionAppendErrorConsumed) {
				demoTransactionAppendErrorConsumed = true
				throw new Error('The next transaction page could not be read')
			}
			if (
				(pageUrl.searchParams.get('transactionLiveRefreshDelay') === '1' || pageUrl.searchParams.get('transactionLiveRefreshDelayLong') === '1') &&
				!canonicalRefreshRequired &&
				cursor === null &&
				demoTransactionRequests > 1
			)
				await new Promise((resolve) => setTimeout(resolve, pageUrl.searchParams.get('transactionLiveRefreshDelayLong') === '1' ? 3_500 : 800))
			if (pageUrl.searchParams.get('transactionRestoreDelay') === '1' && canonicalRefreshRequired && cursor === null && demoTransactionRequests > 1)
				await new Promise((resolve) => setTimeout(resolve, 800))
			if (
				pageUrl.searchParams.get('transactionRestoreErrorOnce') === '1' &&
				cursor === null &&
				demoTransactionRequests > 1 &&
				!demoTransactionRestoreErrorConsumed
			) {
				demoTransactionRestoreErrorConsumed = true
				throw new Error('The account transactions could not be restored')
			}
			if (
				cursor !== null &&
				((pageUrl.searchParams.get('transactionCursor409') === '1' && !demoTransactionSnapshotInvalidated) ||
					pageUrl.searchParams.get('transactionCursor409Always') === '1')
			) {
				if (pageUrl.searchParams.get('transactionCursor409Always') !== '1') demoTransactionSnapshotInvalidated = true
				const error = new Error('The transaction snapshot changed after a chain update')
				error.status = 409
				throw error
			}
			if (pageUrl.searchParams.get('transactionRefreshError') === '1' && cursor === null && demoTransactionRequests > 1)
				throw new Error('The newest account transactions could not be read')
			if (demoReorgObserved && pageUrl.searchParams.get('evictTransactionOnReorg') === '1') demoTransactionSnapshotInvalidated = true
			const offset = cursor ? Number(JSON.parse(atob(cursor))) : 0
			const limit = Number(request.searchParams.get('limit') ?? 50)
			const owner = demoRichList.find((item) => item.chain_id === chainId && item.address.toLowerCase() === address)
			const total = Math.max(0, Number(owner?.transaction_count ?? 0) - (demoTransactionSnapshotInvalidated ? 1 : 0))
			const network = demoNetworks.find((item) => item.chain_id === chainId)
			const items = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, itemIndex) => {
				const index = offset + itemIndex + (demoTransactionSnapshotInvalidated ? 1 : 0)
				const initialTotal = demoInitialTransactionCounts.get(`${chainId}:${address}`) ?? total
				const ordinal = Number(owner?.transaction_count ?? 0) - index - 1
				const liveOrdinal = ordinal - initialTotal
				const baseline = demoNetworkBaselines.get(chainId)
				const blockNumber =
					liveOrdinal >= 0
						? (baseline?.blockNumber ?? 0n) + BigInt(liveOrdinal + 1)
						: (baseline?.blockNumber ?? 0n) - BigInt(Math.max(0, initialTotal - ordinal - 1))
				const blockTimestamp = new Date((baseline?.timestamp ?? Date.now()) + (liveOrdinal >= 0 ? liveOrdinal + 1 : -(initialTotal - ordinal - 1)) * 14_000)
				const toAddress = ordinal % 2 === 0 ? '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db' : '0x7777777777777777777777777777777777777777'
				return {
					chain_id: chainId,
					tx_hash: `${demoHash.slice(0, -8)}${ordinal.toString(16).padStart(8, '0')}`,
					block_hash: `0x${blockNumber.toString(16).padStart(64, '0')}`,
					block_number: String(blockNumber),
					block_timestamp: blockTimestamp.toISOString(),
					transaction_index: ordinal % 12,
					from_address: owner?.address,
					to_address: toAddress,
					to_label: ordinal % 2 === 0 ? 'OpenOracle' : 'Security Pool',
					to_kind: ordinal % 2 === 0 ? 'openOracle' : 'securityPool',
					value: ordinal % 4 === 0 ? '125000000000000000' : '0',
					status: 'success',
					gas_used: String(94_000 + ordinal * 117),
					function_name: ordinal % 2 === 0 ? 'report' : 'checkpointPoolAccounting',
					function_signature: ordinal % 2 === 0 ? 'report((...),bool,bool,(...))' : 'checkpointPoolAccounting(uint8)',
					action_summary: ordinal % 2 === 0 ? 'report · reportId=1842' : 'checkpointPoolAccounting · reason=Trade',
					action_arguments:
						ordinal % 2 === 0
							? {
									reporter: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
									recipients: ['0x7777777777777777777777777777777777777777', '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'],
								}
							: { reason: '1' },
					action_display_arguments:
						ordinal % 2 === 0
							? {
									reporter: 'OpenOracle (0xc9b36e44643fc5d882654ffd9791ae7171b0e9db)',
									recipients: ['Security Pool (0x7777777777777777777777777777777777777777)', '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'],
								}
							: { reason: 'Trade' },
					action_argument_schema:
						ordinal % 2 === 0
							? [
									{ index: 0, name: 'reporter', type: 'address' },
									{ index: 1, name: 'recipients', type: 'address[]' },
								]
							: [{ index: 0, name: 'reason', type: 'uint8' }],
					explorer_base_url: network?.explorer_base_url,
				}
			})
			const nextOffset = offset + items.length
			return { items, total, limit, snapshotBlock: network?.indexed_block, nextCursor: nextOffset < total ? btoa(JSON.stringify(nextOffset)) : undefined }
		}
		if (path.startsWith('/api/v1/address-interactions')) {
			const transactions = await api(path.replace('/address-interactions', '/address-transactions'))
			return {
				...transactions,
				items: transactions.items
					.filter((_, index) => index % 3 === 0)
					.map((transaction, index) => ({
						...transaction,
						roles: ['referenced'],
						pool_addresses: index % 2 === 0 ? ['0x7777777777777777777777777777777777777777'] : [],
					})),
			}
		}
		if (path.startsWith('/api/v1/address-identity')) {
			const request = new URL(path, location.origin)
			const chainId = request.searchParams.get('chainId')
			const address = request.searchParams.get('address')?.toLowerCase()
			const owner = demoRichList.find((item) => item.chain_id === chainId && item.address.toLowerCase() === address)
			const fixedIdentity = {
				'0xc9b36e44643fc5d882654ffd9791ae7171b0e9db': ['OpenOracle', 'openOracle'],
				'0x7777777777777777777777777777777777777777': ['Security Pool', 'securityPool'],
			}[address]
			const catalogIdentity = [
				...demoPools.flatMap((pool) => [
					[pool.chain_id, pool.pool_address, 'Security Pool', 'securityPool'],
					[pool.chain_id, pool.share_token_address, 'Share token', 'shareToken'],
					[pool.chain_id, pool.coordinator_address, 'Price coordinator', 'priceCoordinator'],
					[pool.chain_id, pool.truth_auction_address, 'Truth auction', 'truthAuction'],
				]),
				...demoUniverses.map((universe) => [
					universe.chain_id,
					universe.reputation_token_address,
					universe.universe_id === '0' ? 'Genesis REP' : `Child REP · universe ${shortIdentifier(universe.universe_id)}`,
					'reputationToken',
				]),
				...demoRichList.flatMap((item) =>
					[...(item.rep_balances ?? []), ...(item.weth_balances ?? [])].map((token) => [
						item.chain_id,
						token.address,
						token.contractLabel ?? token.name,
						token.universeId === undefined ? 'weth' : 'reputationToken',
					]),
				),
			].find(([identityChainId, identityAddress]) => identityChainId === chainId && identityAddress.toLowerCase() === address)
			return {
				chainId,
				address,
				label: owner?.label ?? fixedIdentity?.[0] ?? catalogIdentity?.[2],
				kind: owner?.kind ?? fixedIdentity?.[1] ?? catalogIdentity?.[3],
			}
		}
		if (path.startsWith('/api/v1/richlist')) {
			demoRichListRequests++
			const richRefreshErrorRequest = Number(pageUrl.searchParams.get('routeRefreshErrorRequest'))
			if (
				((pageUrl.searchParams.get('routeRefreshErrorAfterLoad') === '1' && demoRichListRequests > 1) ||
					(Number.isInteger(richRefreshErrorRequest) && richRefreshErrorRequest > 0 && demoRichListRequests === richRefreshErrorRequest)) &&
				!demoRouteRefreshErrorConsumed
			) {
				demoRouteRefreshErrorConsumed = true
				throw new Error('The newest account rankings could not be read')
			}
			if (demoReorgObserved && pageUrl.searchParams.get('canonicalRouteRefreshError') === '1' && !demoCanonicalRouteRefreshErrorConsumed) {
				demoCanonicalRouteRefreshErrorConsumed = true
				throw new Error('The account state could not be refreshed')
			}
			const request = new URL(path, location.origin)
			const chainId = request.searchParams.get('chainId')
			const address = request.searchParams.get('address')?.toLowerCase()
			const offset = Number(request.searchParams.get('offset') ?? 0)
			const limit = Number(request.searchParams.get('limit') ?? 50)
			if (pageUrl.searchParams.get('richAppendDelay') === '1' && offset > 0) await new Promise((resolve) => setTimeout(resolve, 1_500))
			const filtered = demoRichList.filter(
				(item) =>
					(!chainId || item.chain_id === chainId) &&
					(!address || item.address.toLowerCase() === address) &&
					!(demoReorgObserved && pageUrl.searchParams.get('evictAccountOnReorg') === '1' && item.address.toLowerCase() === demoEvictedAddress),
			)
			const ranked =
				pageUrl.searchParams.get('richPaginationDemo') === '1' && address === undefined && filtered.length > 0
					? Array.from({ length: 120 }, (_, index) => ({
							...filtered[index % filtered.length],
							address: `0x${BigInt(index + 1)
								.toString(16)
								.padStart(40, '0')}`,
						}))
					: filtered
			return { items: ranked.slice(offset, offset + limit), total: ranked.length, limit, offset }
		}
		if (path.startsWith('/api/v1/logs/') && path.split('/').length > 7) {
			if (detailState === 'error' && !demoDetailErrorConsumed) {
				demoDetailErrorConsumed = true
				throw new Error('The receipt could not be read from the RPC')
			}
			if (detailState === 'loading') return await new Promise(() => {})
			const [, , , , requestedChainId, , requestedTransactionHash, requestedLogIndex] = path.split('/')
			if (demoReorgObserved && pageUrl.searchParams.get('logRemovedOnReorg') === '1') {
				const error = new Error('The log was replaced after a chain update')
				error.status = 404
				throw error
			}
			const detailLog =
				demoLogs.find(
					(item) => item.chain_id === requestedChainId && item.tx_hash === requestedTransactionHash && item.log_index === Number(requestedLogIndex),
				) ?? demoLogs[0]
			const detailNetwork = demoNetworks.find((network) => network.chain_id === detailLog.chain_id)
			return {
				...detailLog,
				block_timestamp: detailLog.block_timestamp,
				from_address: '0x1A620F3dC4Dba34F365C9233C34A22f8F48D2D34',
				to_address: '0x7777777777777777777777777777777777777777',
				value: '0',
				input: '0x4f8b2f2d',
				gas_used: '184220',
				contract_provenance:
					pageUrl.searchParams.get('detailLiveDemo') === '1'
						? `Security Pool Factory.DeploySecurityPool · indexed block ${detailNetwork?.indexed_block}`
						: 'Security Pool Factory.DeploySecurityPool',
				explorer_base_url: detailNetwork?.id === 'sepolia' ? 'https://sepolia.etherscan.io' : 'https://etherscan.io',
				action_arguments: {
					reason: '1',
					route: ['0xc9b36e44643fc5d882654ffd9791ae7171b0e9db', '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'],
				},
				action_display_arguments: {
					reason: 'Trade',
					route: ['OpenOracle (0xc9b36e44643fc5d882654ffd9791ae7171b0e9db)', '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'],
				},
				action_argument_schema: [
					{ index: 0, name: 'reason', type: 'uint8' },
					{ index: 1, name: 'route', type: 'address[]' },
				],
				receipt: {
					transactionHash: detailLog.tx_hash,
					blockHash: detailLog.block_hash,
					blockNumber: detailLog.block_number,
					status: 'success',
					gasUsed: '184220',
					logs: demoLogs.slice(0, 4).map(({ emitter_address: address, topics, data, log_index: logIndex }) => ({ address, topics, data, logIndex })),
				},
				event_signature: 'event PoolAccountingCheckpoint(address indexed securityPool, uint256 totalRepBackingUnits)',
				action_summary: 'checkpoint(reason=Trade)',
				relatedLogs: demoLogs.slice(0, 4),
			}
		}
		if (path.startsWith('/api/v1/logs')) {
			demoLogRequests++
			const activityRefreshErrorRequest = Number(pageUrl.searchParams.get('routeRefreshErrorRequest'))
			if (
				((pageUrl.searchParams.get('routeRefreshErrorAfterLoad') === '1' && demoLogRequests > 1) ||
					(Number.isInteger(activityRefreshErrorRequest) && activityRefreshErrorRequest > 0 && demoLogRequests === activityRefreshErrorRequest)) &&
				!demoRouteRefreshErrorConsumed
			) {
				demoRouteRefreshErrorConsumed = true
				throw new Error('The newest activity could not be read')
			}
			if (pageUrl.searchParams.get('networkFallbackRouteError') === '1' && selectedChainId() !== '1' && !demoNetworkFallbackErrorConsumed) {
				demoNetworkFallbackErrorConsumed = true
				throw new Error('Activity could not be loaded for the fallback network')
			}
			if (pageUrl.searchParams.get('reorgRefreshError') === '1' && demoLogRequests > 1 && !demoReorgRefreshErrorConsumed) {
				demoReorgRefreshErrorConsumed = true
				throw new Error('Activity could not be refreshed after the chain changed')
			}
			if (demoState === 'error' && !demoErrorConsumed) {
				demoErrorConsumed = true
				throw new Error('RPC history is temporarily unavailable')
			}
			if (demoState === 'loading') return await new Promise(() => {})
			if (demoState === 'delayed-logs') {
				demoRouteRequestsInFlight++
				demoMaxRouteRequestsInFlight = Math.max(demoMaxRouteRequestsInFlight, demoRouteRequestsInFlight)
				window.__demoMaxRouteRequestsInFlight = demoMaxRouteRequestsInFlight
				try {
					await new Promise((resolve) => setTimeout(resolve, 800))
				} finally {
					demoRouteRequestsInFlight--
				}
			}
			const request = new URL(path, location.origin)
			const chainId = request.searchParams.get('chainId')
			const event = request.searchParams.get('event')?.toLowerCase()
			const address = request.searchParams.get('address')?.toLowerCase()
			if (address && !/^0x[0-9a-f]{40}$/.test(address)) throw new Error('Address filter is invalid')
			const filtered =
				demoState === 'empty'
					? []
					: demoLogs.filter(
							(item) =>
								(!chainId || item.chain_id === chainId) &&
								(!event || item.event_name?.toLowerCase().includes(event)) &&
								(!address || [item.emitter_address, item.origin_address].some((candidate) => candidate?.toLowerCase() === address)),
						)
			if (pageUrl.searchParams.get('logPaginationDemo') !== '1' || filtered.length === 0) return { items: filtered }
			const expanded = Array.from({ length: 220 }, (_, index) => {
				const ordinal = demoReorgObserved ? (index === 0 ? 10_000 : index - 1) : index
				const template = filtered[ordinal % filtered.length]
				return {
					...template,
					block_number: String(23_184_711 - Math.min(ordinal, 219)),
					block_hash: `0x${BigInt(50_000 + ordinal)
						.toString(16)
						.padStart(64, '0')}`,
					tx_hash: `0x${BigInt(100_000 + ordinal)
						.toString(16)
						.padStart(64, '0')}`,
					log_index: ordinal,
					summary: ordinal === 10_000 ? 'Canonical replacement after chain reorganization' : template.summary,
				}
			})
			const offset = request.searchParams.get('cursor') ? Number(JSON.parse(atob(request.searchParams.get('cursor')))) : 0
			const limit = Number(request.searchParams.get('limit') ?? 100)
			const nextOffset = offset + limit
			return { items: expanded.slice(offset, nextOffset), nextCursor: nextOffset < expanded.length ? btoa(JSON.stringify(nextOffset)) : undefined }
		}
	}
	const timeout = AbortSignal.timeout(15_000)
	const response = await fetch(path, { signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]) })
	const payload = await response.json().catch(() => ({}))
	if (!response.ok) {
		const error = new Error(payload.error ?? `Request failed (${response.status})`)
		error.status = response.status
		throw error
	}
	return payload
}

const renderNetworks = (networks) => {
	let selectedReorgAdvanced = false
	for (const network of networks) {
		const previous = latestNetworks.find((item) => String(item.chain_id) === String(network.chain_id))
		const reorgAdvanced = previous && network.last_reorg_at && previous.last_reorg_at !== network.last_reorg_at
		if (reorgAdvanced) {
			invalidateAddressIdentityCache(network.chain_id)
			if (String(network.chain_id) === selectedChainId()) selectedReorgAdvanced = true
		} else if (previous && previous.indexed_hash !== network.indexed_hash) invalidateAddressIdentityCache(network.chain_id, true)
	}
	latestNetworks = networks
	if (selectedReorgAdvanced && activeReorgRecovery !== undefined) activeReorgRecovery.pendingRefresh = true
	else if (selectedReorgAdvanced && polledReorgRefreshTimer === undefined) {
		const chainId = selectedChainId()
		polledReorgRefreshTimer = window.setTimeout(() => {
			polledReorgRefreshTimer = undefined
			if (selectedChainId() === chainId && activeReorgRecovery === undefined)
				void refreshCanonicalViews('Chain reorganization detected', 'Address identities and views are refreshing.')
		}, 0)
	}
	networkCards.classList.remove('empty')
	networkCards.replaceChildren()
	for (const network of networks.filter((item) => String(item.chain_id) === selectedChainId())) {
		const progress = indexerProgressEstimate(network, indexerProgressSamples.get(String(network.chain_id)))
		if (progress.sample !== undefined) indexerProgressSamples.set(String(network.chain_id), progress.sample)
		const card = setLiveRecord(element('article', 'network-card'), String(network.chain_id), {
			indexedBlock: network.indexed_block,
			indexedHash: network.indexed_hash,
			indexedTimestamp: network.indexed_timestamp,
			observedBlock: network.observed_block,
			phase: network.phase,
			failures: network.consecutive_failures,
		})
		card.dataset.phase = network.phase
		const title = element('div', 'network-title')
		const badge = element('span', 'badge', network.phase)
		title.append(badge)
		const block = element(
			network.indexed_block && network.explorer_base_url ? 'a' : 'p',
			'block-number',
			network.indexed_block ? `#${number(network.indexed_block)}` : 'Awaiting first block',
		)
		if (block instanceof HTMLAnchorElement) {
			block.href = `${String(network.explorer_base_url).replace(/\/$/, '')}/block/${network.indexed_block}`
			block.target = '_blank'
			block.rel = 'noreferrer'
			block.title = `Open block ${network.indexed_block} in the network explorer`
		}
		const meta = element('div', 'block-meta')
		const indexedTime = element(
			'time',
			'',
			network.indexed_timestamp ? `${exactTimestamp(network.indexed_timestamp).slice(0, 10)} · ${time(network.indexed_timestamp)} UTC` : 'No timestamp',
		)
		if (network.indexed_timestamp) indexedTime.dateTime = exactTimestamp(network.indexed_timestamp)
		indexedTime.title = exactTimestamp(network.indexed_timestamp)
		const ageNode = element('span', 'age', age(network.indexed_timestamp))
		ageNode.dataset.time = network.indexed_timestamp ?? ''
		ageNode.title = exactTimestamp(network.indexed_timestamp)
		const lag = indexerLagLabel(network)
		meta.append(indexedTime, ageNode, element('span', '', lag))
		const progressLabel = progress.percentage === undefined ? progress.eta : `${progress.percentage}% complete · ${progress.eta}`
		card.append(title, block, meta, element('p', 'network-progress', progressLabel))
		if (Number(network.consecutive_failures) > 0) {
			const retry = network.next_retry_at ? `next retry ${until(network.next_retry_at)}` : 'retry scheduled'
			card.append(element('p', 'network-retry', `${number(network.consecutive_failures)} consecutive failures · ${retry}`))
		}
		if (network.last_error) card.append(element('p', 'network-error', network.last_error))
		networkCards.append(card)
	}
	networkCards.setAttribute('aria-busy', 'false')
	updateConnectionStatus()
}

const updateFreshness = () => {
	if (activeReorgRecovery !== undefined) return
	const retryCanonical = $('#refresh-stale')
	if (canonicalRefreshRequired) {
		const banner = $('#freshness-banner')
		banner.hidden = false
		retryCanonical.hidden = false
		$('#freshness-title').textContent = 'Chain update refresh incomplete'
		$('#freshness-detail').textContent = 'A chain update was recorded, but the content refresh failed. Retry before debugging current state.'
		return
	}
	if (lastNetworkRequestFailed) {
		const banner = $('#freshness-banner')
		banner.hidden = false
		retryCanonical.hidden = true
		$('#freshness-title').textContent = 'Status API unavailable'
		$('#freshness-detail').textContent = 'Showing the last committed data already on screen; automatic retries continue.'
		return
	}
	const stale = latestNetworks
		.filter((network) => String(network.chain_id) === selectedChainId())
		.filter(
			(network) => !network.last_success_at || Date.now() + serverClockOffsetMs - new Date(network.last_success_at).getTime() > networkFreshnessThresholdMs,
		)
	const banner = $('#freshness-banner')
	retryCanonical.hidden = true
	if (stale.length === 0) {
		banner.hidden = true
		return
	}
	banner.hidden = false
	$('#freshness-title').textContent = 'Selected network is not updating'
	$('#freshness-detail').textContent = 'Showing the last committed database state.'
}

const completeCanonicalRefresh = () => {
	canonicalRefreshRequired = false
	pendingCanonicalActivityCount = undefined
	hideCanonicalDialogStatus()
	updateFreshness()
}

const selectedChainId = () => (globalNetworkFilter.dataset.restored === 'true' ? globalNetworkFilter.value : initialChainId)
const requiredChainId = () => {
	const chainId = selectedChainId()
	if (chainId === '') throw new Error('Waiting for network status before loading this view')
	return chainId
}

const syncNetworkUrl = () => {
	const url = new URL(location.href)
	const chainId = selectedChainId()
	if (chainId) url.searchParams.set('chainId', chainId)
	else url.searchParams.delete('chainId')
	history.replaceState(null, '', url)
	for (const link of document.querySelectorAll('.product-nav a')) {
		const destination = new URL(link.href)
		if (chainId) destination.searchParams.set('chainId', chainId)
		else destination.searchParams.delete('chainId')
		link.href = destination
	}
}

const updateNetworkLabels = () => {
	const symbol = selectedChainId() === '1' ? 'ETH' : 'SepoliaETH'
	$('#rich-native-sort-option').textContent = symbol
	$('#rich-native-heading').textContent = `${symbol} / WETH`
}

const reconcileNetworkOptions = (items) => {
	const selected = selectedChainId()
	globalNetworkFilter.replaceChildren(...items.map((network) => new Option(network.name, network.chain_id)))
	globalNetworkFilter.value = [...globalNetworkFilter.options].some((option) => option.value === selected) ? selected : String(items[0]?.chain_id ?? '')
	globalNetworkFilter.dataset.restored = 'true'
	syncNetworkUrl()
	updateNetworkLabels()
}

const loadNetworks = async ({ synchronizeActivity = true, refreshAfterCurrent = false } = {}) => {
	if (networkLoadPromise !== undefined) {
		if (!refreshAfterCurrent) return await networkLoadPromise
		if (refreshAfterCurrent && networkFollowUpPromise !== undefined) return await networkFollowUpPromise
		const activeLoad = networkLoadPromise
		const followUp = activeLoad
			.then(async () => {
				if (networkLoadPromise === activeLoad) networkLoadPromise = undefined
				return await loadNetworks({ synchronizeActivity })
			})
			.finally(() => {
				if (networkFollowUpPromise === followUp) networkFollowUpPromise = undefined
			})
		if (refreshAfterCurrent) networkFollowUpPromise = followUp
		return await followUp
	}
	const run = (async () => {
		try {
			const { items, serverTime, freshnessThresholdMs } = await api('/api/v1/networks')
			if (serverTime) serverClockOffsetMs = new Date(serverTime).getTime() - Date.now()
			if (Number.isFinite(freshnessThresholdMs) && freshnessThresholdMs > 0) networkFreshnessThresholdMs = freshnessThresholdMs
			const previousNetwork = selectedChainId()
			reconcileNetworkOptions(items)
			if (previousNetwork !== selectedChainId()) resetSelectedNetworkContext()
			renderNetworks(items)
			lastNetworkRequestFailed = false
			updateFreshness()
			updateConnectionStatus()
			if (isActivity && synchronizeActivity && previousNetwork !== selectedChainId()) {
				await loadLogs()
			}
			if (isSystem && synchronizeActivity && previousNetwork !== selectedChainId()) await loadSystemState()
			if (isContracts && synchronizeActivity && previousNetwork !== selectedChainId()) await loadContracts()
			if (isRichList && synchronizeActivity && previousNetwork !== selectedChainId()) await loadRichList()
			if (isAddress && synchronizeActivity && previousNetwork !== selectedChainId()) await loadAddressProfile()
			return true
		} catch (error) {
			console.error(`Network status refresh failed (${error instanceof Error ? error.name : typeof error})`)
			lastNetworkRequestFailed = true
			updateConnectionStatus()
			networkCards.setAttribute('aria-busy', 'false')
			if (networkCards.childElementCount === 0) networkCards.classList.add('empty')
			updateFreshness()
			return false
		}
	})()
	const tracked = run.finally(() => {
		if (networkLoadPromise === tracked) networkLoadPromise = undefined
	})
	networkLoadPromise = tracked
	await tracked
}

const logKeyFor = (log) => `${log.chain_id}:${log.block_hash}:${log.tx_hash}:${log.log_index}`

const rowFor = (log) => {
	const key = logKeyFor(log)
	const row = setLiveRecord(element('article', 'log-row'), key, {
		contractLabel: log.contract_label,
		eventName: log.event_name,
		summary: log.summary,
		origin: log.origin_address,
	})
	const chain = element('span', 'cell chain-block')
	const openCue = element('span', 'row-open-cue', '›')
	openCue.setAttribute('aria-hidden', 'true')
	chain.append(element('span', '', `#${number(log.block_number)}`), openCue)
	const timestamp = element('time', 'cell cell-time', `${time(log.block_timestamp)} · ${age(log.block_timestamp)}`)
	timestamp.dataset.time = log.block_timestamp
	timestamp.dateTime = exactTimestamp(log.block_timestamp)
	timestamp.title = exactTimestamp(log.block_timestamp)
	const contract = element('span', 'cell')
	contract.append(
		protocolAddressLink(log.emitter_address, {
			knownLabel: log.contract_label,
			chainId: log.chain_id,
			className: 'contract-name address-link',
			compact: true,
		}),
		element('span', 'contract-address', short(log.emitter_address)),
	)
	const event = element('button', 'cell event-name', log.event_name ?? 'Unknown event')
	event.type = 'button'
	event.setAttribute('aria-label', `Open ${log.event_name ?? 'unknown event'} log details from block ${log.block_number}`)
	const summary = element('span', 'cell summary', log.summary)
	const tx = explorerLink(log.explorer_base_url, 'tx', log.tx_hash, `${short(log.tx_hash, 7, 5)} · ${log.log_index}`)
	tx.className = 'cell cell-tx'
	const origin = protocolAddressLink(log.origin_address, { chainId: log.chain_id, className: 'cell cell-origin address-link', compact: true })
	row.append(chain, timestamp, contract, event, summary, tx, origin)
	row.addEventListener('click', (clickEvent) => {
		if (clickEvent.target instanceof HTMLAnchorElement) return
		openDetail(log)
	})
	return row
}

const queryPath = (cursor, limit = 100) => {
	const params = new URLSearchParams({ limit: String(limit) })
	params.set('chainId', requiredChainId())
	if (appliedActivityFilters.event) params.set('event', appliedActivityFilters.event)
	if (appliedActivityFilters.address) params.set('address', appliedActivityFilters.address)
	if (cursor) params.set('cursor', cursor)
	return `/api/v1/logs?${params}`
}

const activityFilterValues = () => ({
	event: $('#event-filter').value.trim(),
	address: $('#address-filter').value.trim(),
})

const syncActivityFilterUrl = () => {
	const url = new URL(location.href)
	url.searchParams.delete('decoded')
	for (const [name, value] of Object.entries(appliedActivityFilters)) {
		if (value) url.searchParams.set(name, value)
		else url.searchParams.delete(name)
	}
	const chainId = selectedChainId()
	if (chainId) url.searchParams.set('chainId', chainId)
	else url.searchParams.delete('chainId')
	history.replaceState(null, '', url)
}

const validateAddressFilter = (report = false) => {
	const input = $('#address-filter')
	const value = input.value.trim()
	input.setCustomValidity(value === '' || /^0x[0-9a-fA-F]{40}$/.test(value) ? '' : 'Enter a complete 20-byte EVM address (0x plus 40 hexadecimal characters).')
	return report ? input.reportValidity() : input.validity.valid
}

const showInvalidAddressFilter = () => {
	feed.replaceChildren()
	feed.setAttribute('aria-busy', 'false')
	feedState.hidden = false
	feedState.textContent = $('#address-filter').validationMessage
	$('#activity-summary').textContent = 'Invalid address filter'
	$('#more').hidden = true
	setLogControlsBusy(false)
}

const hasActivityFilters = () => Object.values(activityFilterValues()).some(Boolean)

const setLogControlsBusy = (busy) => {
	for (const control of [$('#filters button[type="submit"]'), $('#more')]) control.disabled = busy
	$('#clear-filters').disabled = busy || !hasActivityFilters()
}

const performLoadLogs = async ({ append = false, live = false, replaceDepth, contextVersion } = {}) => {
	if (contextVersion !== viewContextVersion) return false
	logsAbortController?.abort()
	logsAbortController = new AbortController()
	const requestSignal = logsAbortController?.signal
	const requestVersion = ++logsRequestVersion
	const moreButton = $('#more')
	const paginationStatus = $('#activity-more-status')
	const hadRows = feed.querySelector('.log-row') !== null
	const previousRows = liveSnapshot(feed, '.log-row[data-live-key]')
	const presentation = refreshPresentation({ live, append })
	const anchor =
		live && window.scrollY >= 420 ? [...feed.querySelectorAll('.log-row[data-live-key]')].find((row) => row.getBoundingClientRect().bottom > 0) : undefined
	const anchorKey = anchor?.dataset.liveKey
	const anchorTop = anchor?.getBoundingClientRect().top
	feed.setAttribute('aria-busy', String(presentation.busy))
	setLogControlsBusy(presentation.busy)
	if (append) {
		paginationStatus.hidden = true
		paginationStatus.replaceChildren()
		moreButton.hidden = false
		moreButton.setAttribute('aria-busy', 'true')
		moreButton.textContent = 'Loading more…'
	}
	if (!append && !hadRows) $('#more').hidden = true
	if (presentation.loadingState && !append) {
		feedState.hidden = false
		feedState.textContent = hadRows ? 'Refreshing indexed activity…' : 'Loading indexed activity…'
	}
	if (presentation.loadingState && !append && !hadRows) feed.replaceChildren(...Array.from({ length: 6 }, () => element('div', 'loading-line')))
	try {
		const payload =
			!append && replaceDepth !== undefined
				? await collectCanonicalPages((cursor, limit) => api(queryPath(cursor, limit), { signal: requestSignal }), replaceDepth, logKeyFor)
				: await api(queryPath(append ? nextCursor : undefined), { signal: requestSignal })
		if (!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, logsRequestVersion)) return false
		if (!append) feed.replaceChildren()
		const refreshedKeys = new Set(append ? [...feed.querySelectorAll('.log-row[data-live-key]')].map((row) => row.dataset.liveKey) : [])
		for (const log of payload.items) {
			const row = rowFor(log)
			if (refreshedKeys.has(row.dataset.liveKey)) continue
			refreshedKeys.add(row.dataset.liveKey)
			feed.append(row)
		}
		applyLiveChanges(feed, previousRows, { live, selector: '.log-row[data-live-key]' })
		if (anchorKey !== undefined && anchorTop !== undefined) {
			const currentAnchor = [...feed.querySelectorAll('.log-row[data-live-key]')].find((row) => row.dataset.liveKey === anchorKey)
			if (currentAnchor !== undefined) window.scrollBy(0, currentAnchor.getBoundingClientRect().top - anchorTop)
		}
		nextCursor = payload.nextCursor
		$('#more').hidden = !nextCursor
		paginationStatus.hidden = true
		paginationStatus.replaceChildren()
		feedState.hidden = feed.childElementCount > 0
		if (feed.childElementCount === 0) feedState.textContent = 'No project logs match these filters yet.'
		$('#activity-summary').textContent =
			feed.childElementCount === 0 ? 'No logs shown' : `${feed.childElementCount} log${feed.childElementCount === 1 ? '' : 's'} shown`
		return true
	} catch (error) {
		if (error.name === 'AbortError') return false
		if (!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, logsRequestVersion)) return false
		if (!append && !hadRows) feed.replaceChildren()
		$('#more').hidden = !retainedPaginationAvailable(nextCursor !== undefined, canonicalRefreshRequired)
		const retryAction = () => (canonicalRefreshRequired ? requestRouteRefresh(1, true) : loadLogs({ append }))
		if (append) {
			feedState.hidden = feed.childElementCount > 0
			$('#activity-summary').textContent = `${feed.childElementCount} logs shown · could not load more`
			renderRetryStatus(paginationStatus, `Could not load more activity; showing indexed logs: ${error.message}`, retryAction)
			moreButton.hidden = true
		} else {
			feedState.hidden = false
			const message = element('span', '', `Activity unavailable: ${error.message}`)
			$('#activity-summary').textContent = hadRows ? `${feed.childElementCount} logs shown · refresh failed` : ''
			const retry = element('button', 'state-retry', 'Retry')
			retry.type = 'button'
			retry.addEventListener('click', retryAction)
			feedState.replaceChildren(message, retry)
		}
		return false
	} finally {
		if (isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, logsRequestVersion)) {
			feed.setAttribute('aria-busy', 'false')
			setLogControlsBusy(false)
			moreButton.removeAttribute('aria-busy')
			moreButton.textContent = 'Show more'
		}
	}
}

const loadLogs = (options = {}) => {
	const contextVersion = viewContextVersion
	const operation = () => {
		const { retainVisibleDepth, ...loadOptions } = options
		const replaceDepth = retainVisibleDepth
			? resolveActivityRefreshDepth(loadOptions.replaceDepth, pendingCanonicalActivityCount, feed.querySelectorAll('.log-row').length)
			: loadOptions.replaceDepth
		return performLoadLogs({ ...loadOptions, replaceDepth, contextVersion })
	}
	return options.live === true ? logRefreshGate.runBackground(operation) : logRefreshGate.runForeground(operation)
}

const detailCard = (term, description, wide = false) => {
	const card = element('dl', `detail-card${wide ? ' wide' : ''}`)
	card.append(element('dt', '', term), element('dd', '', description ?? '—'))
	return card
}

const addressDetailCard = (term, address, { knownLabel, chainId, wide = false } = {}) => {
	const card = element('dl', `detail-card${wide ? ' wide' : ''}`)
	const description = element('dd')
	if (address) description.append(protocolAddressLink(address, { knownLabel, chainId }))
	else description.textContent = '—'
	card.append(element('dt', '', term), description)
	return card
}

const copyButton = (value, label) => {
	const button = element('button', 'copy-button', `Copy ${label}`)
	button.type = 'button'
	button.setAttribute('aria-live', 'polite')
	button.addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(String(value))
			button.textContent = 'Copied'
		} catch (error) {
			button.textContent = error instanceof Error ? 'Copy failed' : 'Copy unavailable'
		}
		setTimeout(() => {
			button.textContent = `Copy ${label}`
		}, 1200)
	})
	return button
}

const explorerLink = (base, type, value, label) => {
	const link = element('a', 'explorer-link', label)
	link.href = `${String(base).replace(/\/$/, '')}/${type}/${value}`
	link.target = '_blank'
	link.rel = 'noreferrer'
	return link
}

const usableAddressLabel = (label) => (label && !String(label).toLowerCase().startsWith('unknown') ? String(label) : undefined)

const addressIdentityKey = (chainId, address) => `${chainId}:${String(address).toLowerCase()}`

const invalidateAddressIdentityCache = (chainId, missesOnly = false) => {
	const prefix = `${chainId}:`
	for (const [key, value] of addressIdentityCache) {
		if (key.startsWith(prefix) && (!missesOnly || typeof value !== 'string')) addressIdentityCache.delete(key)
	}
}

const resolveAddressLabel = async (chainId, address) => {
	const key = addressIdentityKey(chainId, address)
	const cached = addressIdentityCache.get(key)
	if (typeof cached === 'string') return cached
	if (cached === false) return undefined
	if (cached) return await cached
	const pending = api(`/api/v1/address-identity?${new URLSearchParams({ chainId: String(chainId), address })}`)
		.then((identity) => {
			const resolved = usableAddressLabel(identity.label)
			if (addressIdentityCache.get(key) !== pending) return undefined
			addressIdentityCache.set(key, resolved ?? false)
			return resolved
		})
		.catch(() => {
			if (addressIdentityCache.get(key) !== pending) return undefined
			addressIdentityCache.delete(key)
			return undefined
		})
	addressIdentityCache.set(key, pending)
	return await pending
}

const protocolAddressLink = (address, { knownLabel, chainId = selectedChainId(), className = 'address-link', compact = false } = {}) => {
	const key = addressIdentityKey(chainId, address)
	const suppliedLabel = usableAddressLabel(knownLabel)
	const cachedLabel = addressIdentityCache.get(key)
	const canonicalLabel = typeof cachedLabel === 'string' ? cachedLabel : undefined
	const displayLabel = canonicalLabel ?? suppliedLabel
	const link = element('a', className, displayLabel ?? (compact ? short(address, 10, 8) : address))
	const params = new URLSearchParams({ chainId: String(chainId), address })
	if (isDemo) params.set('demo', '1')
	link.href = `/address?${params}`
	link.title = displayLabel ? `${displayLabel} · ${address}` : address
	if (!canonicalLabel) {
		void resolveAddressLabel(chainId, address).then((resolvedLabel) => {
			if (!resolvedLabel) return
			link.textContent = resolvedLabel
			link.title = `${resolvedLabel} · ${address}`
		})
	}
	return link
}

const decodedValueNode = (rawValue, displayValue, chainId) => {
	const node = element('span', 'decoded-value')
	if (typeof rawValue === 'string' && /^0x[0-9a-fA-F]{40}$/.test(rawValue)) {
		node.append(protocolAddressLink(rawValue, { chainId }))
		return node
	}
	if (Array.isArray(rawValue)) {
		node.append(document.createTextNode('['))
		rawValue.forEach((value, index) => {
			if (index > 0) node.append(document.createTextNode(', '))
			node.append(decodedValueNode(value, Array.isArray(displayValue) ? displayValue[index] : undefined, chainId))
		})
		node.append(document.createTextNode(']'))
		return node
	}
	if (rawValue && typeof rawValue === 'object') {
		node.append(document.createTextNode('{ '))
		Object.entries(rawValue).forEach(([key, value], index) => {
			if (index > 0) node.append(document.createTextNode(', '))
			node.append(document.createTextNode(`${key}: `), decodedValueNode(value, displayValue?.[key], chainId))
		})
		node.append(document.createTextNode(' }'))
		return node
	}
	const rendered = displayValue !== undefined && displayValue !== null && typeof displayValue !== 'object' ? displayValue : rawValue
	node.textContent = rendered === undefined || rendered === null ? '—' : String(rendered)
	return node
}

const evidenceText = (value) => (value === undefined || value === null ? '—' : typeof value === 'string' ? value : JSON.stringify(value))

const decodedArgumentsTable = (schema, rawArguments, displayArguments, chainId) => {
	const raw = rawArguments ?? {}
	const display = displayArguments ?? {}
	const entries = schema?.length
		? schema.toSorted((left, right) => Number(left.index) - Number(right.index))
		: Object.keys(raw).map((name, index) => ({ index, name, type: 'unknown' }))
	const table = element('table', 'arguments')
	const head = element('thead')
	const headRow = element('tr')
	for (const label of ['# / Name', 'Solidity type', 'Display value', 'Raw value']) headRow.append(element('th', '', label))
	head.append(headRow)
	const body = element('tbody')
	for (const entry of entries) {
		const rawValue = raw[entry.name]
		const row = element('tr')
		const nameCell = element('td', '', `#${number(entry.index)} · ${entry.name}`)
		nameCell.dataset.label = '# / Name'
		const typeCell = element('td', '', `${entry.type}${entry.indexed ? ' · indexed' : ''}`)
		typeCell.dataset.label = 'Solidity type'
		const displayCell = element('td')
		displayCell.dataset.label = 'Display value'
		displayCell.append(decodedValueNode(rawValue, display[entry.name], chainId))
		const rawCell = element('td', '', evidenceText(rawValue))
		rawCell.dataset.label = 'Raw value'
		row.append(nameCell, typeCell, displayCell, rawCell)
		body.append(row)
	}
	table.append(head, body)
	return table
}

const captureDetailContext = () => {
	const focusable = [...detailContent.querySelectorAll('a, button, summary')]
	const focusIndex = focusable.indexOf(document.activeElement)
	return {
		scrollTop: dialog.scrollTop,
		focusIndex,
		focusTop: focusIndex >= 0 ? focusable[focusIndex].getBoundingClientRect().top : undefined,
	}
}

const restoreDetailContext = (snapshot) => {
	dialog.scrollTop = snapshot.scrollTop
	if (snapshot.focusIndex < 0) return
	const focusable = [...detailContent.querySelectorAll('a, button, summary')]
	const nextFocus = focusable[snapshot.focusIndex]
	if (nextFocus === undefined) return
	if (snapshot.focusTop !== undefined) dialog.scrollTop += nextFocus.getBoundingClientRect().top - snapshot.focusTop
	nextFocus.focus({ preventScroll: true })
}

const performOpenDetail = async (log, { live = false, canonicalRecovery = false, contextVersion } = {}) => {
	if (contextVersion !== detailContextVersion) return false
	const requestVersion = ++detailRequestVersion
	const previousContext = live ? captureDetailContext() : undefined
	activeLog = log
	if (!canonicalRecovery) {
		pendingCanonicalLog = activeReorgRecovery === undefined && !canonicalRefreshRequired ? undefined : log
		if (activeReorgRecovery !== undefined) {
			activeReorgRecovery.logToRefresh = log
			activeReorgRecovery.accountToRefresh = undefined
		}
	}
	pendingCanonicalAccount = undefined
	pendingAccountDialogSnapshot = undefined
	activeAccount = undefined
	activeAccountTransactions = undefined
	activeAccountLoadMore = undefined
	if (!dialog.open) dialog.showModal()
	syncCanonicalDialogStatus()
	$('#detail-eyebrow').textContent = 'Log evidence'
	$('#detail-title').textContent = 'Event details'
	detailContent.setAttribute('aria-busy', String(refreshPresentation({ live }).busy))
	if (!live) {
		const loading = element('p', 'detail-status', 'Loading event details…')
		loading.setAttribute('role', 'status')
		detailContent.replaceChildren(loading, element('div', 'loading-line'))
	}
	const url = new URL(location.href)
	url.searchParams.delete('account')
	url.searchParams.set('log', `${log.chain_id}:${log.block_hash}:${log.tx_hash}:${log.log_index}`)
	history.replaceState(null, '', url)
	try {
		const detail = await api(`/api/v1/logs/${log.chain_id}/${log.block_hash}/${log.tx_hash}/${log.log_index}`)
		if (!isCurrentContextRequest(contextVersion, detailContextVersion, requestVersion, detailRequestVersion)) return false
		const grid = element('div', 'detail-grid')
		grid.append(
			detailCard('Block', `#${number(detail.block_number)} · ${exactTimestamp(detail.block_timestamp)}`),
			addressDetailCard('Contract', detail.emitter_address, { knownLabel: detail.contract_label, chainId: detail.chain_id, wide: true }),
			detailCard('Contract identity', `${detail.contract_kind ?? 'unknown kind'} · ${detail.contract_provenance ?? 'unknown provenance'}`, true),
			detailCard('Event signature', detail.event_signature ?? 'No matching ABI', true),
			detailCard('Block hash', detail.block_hash, true),
			detailCard('Occurrence position', `transaction ${number(detail.transaction_index)} · log ${number(detail.log_index)}`),
			detailCard('Transaction', detail.tx_hash, true),
			addressDetailCard('msg.origin', detail.origin_address, { chainId: detail.chain_id }),
			addressDetailCard('To', detail.to_address, { chainId: detail.chain_id }),
			detailCard('Gas used', number(detail.gas_used)),
			detailCard('Decoded action', detail.action_summary ?? 'No decoded calldata'),
		)
		const tools = element('div', 'detail-card wide detail-tools')
		tools.append(
			copyButton(detail.block_hash, 'block hash'),
			copyButton(detail.tx_hash, 'transaction hash'),
			copyButton(detail.emitter_address, 'contract address'),
			explorerLink(detail.explorer_base_url, 'block', detail.block_hash, 'Open block'),
			explorerLink(detail.explorer_base_url, 'tx', detail.tx_hash, 'Open transaction'),
			explorerLink(detail.explorer_base_url, 'address', detail.emitter_address, 'Open contract'),
		)
		grid.append(tools)
		const argumentsCard = element('div', 'detail-card wide')
		argumentsCard.append(element('p', 'eyebrow', 'Decoded arguments'))
		argumentsCard.append(decodedArgumentsTable(detail.argument_schema, detail.arguments, detail.display_arguments, detail.chain_id))
		grid.append(argumentsCard)
		const action = element('div', 'detail-card wide')
		action.append(element('p', 'eyebrow', 'Transaction calldata and decoded action'))
		if (detail.action_arguments && Object.keys(detail.action_arguments).length > 0)
			action.append(decodedArgumentsTable(detail.action_argument_schema, detail.action_arguments, detail.action_display_arguments, detail.chain_id))
		action.append(
			element('pre', 'raw', JSON.stringify({ input: detail.input, function: detail.function_signature, arguments: detail.action_arguments }, null, 2)),
		)
		grid.append(action)
		const raw = element('div', 'detail-card wide')
		raw.append(element('p', 'eyebrow', 'Complete raw transaction receipt'), element('pre', 'raw', JSON.stringify(detail.receipt, null, 2)))
		grid.append(raw)
		const related = element('div', 'detail-card wide')
		related.append(element('p', 'eyebrow', 'Related logs in this transaction'))
		const relatedList = element('div', 'related-logs')
		for (const occurrence of detail.relatedLogs ?? []) {
			const button = element('button', 'related-log', `#${number(occurrence.log_index)} · ${occurrence.event_name ?? 'Unknown event'} · ${occurrence.summary}`)
			button.type = 'button'
			button.addEventListener('click', () =>
				openDetail({ chain_id: detail.chain_id, block_hash: detail.block_hash, tx_hash: detail.tx_hash, log_index: occurrence.log_index }),
			)
			relatedList.append(button)
		}
		related.append(relatedList)
		grid.append(related)
		detailContent.replaceChildren(grid)
		if (previousContext) restoreDetailContext(previousContext)
		if (canonicalRecovery) pendingCanonicalLog = undefined
		return true
	} catch (error) {
		if (!isCurrentContextRequest(contextVersion, detailContextVersion, requestVersion, detailRequestVersion)) return false
		const noncanonical = isNoncanonicalDetailFailure(canonicalRecovery, error.status)
		if (canonicalRecovery && !noncanonical && canonicalRefreshRequired) {
			detailContent.querySelector('.detail-refresh-error')?.remove()
			if (previousContext) restoreDetailContext(previousContext)
			return false
		}
		const alert = element('div', `detail-error${live ? ' detail-refresh-error' : ''}`)
		alert.setAttribute('role', 'alert')
		alert.append(element('p', '', noncanonical ? 'This log was replaced after the chain changed.' : `Could not open log: ${error.message}`))
		const retry = element('button', 'state-retry', 'Retry')
		retry.type = 'button'
		retry.addEventListener('click', () => openDetail(log, { live: !noncanonical, canonicalRecovery }))
		if (!noncanonical) alert.append(retry)
		if (live && !noncanonical) {
			detailContent.querySelector('.detail-refresh-error')?.remove()
			detailContent.prepend(alert)
			if (previousContext) restoreDetailContext(previousContext)
		} else detailContent.replaceChildren(alert)
		if (noncanonical) pendingCanonicalLog = undefined
		return noncanonical
	} finally {
		if (isCurrentContextRequest(contextVersion, detailContextVersion, requestVersion, detailRequestVersion)) detailContent.setAttribute('aria-busy', 'false')
	}
}

const openDetail = (log, options = {}) => {
	if (options.live !== true && options.canonicalRecovery !== true) {
		detailContextVersion++
		detailRequestVersion++
	}
	const contextVersion = detailContextVersion
	const operation = () => performOpenDetail(log, { ...options, contextVersion })
	return options.live === true ? detailRefreshGate.runBackground(operation) : detailRefreshGate.runForeground(operation)
}

const restorePendingCanonicalLog = async () => {
	if (pendingCanonicalLog === undefined) return true
	return await openDetail(pendingCanonicalLog, { live: dialog.open, canonicalRecovery: true })
}

const captureAccountDialogSnapshot = () => {
	if (activeAccountTransactions === undefined) return undefined
	const cards = [...detailContent.querySelectorAll('.account-transaction[data-live-key]')]
	const focusedCard = document.activeElement?.closest('.account-transaction[data-live-key]')
	const focusable = focusedCard ? [...focusedCard.querySelectorAll('a, button, summary')] : []
	const anchorCard = focusedCard ?? cards.find((card) => card.getBoundingClientRect().bottom > dialog.getBoundingClientRect().top)
	return {
		loadedCount: activeAccountTransactions.loaded.length,
		expandedKeys: [...detailContent.querySelectorAll('.account-transaction-action[open]')].map(
			(action) => action.closest('.account-transaction[data-live-key]')?.dataset.liveKey,
		),
		anchorKey: anchorCard?.dataset.liveKey,
		anchorTop: anchorCard?.getBoundingClientRect().top,
		focusKey: focusedCard?.dataset.liveKey,
		focusIndex: focusable.indexOf(document.activeElement),
		outsideFocus: document.activeElement?.dataset.liveFocus,
		scrollTop: dialog.scrollTop,
	}
}

const restoreAccountDialogSnapshot = (snapshot) => {
	const availableKeys = new Set([...detailContent.querySelectorAll('.account-transaction[data-live-key]')].map((card) => card.dataset.liveKey))
	const reconciled = reconcileTransactionDialogSnapshot(snapshot, availableKeys)
	for (const key of reconciled.expandedKeys) {
		if (key === undefined) continue
		const card = detailContent.querySelector(`[data-live-key="${CSS.escape(key)}"]`)
		const action = card?.querySelector('.account-transaction-action')
		if (action) action.open = true
	}
	dialog.scrollTop = reconciled.scrollTop
	if (reconciled.anchorKey && reconciled.anchorTop !== undefined) {
		const anchor = detailContent.querySelector(`[data-live-key="${CSS.escape(reconciled.anchorKey)}"]`)
		if (anchor) dialog.scrollTop += anchor.getBoundingClientRect().top - reconciled.anchorTop
	}
	if (reconciled.focusKey && reconciled.focusIndex >= 0) {
		const focusedCard = detailContent.querySelector(`[data-live-key="${CSS.escape(reconciled.focusKey)}"]`)
		const focusable = focusedCard ? [...focusedCard.querySelectorAll('a, button, summary')] : []
		focusable[reconciled.focusIndex]?.focus({ preventScroll: true })
	} else if (reconciled.outsideFocus) {
		detailContent.querySelector(`[data-live-focus="${CSS.escape(reconciled.outsideFocus)}"]`)?.focus({ preventScroll: true })
	}
}

const performOpenAccountTransactions = async (account, { live = false, restoreSnapshot, canonicalRecovery = false, contextVersion } = {}) => {
	if (contextVersion !== detailContextVersion) return false
	const pageReservation = accountPageRefreshGate.reserve()
	await pageReservation.ready
	if (contextVersion !== detailContextVersion) {
		pageReservation.release()
		await pageReservation.completed
		return false
	}
	const previousState = activeAccountTransactions
	const previousLoadMore = activeAccountLoadMore
	const stateKey = `${account.chain_id}:${account.address.toLowerCase()}`
	const previousMatches = previousState?.key === stateKey
	const requestVersion = live && previousMatches ? detailRequestVersion : ++detailRequestVersion
	const stagedLiveRefresh = !canonicalRecovery && live && previousMatches
	const stagedRefresh = canonicalRecovery || stagedLiveRefresh
	const stagedSnapshot = canonicalRecovery ? restoreSnapshot : stagedLiveRefresh ? captureAccountDialogSnapshot() : undefined
	const refreshPrevious = stagedRefresh ? liveSnapshot(detailContent, '.account-transaction[data-live-key]') : undefined
	activeLog = undefined
	pendingCanonicalLog = undefined
	if (restoreSnapshot === undefined && !live) {
		pendingCanonicalAccount = activeReorgRecovery === undefined && !canonicalRefreshRequired ? undefined : account
		pendingAccountDialogSnapshot = undefined
		if (activeReorgRecovery !== undefined) {
			activeReorgRecovery.logToRefresh = undefined
			activeReorgRecovery.accountToRefresh = account
		}
	}
	activeAccount = account
	if (!dialog.open) dialog.showModal()
	syncCanonicalDialogStatus()
	$('#detail-eyebrow').textContent = 'Account activity'
	$('#detail-title').textContent = 'Sent transactions'
	const url = new URL(location.href)
	url.searchParams.delete('log')
	if (isRichList) url.searchParams.set('account', `${account.chain_id}:${account.address}`)
	else url.searchParams.delete('account')
	history.replaceState(null, '', url)
	const state =
		!stagedRefresh && live && previousMatches
			? previousState
			: {
					key: stateKey,
					account,
					loaded: [],
					total: 0,
					nextPageCursor: undefined,
					pageLoading: false,
					pageError: undefined,
					pageErrorAppend: false,
				}
	state.account = account
	activeAccountTransactions = accountStateDuringStagedRefresh(previousState, state, stagedRefresh)
	const render = ({ previous = new Map(), highlight = false } = {}) => {
		const focusedCard = document.activeElement?.closest('.account-transaction[data-live-key]')
		const focusedTransactionKey = focusedCard?.dataset.liveKey
		const focusedControls = focusedCard ? [...focusedCard.querySelectorAll('a, button, summary')] : []
		const focusedControlIndex = focusedControls.indexOf(document.activeElement)
		const outsideFocusKey = focusedCard ? undefined : document.activeElement?.dataset.liveFocus
		const visibleCards = [...detailContent.querySelectorAll('.account-transaction[data-live-key]')]
		const anchorCard = focusedCard ?? visibleCards.find((card) => card.getBoundingClientRect().bottom > dialog.getBoundingClientRect().top)
		const anchorKey = anchorCard?.dataset.liveKey
		const anchorTop = anchorCard?.getBoundingClientRect().top
		const openTransactionKeys = new Set(
			[...detailContent.querySelectorAll('.account-transaction-action[open]')].map(
				(action) => action.closest('.account-transaction[data-live-key]')?.dataset.liveKey,
			),
		)
		const header = element('div', 'account-transactions-header')
		header.append(
			element('p', 'eyebrow', 'Sent transactions'),
			element('h3', '', state.account.label ?? state.account.address),
			element('code', '', state.account.address),
			element('p', 'data-note', `${number(state.loaded.length)} of ${number(state.total)} sent transactions`),
		)
		const list = element('div', 'account-transactions')
		for (const transaction of state.loaded) {
			const transactionKey = `${transaction.chain_id}:${transaction.tx_hash}`
			const card = setLiveRecord(element('article', 'account-transaction'), transactionKey, transaction)
			const cardHeader = element('div', 'account-transaction-header')
			cardHeader.append(
				explorerLink(transaction.explorer_base_url, 'tx', transaction.tx_hash, short(transaction.tx_hash, 12, 8)),
				element('span', `badge${transaction.status === 'success' ? '' : ' transaction-failed'}`, transaction.status ?? 'unknown'),
			)
			const destination = transaction.to_label
				? `${transaction.to_label} · ${short(transaction.to_address, 8, 6)}`
				: (transaction.to_address ?? 'Contract creation')
			const detailGrid = element('dl', 'account-transaction-fields')
			for (const [term, value] of [
				[
					'Block',
					`#${number(transaction.block_number)} · ${exactTimestamp(transaction.block_timestamp).slice(0, 10)} · ${time(transaction.block_timestamp)} UTC`,
				],
				['To', destination],
				['Value', exactUnit(transaction.value, 18, nativeSymbol(transaction.chain_id), 2)],
				['Gas used', number(transaction.gas_used)],
				['Action', transaction.action_summary ?? transaction.function_name ?? 'Unknown call'],
			]) {
				const field = element('div')
				const description = element('dd', '', term === 'To' && transaction.to_address ? undefined : value)
				if (term === 'To' && transaction.to_address)
					description.append(
						protocolAddressLink(transaction.to_address, {
							knownLabel: transaction.to_label,
							chainId: transaction.chain_id,
							className: 'address-link',
						}),
					)
				field.append(element('dt', '', term), description)
				detailGrid.append(field)
			}
			card.append(cardHeader, detailGrid)
			if (transaction.action_display_arguments && Object.keys(transaction.action_display_arguments).length > 0) {
				const action = element('details', 'account-transaction-action')
				action.open = openTransactionKeys.has(transactionKey)
				const argumentsContent = element('div', 'account-transaction-arguments')
				argumentsContent.append(
					decodedArgumentsTable(transaction.action_argument_schema, transaction.action_arguments, transaction.action_display_arguments, transaction.chain_id),
				)
				const summary = element('summary', '', 'Decoded arguments')
				summary.dataset.liveFocus = 'decoded-arguments'
				action.append(summary, argumentsContent)
				card.append(action)
			}
			list.append(card)
		}
		if (state.loaded.length === 0) list.append(element('p', 'state-placeholder', 'No sent transactions were found.'))
		const more = element('button', 'secondary account-transactions-more', state.pageLoading ? 'Loading more transactions…' : 'Show more transactions')
		more.type = 'button'
		more.dataset.liveFocus = 'show-more-transactions'
		more.hidden = state.nextPageCursor === undefined || (state.pageError !== undefined && state.pageErrorAppend)
		more.disabled = state.pageLoading
		more.addEventListener('click', () => activeAccountLoadMore?.())
		const content = [header]
		let transactionError
		if (state.pageError) {
			transactionError = element('div', `detail-error account-transactions-error${state.pageErrorAppend ? ' append-error' : ''}`)
			transactionError.setAttribute('role', 'alert')
			transactionError.append(element('p', '', state.pageError))
			const retry = element('button', 'state-retry', 'Retry loading transactions')
			retry.type = 'button'
			retry.addEventListener('click', () => {
				if (pendingCanonicalAccount && pendingAccountDialogSnapshot) return restorePendingCanonicalAccount()
				const retryMode = transactionRetryMode(state.pageErrorAppend, state.loaded.length > 0)
				return loadPage(retryMode.append, { liveRefresh: retryMode.liveRefresh })
			})
			transactionError.append(retry)
			if (!state.pageErrorAppend) content.push(transactionError)
		}
		content.push(list)
		if (transactionError && state.pageErrorAppend) content.push(transactionError)
		content.push(more)
		detailContent.replaceChildren(...content)
		const nextAnchor = anchorKey ? detailContent.querySelector(`[data-live-key="${CSS.escape(anchorKey)}"]`) : undefined
		if (nextAnchor && anchorTop !== undefined) dialog.scrollTop += nextAnchor.getBoundingClientRect().top - anchorTop
		if (focusedTransactionKey && focusedControlIndex >= 0) {
			const nextFocusedCard = detailContent.querySelector(`[data-live-key="${CSS.escape(focusedTransactionKey)}"]`)
			const nextControls = nextFocusedCard ? [...nextFocusedCard.querySelectorAll('a, button, summary')] : []
			nextControls[focusedControlIndex]?.focus({ preventScroll: true })
		} else if (outsideFocusKey === 'show-more-transactions') {
			detailContent.querySelector('[data-live-focus="show-more-transactions"]')?.focus({ preventScroll: true })
		}
		applyLiveChanges(list, previous, { live: highlight, selector: '.account-transaction[data-live-key]' })
	}
	const performLoadPage = async (
		append = false,
		{ liveRefresh = false, background = false, stageOnly = false, limit = 50, restartInvalidSnapshot = true } = {},
	) => {
		if (state.pageLoading) return false
		state.pageLoading = true
		state.pageError = undefined
		state.pageErrorAppend = false
		detailContent.setAttribute('aria-busy', String(refreshPresentation({ live: background, append }).busy))
		const previous = liveSnapshot(detailContent, '.account-transaction[data-live-key]')
		const previousLoaded = state.loaded
		const previousTotal = state.total
		const previousCursor = state.nextPageCursor
		if (!append && !liveRefresh && !stageOnly && state.loaded.length === 0) {
			const loading = element('p', 'detail-status', 'Loading sent transactions…')
			loading.setAttribute('role', 'status')
			detailContent.replaceChildren(loading, element('div', 'loading-line'))
		} else if (append && !stageOnly) render()
		try {
			const query = new URLSearchParams({
				chainId: String(state.account.chain_id),
				address: state.account.address,
				limit: String(limit),
			})
			if (append && state.nextPageCursor) query.set('cursor', state.nextPageCursor)
			const result = await api(`/api/v1/address-transactions?${query}`)
			if (contextVersion !== detailContextVersion || !isCurrentLiveRequest(requestVersion, detailRequestVersion, state.account.chain_id, selectedChainId())) {
				state.pageLoading = false
				return false
			}
			const retained = append ? previousLoaded : liveRefresh ? previousLoaded : []
			state.loaded = mergeUniqueRecords(
				append ? retained : result.items,
				append ? result.items : retained,
				(transaction) => `${transaction.chain_id}:${transaction.tx_hash}`,
			)
			state.total = reconcilePaginatedTotal(state.total, result.total, append)
			state.nextPageCursor = liveRefresh && previousCursor !== undefined ? previousCursor : result.nextCursor
			if (state.loaded.length >= state.total) state.nextPageCursor = undefined
			state.pageLoading = false
			if (!stageOnly) render({ previous, highlight: liveRefresh })
			return true
		} catch (error) {
			if (!isCurrentContextRequest(contextVersion, detailContextVersion, requestVersion, detailRequestVersion)) {
				state.pageLoading = false
				return false
			}
			if (error.status === 409 && restartInvalidSnapshot) {
				state.pageLoading = false
				const targetCount = previousLoaded.length + (append ? limit : 0)
				state.loaded = []
				state.total = 0
				state.nextPageCursor = undefined
				let recovered = await performLoadPage(false, {
					background,
					stageOnly: true,
					limit: canonicalPageLimit(targetCount, 0, 50),
					restartInvalidSnapshot: false,
				})
				while (shouldContinueTransactionRestore(recovered, state.loaded.length, targetCount, state.nextPageCursor))
					recovered = await performLoadPage(true, {
						background,
						stageOnly: true,
						limit: canonicalPageLimit(targetCount, state.loaded.length, 50),
						restartInvalidSnapshot: false,
					})
				if (recovered) {
					if (!stageOnly) render({ previous, highlight: true })
					return true
				}
				const recoveryError = state.pageError
				state.loaded = previousLoaded
				state.total = previousTotal
				state.nextPageCursor = previousCursor
				state.pageLoading = false
				state.pageErrorAppend = append
				state.pageError = append
					? `Could not load more transactions; showing the last known activity: ${recoveryError ?? error.message}`
					: `Could not refresh sent transactions; showing the last known activity: ${recoveryError ?? error.message}`
				if (!stageOnly) render()
				return false
			}
			state.pageLoading = false
			state.pageErrorAppend = append
			state.pageError =
				state.loaded.length > 0
					? append
						? `Could not load more transactions; showing the last known activity: ${error.message}`
						: `Could not refresh sent transactions; showing the last known activity: ${error.message}`
					: `Could not load sent transactions: ${error.message}`
			if (!stageOnly) render()
			return false
		} finally {
			if (isCurrentContextRequest(contextVersion, detailContextVersion, requestVersion, detailRequestVersion)) detailContent.setAttribute('aria-busy', 'false')
		}
	}
	const loadPage = (append = false, options = {}) => {
		if (append && options.background !== true) {
			const more = detailContent.querySelector('.account-transactions-more')
			if (more !== null) {
				more.disabled = true
				more.setAttribute('aria-busy', 'true')
				more.textContent = 'Loading more transactions…'
			}
			detailContent.setAttribute('aria-busy', 'true')
		}
		return options.background === true
			? accountPageRefreshGate.runBackground(() => performLoadPage(append, options))
			: accountPageRefreshGate.runForeground(() => performLoadPage(append, options))
	}
	const loadMore = () => loadPage(true)
	let releaseStagedRefresh
	const stagedRefreshCompleted = stagedRefresh
		? new Promise((resolve) => {
				releaseStagedRefresh = resolve
			})
		: undefined
	const queuedLoadMore = async () => {
		const more = detailContent.querySelector('.account-transactions-more')
		if (more !== null) {
			more.disabled = true
			more.setAttribute('aria-busy', 'true')
			more.textContent = 'Loading more transactions…'
		}
		await stagedRefreshCompleted
		return activeAccountLoadMore === queuedLoadMore ? false : await activeAccountLoadMore?.()
	}
	activeAccountLoadMore = stagedRefresh ? queuedLoadMore : loadMore
	let loadRequest
	if (stagedRefresh) {
		loadRequest = accountPageRefreshGate.runBackground(async () => {
			const targetCount = stagedSnapshot?.loadedCount ?? 0
			let staged = await performLoadPage(false, {
				background: true,
				stageOnly: true,
				limit: canonicalPageLimit(targetCount, 0, 50),
			})
			while (stagedSnapshot && shouldContinueTransactionRestore(staged, state.loaded.length, stagedSnapshot.loadedCount, state.nextPageCursor))
				staged = await performLoadPage(true, {
					background: true,
					stageOnly: true,
					limit: canonicalPageLimit(stagedSnapshot.loadedCount, state.loaded.length, 50),
				})
			return staged
		})
	} else {
		loadRequest = loadPage(false, { liveRefresh: live && state.loaded.length > 0, background: live })
	}
	pageReservation.release()
	await pageReservation.completed
	let loaded = await loadRequest
	if (!stagedRefresh) {
		while (restoreSnapshot && shouldContinueTransactionRestore(loaded, state.loaded.length, restoreSnapshot.loadedCount, state.nextPageCursor))
			loaded = await loadPage(true)
	}
	if (!isCurrentContextRequest(contextVersion, detailContextVersion, requestVersion, detailRequestVersion)) {
		releaseStagedRefresh?.()
		return false
	}
	if (stagedRefresh) {
		if (!loaded) {
			if (isCurrentContextRequest(contextVersion, detailContextVersion, requestVersion, detailRequestVersion) && dialog.open) {
				activeAccountTransactions = previousState
				activeAccountLoadMore = previousLoadMore
				detailContent.querySelector('.account-transactions-error')?.remove()
				if (!canonicalRecovery) {
					const alert = element('div', 'detail-error account-transactions-error')
					alert.setAttribute('role', 'alert')
					alert.append(element('p', '', state.pageError ?? 'Could not refresh sent transactions; showing the last known activity.'))
					const retry = element('button', 'state-retry', 'Retry loading transactions')
					retry.type = 'button'
					retry.addEventListener('click', () => openAccountTransactions(account, { live: true }))
					alert.append(retry)
					detailContent.prepend(alert)
				}
			}
			releaseStagedRefresh()
			return false
		}
		activeAccountTransactions = state
		activeAccountLoadMore = loadMore
		render({ previous: refreshPrevious, highlight: true })
		releaseStagedRefresh()
	}
	if (loaded && stagedSnapshot) restoreAccountDialogSnapshot(stagedSnapshot)
	if (
		loaded &&
		canonicalRecovery &&
		pendingCanonicalAccount &&
		String(pendingCanonicalAccount.chain_id) === String(state.account.chain_id) &&
		pendingCanonicalAccount.address.toLowerCase() === state.account.address.toLowerCase()
	)
		pendingCanonicalAccount = undefined
	if (loaded && !canonicalRecovery && canonicalRefreshRequired) pendingAccountDialogSnapshot = captureAccountDialogSnapshot()
	if (loaded && pendingCanonicalAccount === undefined) pendingAccountDialogSnapshot = undefined
	return loaded
}

const openAccountTransactions = (account, options = {}) => {
	if (options.live !== true && options.canonicalRecovery !== true) {
		detailContextVersion++
		detailRequestVersion++
	}
	const contextVersion = detailContextVersion
	const operation = () => performOpenAccountTransactions(account, { ...options, contextVersion })
	return options.live === true ? detailRefreshGate.runBackground(operation) : detailRefreshGate.runForeground(operation)
}

const restorePendingCanonicalAccount = async () => {
	const pending = pendingCanonicalAccount
	if (pending === undefined) return true
	let restored = false
	if (isRichList) {
		const current = richListItems.find(
			(item) => String(item.chain_id) === String(pending.chain_id) && item.address.toLowerCase() === pending.address.toLowerCase(),
		)
		restored = await openAccountTransactions(current ?? pending, {
			live: dialog.open,
			restoreSnapshot: pendingAccountDialogSnapshot,
			canonicalRecovery: true,
		})
	} else if (
		isAddress &&
		currentAddressProfile &&
		String(currentAddressProfile.chain_id) === String(pending.chain_id) &&
		currentAddressProfile.address.toLowerCase() === pending.address.toLowerCase()
	)
		restored = await openAccountTransactions(currentAddressProfile, {
			live: dialog.open,
			restoreSnapshot: pendingAccountDialogSnapshot,
			canonicalRecovery: true,
		})
	if (restored) {
		pendingCanonicalAccount = undefined
		pendingAccountDialogSnapshot = undefined
	}
	return restored
}

const closeDetail = ({ preservePendingCanonicalAccount = false, preservePendingCanonicalLog = false } = {}) => {
	detailContextVersion++
	detailRequestVersion++
	activeLog = undefined
	activeAccount = undefined
	activeAccountTransactions = undefined
	activeAccountLoadMore = undefined
	if (activeReorgRecovery !== undefined) {
		activeReorgRecovery.logToRefresh = undefined
		activeReorgRecovery.accountToRefresh = undefined
	}
	hideCanonicalDialogStatus()
	preservePendingOnDialogClose = preservePendingCanonicalAccount || preservePendingCanonicalLog
	if (!preservePendingCanonicalAccount) {
		pendingCanonicalAccount = undefined
		pendingAccountDialogSnapshot = undefined
	}
	if (!preservePendingCanonicalLog) pendingCanonicalLog = undefined
	dialog.close()
	clearDetailUrl()
}

const clearDetailUrl = () => {
	const url = new URL(location.href)
	url.searchParams.delete('log')
	url.searchParams.delete('account')
	history.replaceState(null, '', url)
}

const exactUnit = (value, decimals = 18, symbol = '', maximumFraction = 3) => {
	if (value === null || value === undefined) return '—'
	const negative = String(value).startsWith('-')
	const digits = String(value)
		.replace('-', '')
		.padStart(decimals + 1, '0')
	const whole = digits.slice(0, -decimals) || '0'
	const fraction = decimals === 0 ? '' : digits.slice(-decimals).slice(0, maximumFraction).replace(/0+$/, '')
	const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
	return `${negative ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}${symbol ? ` ${symbol}` : ''}`
}

const compactValue = (value, decimals = 18) => {
	if (value === null || value === undefined) return 0
	const digits = String(value)
	const scale = 10 ** Math.min(decimals, 18)
	return Number(digits) / scale
}

const staticField = (label, value) => {
	const field = element('div', 'static-field')
	field.append(element('span', '', label), element('code', '', value ?? '—'))
	return field
}

const staticAddressField = (label, address, chainId) => {
	const field = element('div', 'static-field')
	field.append(element('span', '', label), address ? protocolAddressLink(address, { chainId }) : element('code', '', '—'))
	return field
}

const metricCard = (label, value, detail) => {
	const card = element('div', 'metric-card')
	card.append(element('span', '', label), element('strong', '', value))
	if (detail !== undefined) card.append(element('small', '', detail))
	return card
}

const lineChart = (rows, definitions, { sharedRange, axisUnit = '' } = {}) => {
	const width = 760
	const height = 190
	const margin = { left: 48, right: 14, top: 12, bottom: 28 }
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
	svg.setAttribute('class', 'time-chart')
	svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
	svg.setAttribute('role', 'img')
	const normalized = definitions.length > 1 && sharedRange === undefined
	svg.setAttribute('aria-label', `${definitions.map(({ label }) => label).join(', ')} ${normalized ? 'independently scaled trend' : 'value'} over indexed time`)
	const series = definitions.map(({ key, decimals = 18 }) => {
		const raw = rows.map((row) => (row[key] === undefined ? Number.NaN : compactValue(row[key], decimals)))
		const finite = raw.filter(Number.isFinite)
		const seriesMinimum = Math.min(...finite)
		const seriesRange = Math.max(...finite) - seriesMinimum
		return normalized ? raw.map((value) => (Number.isFinite(value) ? (seriesRange === 0 ? 50 : ((value - seriesMinimum) / seriesRange) * 100) : value)) : raw
	})
	const values = series.flat().filter(Number.isFinite)
	const { minimum, maximum } = chartValueBounds(values, sharedRange)
	const range = maximum - minimum
	const chartWidth = width - margin.left - margin.right
	const chartHeight = height - margin.top - margin.bottom
	for (let index = 0; index <= 3; index++) {
		const y = margin.top + (chartHeight * index) / 3
		const grid = document.createElementNS('http://www.w3.org/2000/svg', 'line')
		grid.setAttribute('class', 'chart-grid-line')
		grid.setAttribute('x1', String(margin.left))
		grid.setAttribute('x2', String(width - margin.right))
		grid.setAttribute('y1', String(y))
		grid.setAttribute('y2', String(y))
		svg.append(grid)
		const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
		label.setAttribute('class', 'chart-axis-label')
		label.setAttribute('x', '2')
		label.setAttribute('y', String(y + 3))
		const axisValue = maximum - (range * index) / 3
		label.textContent = normalized
			? ['High', '⅔', '⅓', 'Low'][index]
			: `${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(axisValue)}${axisUnit}`
		svg.append(label)
	}
	definitions.forEach(({ key, label, decimals = 18, unit = '', className = '', pointShape, pointLabel }, definitionIndex) => {
		const points = rows.flatMap((row, index) => {
			const value = series[definitionIndex][index]
			if (!Number.isFinite(value)) return []
			const x = margin.left + (chartWidth * index) / Math.max(1, rows.length - 1)
			const y = margin.top + chartHeight - ((value - minimum) / range) * chartHeight
			return [{ x, y, row }]
		})
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
		path.setAttribute('class', `chart-line ${className}`)
		path.setAttribute('d', points.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' '))
		svg.append(path)
		for (const { x, y, row } of points) {
			const shape = pointShape?.(row) ?? 'circle'
			const point = document.createElementNS('http://www.w3.org/2000/svg', shape === 'diamond' ? 'rect' : 'circle')
			point.setAttribute('class', `chart-point ${className}${shape === 'diamond' ? ' initialization' : ''}`)
			if (shape === 'diamond') {
				point.setAttribute('x', String(x - 3))
				point.setAttribute('y', String(y - 3))
				point.setAttribute('width', '6')
				point.setAttribute('height', '6')
				point.setAttribute('transform', `rotate(45 ${x} ${y})`)
			} else {
				point.setAttribute('cx', String(x))
				point.setAttribute('cy', String(y))
				point.setAttribute('r', '2.8')
			}
			point.setAttribute('tabindex', '0')
			const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
			const observationType = pointLabel?.(row)
			title.textContent = `${label}: ${exactUnit(row[key], decimals, unit, decimals)} · ${new Date(row.timestamp).toLocaleString()}${observationType ? ` · ${observationType}` : ''}`
			point.setAttribute('aria-label', title.textContent)
			point.append(title)
			svg.append(point)
		}
	})
	if (rows.length > 0)
		for (const [x, row] of [
			[margin.left, rows[0]],
			[width - margin.right, rows.at(-1)],
		]) {
			const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
			label.setAttribute('class', 'chart-axis-label')
			label.setAttribute('x', String(x))
			label.setAttribute('y', String(height - 5))
			label.setAttribute('text-anchor', x === margin.left ? 'start' : 'end')
			label.textContent = new Date(row.timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
			svg.append(label)
		}
	return svg
}

const chartCard = (
	title,
	rows,
	definitions,
	note,
	{ sharedRange, axisUnit, legendItems = [], emptyMessage = 'No checkpoints have been indexed for this entity yet.' } = {},
) => {
	const card = element('section', 'chart-card')
	const heading = element('div', 'chart-heading')
	heading.append(element('h4', '', title))
	const legend = element('div', 'chart-legend')
	for (const { label, className = '' } of [...definitions, ...legendItems]) {
		const item = element('span')
		item.append(element('i', className === '' ? '' : `chart-${className}`), document.createTextNode(label))
		legend.append(item)
	}
	if (rows.length > 0) heading.append(legend)
	card.append(heading)
	if (rows.length === 0) card.append(element('p', 'data-note', emptyMessage))
	else {
		const viewport = element('div', 'chart-scroll')
		viewport.append(lineChart(rows, definitions, { sharedRange, axisUnit }))
		card.append(
			viewport,
			element(
				'p',
				'data-note',
				`${note}${definitions.length > 1 && sharedRange === undefined ? ' Each line is independently scaled to its observed range so every trend remains visible; exact current values are shown above.' : ''}`,
			),
		)
	}
	return card
}

const stateHeader = (eyebrow, title, subtitle, kind) => {
	const header = element('header', 'state-detail-header')
	const copy = element('div')
	copy.append(element('p', 'eyebrow', eyebrow), element('h3', 'state-detail-title', title), element('p', 'state-detail-subtitle', subtitle))
	header.append(copy, element('span', 'state-kind', kind))
	return header
}

const richBalance = (value, symbol, digits = 2) => exactUnit(value ?? '0', 18, symbol, digits)
const richFieldLabel = (label) => element('span', 'sr-only rich-field-label', label)
const nativeSymbol = (chainId = selectedChainId()) => (String(chainId) === '1' ? 'ETH' : 'SepoliaETH')
const syncContractUrl = (address) => {
	const url = new URL(location.href)
	if (address) url.searchParams.set('contract', address)
	else url.searchParams.delete('contract')
	history.replaceState(null, '', url)
}

const renderContractDetail = (contract) => {
	const detail = $('#contract-detail')
	if (contract === undefined) {
		detail.replaceChildren(element('div', 'state-placeholder', 'No contract is selected.'))
		return
	}
	const status = contractDeploymentStatus(contract)
	const head = element('div', 'contract-detail-head')
	const identity = element('div')
	identity.append(element('p', 'eyebrow', contract.kind), element('h3', '', contract.label), element('code', '', contract.address))
	const statusNode = element('span', `deployment-status ${status.tone}`, status.label)
	head.append(identity, statusNode)
	const grid = element('div', 'contract-detail-grid')
	grid.append(
		detailCard('Registry source', contract.provenance),
		detailCard(
			'Deployment block',
			contract.deployment_block === null || contract.deployment_block === undefined
				? 'Not observed'
				: `${contract.deployment_block_exact === false ? 'At or before ' : ''}#${number(contract.deployment_block)}`,
		),
		detailCard(contractDeploymentTimestampLabel(contract), contract.deployment_timestamp ? exactTimestamp(contract.deployment_timestamp) : 'Not observed'),
		detailCard('First protocol discovery block', contract.discovery_block ? `#${number(contract.discovery_block)}` : 'Configured contract', true),
	)
	const actions = element('div', 'detail-tools')
	const copyAddress = copyButton(contract.address, 'address')
	copyAddress.dataset.contractAction = 'copy-address'
	const openContract = explorerLink(contract.explorer_base_url, 'address', contract.address, 'Open contract ↗')
	openContract.dataset.contractAction = 'open-contract'
	actions.append(copyAddress, openContract)
	if (contract.deployment_block) {
		const openDeployment = explorerLink(contract.explorer_base_url, 'block', contract.deployment_block, 'Open deployment block ↗')
		openDeployment.dataset.contractAction = 'open-deployment'
		actions.append(openDeployment)
	}
	if (contract.discovery_tx_hash) {
		const openDiscovery = explorerLink(contract.explorer_base_url, 'tx', contract.discovery_tx_hash, 'Open discovery transaction ↗')
		openDiscovery.dataset.contractAction = 'open-discovery'
		actions.append(openDiscovery)
	}
	detail.replaceChildren(head, grid, actions)
}

const renderContracts = () => {
	const list = $('#contract-list')
	if (contractItems.length === 0) {
		list.replaceChildren(element('div', 'state-placeholder', 'No system contracts are registered for this network.'))
		renderContractDetail(undefined)
		list.setAttribute('aria-busy', 'false')
		return
	}
	const requested = pageUrl.searchParams.get('contract')?.toLowerCase()
	const selected =
		contractItems.find((contract) => contract.address.toLowerCase() === selectedContractAddress?.toLowerCase()) ??
		contractItems.find((contract) => contract.address.toLowerCase() === requested) ??
		contractItems[0]
	selectedContractAddress = selected.address
	const scrollLeft = list.scrollLeft
	const scrollTop = list.scrollTop
	const focusedContractAddress = document.activeElement?.closest?.('.contract-row')?.dataset.contractAddress
	const focusedAction = document.activeElement?.closest?.('[data-contract-action]')?.dataset.contractAction
	const existingRows = new Map([...list.querySelectorAll('.contract-row[data-contract-address]')].map((row) => [row.dataset.contractAddress, row]))
	const renderedRows = []
	for (const contract of contractItems) {
		const status = contractDeploymentStatus(contract)
		const addressKey = contract.address.toLowerCase()
		const row = existingRows.get(addressKey) ?? element('button', 'contract-row')
		row.type = 'button'
		row.dataset.contractAddress = addressKey
		row.setAttribute('aria-selected', String(contract.address.toLowerCase() === selected.address.toLowerCase()))
		const head = element('span', 'contract-row-head')
		head.append(element('strong', '', contract.label), element('span', `deployment-status ${status.tone}`, status.label))
		row.replaceChildren(head, element('code', '', contract.address), element('span', 'eyebrow', contract.kind))
		row.onclick = () => {
			selectedContractAddress = contract.address
			syncContractUrl(contract.address)
			for (const candidate of list.querySelectorAll('.contract-row')) candidate.setAttribute('aria-selected', String(candidate === row))
			renderContractDetail(contract)
		}
		renderedRows.push(row)
	}
	const retainedRows = new Set(renderedRows)
	for (const child of [...list.children]) if (!retainedRows.has(child)) child.remove()
	for (const row of renderedRows) list.append(row)
	list.scrollLeft = scrollLeft
	list.scrollTop = scrollTop
	syncContractUrl(selected.address)
	renderContractDetail(selected)
	if (focusedAction !== undefined) document.querySelector(`[data-contract-action="${focusedAction}"]`)?.focus()
	else if (focusedContractAddress !== undefined) list.querySelector(`[data-contract-address="${focusedContractAddress}"]`)?.focus()
	list.setAttribute('aria-busy', 'false')
}

const performLoadContracts = async ({ live = false, contextVersion } = {}) => {
	if (contextVersion !== viewContextVersion) return false
	const requestVersion = ++contractRequestVersion
	const status = $('#contracts-status')
	const presentation = refreshPresentation({ live })
	if (presentation.loadingState) {
		status.hidden = false
		status.className = contractItems.length === 0 ? 'system-status' : 'system-status sr-only'
		status.textContent = contractItems.length === 0 ? 'Loading system contracts…' : 'Refreshing system contracts…'
	}
	$('#contract-list').setAttribute('aria-busy', String(presentation.busy))
	try {
		const result = await api(`/api/v1/contracts?${new URLSearchParams({ chainId: requiredChainId() })}`)
		if (!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, contractRequestVersion)) return false
		contractItems = result.items
		renderContracts()
		if (presentation.loadingState) {
			status.className = 'system-status sr-only'
			status.textContent = 'System contracts updated.'
		} else status.hidden = true
		return true
	} catch (error) {
		if (!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, contractRequestVersion)) return false
		$('#contract-list').setAttribute('aria-busy', 'false')
		renderRetryStatus(
			status,
			contractItems.length === 0 ? `Contract registry unavailable: ${error.message}` : `Refresh failed; showing the last registry: ${error.message}`,
			() => retryCanonicalViewOr(loadContracts),
		)
		return false
	}
}

const loadContracts = (options = {}) => {
	const contextVersion = viewContextVersion
	const operation = () => performLoadContracts({ ...options, contextVersion })
	return options.live === true ? contractRefreshGate.runBackground(operation) : contractRefreshGate.runForeground(operation)
}

const renderRichList = ({ live = false } = {}) => {
	const rows = $('#richlist-rows')
	const previousRows = liveSnapshot(rows, '.rich-row[data-live-key]')
	const isInitialRender = rows.childElementCount === 0
	const openDetailKeys = new Set([...rows.querySelectorAll('details[open][data-detail-key]')].map((details) => details.dataset.detailKey))
	const focusedDetailKey = document.activeElement?.closest?.('details[data-detail-key]')?.dataset.detailKey
	rows.replaceChildren()
	for (const item of richListItems) {
		const itemKey = `${item.chain_id}:${item.address}`
		const article = setLiveRecord(element('article', 'rich-row'), itemKey, item)
		const main = element('div', 'rich-row-main')
		const identity = element('div', 'rich-identity')
		const addressLink = protocolAddressLink(item.address, { knownLabel: item.label, chainId: item.chain_id, className: 'rich-address address-link' })
		identity.append(richFieldLabel('Address'), addressLink)
		const identityMeta = item.label ? item.address : undefined
		if (identityMeta) identity.append(element('span', '', identityMeta))
		const hasNative = Number(item.sampled_native_count) > 0
		const repComplete = Number(item.sampled_rep_token_count) >= Number(item.rep_token_count)
		const wethComplete = Number(item.sampled_weth_token_count) >= Number(item.weth_token_count)
		const repTokens = Array.isArray(item.rep_balances) ? item.rep_balances : []
		const wethTokens = Array.isArray(item.weth_balances) ? item.weth_balances : []
		const nativeBalance = item.native_balance_detail
		const itemNativeSymbol = nativeSymbol(item.chain_id)
		const wallet = element('div', 'rich-wallet')
		wallet.append(
			richFieldLabel(`${itemNativeSymbol} / WETH`),
			element('strong', '', hasNative ? richBalance(item.native_balance, itemNativeSymbol) : `${itemNativeSymbol} pending`),
			element('span', '', wethComplete ? richBalance(item.weth_balance, 'WETH') : `${richBalance(item.weth_balance, 'WETH')} · partial`),
		)
		const transactions = element('button', 'rich-count rich-transactions')
		transactions.type = 'button'
		transactions.setAttribute('aria-label', `View ${number(item.transaction_count)} transactions sent by ${item.label ?? item.address}`)
		transactions.append(
			richFieldLabel('Sent transactions'),
			element('strong', '', number(item.transaction_count)),
			element('span', '', `${counted(item.interaction_count, 'observed interaction')} · View sent transactions`),
		)
		transactions.addEventListener('click', () => openAccountTransactions(item))
		const positions = element('div', 'rich-count')
		positions.append(
			richFieldLabel('Protocol involvement'),
			element('strong', '', counted(item.pool_count, 'pool')),
			element('span', '', `${counted(item.active_vault_count, 'active vault')} / ${counted(item.vault_count, 'known vault')}`),
		)
		const balanceState = element('div', 'rich-count')
		balanceState.append(
			richFieldLabel('Balance state'),
			element('strong', '', item.oldest_balance_block ? `#${number(item.oldest_balance_block)}` : 'Pending'),
			element(
				'span',
				'',
				item.last_balance_refresh
					? repComplete && wethComplete && hasNative
						? age(item.last_balance_refresh)
						: `${number(item.sampled_rep_token_count)} of ${number(item.rep_token_count)} REP tokens sampled`
					: 'Balance refresh queued',
			),
		)
		const rep = element('div', 'rich-rep')
		rep.append(richFieldLabel('REP tokens'))
		if (repTokens.length === 0) rep.append(element('strong', '', 'REP pending'))
		for (const token of repTokens) {
			const decimals = Number.isInteger(Number(token.decimals)) && Number(token.decimals) >= 0 && Number(token.decimals) <= 255 ? Number(token.decimals) : 18
			const tokenLine = element('span', 'rich-rep-token')
			const tokenIdentity = element('span')
			tokenIdentity.append(
				protocolAddressLink(token.address, {
					knownLabel: token.contractLabel,
					chainId: item.chain_id,
					className: 'address-link',
				}),
			)
			if (token.universeId !== null && token.universeId !== undefined)
				tokenIdentity.append(document.createTextNode(` · universe ${shortIdentifier(token.universeId)}`))
			tokenLine.append(element('strong', '', exactUnit(token.balance, decimals, token.symbol ?? 'REP', 2)), tokenIdentity)
			rep.append(tokenLine)
		}
		if (!repComplete) rep.append(element('span', '', `${number(item.sampled_rep_token_count)} of ${number(item.rep_token_count)} REP tokens sampled`))
		main.append(identity, rep, wallet, transactions, positions, balanceState)
		article.append(main)
		const details = element('details', 'rich-assets')
		details.dataset.detailKey = `${itemKey}:assets`
		details.open =
			openDetailKeys.has(details.dataset.detailKey) ||
			(isInitialRender && isDemo && pageUrl.searchParams.get('expandRich') === '1' && item === richListItems[0])
		const summary = element(
			'summary',
			'',
			`Balances · ${nativeBalance ? itemNativeSymbol : `${itemNativeSymbol} pending`} · ${wethTokens.length} WETH · ${repTokens.length} of ${number(item.sampled_rep_token_count)} sampled REP`,
		)
		details.append(summary)
		const tokenGrid = element('div', 'rich-token-grid')
		if (!nativeBalance && repTokens.length === 0 && wethTokens.length === 0)
			tokenGrid.append(element('span', 'data-note', 'Balances have not been refreshed yet.'))
		if (nativeBalance) {
			const nativeCard = element('div', 'rich-token')
			nativeCard.append(
				element('strong', '', exactUnit(nativeBalance.balance, 18, itemNativeSymbol, 2)),
				element('span', '', `${itemNativeSymbol} · block #${number(nativeBalance.blockNumber)}`),
				element('code', 'rich-token-raw', `${nativeBalance.balance} base units`),
			)
			tokenGrid.append(nativeCard)
		}
		for (const [token, fallbackSymbol] of [...wethTokens.map((token) => [token, 'WETH']), ...repTokens.map((token) => [token, 'REP'])]) {
			const tokenCard = element('div', 'rich-token')
			const decimals = Number.isInteger(Number(token.decimals)) && Number(token.decimals) >= 0 && Number(token.decimals) <= 255 ? Number(token.decimals) : 18
			const tokenAddress = protocolAddressLink(token.address, {
				knownLabel: token.contractLabel,
				chainId: item.chain_id,
				className: 'rich-token-address address-link',
			})
			tokenCard.append(
				element('strong', '', exactUnit(token.balance, decimals, token.symbol ?? fallbackSymbol, 2)),
				element(
					'span',
					'',
					`${fallbackSymbol === 'REP' && token.universeId !== null && token.universeId !== undefined ? `Universe ${shortIdentifier(token.universeId)} · ` : ''}block #${number(token.blockNumber)}`,
				),
				tokenAddress,
				element('code', 'rich-token-raw', `${token.balance} base units`),
			)
			tokenGrid.append(tokenCard)
		}
		if (item.rep_balances_truncated)
			tokenGrid.append(element('span', 'data-note', `Showing 100 of ${number(item.sampled_rep_token_count)} sampled REP token balances.`))
		if (item.weth_balances_truncated)
			tokenGrid.append(element('span', 'data-note', `Showing 100 of ${number(item.sampled_weth_token_count)} sampled WETH token balances.`))
		details.append(tokenGrid)
		article.append(details)
		const poolAssociations = Array.isArray(item.pool_associations) ? item.pool_associations : []
		const vaultPositions = Array.isArray(item.vault_positions) ? item.vault_positions : []
		const involvement = element('details', 'rich-assets rich-involvement')
		involvement.dataset.detailKey = `${itemKey}:involvement`
		involvement.open =
			openDetailKeys.has(involvement.dataset.detailKey) ||
			(isInitialRender && isDemo && pageUrl.searchParams.get('expandRich') === '1' && item === richListItems[0])
		involvement.append(element('summary', '', `${counted(item.pool_count, 'pool association')} · ${counted(item.vault_count, 'vault position')}`))
		const involvementGrid = element('div', 'rich-position-grid')
		for (const pool of poolAssociations) {
			const card = element('div', 'rich-position')
			const link = protocolAddressLink(pool.address, {
				knownLabel: pool.label,
				chainId: item.chain_id,
				className: 'rich-token-address address-link',
			})
			card.append(
				element('span', 'rich-position-kind', 'Pool association'),
				element('strong', '', pool.questionTitle ?? pool.label ?? 'Associated security pool'),
				element('span', '', pool.label ?? 'Observed in the same protocol transaction'),
				link,
			)
			involvementGrid.append(card)
		}
		for (const position of vaultPositions) {
			const card = element('div', 'rich-position')
			const link = protocolAddressLink(position.poolAddress, { chainId: item.chain_id, className: 'rich-token-address address-link' })
			card.append(
				element('span', 'rich-position-kind', 'Vault position'),
				element('strong', '', position.questionTitle ?? 'Vault position'),
				element('span', '', `REP backing units ${exactUnit(position.repBackingUnits, 18, '', 2)}`),
				element('span', '', `Capacity ownership ${exactUnit(position.capacityOwnershipAttoRep, 18, 'REP', 2)}`),
				element('span', '', `Claimable fees ${exactUnit(position.claimableFeesAttoEth, 18, itemNativeSymbol, 2)} · block #${number(position.blockNumber)}`),
				link,
			)
			involvementGrid.append(card)
		}
		if (poolAssociations.length < Number(item.pool_count) || vaultPositions.length < Number(item.vault_count))
			involvementGrid.append(element('span', 'data-note', 'Showing the first 100 associations or positions.'))
		involvement.append(involvementGrid)
		article.append(involvement)
		rows.append(article)
	}
	if (focusedDetailKey) {
		const focusedDetails = [...rows.querySelectorAll('details[data-detail-key]')].find((details) => details.dataset.detailKey === focusedDetailKey)
		focusedDetails?.querySelector('summary')?.focus({ preventScroll: true })
	}
	applyLiveChanges(rows, previousRows, { live, selector: '.rich-row[data-live-key]' })
	rows.setAttribute('aria-busy', 'false')
	$('#richlist-summary').textContent = `${number(richListItems.length)} of ${number(richListTotal)} known addresses`
	$('#richlist-more').hidden = richListItems.length >= richListTotal
}

const performLoadRichList = async ({ append = false, live = false, contextVersion } = {}) => {
	if (contextVersion !== viewContextVersion) return false
	const requestVersion = ++richListRequestVersion
	const status = $('#richlist-status')
	const paginationStatus = $('#richlist-more-status')
	const more = $('#richlist-more')
	const nextOffset = append ? richListItems.length : 0
	const presentation = refreshPresentation({ live, append })
	if (presentation.loadingState) {
		if (append) {
			paginationStatus.hidden = false
			paginationStatus.className = 'system-status sr-only'
			paginationStatus.textContent = 'Loading more known addresses…'
			more.hidden = false
			more.setAttribute('aria-busy', 'true')
			more.textContent = 'Loading more…'
		} else {
			status.hidden = false
			status.textContent = richListItems.length === 0 ? 'Loading known addresses…' : 'Refreshing known addresses…'
		}
	}
	more.disabled = presentation.busy
	$('#rich-sort').disabled = presentation.busy
	$('#richlist-rows').setAttribute('aria-busy', String(presentation.busy))
	try {
		const fetchPage = async (offset, limit) => {
			const query = new URLSearchParams({ sort: $('#rich-sort').value, offset: String(offset), limit: String(limit) })
			query.set('chainId', requiredChainId())
			return await api(`/api/v1/richlist?${query}`)
		}
		const fetchSnapshot = async (requestedCount) => {
			const firstLimit = Math.min(100, requestedCount)
			const firstPage = await fetchPage(0, firstLimit)
			const targetCount = Math.min(requestedCount, firstPage.total)
			const remainingOffsets = []
			for (let offset = firstLimit; offset < targetCount; offset += 100) remainingOffsets.push(offset)
			const remainingPages = await Promise.all(remainingOffsets.map((offset) => fetchPage(offset, Math.min(100, targetCount - offset))))
			return { ...firstPage, items: [firstPage, ...remainingPages].flatMap((page) => page.items).slice(0, targetCount) }
		}
		let replace = !append
		let result = append ? await fetchPage(nextOffset, 50) : await fetchSnapshot(Math.max(50, richListItems.length))
		if (!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, richListRequestVersion)) return false
		if (append && paginatedSnapshotWasReplaced(richListItems.length, result.total)) {
			result = await fetchSnapshot(Math.max(1, richListItems.length))
			if (!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, richListRequestVersion)) return false
			replace = true
		}
		richListItems = replace ? result.items : [...richListItems, ...result.items]
		richListTotal = result.total
		renderRichList({ live })
		status.hidden = true
		paginationStatus.hidden = true
		paginationStatus.replaceChildren()
		return true
	} catch (error) {
		if (!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, richListRequestVersion)) return false
		$('#richlist-rows').setAttribute('aria-busy', 'false')
		const failureStatus = append ? paginationStatus : status
		renderRetryStatus(
			failureStatus,
			append
				? `Could not load more; showing known rankings: ${error.message}`
				: richListItems.length === 0
					? `Rich list unavailable: ${error.message}`
					: `Refresh failed; showing last known rankings: ${error.message}`,
			() => retryCanonicalViewOr(() => loadRichList({ append })),
		)
		more.hidden = !retainedPaginationAvailable(richListItems.length < richListTotal, canonicalRefreshRequired)
		if (append) more.hidden = true
		if (richListItems.length === 0) $('#richlist-summary').textContent = ''
		return false
	} finally {
		if (isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, richListRequestVersion)) {
			more.disabled = false
			$('#rich-sort').disabled = false
			more.removeAttribute('aria-busy')
			more.textContent = 'Show more'
		}
	}
}

const loadRichList = (options = {}) => {
	const contextVersion = viewContextVersion
	const operation = () => performLoadRichList({ ...options, contextVersion })
	return options.live === true && options.append !== true ? richListRefreshGate.runBackground(operation) : richListRefreshGate.runForeground(operation)
}

const renderAddressProfile = (item, transactions, interactions, { live = false } = {}) => {
	const content = $('#address-profile-content')
	const previousSections = liveSnapshot(content, '[data-live-key]')
	const chainId = String(item.chain_id)
	const itemNativeSymbol = nativeSymbol(chainId)
	const header = element('header', 'address-profile-header')
	const identity = element('div')
	const heading = element('h2', '', item.label ?? 'Address')
	heading.id = 'address-profile-heading'
	identity.append(element('p', 'eyebrow', item.kind ? 'Protocol contract' : 'Account'), heading, element('code', 'address-profile-value', item.address))
	const actions = element('div', 'address-profile-actions')
	const logParams = new URLSearchParams({ chainId, address: item.address })
	if (isDemo) logParams.set('demo', '1')
	const relatedLogs = element('a', 'explorer-link', 'View related logs')
	relatedLogs.href = `/?${logParams}`
	actions.append(copyButton(item.address, 'address'), relatedLogs, explorerLink(item.explorer_base_url, 'address', item.address, 'Open in Etherscan ↗'))
	header.append(identity, actions)
	setLiveRecord(header, 'identity', { label: item.label, kind: item.kind, address: item.address })
	const metrics = element('div', 'state-stats address-profile-stats')
	for (const [label, value] of [
		['Sent transactions', number(item.transaction_count)],
		['Observed interactions', number(item.interaction_count)],
		['Pools', number(item.pool_count)],
		['Vault positions', number(item.vault_count)],
	]) {
		const card = element('div', 'state-stat')
		card.append(element('span', '', label), element('strong', '', value))
		metrics.append(card)
	}
	setLiveRecord(metrics, 'metrics', {
		transactions: item.transaction_count,
		interactions: item.interaction_count,
		pools: item.pool_count,
		vaults: item.vault_count,
	})
	const balances = element('section', 'address-profile-panel')
	balances.append(element('p', 'eyebrow', 'Balances'), element('h3', '', 'Assets observed by augurScan'))
	const balanceGrid = element('div', 'address-balance-grid')
	const nativeCard = element('div', 'rich-token')
	nativeCard.append(
		element('strong', '', item.native_balance_detail ? exactUnit(item.native_balance_detail.balance, 18, itemNativeSymbol, 2) : `${itemNativeSymbol} pending`),
		element('span', '', item.native_balance_detail ? `Block #${number(item.native_balance_detail.blockNumber)}` : 'No balance snapshot yet'),
	)
	balanceGrid.append(nativeCard)
	for (const token of [...(item.weth_balances ?? []), ...(item.rep_balances ?? [])]) {
		const decimals = Number.isInteger(Number(token.decimals)) && Number(token.decimals) >= 0 && Number(token.decimals) <= 255 ? Number(token.decimals) : 18
		const card = element('div', 'rich-token')
		card.append(
			element('strong', '', exactUnit(token.balance, decimals, token.symbol ?? 'REP', 2)),
			element(
				'span',
				'',
				`${token.universeId === undefined || token.universeId === null ? 'Token' : `Universe ${shortIdentifier(token.universeId)}`} · block #${number(token.blockNumber)}`,
			),
			protocolAddressLink(token.address, {
				knownLabel: token.contractLabel,
				chainId,
				className: 'rich-token-address address-link',
			}),
		)
		balanceGrid.append(card)
	}
	balances.append(balanceGrid)
	setLiveRecord(balances, 'balances', {
		native: item.native_balance_detail,
		weth: item.weth_balances,
		rep: item.rep_balances,
	})
	const involvement = element('section', 'address-profile-panel')
	involvement.append(element('p', 'eyebrow', 'Augur involvement'), element('h3', '', 'Pools and vaults'))
	const involvementGrid = element('div', 'rich-position-grid')
	for (const pool of item.pool_associations ?? []) {
		const card = element('div', 'rich-position')
		card.append(
			element('span', 'rich-position-kind', 'Pool'),
			element('strong', '', pool.questionTitle ?? pool.label ?? 'Security pool'),
			protocolAddressLink(pool.address, { knownLabel: pool.label, chainId, className: 'rich-token-address address-link' }),
		)
		involvementGrid.append(card)
	}
	for (const position of item.vault_positions ?? []) {
		const card = element('div', 'rich-position')
		card.append(
			element('span', 'rich-position-kind', 'Vault'),
			element('strong', '', position.questionTitle ?? 'Vault position'),
			element(
				'span',
				'',
				`${exactUnit(position.capacityOwnershipAttoRep, 18, 'REP', 2)} capacity · ${exactUnit(position.claimableFeesAttoEth, 18, itemNativeSymbol, 2)} claimable`,
			),
			protocolAddressLink(position.poolAddress, { chainId, className: 'rich-token-address address-link' }),
		)
		involvementGrid.append(card)
	}
	if (involvementGrid.childElementCount === 0) involvementGrid.append(element('p', 'data-note', 'No pool or vault involvement has been indexed.'))
	involvement.append(involvementGrid)
	setLiveRecord(involvement, 'involvement', { pools: item.pool_associations, vaults: item.vault_positions })
	const activity = element('section', 'address-profile-panel')
	const activityHeader = element('div', 'address-section-heading')
	const activityCopy = element('div')
	activityCopy.append(element('p', 'eyebrow', 'Account activity'), element('h3', '', 'Recent sent transactions'))
	activityHeader.append(activityCopy)
	const allTransactions = element('button', 'secondary', 'View all sent transactions')
	allTransactions.type = 'button'
	allTransactions.addEventListener('click', () => openAccountTransactions(item))
	activityHeader.append(allTransactions)
	const transactionList = element('div', 'address-transaction-list')
	for (const transaction of transactions) {
		const row = element('article', 'address-transaction-row')
		const destination = transaction.to_address
			? protocolAddressLink(transaction.to_address, {
					knownLabel: transaction.to_label,
					chainId: transaction.chain_id,
					className: 'address-link',
				})
			: element('span', '', 'Contract creation')
		row.append(
			explorerLink(transaction.explorer_base_url, 'tx', transaction.tx_hash, short(transaction.tx_hash, 10, 8)),
			destination,
			element('span', '', transaction.action_summary ?? transaction.function_name ?? 'Unknown call'),
			element('span', '', `#${number(transaction.block_number)} · ${time(transaction.block_timestamp)} UTC`),
			element('strong', '', exactUnit(transaction.value, 18, itemNativeSymbol, 2)),
		)
		transactionList.append(row)
	}
	if (transactions.length === 0) transactionList.append(element('p', 'data-note', 'No sent transactions have been indexed.'))
	activity.append(activityHeader, transactionList)
	const interactionPanel = element('section', 'address-profile-panel')
	interactionPanel.append(element('p', 'eyebrow', 'Augur activity'), element('h3', '', 'Recent protocol references'))
	const interactionList = element('div', 'address-transaction-list')
	for (const transaction of interactions) {
		const row = element('article', 'address-transaction-row address-interaction-row')
		const destination = transaction.to_address
			? protocolAddressLink(transaction.to_address, {
					knownLabel: transaction.to_label,
					chainId: transaction.chain_id,
					className: 'address-link',
				})
			: element('span', '', 'Contract creation')
		row.append(
			explorerLink(transaction.explorer_base_url, 'tx', transaction.tx_hash, short(transaction.tx_hash, 10, 8)),
			destination,
			element('span', '', transaction.action_summary ?? transaction.function_name ?? 'Unknown call'),
			element('span', '', `#${number(transaction.block_number)} · ${time(transaction.block_timestamp)} UTC`),
			element('strong', '', exactUnit(transaction.value, 18, itemNativeSymbol, 2)),
		)
		if (transaction.action_arguments && Object.keys(transaction.action_arguments).length > 0) {
			const action = element('details', 'account-transaction-action')
			const argumentsContent = element('div', 'account-transaction-arguments')
			argumentsContent.append(
				decodedArgumentsTable(transaction.action_argument_schema, transaction.action_arguments, transaction.action_display_arguments, transaction.chain_id),
			)
			action.append(element('summary', '', 'Decoded arguments'), argumentsContent)
			row.append(action)
		}
		interactionList.append(row)
	}
	if (interactions.length === 0) interactionList.append(element('p', 'data-note', 'No protocol references have been indexed.'))
	interactionPanel.append(interactionList)
	setLiveRecord(interactionPanel, 'references', interactions)
	setLiveRecord(activity, 'transactions', transactions)
	content.replaceChildren(header, metrics, balances, involvement, interactionPanel, activity)
	applyLiveChanges(content, previousSections, { live })
	content.setAttribute('aria-busy', 'false')
}

const performLoadAddressProfile = async ({ live = false, contextVersion } = {}) => {
	if (contextVersion !== viewContextVersion) return false
	const requestVersion = ++addressProfileRequestVersion
	const content = $('#address-profile-content')
	const hadProfile = content.querySelector('[data-live-key]') !== null
	const address = pageUrl.searchParams.get('address')?.toLowerCase()
	const backParams = new URLSearchParams({ chainId: requiredChainId() })
	if (isDemo) backParams.set('demo', '1')
	$('#address-back').href = `/richlist?${backParams}`
	if (!/^0x[0-9a-f]{40}$/.test(address ?? '')) {
		content.replaceChildren(element('div', 'detail-error', 'A complete 20-byte address is required.'))
		content.setAttribute('aria-busy', 'false')
		return false
	}
	const presentation = refreshPresentation({ live })
	content.setAttribute('aria-busy', String(presentation.busy))
	if (presentation.loadingState) content.querySelector('.address-refresh-error')?.remove()
	if (presentation.loadingState && !hadProfile)
		content.replaceChildren(element('p', 'detail-status', 'Loading address activity…'), element('div', 'loading-line'))
	try {
		const query = new URLSearchParams({ chainId: requiredChainId(), address, limit: '1' })
		const [profile, identity, transactions, interactions] = await Promise.all([
			api(`/api/v1/richlist?${query}`),
			api(`/api/v1/address-identity?chainId=${encodeURIComponent(requiredChainId())}&address=${encodeURIComponent(address)}`),
			api(`/api/v1/address-transactions?chainId=${encodeURIComponent(requiredChainId())}&address=${encodeURIComponent(address)}&limit=10`),
			api(`/api/v1/address-interactions?chainId=${encodeURIComponent(requiredChainId())}&address=${encodeURIComponent(address)}&limit=10`),
		])
		if (!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, addressProfileRequestVersion)) return false
		const network = latestNetworks.find((candidate) => String(candidate.chain_id) === selectedChainId())
		const profileItem = profile.items[0]
		const item = profileItem
			? { ...profileItem, label: profileItem.label ?? identity.label, kind: profileItem.kind ?? identity.kind }
			: {
					chain_id: selectedChainId(),
					address,
					label: identity.label,
					kind: identity.kind,
					explorer_base_url: network?.explorer_base_url,
					transaction_count: transactions.total,
					interaction_count: transactions.total,
					pool_count: 0,
					vault_count: 0,
					rep_balances: [],
					weth_balances: [],
					pool_associations: [],
					vault_positions: [],
				}
		renderAddressProfile(item, transactions.items, interactions.items, { live })
		currentAddressProfile = item
		return true
	} catch (error) {
		if (!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, addressProfileRequestVersion)) return false
		if (hadProfile && canonicalRefreshRequired) {
			content.querySelector('.address-refresh-error')?.remove()
			content.setAttribute('aria-busy', 'false')
			return false
		}
		const alert = element('div', `detail-error${hadProfile ? ' address-refresh-error' : ''}`)
		alert.setAttribute('role', 'alert')
		alert.append(
			element('p', '', hadProfile ? `Refresh failed; showing last known address state: ${error.message}` : `Could not load address: ${error.message}`),
		)
		const retry = element('button', 'state-retry', 'Retry')
		retry.type = 'button'
		retry.addEventListener('click', () => retryCanonicalViewOr(loadAddressProfile))
		alert.append(retry)
		if (hadProfile) {
			content.querySelector('.address-refresh-error')?.remove()
			content.prepend(alert)
		} else content.replaceChildren(alert)
		content.setAttribute('aria-busy', 'false')
		return false
	}
}

const loadAddressProfile = (options = {}) => {
	const contextVersion = viewContextVersion
	const operation = () => performLoadAddressProfile({ ...options, contextVersion })
	return options.live === true ? addressProfileRefreshGate.runBackground(operation) : addressProfileRefreshGate.runForeground(operation)
}

const fetchEntityHistory = async (type, item) => {
	if (type === 'pools') return await api(`/api/v1/state/pools/${item.chain_id}/${item.pool_address}`)
	if (type === 'vaults') return await api(`/api/v1/state/vaults/${item.chain_id}/${item.pool_address}/${item.vault_address}`)
	if (type === 'questions') return await api(`/api/v1/state/questions/${item.chain_id}/${item.question_id}`)
	return await api(`/api/v1/state/universes/${item.chain_id}/${item.universe_id}`)
}

const renderPoolDetail = async (poolItem, requestVersion, suppliedHistory) => {
	const history = suppliedHistory ?? (await fetchEntityHistory('pools', poolItem))
	if (requestVersion !== stateDetailRequestVersion) return
	const poolNativeSymbol = nativeSymbol(poolItem.chain_id)
	const ammPrices = history.ammPrices ?? []
	const repEthPrices = history.repEthPrices ?? []
	const uniswapRepEthPrices = history.uniswapRepEthPrices ?? []
	const uniswapChart = uniswapPriceChartModel(uniswapRepEthPrices)
	const latestAmmPrice = ammPrices.at(-1)
	const latestRepEthPrice = repEthPrices.at(-1)
	const latestUniswapPrice = uniswapChart.latestObservation
	const fragment = document.createDocumentFragment()
	fragment.append(
		stateHeader(
			'Security pool',
			poolItem.question_title ?? 'Unknown question',
			`${poolItem.pool_address} · universe ${shortIdentifier(poolItem.universe_id, 8, 6)}`,
			'Latest indexed',
		),
	)
	const metrics = element('div', 'metric-grid')
	metrics.append(
		metricCard(
			'Settlement collateral',
			exactUnit(poolItem.settlement_collateral_atto_eth ?? poolItem.initial_settlement_collateral_atto_eth, 18, poolNativeSymbol, 2),
		),
		metricCard('Capacity ownership', exactUnit(poolItem.total_capacity_ownership_atto_rep, 18, 'REP', 2)),
		metricCard('Claimable vault fees', exactUnit(poolItem.total_claimable_vault_fees_atto_eth, 18, poolNativeSymbol, 3)),
		metricCard('Indexed vaults', number(poolItem.vault_count)),
		metricCard('Conditional YES', latestAmmPrice === undefined ? 'No AMM price' : exactUnit(latestAmmPrice.conditional_yes_bps, 2, '%', 2)),
		metricCard('Conditional NO', latestAmmPrice === undefined ? 'No AMM price' : exactUnit(latestAmmPrice.conditional_no_bps, 2, '%', 2)),
		metricCard('REP / ETH', latestRepEthPrice === undefined ? 'No coordinator price' : exactUnit(latestRepEthPrice.rep_per_eth_1e18, 18, 'REP/ETH', 4)),
		metricCard(
			'Latest Uniswap spot',
			latestUniswapPrice === undefined ? 'No Uniswap price' : exactUnit(latestUniswapPrice.rep_per_eth_1e18, 18, `REP/${latestUniswapPrice.quote_symbol}`, 4),
			latestUniswapPrice === undefined ? undefined : uniswapPriceProvenance(latestUniswapPrice),
		),
		metricCard('AMM market', history.market === undefined ? 'Not indexed' : `${number(ammPrices.length)} observations`),
	)
	fragment.append(metrics)
	fragment.append(
		chartCard(
			'Pool accounting history',
			history.snapshots,
			[
				{ key: 'settlement_collateral_atto_eth', label: 'Collateral', unit: poolNativeSymbol },
				{ key: 'total_capacity_ownership_atto_rep', label: 'Capacity ownership', unit: 'REP', className: 'secondary' },
				{ key: 'total_claimable_vault_fees_atto_eth', label: 'Claimable fees', unit: poolNativeSymbol, className: 'tertiary' },
			],
			'Authoritative PoolAccountingCheckpoint results. Collateral and fees use attoETH; capacity ownership uses attoREP.',
		),
		chartCard(
			'Uniswap REP / ETH spot price history',
			uniswapChart.rows,
			uniswapChart.definitions,
			'Event-time marginal prices derived from V2 Sync reserves and V3/V4 Initialize or Swap sqrt prices. V2/V3 quote REP per WETH; V4 quotes REP per native ETH. These values can be manipulated within a block and are not a TWAP or protocol oracle.',
			{
				sharedRange: uniswapChart.sharedRange,
				emptyMessage: 'No Uniswap REP / ETH pool observations have been indexed for this universe.',
			},
		),
	)
	fragment.append(
		chartCard(
			'Conditional YES / NO spot price history',
			ammPrices,
			[
				{ key: 'conditional_yes_bps', label: 'Conditional YES', decimals: 2, unit: '%' },
				{ key: 'conditional_no_bps', label: 'Conditional NO', decimals: 2, unit: '%', className: 'secondary' },
			],
			'Each point is derived from the exact YES/NO reserves emitted by an Augur AMM Sync event. Prices are conditional on a valid resolution and are manipulable spot values, not a TWAP or protocol oracle.',
			{ sharedRange: [0, 100], axisUnit: '%', emptyMessage: 'No Augur AMM reserve observations have been indexed for this pool.' },
		),
		chartCard(
			'REP / ETH coordinator price history',
			repEthPrices,
			[
				{
					key: 'rep_per_eth_1e18',
					label: 'REP per ETH',
					unit: 'REP/ETH',
					pointShape: (row) => (row.event_name === 'RepEthPriceSet' ? 'diamond' : 'circle'),
					pointLabel: (row) => (row.event_name === 'RepEthPriceSet' ? 'Initialization seed' : 'Accepted settlement'),
				},
			],
			'Coordinator price state. RepEthPriceSet records initialization and does not establish timestamp-based oracle validity; PriceReported points are accepted settlements.',
			{
				legendItems: [{ label: 'Initialization', className: 'initialization' }],
				emptyMessage: 'No REP / ETH coordinator price observations have been indexed for this pool.',
			},
		),
	)
	const currentCard = element('section', 'static-card')
	currentCard.append(element('h4', '', 'Latest indexed accounting and lifecycle'))
	const currentGrid = element('div', 'static-grid')
	const systemStates = ['Operational', 'Pool forked', 'Fork migration', 'Fork truth auction']
	const currentState = poolItem.current_state ?? {}
	currentGrid.append(
		staticField(
			'System state',
			currentState.systemState === undefined
				? 'No lifecycle event yet'
				: (systemStates[Number(currentState.systemState)] ?? `State ${currentState.systemState}`),
		),
		staticField(
			'Awaiting fork continuation',
			currentState.awaitingForkContinuation === undefined ? 'No checkpoint' : currentState.awaitingForkContinuation ? 'Yes' : 'No',
		),
		staticField(
			'Total REP backing units',
			currentState.totalRepBackingUnits === undefined ? 'No checkpoint' : exactUnit(currentState.totalRepBackingUnits, 18, '', 3),
		),
		staticField(
			'Share-token supply',
			currentState.shareTokenSupplyAttoShares === undefined ? 'No checkpoint' : exactUnit(currentState.shareTokenSupplyAttoShares, 18, 'shares', 3),
		),
		staticField('Fee-eligible capacity ownership', exactUnit(poolItem.fee_eligible_capacity_ownership_atto_rep, 18, 'REP', 3)),
		staticField('Unallocated accrued fees', exactUnit(poolItem.unallocated_accrued_fees_atto_eth, 18, poolNativeSymbol, 5)),
		staticField('Current retention rate', exactUnit(poolItem.current_retention_rate, 18, '', 9)),
		currentState.escalationGame
			? staticAddressField('Escalation game', currentState.escalationGame, poolItem.chain_id)
			: staticField('Escalation game', 'Not set'),
	)
	currentCard.append(currentGrid)
	fragment.append(currentCard)
	const staticCard = element('section', 'static-card')
	staticCard.append(element('h4', '', 'Immutable deployment configuration'))
	const grid = element('div', 'static-grid')
	grid.append(
		staticField('Question ID', poolItem.question_id),
		staticAddressField('Parent pool', poolItem.parent_address, poolItem.chain_id),
		staticAddressField('Share token', poolItem.share_token_address, poolItem.chain_id),
		staticAddressField('Price coordinator', poolItem.coordinator_address, poolItem.chain_id),
		history.market === undefined
			? staticField('Augur AMM pair', 'Not indexed')
			: staticAddressField('Augur AMM pair', history.market.pair_address, poolItem.chain_id),
		staticField('Augur AMM fee', history.market === undefined ? '—' : `${Number(history.market.fee_bps) / 100}%`),
		staticAddressField('Truth auction', poolItem.truth_auction_address, poolItem.chain_id),
		staticField('Security multiplier', `${Number(poolItem.security_multiplier_bps) / 100}%`),
		staticField('Initial priority fee', exactUnit(poolItem.initial_priority_fee_atto_eth_per_gas, 9, 'gwei', 2)),
		staticField('Child pools', number(poolItem.child_count)),
	)
	staticCard.append(grid)
	fragment.append(staticCard)
	$('#state-detail').replaceChildren(fragment)
}

const renderVaultDetail = async (vaultItem, requestVersion, suppliedHistory) => {
	const history = suppliedHistory ?? (await fetchEntityHistory('vaults', vaultItem))
	if (requestVersion !== stateDetailRequestVersion) return
	const vaultNativeSymbol = nativeSymbol(vaultItem.chain_id)
	const fragment = document.createDocumentFragment()
	fragment.append(stateHeader('Security vault', vaultItem.vault_address, `Pool ${vaultItem.pool_address}`, 'Latest indexed'))
	const metrics = element('div', 'metric-grid')
	metrics.append(
		metricCard('REP backing units', exactUnit(vaultItem.rep_backing_units, 18, '', 2)),
		metricCard('Capacity ownership', exactUnit(vaultItem.capacity_ownership_atto_rep, 18, 'REP', 2)),
		metricCard('Claimable fees', exactUnit(vaultItem.claimable_fees_atto_eth, 18, vaultNativeSymbol, 4)),
		metricCard('Fee index', exactUnit(vaultItem.fee_index, 18, '', 5)),
	)
	fragment.append(metrics)
	fragment.append(
		chartCard(
			'Vault accounting history',
			history.snapshots,
			[
				{ key: 'rep_backing_units', label: 'REP backing units', unit: 'units' },
				{ key: 'capacity_ownership_atto_rep', label: 'Capacity ownership', unit: 'REP', className: 'secondary' },
				{ key: 'claimable_fees_atto_eth', label: 'Claimable fees', unit: vaultNativeSymbol, className: 'tertiary' },
			],
			'VaultAccountingCheckpoint history. REP backing units are protocol accounting units; capacity ownership uses attoREP and fees use attoETH.',
		),
	)
	const staticCard = element('section', 'static-card')
	staticCard.append(element('h4', '', 'Identity and complete current checkpoint'))
	const grid = element('div', 'static-grid')
	grid.append(
		staticAddressField('Vault address', vaultItem.vault_address, vaultItem.chain_id),
		staticAddressField('Pool address', vaultItem.pool_address, vaultItem.chain_id),
		staticField('Question', vaultItem.question_title),
		staticField('Last block', `#${number(vaultItem.block_number)}`),
		staticField('Fee remainder (1e18 denominator)', vaultItem.vault_fee_remainder),
		staticField('Resulting pool REP backing units', exactUnit(vaultItem.resulting_total_rep_backing_units, 18, '', 3)),
		staticField('Resulting fee-eligible capacity', exactUnit(vaultItem.resulting_fee_eligible_capacity_ownership_atto_rep, 18, 'REP', 3)),
		staticField('Fee index', exactUnit(vaultItem.fee_index, 18, '', 8)),
	)
	staticCard.append(grid)
	fragment.append(staticCard)
	$('#state-detail').replaceChildren(fragment)
}

const questionStatus = (question) => {
	const now = Date.now()
	if (now < new Date(question.start_time).getTime()) return 'Scheduled'
	if (now < new Date(question.end_time).getTime()) return 'Open'
	return 'Ended'
}

const renderQuestionDetail = async (question, requestVersion, suppliedHistory) => {
	const history = suppliedHistory ?? (await fetchEntityHistory('questions', question))
	if (requestVersion !== stateDetailRequestVersion) return
	const kind = question.outcome_options.length === 0 ? 'Scalar' : 'Categorical'
	const fragment = document.createDocumentFragment()
	fragment.append(stateHeader('Immutable question', question.title, `ID ${short(question.question_id, 10, 8)}`, `${kind} · ${questionStatus(question)}`))
	const metrics = element('div', 'metric-grid')
	metrics.append(
		metricCard('Status', questionStatus(question)),
		metricCard('Linked pools', number(question.pool_count)),
		metricCard('Universe forks', number(question.fork_count)),
		metricCard('Answer type', kind),
	)
	fragment.append(metrics)
	const definition = element('section', 'static-card')
	definition.append(element('h4', '', 'Question definition — immutable after creation'), element('p', 'question-description', question.description))
	const outcomes = element('div', 'outcomes')
	const labels =
		question.outcome_options.length > 0
			? ['Invalid', ...question.outcome_options]
			: [
					`${exactUnit(question.display_value_min, 18, question.answer_unit)} → ${exactUnit(question.display_value_max, 18, question.answer_unit)}`,
					`${number(question.num_ticks)} ticks`,
				]
	for (const label of labels) outcomes.append(element('span', 'outcome', label))
	definition.append(outcomes)
	const timeline = element('div', 'timeline')
	for (const [label, value] of [
		['Created', question.created_timestamp],
		['Starts', question.start_time],
		['Ends', question.end_time],
	])
		timeline.append(element('div', 'timeline-step', `${label} · ${new Date(value).toLocaleDateString('en-GB')}`))
	definition.append(timeline)
	fragment.append(definition)
	const usage = element('section', 'static-card')
	usage.append(element('h4', '', 'Protocol usage'))
	const grid = element('div', 'static-grid')
	grid.append(
		staticField('Pool deployments', String(history.pools.length)),
		staticField('Universe forks using this question', String(history.forks.length)),
		staticField('Question ID', question.question_id),
		staticField('Created block evidence', `#${number(question.block_number)}`),
	)
	usage.append(
		grid,
		element(
			'p',
			'data-note',
			'Question metadata has no mutable onchain fields. Pool deployments and universe forks are tracked separately as historical usage.',
		),
	)
	fragment.append(usage)
	$('#state-detail').replaceChildren(fragment)
}

const renderLineage = (universes, selected) => {
	const byKey = new Map(universes.map((universe) => [`${universe.chain_id}:${universe.universe_id}`, universe]))
	const depth = (universe, seen = new Set()) => {
		const key = `${universe.chain_id}:${universe.universe_id}`
		if (seen.has(key) || universe.parent_universe_id === universe.universe_id) return 0
		seen.add(key)
		const parent = byKey.get(`${universe.chain_id}:${universe.parent_universe_id}`)
		return parent === undefined ? 0 : depth(parent, seen) + 1
	}
	const positions = new Map()
	const levels = new Map()
	for (const universe of universes) {
		const level = depth(universe)
		const members = levels.get(level) ?? []
		members.push(universe)
		levels.set(level, members)
	}
	const maximumLevel = Math.max(0, ...levels.keys())
	const maximumMembers = Math.max(1, ...[...levels.values()].map((members) => members.length))
	const nodeWidth = 210
	const columnGap = 285
	const rowGap = 70
	const width = 60 + maximumLevel * columnGap + nodeWidth
	const height = 40 + maximumMembers * rowGap
	const renderedWidth = Math.max(900, width)
	const renderedHeight = Math.round((height * renderedWidth) / width)
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
	svg.setAttribute('class', 'lineage-graph')
	svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
	svg.setAttribute('width', String(renderedWidth))
	svg.setAttribute('height', String(renderedHeight))
	svg.setAttribute('role', 'img')
	svg.setAttribute('aria-label', 'Returned Zoltar universe parent and child relationships')
	for (const [level, members] of levels)
		members.forEach((universe, index) => {
			positions.set(`${universe.chain_id}:${universe.universe_id}`, { x: 30 + level * columnGap, y: 20 + index * rowGap })
		})
	for (const universe of universes) {
		if (universe.parent_universe_id === universe.universe_id) continue
		const from = positions.get(`${universe.chain_id}:${universe.parent_universe_id}`)
		const to = positions.get(`${universe.chain_id}:${universe.universe_id}`)
		if (from === undefined || to === undefined) continue
		const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
		line.setAttribute('class', 'lineage-link')
		line.setAttribute('x1', String(from.x + nodeWidth))
		line.setAttribute('y1', String(from.y + 25))
		line.setAttribute('x2', String(to.x))
		line.setAttribute('y2', String(to.y + 25))
		svg.append(line)
	}
	for (const universe of universes) {
		const position = positions.get(`${universe.chain_id}:${universe.universe_id}`)
		if (position === undefined) continue
		const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
		group.setAttribute('class', `lineage-node${universe === selected ? ' selected' : ''}`)
		group.setAttribute('transform', `translate(${position.x} ${position.y})`)
		const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
		rect.setAttribute('width', String(nodeWidth))
		rect.setAttribute('height', '50')
		rect.setAttribute('rx', '7')
		const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
		label.setAttribute('x', '10')
		label.setAttribute('y', '20')
		label.textContent = universe.universe_id === '0' ? 'Genesis universe' : `Universe ${shortIdentifier(universe.universe_id, 7, 5)}`
		const meta = document.createElementNS('http://www.w3.org/2000/svg', 'text')
		meta.setAttribute('class', 'node-meta')
		meta.setAttribute('x', '10')
		meta.setAttribute('y', '37')
		meta.textContent = `${counted(universe.pool_count, 'pool')} · outcome ${universe.forking_outcome_index}`
		group.append(rect, label, meta)
		svg.append(group)
	}
	return svg
}

const renderUniverseDetail = async (universe, requestVersion, suppliedHistory) => {
	const history = suppliedHistory ?? (await fetchEntityHistory('universes', universe))
	if (requestVersion !== stateDetailRequestVersion) return
	const fragment = document.createDocumentFragment()
	const title = universe.universe_id === '0' ? 'Genesis universe' : `Universe ${shortIdentifier(universe.universe_id, 12, 8)}`
	fragment.append(
		stateHeader(
			'Zoltar universe',
			title,
			`Outcome ${universe.forking_outcome_index} · parent ${shortIdentifier(universe.parent_universe_id, 8, 6)}`,
			universe.active_fork_time ? 'Forked' : 'Active',
		),
	)
	const metrics = element('div', 'metric-grid')
	metrics.append(
		metricCard('Theoretical REP supply', exactUnit(universe.theoretical_supply_atto_rep, 18, 'REP', 1)),
		metricCard('Child universes', number(universe.child_count)),
		metricCard('Security pools', number(universe.pool_count)),
		metricCard('Fork time', universe.active_fork_time ? new Date(universe.active_fork_time).toLocaleDateString('en-GB') : 'Not forked'),
	)
	fragment.append(metrics)
	fragment.append(
		chartCard(
			'Theoretical REP supply history',
			history.events.filter((event) => event.theoretical_supply_atto_rep !== null),
			[{ key: 'theoretical_supply_atto_rep', label: 'Theoretical REP', unit: 'REP' }],
			'Supply changes are recorded from initialization, fork, burn, and migration events.',
		),
	)
	const lineage = element('section', 'lineage-card')
	const heading = element('div', 'chart-heading')
	heading.append(element('h4', '', 'Returned Zoltar universes'), element('span', 'data-note', `${stateData.universes.length} returned records`))
	const scroll = element('div', 'lineage-scroll')
	scroll.append(renderLineage(stateData.universes, universe))
	lineage.append(heading, scroll, element('p', 'data-note', 'Each edge links a child universe to the parent fork and outcome that created it.'))
	fragment.append(lineage)
	const identity = element('section', 'static-card')
	identity.append(element('h4', '', 'Immutable universe identity'))
	const grid = element('div', 'static-grid')
	grid.append(
		staticField('Universe ID', universe.universe_id),
		staticField('Parent universe', universe.parent_universe_id),
		staticField('Forking outcome', universe.forking_outcome_index),
		staticAddressField('REP token', universe.reputation_token_address, universe.chain_id),
		staticField('Fork question', universe.active_fork_question_id),
		staticField('Fork time', universe.active_fork_time ? new Date(universe.active_fork_time).toISOString() : 'Not forked'),
		staticAddressField('Fork initiator', universe.forker_address, universe.chain_id),
		staticField('Fork threshold', exactUnit(universe.fork_threshold_atto_rep, 18, 'REP', 3)),
		staticField('Fork initiator migration balance at fork', exactUnit(universe.migration_rep_balance_atto_rep, 18, 'REP', 3)),
	)
	identity.append(grid)
	fragment.append(identity)
	$('#state-detail').replaceChildren(fragment)
}

const entityKey = (type, item) => {
	if (type === 'pools') return `${item.chain_id}:${item.pool_address}`
	if (type === 'vaults') return `${item.chain_id}:${item.pool_address}:${item.vault_address}`
	if (type === 'questions') return `${item.chain_id}:${item.question_id}`
	return `${item.chain_id}:${item.universe_id}`
}

const entityCopy = (type, item) => {
	if (type === 'pools')
		return [
			item.question_title ?? short(item.pool_address),
			`${counted(item.vault_count, 'vault')} · ${exactUnit(item.settlement_collateral_atto_eth, 18, nativeSymbol(item.chain_id), 1)}`,
		]
	if (type === 'vaults') return [short(item.vault_address, 10, 6), `${exactUnit(item.capacity_ownership_atto_rep, 18, 'REP', 1)} capacity`]
	if (type === 'questions') return [item.title, `${questionStatus(item)} · ${counted(item.pool_count, 'pool')}`]
	return [
		item.universe_id === '0' ? 'Genesis universe' : `Universe ${shortIdentifier(item.universe_id, 9, 6)}`,
		`${counted(item.child_count, 'child', 'children')} · ${counted(item.pool_count, 'pool')}`,
	]
}

const performSelectEntity = async (item, { preserveDetail = false, quiet = false, contextVersion, suppliedHistory } = {}) => {
	if (contextVersion !== stateDetailContextVersion) return false
	selectedEntityKey = entityKey(activeStateType, item)
	for (const row of document.querySelectorAll('.entity-row')) row.setAttribute('aria-selected', String(row.dataset.key === selectedEntityKey))
	const requestVersion = ++stateDetailRequestVersion
	const detail = $('#state-detail')
	const presentation = refreshPresentation({ live: quiet })
	detail.setAttribute('aria-busy', String(presentation.busy))
	const replaceWithLoading = presentation.loadingState && (!preserveDetail || detail.childElementCount === 0)
	const existingRefreshStatus = detail.querySelector('.detail-refresh-status')
	if (presentation.loadingState) existingRefreshStatus?.remove()
	let refreshStatus = presentation.loadingState ? undefined : existingRefreshStatus
	if (replaceWithLoading) detail.replaceChildren(element('div', 'state-placeholder', 'Loading historical checkpoints…'))
	else if (!quiet) {
		refreshStatus = element('div', 'system-status detail-refresh-status', 'Refreshing historical checkpoints…')
		refreshStatus.setAttribute('role', 'status')
		detail.prepend(refreshStatus)
	}
	const url = new URL(location.href)
	url.searchParams.set('tab', activeStateType)
	url.searchParams.set('entity', selectedEntityKey)
	history.replaceState(null, '', url)
	try {
		if (activeStateType === 'pools') await renderPoolDetail(item, requestVersion, suppliedHistory)
		if (activeStateType === 'vaults') await renderVaultDetail(item, requestVersion, suppliedHistory)
		if (activeStateType === 'questions') await renderQuestionDetail(item, requestVersion, suppliedHistory)
		if (activeStateType === 'universes') await renderUniverseDetail(item, requestVersion, suppliedHistory)
		return isCurrentContextRequest(contextVersion, stateDetailContextVersion, requestVersion, stateDetailRequestVersion)
	} catch (error) {
		if (isCurrentContextRequest(contextVersion, stateDetailContextVersion, requestVersion, stateDetailRequestVersion)) {
			if (replaceWithLoading) {
				const failure = element('div', 'state-error')
				failure.append(element('span', '', `State history unavailable: ${error.message}`))
				const retry = element('button', '', 'Retry')
				retry.type = 'button'
				retry.addEventListener('click', () => retryCanonicalViewOr(() => selectEntity(item)))
				failure.append(retry)
				detail.replaceChildren(failure)
			} else {
				const failure = refreshStatus ?? element('div', 'system-status detail-refresh-status')
				failure.classList.add('error')
				failure.setAttribute('role', 'alert')
				failure.replaceChildren(element('span', '', `Historical refresh failed; showing last known details: ${error.message}`))
				const retry = element('button', '', 'Retry')
				retry.type = 'button'
				retry.addEventListener('click', () => retryCanonicalViewOr(() => selectEntity(item, { preserveDetail: true })))
				failure.append(retry)
				if (refreshStatus === undefined) detail.prepend(failure)
			}
		}
		return false
	} finally {
		if (isCurrentContextRequest(contextVersion, stateDetailContextVersion, requestVersion, stateDetailRequestVersion))
			$('#state-detail').setAttribute('aria-busy', 'false')
	}
}

const selectEntity = (item, options = {}) => {
	if (options.quiet !== true) {
		stateDetailContextVersion++
		stateDetailRequestVersion++
	}
	const contextVersion = stateDetailContextVersion
	const operation = () => performSelectEntity(item, { ...options, contextVersion })
	return options.quiet === true ? systemDetailRefreshGate.runBackground(operation) : systemDetailRefreshGate.runForeground(operation)
}

const selectEntityWhileReserved = (item, options = {}) => {
	if (options.quiet !== true) {
		stateDetailContextVersion++
		stateDetailRequestVersion++
	}
	return performSelectEntity(item, { ...options, contextVersion: stateDetailContextVersion })
}

const renderEntityList = async ({ refreshSelected = false, live = false, selectedHistory, detailGateReserved = false } = {}) => {
	const query = $('#entity-search').value.trim().toLowerCase()
	const catalogItems = stateData[activeStateType]
	const items = catalogItems.filter((item) => !query || entityCopy(activeStateType, item).join(' ').toLowerCase().includes(query))
	$('#entity-list-title').textContent = `All ${activeStateType}`
	$('#entity-count').textContent = String(items.length)
	$('#entity-search').placeholder = `Filter ${activeStateType}…`
	const list = $('#entity-list')
	const previousRows = liveSnapshot(list, '.entity-row[data-live-key]')
	list.replaceChildren()
	for (const item of items) {
		const [title, meta] = entityCopy(activeStateType, item)
		const row = setLiveRecord(element('button', 'entity-row'), entityKey(activeStateType, item), item)
		row.type = 'button'
		row.dataset.key = entityKey(activeStateType, item)
		row.setAttribute('role', 'option')
		row.setAttribute('aria-selected', String(row.dataset.key === selectedEntityKey))
		row.append(element('span', 'entity-row-title', title), element('span', 'entity-row-meta', meta))
		row.addEventListener('click', () => selectEntity(item))
		list.append(row)
	}
	applyLiveChanges(list, previousRows, { live, selector: '.entity-row[data-live-key]' })
	list.setAttribute('aria-busy', 'false')
	const selected = items.find((item) => entityKey(activeStateType, item) === selectedEntityKey)
	if (selected !== undefined) {
		if (refreshSelected) {
			const select = detailGateReserved ? selectEntityWhileReserved : selectEntity
			return await select(selected, { preserveDetail: true, quiet: live, suppliedHistory: selectedHistory })
		}
		return true
	}
	if (items[0] !== undefined) {
		const select = detailGateReserved ? selectEntityWhileReserved : selectEntity
		return await select(items[0], { preserveDetail: live, quiet: live, suppliedHistory: selectedHistory })
	} else {
		stateDetailContextVersion++
		stateDetailRequestVersion++
		selectedEntityKey = undefined
		$('#state-detail').setAttribute('aria-busy', 'false')
		$('#state-detail').replaceChildren(element('div', 'state-placeholder', `No indexed ${activeStateType} match this view.`))
	}
	return true
}

const renderStateStats = ({ live = false } = {}) => {
	const stats = $('#state-stats')
	const previousStats = liveSnapshot(stats, '.state-stat[data-live-key]')
	stats.replaceChildren()
	for (const [label, items] of [
		['Pools', stateData.pools],
		['Questions', stateData.questions],
		['Vaults', stateData.vaults],
		['Universes', stateData.universes],
	]) {
		const card = setLiveRecord(element('div', 'state-stat'), label.toLowerCase(), String(items.length))
		card.append(element('span', '', label), element('strong', '', number(items.length)))
		stats.append(card)
	}
	applyLiveChanges(stats, previousStats, { live, selector: '.state-stat[data-live-key]' })
	stats.setAttribute('aria-busy', 'false')
}

const setSystemControlsDisabled = (disabled) => {
	$('#entity-search').disabled = disabled
	for (const tab of document.querySelectorAll('[data-state-tab]')) tab.disabled = disabled
	for (const row of document.querySelectorAll('.entity-row')) row.disabled = disabled
}

const performLoadSystemState = async ({ live = false, contextVersion } = {}) => {
	if (contextVersion !== viewContextVersion) return false
	const requestVersion = ++catalogRequestVersion
	const alert = $('#system-alert')
	const status = $('#system-status')
	const hadData = stateData !== undefined
	const previousDetail = $('#state-detail').textContent
	const presentation = refreshPresentation({ live })
	if (presentation.loadingState) {
		alert.hidden = true
		alert.replaceChildren()
		status.hidden = false
		status.textContent = hadData ? 'Refreshing indexed registry…' : 'Loading indexed registry…'
	}
	setSystemControlsDisabled(presentation.busy)
	$('#state-stats').setAttribute('aria-busy', String(presentation.busy))
	$('#entity-list').setAttribute('aria-busy', String(presentation.busy))
	try {
		const nextStateData = await api(`/api/v1/state/catalog?chainId=${requiredChainId()}`)
		if (!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, catalogRequestVersion)) return false
		for (const poolItem of nextStateData.pools) poolItem.current_state = {}
		const orderedPoolStates = nextStateData.poolStates.toSorted(
			(left, right) => Number(left.block_number) - Number(right.block_number) || Number(left.log_index) - Number(right.log_index),
		)
		for (const state of orderedPoolStates) {
			const poolItem = nextStateData.pools.find(
				(candidate) => String(candidate.chain_id) === String(state.chain_id) && candidate.pool_address === state.pool_address,
			)
			if (poolItem !== undefined) Object.assign(poolItem.current_state, state.state)
		}
		const stagedStateType = activeStateType
		const stagedDetailContext = stateDetailContextVersion
		const query = $('#entity-search').value.trim().toLowerCase()
		const visibleItems = nextStateData[stagedStateType].filter((item) => !query || entityCopy(stagedStateType, item).join(' ').toLowerCase().includes(query))
		const selectedItem = visibleItems.find((item) => entityKey(stagedStateType, item) === selectedEntityKey) ?? visibleItems[0]
		const stagedSelectedKey = selectedItem === undefined ? undefined : entityKey(stagedStateType, selectedItem)
		const selectedHistory = selectedItem === undefined ? undefined : await fetchEntityHistory(stagedStateType, selectedItem)
		const currentQuery = $('#entity-search').value.trim().toLowerCase()
		const currentVisibleItems = nextStateData[stagedStateType].filter(
			(item) => !currentQuery || entityCopy(stagedStateType, item).join(' ').toLowerCase().includes(currentQuery),
		)
		const currentSelectedItem = currentVisibleItems.find((item) => entityKey(stagedStateType, item) === selectedEntityKey) ?? currentVisibleItems[0]
		const currentSelectedKey = currentSelectedItem === undefined ? undefined : entityKey(stagedStateType, currentSelectedItem)
		if (
			!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, catalogRequestVersion) ||
			stagedDetailContext !== stateDetailContextVersion ||
			stagedStateType !== activeStateType ||
			query !== currentQuery ||
			stagedSelectedKey !== currentSelectedKey
		)
			return false
		return await runWithForegroundReservation(systemDetailRefreshGate, async () => {
			const reservedQuery = $('#entity-search').value.trim().toLowerCase()
			const reservedVisibleItems = nextStateData[stagedStateType].filter(
				(item) => !reservedQuery || entityCopy(stagedStateType, item).join(' ').toLowerCase().includes(reservedQuery),
			)
			const reservedSelectedItem = reservedVisibleItems.find((item) => entityKey(stagedStateType, item) === selectedEntityKey) ?? reservedVisibleItems[0]
			const reservedSelectedKey = reservedSelectedItem === undefined ? undefined : entityKey(stagedStateType, reservedSelectedItem)
			if (
				!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, catalogRequestVersion) ||
				stagedDetailContext !== stateDetailContextVersion ||
				stagedStateType !== activeStateType ||
				query !== reservedQuery ||
				stagedSelectedKey !== reservedSelectedKey
			)
				return false
			stateData = nextStateData
			renderStateStats({ live })
			const detailRefreshed = await renderEntityList({ refreshSelected: true, live, selectedHistory, detailGateReserved: true })
			if (!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, catalogRequestVersion)) return false
			if (live && previousDetail !== $('#state-detail').textContent) animateLiveNode($('#state-detail'), 'live-changed')
			status.hidden = true
			alert.hidden = true
			alert.replaceChildren()
			const truncated = Object.entries(stateData.truncated ?? {})
				.filter(([, value]) => value)
				.map(([name]) => name)
			if (truncated.length > 0) {
				alert.hidden = false
				alert.append(element('span', '', `Large registry: showing ${stateData.limit} ${truncated.join(', ')} records for this network.`))
			}
			return detailRefreshed
		})
	} catch (error) {
		if (isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, catalogRequestVersion)) {
			$('#state-stats').setAttribute('aria-busy', 'false')
			$('#entity-list').setAttribute('aria-busy', 'false')
			$('#state-detail').setAttribute('aria-busy', 'false')
			alert.hidden = false
			alert.replaceChildren()
			status.hidden = true
			alert.append(element('span', '', hadData ? `Refresh failed; showing last known state: ${error.message}` : `System state unavailable: ${error.message}`))
			const retry = element('button', '', 'Retry')
			retry.type = 'button'
			retry.addEventListener('click', () => retryCanonicalViewOr(loadSystemState))
			alert.append(retry)
			if (!hadData) {
				$('#entity-list-title').textContent = 'Registry unavailable'
				$('#entity-count').textContent = '—'
				$('#entity-list').replaceChildren(element('div', 'state-placeholder', 'No registry data is available.'))
				$('#state-detail').replaceChildren(element('div', 'state-placeholder', 'State details are unavailable.'))
			}
		}
		return false
	} finally {
		if (isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, catalogRequestVersion)) {
			$('#state-stats').setAttribute('aria-busy', 'false')
			$('#entity-list').setAttribute('aria-busy', 'false')
			setSystemControlsDisabled(false)
		}
	}
}

const loadSystemState = (options = {}) => {
	const contextVersion = viewContextVersion
	const operation = () => performLoadSystemState({ ...options, contextVersion })
	return options.live === true ? systemStateRefreshGate.runBackground(operation) : systemStateRefreshGate.runForeground(operation)
}

const setStateTab = (type) => {
	stateDetailContextVersion++
	stateDetailRequestVersion++
	activeStateType = type
	selectedEntityKey = undefined
	$('#state-detail').setAttribute('aria-busy', 'false')
	for (const tab of document.querySelectorAll('[data-state-tab]')) {
		const selected = tab.dataset.stateTab === type
		tab.setAttribute('aria-selected', String(selected))
		tab.tabIndex = selected ? 0 : -1
	}
	$('#state-detail').setAttribute('aria-labelledby', `tab-${type}`)
	if (stateData !== undefined) renderEntityList()
}

const resetActivityFilterContext = () => {
	feed.replaceChildren()
	feed.setAttribute('aria-busy', 'true')
	nextCursor = undefined
	$('#activity-summary').textContent = ''
	feedState.hidden = false
	feedState.textContent = 'Loading indexed activity…'
	$('#more').hidden = true
	$('#activity-more-status').hidden = true
	$('#activity-more-status').replaceChildren()
	setLogControlsBusy(true)
}

$('#filters').addEventListener('submit', (event) => {
	event.preventDefault()
	if (!validateAddressFilter(true)) return
	appliedActivityFilters = activityFilterValues()
	syncActivityFilterUrl()
	viewContextVersion++
	logsAbortController?.abort()
	logsRequestVersion++
	resetActivityFilterContext()
	loadLogs()
})
$('#clear-filters').addEventListener('click', () => {
	$('#event-filter').value = ''
	$('#address-filter').value = ''
	validateAddressFilter()
	appliedActivityFilters = activityFilterValues()
	syncActivityFilterUrl()
	viewContextVersion++
	logsAbortController?.abort()
	logsRequestVersion++
	resetActivityFilterContext()
	loadLogs()
})
$('#address-filter').addEventListener('input', validateAddressFilter)
$('#filters').addEventListener('input', () => {
	$('#clear-filters').disabled = !hasActivityFilters()
})
const retryCanonicalRefresh = async (button) => {
	if (button.disabled) return
	button.disabled = true
	button.setAttribute('aria-busy', 'true')
	button.textContent = 'Retrying…'
	try {
		if (canonicalRefreshRequired) {
			const refreshed = await requestRouteRefresh(1, true)
			if (refreshed) completeCanonicalRefresh()
			else updateFreshness()
		} else {
			await loadNetworks({ refreshAfterCurrent: true })
			if (isSystem) await loadSystemState()
			else if (isContracts) await loadContracts()
			else if (isRichList) await loadRichList()
			else if (isAddress) await loadAddressProfile()
			else await loadLogs()
		}
	} finally {
		button.disabled = false
		button.removeAttribute('aria-busy')
		button.textContent = 'Retry now'
	}
}
$('#refresh-stale').addEventListener('click', () => retryCanonicalRefresh($('#refresh-stale')))
$('#detail-canonical-retry').addEventListener('click', () => retryCanonicalRefresh($('#detail-canonical-retry')))
$('#more').addEventListener('click', () => loadLogs({ append: true }))
$('#close-detail').addEventListener('click', closeDetail)
dialog.addEventListener('click', (event) => {
	if (event.target === dialog) closeDetail()
})
dialog.addEventListener('cancel', (event) => {
	event.preventDefault()
	closeDetail()
})
dialog.addEventListener('close', () => {
	if (shouldClearPendingDetailState(preservePendingOnDialogClose)) {
		activeLog = undefined
		pendingCanonicalLog = undefined
		pendingCanonicalAccount = undefined
		pendingAccountDialogSnapshot = undefined
		activeAccount = undefined
		activeAccountTransactions = undefined
		activeAccountLoadMore = undefined
		detailRequestVersion++
	}
	preservePendingOnDialogClose = false
	clearDetailUrl()
})
const stateTabs = [...document.querySelectorAll('[data-state-tab]')]
for (const tab of stateTabs) {
	tab.addEventListener('click', () => setStateTab(tab.dataset.stateTab))
	tab.addEventListener('keydown', (event) => {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
		event.preventDefault()
		const current = stateTabs.indexOf(tab)
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? stateTabs.length - 1
					: (current + (event.key === 'ArrowRight' ? 1 : -1) + stateTabs.length) % stateTabs.length
		stateTabs[next].focus()
		setStateTab(stateTabs[next].dataset.stateTab)
	})
}
$('#entity-search').addEventListener('input', () => {
	stateDetailContextVersion++
	stateDetailRequestVersion++
	if (stateData !== undefined) renderEntityList()
})
$('#entity-search').addEventListener('keydown', (event) => {
	if (event.key !== 'Escape' || event.currentTarget.value === '') return
	event.preventDefault()
	event.currentTarget.value = ''
	stateDetailContextVersion++
	stateDetailRequestVersion++
	if (stateData !== undefined) renderEntityList()
})

const resetSelectedNetworkContext = () => {
	viewContextVersion++
	detailContextVersion++
	stateDetailContextVersion++
	contractRequestVersion++
	richListRequestVersion++
	addressProfileRequestVersion++
	catalogRequestVersion++
	stateDetailRequestVersion++
	activeReorgRecovery = undefined
	activeLog = undefined
	pendingCanonicalLog = undefined
	pendingCanonicalActivityCount = undefined
	pendingCanonicalAccount = undefined
	pendingAccountDialogSnapshot = undefined
	canonicalRefreshRequired = false
	hideCanonicalDialogStatus()
	if (blockRefreshTimer !== undefined) clearTimeout(blockRefreshTimer)
	blockRefreshTimer = undefined
	pendingBlockUpdates = 0
	if (isActivity) {
		logsAbortController?.abort()
		logsAbortController = undefined
		logsRequestVersion++
		feed.replaceChildren()
		nextCursor = undefined
		$('#activity-summary').textContent = 'No logs shown'
		$('#more').hidden = true
	}
	if (dialog.open) closeDetail({ preservePendingCanonicalAccount: true })
	const url = new URL(location.href)
	url.searchParams.delete('log')
	url.searchParams.delete('entity')
	url.searchParams.delete('account')
	url.searchParams.delete('contract')
	history.replaceState(null, '', url)
	if (isSystem) {
		stateDetailRequestVersion++
		stateData = undefined
		selectedEntityKey = undefined
		$('#state-stats').replaceChildren()
		$('#entity-list').replaceChildren()
		$('#entity-count').textContent = '—'
		$('#state-detail').replaceChildren(element('div', 'state-placeholder', 'Loading system state…'))
	} else if (isContracts) {
		contractItems = []
		selectedContractAddress = undefined
		$('#contract-list').replaceChildren()
		$('#contract-detail').replaceChildren(element('div', 'state-placeholder', 'Loading system contracts…'))
	} else if (isRichList) {
		richListItems = []
		richListTotal = 0
		$('#richlist-rows').replaceChildren()
		$('#richlist-summary').textContent = '0 of 0 known addresses'
		$('#richlist-more').hidden = true
	} else if (isAddress) {
		currentAddressProfile = undefined
		$('#address-profile-content').replaceChildren(element('div', 'state-placeholder', 'Loading address activity…'))
	}
}

globalNetworkFilter.addEventListener('change', async () => {
	resetSelectedNetworkContext()
	syncNetworkUrl()
	updateNetworkLabels()
	renderNetworks(latestNetworks)
	updateFreshness()
	if (isSystem) {
		await loadSystemState()
	} else if (isContracts) {
		await loadContracts()
	} else if (isRichList) {
		await loadRichList()
	} else if (isAddress) {
		await loadAddressProfile()
	} else {
		await loadLogs()
	}
})
$('#rich-sort').addEventListener('change', () => {
	viewContextVersion++
	richListRequestVersion++
	richListItems = []
	richListTotal = 0
	$('#richlist-rows').replaceChildren()
	$('#richlist-rows').setAttribute('aria-busy', 'true')
	$('#richlist-summary').textContent = ''
	$('#richlist-status').hidden = false
	$('#richlist-status').className = 'system-status'
	$('#richlist-status').textContent = 'Loading known addresses…'
	$('#rich-sort').disabled = true
	$('#richlist-more').hidden = true
	$('#richlist-more').disabled = true
	$('#richlist-more-status').hidden = true
	$('#richlist-more-status').replaceChildren()
	loadRichList()
})
$('#richlist-more').addEventListener('click', () => loadRichList({ append: true }))

const refreshAfterUpdates = async (_count, _forceContentRefresh = false, recovery) => {
	if (activeReorgRecovery !== undefined && activeReorgRecovery !== recovery) return await activeReorgRecovery.promise
	const networkRefresh = loadNetworks()
	if (isSystem) {
		const [, contentRefreshed] = await Promise.all([networkRefresh, loadSystemState({ live: true })])
		if (contentRefreshed && canonicalRefreshRequired && activeReorgRecovery === undefined) completeCanonicalRefresh()
		return contentRefreshed
	}
	if (isContracts) {
		const [, contentRefreshed] = await Promise.all([networkRefresh, loadContracts({ live: true })])
		if (contentRefreshed && canonicalRefreshRequired && activeReorgRecovery === undefined) completeCanonicalRefresh()
		return contentRefreshed
	}
	if (isRichList) {
		const [, contentRefreshed] = await Promise.all([networkRefresh, loadRichList({ live: true })])
		if (contentRefreshed && activeReorgRecovery === undefined && pendingCanonicalAccount === undefined && activeAccount && dialog.open) {
			const refreshedAccount = richListItems.find(
				(item) => String(item.chain_id) === String(activeAccount.chain_id) && item.address.toLowerCase() === activeAccount.address.toLowerCase(),
			)
			await openAccountTransactions(refreshedAccount ?? activeAccount, { live: true })
		}
		const canonicalDetailRefreshed =
			contentRefreshed && pendingCanonicalAccount && activeReorgRecovery === undefined ? await restorePendingCanonicalAccount() : true
		const fullyRefreshed = contentRefreshed && canonicalDetailRefreshed
		if (fullyRefreshed && canonicalRefreshRequired && activeReorgRecovery === undefined) completeCanonicalRefresh()
		return fullyRefreshed
	}
	if (isAddress) {
		const [, contentRefreshed] = await Promise.all([networkRefresh, loadAddressProfile({ live: true })])
		if (
			contentRefreshed &&
			activeReorgRecovery === undefined &&
			pendingCanonicalAccount === undefined &&
			activeAccount &&
			dialog.open &&
			currentAddressProfile &&
			String(currentAddressProfile.chain_id) === String(activeAccount.chain_id) &&
			currentAddressProfile.address.toLowerCase() === activeAccount.address.toLowerCase()
		)
			await openAccountTransactions(currentAddressProfile, { live: true })
		const canonicalDetailRefreshed =
			contentRefreshed && pendingCanonicalAccount && activeReorgRecovery === undefined ? await restorePendingCanonicalAccount() : true
		const fullyRefreshed = contentRefreshed && canonicalDetailRefreshed
		if (fullyRefreshed && canonicalRefreshRequired && activeReorgRecovery === undefined) completeCanonicalRefresh()
		return fullyRefreshed
	}
	const activityRetention = activityRefreshRetention(canonicalRefreshRequired, pendingCanonicalActivityCount, feed.querySelectorAll('.log-row').length)
	const [, contentRefreshed] = await Promise.all([
		networkRefresh,
		loadLogs({
			live: true,
			...activityRetention,
		}),
	])
	if (contentRefreshed && activeReorgRecovery === undefined && pendingCanonicalLog === undefined && activeLog && dialog.open)
		await openDetail(activeLog, { live: true })
	const canonicalDetailRefreshed = contentRefreshed && pendingCanonicalLog && activeReorgRecovery === undefined ? await restorePendingCanonicalLog() : true
	const fullyRefreshed = contentRefreshed && canonicalDetailRefreshed
	if (fullyRefreshed && canonicalRefreshRequired && activeReorgRecovery === undefined) completeCanonicalRefresh()
	return fullyRefreshed
}
requestRouteRefresh = createLiveRouteRefreshCoordinator(refreshAfterUpdates, () => activeReorgRecovery)

const refreshCanonicalViews = (title, detail) => {
	if (activeReorgRecovery !== undefined) {
		activeReorgRecovery.pendingRefresh = true
		if (isActivity) {
			const visibleCount = feed.querySelectorAll('.log-row').length
			pendingCanonicalActivityCount = Math.max(pendingCanonicalActivityCount ?? 0, visibleCount)
		}
		activeReorgRecovery.title = title
		activeReorgRecovery.detail = detail
		$('#freshness-title').textContent = title
		$('#freshness-detail').textContent = detail
		showCanonicalDialogStatus(title, detail)
		return activeReorgRecovery.promise
	}
	const recovery = {
		chainId: requiredChainId(),
		title,
		detail,
		logToRefresh: activeLog && dialog.open ? activeLog : undefined,
		accountToRefresh: activeAccount && dialog.open ? activeAccount : undefined,
		accountDialogSnapshot: activeAccount && dialog.open ? captureAccountDialogSnapshot() : undefined,
		pendingRefresh: false,
		promise: undefined,
	}
	if (isActivity) pendingCanonicalActivityCount = feed.querySelectorAll('.log-row').length
	if (recovery.logToRefresh) pendingCanonicalLog = recovery.logToRefresh
	if (recovery.accountToRefresh) {
		pendingCanonicalAccount = recovery.accountToRefresh
		pendingAccountDialogSnapshot = recovery.accountDialogSnapshot
	}
	activeReorgRecovery = recovery
	canonicalRefreshRequired = true
	const banner = $('#freshness-banner')
	banner.hidden = false
	$('#freshness-title').textContent = title
	$('#freshness-detail').textContent = detail
	showCanonicalDialogStatus(title, detail)
	recovery.promise = (async () => {
		try {
			while (true) {
				recovery.pendingRefresh = false
				const refreshed = await requestRouteRefresh(1, true)
				if (activeReorgRecovery !== recovery || selectedChainId() !== recovery.chainId || !refreshed) return false
				if (recovery.pendingRefresh) continue
				let detailRefreshed = true
				if (recovery.logToRefresh && dialog.open) {
					pendingCanonicalLog = recovery.logToRefresh
					const restored = await restorePendingCanonicalLog()
					detailRefreshed = restored || !dialog.open || recovery.logToRefresh === undefined
				}
				if (recovery.accountToRefresh && dialog.open) {
					pendingCanonicalAccount = recovery.accountToRefresh
					pendingAccountDialogSnapshot = captureAccountDialogSnapshot()
					const restored = await restorePendingCanonicalAccount()
					detailRefreshed = (restored || !dialog.open || recovery.accountToRefresh === undefined) && detailRefreshed
				}
				if (!detailRefreshed) return false
				if (recovery.pendingRefresh) continue
				canonicalRefreshRequired = false
				pendingCanonicalActivityCount = undefined
				hideCanonicalDialogStatus()
				return true
			}
		} finally {
			if (activeReorgRecovery === recovery) {
				activeReorgRecovery = undefined
				syncCanonicalDialogStatus()
				updateFreshness()
			}
		}
	})()
	return recovery.promise
}

const scheduleBlockRefresh = () => {
	blockRefreshTimer = window.setTimeout(() => {
		blockRefreshTimer = undefined
		if (activeReorgRecovery !== undefined) {
			void activeReorgRecovery.promise.finally(() => {
				if (pendingBlockUpdates > 0 && blockRefreshTimer === undefined) scheduleBlockRefresh()
			})
			return
		}
		const count = pendingBlockUpdates
		pendingBlockUpdates = 0
		void requestRouteRefresh(count)
	}, 1_000)
}

const queueBlockRefresh = () => {
	pendingBlockUpdates++
	if (blockRefreshTimer === undefined) scheduleBlockRefresh()
}

const connectStream = () => {
	if (isDemo && pageUrl.searchParams.get('streamDemo') !== '1') {
		connection.className = 'connection live'
		$('#connection-label').textContent = 'Demo fixture'
		return
	}
	if (stream !== undefined) return
	const streamQuery = new URLSearchParams()
	if (isDemo && pageUrl.searchParams.get('reorgDemo') === '1') streamQuery.set('reorg', '1')
	if (isDemo && pageUrl.searchParams.get('burstDemo') === '1') streamQuery.set('burst', '1')
	const streamPath = `/api/v1/stream${streamQuery.size > 0 ? `?${streamQuery}` : ''}`
	const nextStream = new EventSource(streamPath)
	stream = nextStream
	nextStream.addEventListener('open', () => {
		updateConnectionStatus()
		if (streamHasOpened) void requestRouteRefresh(1)
		streamHasOpened = true
	})
	nextStream.addEventListener('error', () => {
		updateConnectionStatus()
	})
	const eventPayload = (event, label) => {
		try {
			return JSON.parse(event.data)
		} catch (error) {
			console.error(`${label} notification could not be decoded (${error instanceof Error ? error.name : typeof error})`)
			return undefined
		}
	}
	const selectedEventPayload = (event, label) => {
		const payload = eventPayload(event, label)
		return payload !== undefined && String(payload.chainId) === selectedChainId() ? payload : undefined
	}
	const liveUpdate = (event) => {
		if (selectedEventPayload(event, 'Live update') === undefined) return
		queueBlockRefresh()
	}
	nextStream.addEventListener('block', (event) => {
		const payload = eventPayload(event, 'Block update')
		if (payload === undefined) return
		applyDemoBlock(payload)
		invalidateAddressIdentityCache(payload.chainId, true)
		if (String(payload.chainId) === selectedChainId()) liveUpdate(event)
	})
	nextStream.addEventListener('status', liveUpdate)
	nextStream.addEventListener('reorg', async (event) => {
		const payload = eventPayload(event, 'Reorganization')
		if (payload === undefined) return
		if (isDemo) {
			demoReorgObserved = true
			demoEvictedAddress = activeAccount?.address.toLowerCase()
		}
		invalidateAddressIdentityCache(payload.chainId)
		if (String(payload.chainId) !== selectedChainId()) return
		const depth = String(payload.depth ?? 'unknown')
		await refreshCanonicalViews('Chain reorganization detected', `${depth} block${depth === '1' ? '' : 's'} replaced; views are refreshing.`)
	})
	nextStream.addEventListener('reset', async () => {
		addressIdentityCache.clear()
		await refreshCanonicalViews('Live replay window expired', 'Refreshing views from the current database state.')
	})
}

if (initialChainId) {
	globalNetworkFilter.replaceChildren(new Option(`Chain ${initialChainId}`, initialChainId))
	globalNetworkFilter.value = initialChainId
	globalNetworkFilter.dataset.restored = 'true'
	syncNetworkUrl()
	updateNetworkLabels()
}

connectStream()
addEventListener('pagehide', () => {
	stream?.close()
	stream = undefined
	streamHasOpened = false
	if (blockRefreshTimer !== undefined) clearTimeout(blockRefreshTimer)
	blockRefreshTimer = undefined
	pendingBlockUpdates = 0
})
addEventListener('pageshow', async (event) => {
	if (!event.persisted) return
	connectStream()
	await requestRouteRefresh(1, true)
})

setInterval(() => {
	for (const node of document.querySelectorAll('[data-time]'))
		node.textContent = node.classList.contains('cell-time') ? `${time(node.dataset.time)} · ${age(node.dataset.time)}` : age(node.dataset.time)
}, 1000)
setInterval(() => {
	if (document.hidden) return
	if (isDemo) loadNetworks()
	else void requestRouteRefresh(1)
}, 12_000)
document.addEventListener('visibilitychange', () => {
	if (!document.hidden) void requestRouteRefresh(1)
})

$('#event-filter').value = initialActivityFilters.event
$('#address-filter').value = initialActivityFilters.address
if (pageUrl.searchParams.has('decoded')) syncActivityFilterUrl()
validateAddressFilter()
$('#clear-filters').disabled = !hasActivityFilters()

const deepLink = pageUrl.searchParams.get('log')
const accountDeepLink = pageUrl.searchParams.get('account')
if (!isRichList && accountDeepLink !== null) {
	const url = new URL(location.href)
	url.searchParams.delete('account')
	history.replaceState(null, '', url)
}
$('#activity').hidden = !isActivity
$('#system').hidden = !isSystem
$('#contracts').hidden = !isContracts
$('#richlist').hidden = !isRichList
$('#address-profile').hidden = !isAddress
$('.skip-link').href = isSystem ? '#system' : isContracts ? '#contracts' : isRichList ? '#richlist' : isAddress ? '#address-profile' : '#activity'
for (const link of document.querySelectorAll('.product-nav a')) if (new URL(link.href).pathname === location.pathname) link.setAttribute('aria-current', 'page')

const requestedTab = pageUrl.searchParams.get('tab')
if (isSystem) setStateTab(['pools', 'questions', 'vaults', 'universes'].includes(requestedTab) ? requestedTab : 'pools')
if (isSystem) selectedEntityKey = pageUrl.searchParams.get('entity') ?? undefined

const initialDashboardLoad = (async () => {
	await loadNetworks({ synchronizeActivity: false })
	if (isSystem) await loadSystemState()
	else if (isContracts) await loadContracts()
	else if (isRichList) await loadRichList()
	else if (isAddress) await loadAddressProfile()
	else {
		syncActivityFilterUrl()
		if (validateAddressFilter()) await loadLogs()
		else showInvalidAddressFilter()
	}
})()
await initialDashboardLoad
if (isActivity && deepLink !== null) {
	const [chainId, blockHash, transactionHash, logIndex] = deepLink.split(':')
	if (chainId && chainId === selectedChainId() && blockHash && transactionHash && logIndex)
		await openDetail({ chain_id: chainId, block_hash: blockHash, tx_hash: transactionHash, log_index: Number(logIndex) })
	else {
		const url = new URL(location.href)
		url.searchParams.delete('log')
		history.replaceState(null, '', url)
	}
}
if (isRichList && accountDeepLink !== null) {
	const [chainId, address] = accountDeepLink.split(':')
	if (chainId === selectedChainId() && /^0x[0-9a-fA-F]{40}$/.test(address ?? '')) {
		const item = richListItems.find((candidate) => candidate.chain_id === chainId && candidate.address.toLowerCase() === address?.toLowerCase())
		const network = latestNetworks.find((candidate) => String(candidate.chain_id) === chainId)
		await openAccountTransactions(
			item ?? {
				chain_id: chainId,
				address,
				explorer_base_url: network?.explorer_base_url,
			},
		)
	} else {
		const url = new URL(location.href)
		url.searchParams.delete('account')
		history.replaceState(null, '', url)
	}
}

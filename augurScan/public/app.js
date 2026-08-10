const $ = (selector) => document.querySelector(selector)
const feed = $('#feed')
const feedState = $('#feed-state')
const networkCards = $('#network-cards')
const networkFilter = $('#network-filter')
const dialog = $('#detail-dialog')
const detailContent = $('#detail-content')
const connection = $('.connection')
const pageUrl = new URL(location.href)
const isDemo = pageUrl.searchParams.get('demo') === '1'
const demoState = pageUrl.searchParams.get('state')
const detailState = pageUrl.searchParams.get('detailState')
const networkState = pageUrl.searchParams.get('networkState')
const isSystem = location.pathname === '/system'
const isRichList = location.pathname === '/richlist'
const isActivity = !isSystem && !isRichList
const initialActivityFilters = {
	network: pageUrl.searchParams.get('chainId') ?? '',
	event: pageUrl.searchParams.get('event') ?? '',
	address: pageUrl.searchParams.get('address') ?? '',
	decoded: pageUrl.searchParams.get('decoded') ?? '',
}

let nextCursor
let newLogCount = 0
let demoErrorConsumed = false
let demoDetailErrorConsumed = false
let demoStateDetailRequests = 0
let logsRequestVersion = 0
let detailRequestVersion = 0
let pendingBlockUpdates = 0
let blockRefreshTimer
let streamHasOpened = false
let stateData
let activeStateType = 'pools'
let selectedEntityKey
let catalogRequestVersion = 0
let stateDetailRequestVersion = 0
let lastNetworkSuccessAt
let stream
let networkLoadPromise
let networkFollowUpPromise
let latestNetworks = []
let lastStreamEventAt
let logsAbortController
let serverClockOffsetMs = 0
let networkFreshnessThresholdMs = 48_000
let lastNetworkRequestFailed = false
let activeReorgRecovery
let canonicalRefreshRequired = false
let richListItems = []
let richListTotal = 0
let richListRequestVersion = 0

const demoHash = `0x${'7e4b9ad70f2248c48217f9c9ef694017'.repeat(2)}`
const demoNetworks = [
	{
		chain_id: '1',
		id: 'mainnet',
		name: 'Ethereum Mainnet',
		indexed_block: '23184712',
		indexed_hash: demoHash,
		indexed_timestamp: new Date(Date.now() - 19_000).toISOString(),
		observed_block: '23184713',
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
		summary: index % 2 === 0 ? 'amountAttoRep=4,250.75 REP · vault=Market maker (0x19B4…E2a0)' : 'reportId=1842 · price=0.004281 ETH · outcomeIndex=2',
		decode_status: index === 7 ? 'unknown' : 'decoded',
		canonical: true,
		finalized: index > 4,
		topics: [demoHash],
		data: '0x00',
		arguments: { amountAttoRep: '4250750000000000000000', vault: '0x19B4a7C60926D8FBe420C2a49f1DB56D7800E2a0' },
		display_arguments: { amountAttoRep: '4,250.75 REP', vault: 'Market maker (0x19B4a7C60926D8FBe420C2a49f1DB56D7800E2a0)' },
		argument_schema: [
			{ index: 0, name: 'amountAttoRep', type: 'uint256' },
			{ index: 1, name: 'vault', type: 'address', indexed: true },
		],
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
		rep_balance: repBalance.toString(),
		weth_balance: (BigInt(18 + index) * 10n ** 17n + (index === 0 ? 987_654_321n : 0n)).toString(),
		native_balance: (BigInt(4 + (index % 5)) * 10n ** 17n + (index === 0 ? 456_789_123n : 0n)).toString(),
		rep_token_count: index === 1 ? '2' : '1',
		sampled_rep_token_count: '1',
		weth_token_count: '1',
		sampled_weth_token_count: '1',
		sampled_native_count: '1',
		returned_rep_token_count: '1',
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
				symbol: 'REP',
				decimals: 18,
				blockNumber: network.indexed_block,
			},
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
			questionTitle: poolIndex === 0 ? 'Will the 2030 global mean temperature anomaly exceed 1.5°C?' : null,
		})),
		vault_positions: Array.from({ length: vaultCount }, (_, vaultIndex) => ({
			poolAddress: `0x${(BigInt(index + 1) * 100n + BigInt(vaultIndex + 1)).toString(16).padStart(40, 'a')}`,
			questionTitle: 'Will the 2030 global mean temperature anomaly exceed 1.5°C?',
			repBackingUnits: String(BigInt(120 + vaultIndex) * 10n ** 18n),
			capacityOwnershipAttoRep: String(BigInt(85 + vaultIndex) * 10n ** 18n),
			claimableFeesAttoEth: String(BigInt(3 + vaultIndex) * 10n ** 16n),
			blockNumber: network.indexed_block,
		})),
	}
})

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

const element = (tag, className, text) => {
	const node = document.createElement(tag)
	if (className) node.className = className
	if (text !== undefined) node.textContent = text
	return node
}

const short = (value, front = 6, back = 4) => (value ? `${value.slice(0, front)}…${value.slice(-back)}` : '—')
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
			return { items: demoNetworks }
		}
		if (path.startsWith('/api/v1/state/catalog')) {
			if (demoState === 'error' && !demoErrorConsumed) {
				demoErrorConsumed = true
				throw new Error('The state catalog could not be read from the database')
			}
			if (demoState === 'loading') return await new Promise(() => {})
			if (demoState === 'delayed') await new Promise((resolve) => setTimeout(resolve, 300))
			return demoCatalog
		}
		if (path.startsWith('/api/v1/state/')) {
			demoStateDetailRequests++
			if (detailState === 'error' && !demoDetailErrorConsumed) {
				demoDetailErrorConsumed = true
				throw new Error('Historical checkpoints could not be read')
			}
			if (detailState === 'refresh-error' && demoStateDetailRequests === 2) throw new Error('The newest checkpoint could not be read')
			if (detailState === 'loading') return await new Promise(() => {})
			return demoHistory(path)
		}
		if (path.startsWith('/api/v1/richlist')) {
			const request = new URL(path, location.origin)
			const chainId = request.searchParams.get('chainId')
			const offset = Number(request.searchParams.get('offset') ?? 0)
			const limit = Number(request.searchParams.get('limit') ?? 50)
			const filtered = demoRichList.filter((item) => !chainId || item.chain_id === chainId)
			return { items: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset }
		}
		if (path.startsWith('/api/v1/logs/') && path.split('/').length > 7) {
			if (detailState === 'error' && !demoDetailErrorConsumed) {
				demoDetailErrorConsumed = true
				throw new Error('The receipt could not be read from the RPC')
			}
			if (detailState === 'loading') return await new Promise(() => {})
			const detailLog = demoLogs[0]
			const detailNetwork = demoNetworks.find((network) => network.chain_id === detailLog.chain_id)
			return {
				...detailLog,
				block_timestamp: detailLog.block_timestamp,
				from_address: '0x1A620F3dC4Dba34F365C9233C34A22f8F48D2D34',
				to_address: detailLog.emitter_address,
				value: '0',
				input: '0x4f8b2f2d',
				transaction_status: 'success',
				gas_used: '184220',
				contract_provenance: 'Security Pool Factory.DeploySecurityPool',
				explorer_base_url: detailNetwork?.id === 'sepolia' ? 'https://sepolia.etherscan.io' : 'https://etherscan.io',
				action_argument_schema: [{ index: 0, name: 'reason', type: 'uint8' }],
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
			if (demoState === 'error' && !demoErrorConsumed) {
				demoErrorConsumed = true
				throw new Error('RPC history is temporarily unavailable')
			}
			if (demoState === 'loading') return await new Promise(() => {})
			return { items: demoState === 'empty' ? [] : demoLogs }
		}
	}
	const timeout = AbortSignal.timeout(15_000)
	const response = await fetch(path, { signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]) })
	const payload = await response.json().catch(() => ({}))
	if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`)
	return payload
}

const renderNetworks = (networks) => {
	latestNetworks = networks
	networkCards.classList.remove('empty')
	networkCards.replaceChildren()
	for (const network of networks) {
		const card = element('article', 'network-card')
		card.dataset.phase = network.phase
		const title = element('div', 'network-title')
		const heading = element('h3', '', network.name)
		const badge = element('span', 'badge', network.phase)
		title.append(heading, badge)
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
		const lag =
			network.indexed_block === null || network.observed_block === null
				? 'head unknown'
				: `${counted(Math.max(0, Number(network.observed_block) - Number(network.indexed_block)), 'block')} behind`
		meta.append(indexedTime, ageNode, element('span', '', lag))
		card.append(title, block, meta)
		if (Number(network.consecutive_failures) > 0) {
			const retry = network.next_retry_at ? `next retry ${until(network.next_retry_at)}` : 'retry scheduled'
			card.append(element('p', 'network-retry', `${number(network.consecutive_failures)} consecutive failures · ${retry}`))
		}
		if (network.last_error) card.append(element('p', 'network-error', network.last_error))
		networkCards.append(card)
	}
	networkCards.setAttribute('aria-busy', 'false')
}

const updateDiagnostics = () => {
	const report = {
		generatedAt: new Date().toISOString(),
		page: location.pathname,
		stream: stream?.readyState === EventSource.OPEN ? 'connected' : stream?.readyState === EventSource.CONNECTING ? 'connecting' : 'closed',
		lastStreamEventAt: lastStreamEventAt?.toISOString(),
		networks: latestNetworks.map((network) => ({
			chainId: network.chain_id,
			id: network.id,
			phase: network.phase,
			indexedBlock: network.indexed_block,
			observedBlock: network.observed_block,
			indexedTimestamp: network.indexed_timestamp,
			lastSuccessAt: network.last_success_at,
			consecutiveFailures: network.consecutive_failures,
			nextRetryAt: network.next_retry_at,
			lastReorgAt: network.last_reorg_at,
			lastReorgDepth: network.last_reorg_depth,
			lastError: network.last_error,
		})),
	}
	$('#diagnostics-output').textContent = JSON.stringify(report, null, 2)
}

const updateFreshness = () => {
	if (activeReorgRecovery !== undefined) return
	const retryCanonical = $('#refresh-stale')
	if (canonicalRefreshRequired) {
		const banner = $('#freshness-banner')
		banner.hidden = false
		retryCanonical.hidden = false
		$('#freshness-title').textContent = 'Canonical refresh incomplete'
		$('#freshness-detail').textContent = 'A chain update was recorded, but the canonical content refresh failed. Retry before debugging current state.'
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
	const stale = latestNetworks.filter(
		(network) => !network.last_success_at || Date.now() + serverClockOffsetMs - new Date(network.last_success_at).getTime() > networkFreshnessThresholdMs,
	)
	const banner = $('#freshness-banner')
	retryCanonical.hidden = true
	if (stale.length === 0) {
		banner.hidden = true
		return
	}
	banner.hidden = false
	$('#freshness-title').textContent = `${stale.length} network${stale.length === 1 ? '' : 's'} not updating`
	$('#freshness-detail').textContent = `${stale.map((network) => network.name).join(', ')} · showing the last committed database state.`
}

const reconcileNetworkOptions = (select, items, initialValue = '') => {
	const selected = select.dataset.restored === 'true' ? select.value : initialValue
	select.replaceChildren(new Option('All networks', ''), ...items.map((network) => new Option(network.name, network.chain_id)))
	select.value = [...select.options].some((option) => option.value === selected) ? selected : ''
	select.dataset.restored = 'true'
}

const setManualNetworkRefreshBusy = (busy) => {
	const refreshButton = $('#refresh-networks')
	refreshButton.disabled = busy
	if (busy) {
		refreshButton.setAttribute('aria-busy', 'true')
		refreshButton.textContent = 'Refreshing…'
	} else {
		refreshButton.removeAttribute('aria-busy')
		refreshButton.textContent = 'Refresh status'
	}
}

const loadNetworks = async ({ manual = false, synchronizeActivity = true, refreshAfterCurrent = false } = {}) => {
	if (networkLoadPromise !== undefined) {
		if (!manual && !refreshAfterCurrent) return await networkLoadPromise
		if (refreshAfterCurrent && networkFollowUpPromise !== undefined) return await networkFollowUpPromise
		if (manual) setManualNetworkRefreshBusy(true)
		const activeLoad = networkLoadPromise
		const followUp = activeLoad
			.then(async () => {
				if (networkLoadPromise === activeLoad) networkLoadPromise = undefined
				return await loadNetworks({ manual, synchronizeActivity })
			})
			.finally(() => {
				if (networkFollowUpPromise === followUp) networkFollowUpPromise = undefined
			})
		if (refreshAfterCurrent) networkFollowUpPromise = followUp
		return await followUp
	}
	if (manual) setManualNetworkRefreshBusy(true)
	const run = (async () => {
		try {
			const { items, serverTime, freshnessThresholdMs } = await api('/api/v1/networks')
			if (serverTime) serverClockOffsetMs = new Date(serverTime).getTime() - Date.now()
			if (Number.isFinite(freshnessThresholdMs) && freshnessThresholdMs > 0) networkFreshnessThresholdMs = freshnessThresholdMs
			const previousActivityNetwork = networkFilter.value
			const previousSystemNetwork = $('#system-network-filter').value
			const previousRichNetwork = $('#rich-network-filter').value
			renderNetworks(items)
			lastNetworkRequestFailed = false
			updateFreshness()
			updateDiagnostics()
			reconcileNetworkOptions(networkFilter, items, initialActivityFilters.network)
			reconcileNetworkOptions($('#system-network-filter'), items)
			reconcileNetworkOptions($('#rich-network-filter'), items)
			lastNetworkSuccessAt = new Date()
			$('#last-updated').classList.remove('error')
			$('#last-updated').textContent = `Status checked ${time(lastNetworkSuccessAt)} UTC`
			$('#last-updated').title = lastNetworkSuccessAt.toISOString()
			if (isDemo) {
				connection.className = 'connection live'
				$('#connection-label').textContent = 'Demo fixture'
			}
			if (isActivity && synchronizeActivity && previousActivityNetwork !== networkFilter.value) {
				syncActivityFilterUrl()
				if (validateAddressFilter()) await loadLogs()
				else showInvalidAddressFilter()
			}
			if (isSystem && previousSystemNetwork !== $('#system-network-filter').value) await loadSystemState()
			if (isRichList && previousRichNetwork !== $('#rich-network-filter').value) await loadRichList()
			return true
		} catch {
			lastNetworkRequestFailed = true
			$('#last-updated').classList.add('error')
			$('#last-updated').textContent = lastNetworkSuccessAt ? `Last checked ${time(lastNetworkSuccessAt)} UTC` : 'Status unavailable'
			networkCards.setAttribute('aria-busy', 'false')
			if (networkCards.childElementCount === 0) networkCards.classList.add('empty')
			updateFreshness()
			updateDiagnostics()
			return false
		}
	})()
	const tracked = run.finally(() => {
		if (networkLoadPromise === tracked) networkLoadPromise = undefined
	})
	networkLoadPromise = tracked
	try {
		await tracked
	} finally {
		if (manual) setManualNetworkRefreshBusy(false)
	}
}

const rowFor = (log) => {
	const row = element('button', 'log-row')
	row.type = 'button'
	row.setAttribute(
		'aria-label',
		`${log.network_id} block ${log.block_number} at ${exactTimestamp(log.block_timestamp)}, ${log.event_name ?? 'unknown event'} from ${log.contract_label ?? log.emitter_address}`,
	)
	const chain = element('span', 'cell chain-block')
	const openCue = element('span', 'row-open-cue', '›')
	openCue.setAttribute('aria-hidden', 'true')
	chain.append(element('i', 'chain-dot'), element('span', '', `${log.network_id} · #${number(log.block_number)}`), openCue)
	const timestamp = element('time', 'cell cell-time', `${time(log.block_timestamp)} · ${age(log.block_timestamp)}`)
	timestamp.dataset.time = log.block_timestamp
	timestamp.dateTime = exactTimestamp(log.block_timestamp)
	timestamp.title = exactTimestamp(log.block_timestamp)
	const contract = element('span', 'cell')
	contract.append(element('span', 'contract-name', log.contract_label ?? 'Unknown contract'), element('span', 'contract-address', short(log.emitter_address)))
	const event = element('span', 'cell event-name', log.event_name ?? 'Unknown event')
	const summary = element('span', 'cell summary', log.summary)
	const tx = element('span', 'cell cell-tx', `${short(log.tx_hash, 7, 5)} · ${log.log_index}`)
	const decodeLabel = log.decode_status === 'decoded' ? 'Decoded' : 'Unknown'
	const status = element('span', `status-pill ${log.decode_status === 'decoded' ? '' : 'unknown'}`, `${decodeLabel} · ${log.finalized ? 'final' : 'pending'}`)
	row.append(chain, timestamp, contract, event, summary, tx, status)
	row.addEventListener('click', () => openDetail(log))
	return row
}

const queryPath = (cursor) => {
	const params = new URLSearchParams({ limit: '100' })
	const selectedNetwork = networkFilter.dataset.restored === 'true' ? networkFilter.value : initialActivityFilters.network
	if (selectedNetwork) params.set('chainId', selectedNetwork)
	if ($('#event-filter').value.trim()) params.set('event', $('#event-filter').value.trim())
	if ($('#address-filter').value.trim()) params.set('address', $('#address-filter').value.trim())
	if ($('#decode-filter').value) params.set('decoded', $('#decode-filter').value)
	if (cursor) params.set('cursor', cursor)
	return `/api/v1/logs?${params}`
}

const activityFilterValues = () => ({
	network: networkFilter.dataset.restored === 'true' ? networkFilter.value : initialActivityFilters.network,
	event: $('#event-filter').value.trim(),
	address: $('#address-filter').value.trim(),
	decoded: $('#decode-filter').value,
})

const syncActivityFilterUrl = () => {
	const url = new URL(location.href)
	for (const [name, value] of Object.entries(activityFilterValues())) {
		const parameter = name === 'network' ? 'chainId' : name
		if (value) url.searchParams.set(parameter, value)
		else url.searchParams.delete(parameter)
	}
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
	for (const control of [$('#filters button[type="submit"]'), $('#more'), $('#new-logs')]) control.disabled = busy
	$('#clear-filters').disabled = busy || !hasActivityFilters()
}

const loadLogs = async ({ append = false } = {}) => {
	if (!append) {
		logsAbortController?.abort()
		logsAbortController = new AbortController()
	}
	const requestSignal = logsAbortController?.signal
	const requestVersion = ++logsRequestVersion
	const moreButton = $('#more')
	const hadRows = feed.querySelector('.log-row') !== null
	feed.setAttribute('aria-busy', 'true')
	setLogControlsBusy(true)
	if (append) {
		moreButton.setAttribute('aria-busy', 'true')
		moreButton.textContent = 'Loading more…'
	}
	if (!append && !hadRows) $('#more').hidden = true
	feedState.hidden = false
	feedState.textContent = append ? 'Loading more activity…' : hadRows ? 'Refreshing indexed activity…' : 'Loading indexed activity…'
	if (!append && !hadRows) feed.replaceChildren(...Array.from({ length: 6 }, () => element('div', 'loading-line')))
	try {
		const payload = await api(queryPath(append ? nextCursor : undefined), { signal: requestSignal })
		if (requestVersion !== logsRequestVersion) return
		if (!append) feed.replaceChildren()
		for (const log of payload.items) feed.append(rowFor(log))
		nextCursor = payload.nextCursor
		$('#more').hidden = !nextCursor
		feedState.hidden = feed.childElementCount > 0
		if (feed.childElementCount === 0) feedState.textContent = 'No canonical project logs match these filters yet.'
		$('#activity-summary').textContent =
			feed.childElementCount === 0 ? 'No logs shown' : `${feed.childElementCount} canonical log${feed.childElementCount === 1 ? '' : 's'} shown`
		newLogCount = 0
		$('#new-logs').hidden = true
		return true
	} catch (error) {
		if (error.name === 'AbortError') return false
		if (requestVersion !== logsRequestVersion) return false
		if (!append && !hadRows) feed.replaceChildren()
		$('#more').hidden = !nextCursor
		feedState.hidden = false
		const message = element('span', '', `Activity unavailable: ${error.message}`)
		$('#activity-summary').textContent = hadRows ? `${feed.childElementCount} logs shown · refresh failed` : 'Activity unavailable'
		const retry = element('button', 'state-retry', 'Retry')
		retry.type = 'button'
		retry.addEventListener('click', () => loadLogs())
		feedState.replaceChildren(message, retry)
		return false
	} finally {
		if (requestVersion === logsRequestVersion) {
			feed.setAttribute('aria-busy', 'false')
			setLogControlsBusy(false)
			moreButton.removeAttribute('aria-busy')
			moreButton.textContent = 'Show more'
		}
	}
}

const detailCard = (term, description, wide = false) => {
	const card = element('dl', `detail-card${wide ? ' wide' : ''}`)
	card.append(element('dt', '', term), element('dd', '', description ?? '—'))
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

const openDetail = async (log) => {
	const requestVersion = ++detailRequestVersion
	if (!dialog.open) dialog.showModal()
	detailContent.setAttribute('aria-busy', 'true')
	const loading = element('p', 'detail-status', 'Loading event details…')
	loading.setAttribute('role', 'status')
	detailContent.replaceChildren(loading, element('div', 'loading-line'))
	const url = new URL(location.href)
	url.searchParams.set('log', `${log.chain_id}:${log.block_hash}:${log.tx_hash}:${log.log_index}`)
	history.replaceState(null, '', url)
	try {
		const detail = await api(`/api/v1/logs/${log.chain_id}/${log.block_hash}/${log.tx_hash}/${log.log_index}`)
		if (requestVersion !== detailRequestVersion) return
		const grid = element('div', 'detail-grid')
		grid.append(
			detailCard('Network / block', `${detail.network_id} · #${number(detail.block_number)} · ${exactTimestamp(detail.block_timestamp)}`),
			detailCard('Canonical status', `${detail.canonical ? 'Canonical' : 'Orphaned'} · ${detail.finalized ? 'Finalized' : 'Unfinalized'}`),
			detailCard('Contract', `${detail.contract_label ?? 'Unknown'} · ${detail.emitter_address}`, true),
			detailCard('Contract identity', `${detail.contract_kind ?? 'unknown kind'} · ${detail.contract_provenance ?? 'unknown provenance'}`, true),
			detailCard('Event signature', detail.event_signature ?? 'No matching ABI', true),
			detailCard('Block hash', detail.block_hash, true),
			detailCard('Occurrence position', `transaction ${number(detail.transaction_index)} · log ${number(detail.log_index)}`),
			detailCard('Transaction', detail.tx_hash, true),
			detailCard('From', detail.from_address),
			detailCard('To', detail.to_address),
			detailCard('Transaction result', `${detail.transaction_status ?? 'unknown'} · ${number(detail.gas_used)} gas`),
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
		const table = element('table', 'arguments')
		const head = element('thead')
		const headRow = element('tr')
		for (const label of ['# / Name', 'Solidity type', 'Display value', 'Raw value']) headRow.append(element('th', '', label))
		head.append(headRow)
		const body = element('tbody')
		const rawArgs = detail.arguments ?? {}
		const displayArgs = detail.display_arguments ?? {}
		const schema = detail.argument_schema?.length
			? detail.argument_schema.toSorted((left, right) => Number(left.index) - Number(right.index))
			: Object.keys(rawArgs).map((name, index) => ({ index, name, type: 'unknown' }))
		for (const entry of schema) {
			const name = entry.name
			const raw = rawArgs[name]
			const row = element('tr')
			for (const [label, value] of [
				['# / Name', `#${number(entry.index)} · ${name}`],
				['Solidity type', `${entry.type}${entry.indexed ? ' · indexed' : ''}`],
				['Display value', typeof displayArgs[name] === 'string' ? displayArgs[name] : JSON.stringify(displayArgs[name] ?? raw)],
				['Raw value', typeof raw === 'string' ? raw : JSON.stringify(raw)],
			]) {
				const cell = element('td', '', value)
				cell.dataset.label = label
				row.append(cell)
			}
			body.append(row)
		}
		table.append(head, body)
		argumentsCard.append(table)
		grid.append(argumentsCard)
		const action = element('div', 'detail-card wide')
		action.append(
			element('p', 'eyebrow', 'Transaction calldata and decoded action'),
			element(
				'pre',
				'raw',
				JSON.stringify(
					{
						input: detail.input,
						function: detail.function_signature,
						argumentSchema: detail.action_argument_schema,
						arguments: detail.action_arguments,
						display: detail.action_display_arguments,
					},
					null,
					2,
				),
			),
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
	} catch (error) {
		if (requestVersion !== detailRequestVersion) return
		const alert = element('div', 'detail-error')
		alert.setAttribute('role', 'alert')
		alert.append(element('p', '', `Could not open log: ${error.message}`))
		const retry = element('button', 'state-retry', 'Retry')
		retry.type = 'button'
		retry.addEventListener('click', () => openDetail(log))
		alert.append(retry)
		detailContent.replaceChildren(alert)
	} finally {
		if (requestVersion === detailRequestVersion) detailContent.setAttribute('aria-busy', 'false')
	}
}

const closeDetail = () => {
	detailRequestVersion++
	dialog.close()
	clearDetailUrl()
}

const clearDetailUrl = () => {
	const url = new URL(location.href)
	url.searchParams.delete('log')
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

const metricCard = (label, value) => {
	const card = element('div', 'metric-card')
	card.append(element('span', '', label), element('strong', '', value))
	return card
}

const lineChart = (rows, definitions) => {
	const width = 760
	const height = 190
	const margin = { left: 48, right: 14, top: 12, bottom: 28 }
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
	svg.setAttribute('class', 'time-chart')
	svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
	svg.setAttribute('role', 'img')
	const normalized = definitions.length > 1
	svg.setAttribute('aria-label', `${definitions.map(({ label }) => label).join(', ')} ${normalized ? 'independently scaled trend' : 'value'} over indexed time`)
	const series = definitions.map(({ key, decimals = 18 }) => {
		const raw = rows.map((row) => compactValue(row[key], decimals))
		const seriesMinimum = Math.min(...raw)
		const seriesRange = Math.max(...raw) - seriesMinimum
		return normalized ? raw.map((value) => (seriesRange === 0 ? 50 : ((value - seriesMinimum) / seriesRange) * 100)) : raw
	})
	const values = series.flat().filter(Number.isFinite)
	const minimum = values.length === 0 ? 0 : Math.min(...values)
	const maximum = values.length === 0 ? 1 : Math.max(...values)
	const range = maximum === minimum ? Math.max(1, maximum) : maximum - minimum
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
			: new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(axisValue)
		svg.append(label)
	}
	definitions.forEach(({ key, label, decimals = 18, unit = '', className = '' }, definitionIndex) => {
		const points = rows.map((_row, index) => {
			const value = series[definitionIndex][index]
			const x = margin.left + (chartWidth * index) / Math.max(1, rows.length - 1)
			const y = margin.top + chartHeight - ((value - minimum) / range) * chartHeight
			return [x, y]
		})
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
		path.setAttribute('class', `chart-line ${className}`)
		path.setAttribute('d', points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' '))
		svg.append(path)
		for (const [[x, y], row] of points.map((point, index) => [point, rows[index]])) {
			const point = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
			point.setAttribute('class', `chart-point ${className}`)
			point.setAttribute('cx', String(x))
			point.setAttribute('cy', String(y))
			point.setAttribute('r', '2.8')
			point.setAttribute('tabindex', '0')
			const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
			title.textContent = `${label}: ${exactUnit(row[key], decimals, unit, decimals)} · ${new Date(row.timestamp).toLocaleString()}`
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

const chartCard = (title, rows, definitions, note) => {
	const card = element('section', 'chart-card')
	const heading = element('div', 'chart-heading')
	heading.append(element('h4', '', title))
	const legend = element('div', 'chart-legend')
	for (const { label } of definitions) {
		const item = element('span')
		item.append(element('i'), document.createTextNode(label))
		legend.append(item)
	}
	heading.append(legend)
	card.append(heading)
	if (rows.length === 0) card.append(element('p', 'data-note', 'No canonical checkpoints have been indexed for this entity yet.'))
	else {
		const viewport = element('div', 'chart-scroll')
		viewport.append(lineChart(rows, definitions))
		card.append(
			viewport,
			element(
				'p',
				'data-note',
				`${note}${definitions.length > 1 ? ' Each line is independently scaled to its observed range so every trend remains visible; exact current values are shown above.' : ''}`,
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

const richBalance = (value, symbol, digits = 3) => exactUnit(value ?? '0', 18, symbol, digits)
const richFieldLabel = (label) => element('span', 'sr-only rich-field-label', label)

const renderRichList = () => {
	const rows = $('#richlist-rows')
	const isInitialRender = rows.childElementCount === 0
	const openDetailKeys = new Set([...rows.querySelectorAll('details[open][data-detail-key]')].map((details) => details.dataset.detailKey))
	const focusedDetailKey = document.activeElement?.closest?.('details[data-detail-key]')?.dataset.detailKey
	rows.replaceChildren()
	for (const item of richListItems) {
		const itemKey = `${item.chain_id}:${item.address}`
		const article = element('article', 'rich-row')
		const main = element('div', 'rich-row-main')
		const identity = element('div', 'rich-identity')
		const addressLink = element('a', 'rich-address', item.label ?? short(item.address, 12, 8))
		addressLink.href = `${item.explorer_base_url}/address/${item.address}`
		addressLink.target = '_blank'
		addressLink.rel = 'noreferrer'
		identity.append(
			richFieldLabel('Address'),
			addressLink,
			element('span', '', `${item.label ? `${short(item.address, 12, 8)} · ` : ''}${item.network_id}${item.kind ? ` · ${item.kind}` : ''}`),
		)
		const hasNative = Number(item.sampled_native_count) > 0
		const repComplete = Number(item.sampled_rep_token_count) >= Number(item.rep_token_count)
		const wethComplete = Number(item.sampled_weth_token_count) >= Number(item.weth_token_count)
		const wallet = element('div', 'rich-wallet')
		wallet.append(
			richFieldLabel('ETH / WETH'),
			element('strong', '', hasNative ? richBalance(item.native_balance, 'ETH') : 'ETH pending'),
			element('span', '', wethComplete ? richBalance(item.weth_balance, 'WETH') : `${richBalance(item.weth_balance, 'WETH')} · partial`),
		)
		const transactions = element('div', 'rich-count')
		transactions.append(
			richFieldLabel('Sent transactions'),
			element('strong', '', number(item.transaction_count)),
			element('span', '', counted(item.interaction_count, 'observed interaction')),
		)
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
		const rep = element(
			'strong',
			'rich-rep',
			item.oldest_balance_block ? `${richBalance(item.rep_balance, 'REP')}${repComplete ? '' : ' · partial'}` : 'REP pending',
		)
		rep.prepend(richFieldLabel('All REP'))
		main.append(identity, rep, wallet, transactions, positions, balanceState)
		article.append(main)
		const repTokens = Array.isArray(item.rep_balances) ? item.rep_balances : []
		const wethTokens = Array.isArray(item.weth_balances) ? item.weth_balances : []
		const nativeBalance = item.native_balance_detail
		const details = element('details', 'rich-assets')
		details.dataset.detailKey = `${itemKey}:assets`
		details.open =
			openDetailKeys.has(details.dataset.detailKey) ||
			(isInitialRender && isDemo && pageUrl.searchParams.get('expandRich') === '1' && item === richListItems[0])
		const summary = element(
			'summary',
			'',
			`Exact balances · ${nativeBalance ? 'ETH' : 'ETH pending'} · ${wethTokens.length} WETH · ${repTokens.length} of ${number(item.sampled_rep_token_count)} sampled REP`,
		)
		details.append(summary)
		const tokenGrid = element('div', 'rich-token-grid')
		if (!nativeBalance && repTokens.length === 0 && wethTokens.length === 0)
			tokenGrid.append(element('span', 'data-note', 'Balances have not been refreshed yet.'))
		if (nativeBalance) {
			const nativeCard = element('div', 'rich-token')
			nativeCard.append(
				element('strong', '', exactUnit(nativeBalance.balance, 18, 'ETH', 18)),
				element('span', '', `Native ETH · block #${number(nativeBalance.blockNumber)}`),
				element('code', 'rich-token-raw', `${nativeBalance.balance} base units`),
			)
			tokenGrid.append(nativeCard)
		}
		for (const [token, fallbackSymbol] of [...wethTokens.map((token) => [token, 'WETH']), ...repTokens.map((token) => [token, 'REP'])]) {
			const tokenCard = element('div', 'rich-token')
			const decimals = Number.isInteger(Number(token.decimals)) && Number(token.decimals) >= 0 && Number(token.decimals) <= 255 ? Number(token.decimals) : 18
			const tokenAddress = element('a', 'rich-token-address', token.address)
			tokenAddress.href = `${item.explorer_base_url}/address/${token.address}`
			tokenAddress.target = '_blank'
			tokenAddress.rel = 'noreferrer'
			tokenCard.append(
				element('strong', '', exactUnit(token.balance, decimals, token.symbol ?? fallbackSymbol, decimals)),
				element('span', '', `${token.name ?? token.symbol ?? `${fallbackSymbol} token`} · block #${number(token.blockNumber)}`),
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
			const link = element('a', 'rich-token-address', pool.address)
			link.href = `${item.explorer_base_url}/address/${pool.address}`
			link.target = '_blank'
			link.rel = 'noreferrer'
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
			const link = element('a', 'rich-token-address', position.poolAddress)
			link.href = `${item.explorer_base_url}/address/${position.poolAddress}`
			link.target = '_blank'
			link.rel = 'noreferrer'
			card.append(
				element('span', 'rich-position-kind', 'Vault position'),
				element('strong', '', position.questionTitle ?? 'Vault position'),
				element('span', '', `REP backing units ${exactUnit(position.repBackingUnits, 18, '', 18)}`),
				element('span', '', `Capacity ownership ${exactUnit(position.capacityOwnershipAttoRep, 18, 'REP', 18)}`),
				element('span', '', `Claimable fees ${exactUnit(position.claimableFeesAttoEth, 18, 'ETH', 18)} · block #${number(position.blockNumber)}`),
				link,
			)
			involvementGrid.append(card)
		}
		if (poolAssociations.length < Number(item.pool_count) || vaultPositions.length < Number(item.vault_count))
			involvementGrid.append(element('span', 'data-note', 'Showing the first 100 canonical associations or positions.'))
		involvement.append(involvementGrid)
		article.append(involvement)
		rows.append(article)
	}
	if (focusedDetailKey) {
		const focusedDetails = [...rows.querySelectorAll('details[data-detail-key]')].find((details) => details.dataset.detailKey === focusedDetailKey)
		focusedDetails?.querySelector('summary')?.focus({ preventScroll: true })
	}
	rows.setAttribute('aria-busy', 'false')
	$('#richlist-summary').textContent = `${number(richListItems.length)} of ${number(richListTotal)} known addresses`
	$('#richlist-more').hidden = richListItems.length >= richListTotal
}

const loadRichList = async ({ append = false } = {}) => {
	const requestVersion = ++richListRequestVersion
	const status = $('#richlist-status')
	const more = $('#richlist-more')
	const nextOffset = append ? richListItems.length : 0
	status.hidden = false
	status.textContent = append ? 'Loading more known addresses…' : richListItems.length === 0 ? 'Loading known addresses…' : 'Refreshing known addresses…'
	more.disabled = true
	$('#richlist-rows').setAttribute('aria-busy', 'true')
	try {
		const fetchPage = async (offset, limit) => {
			const query = new URLSearchParams({ sort: $('#rich-sort').value, offset: String(offset), limit: String(limit) })
			const chainId = $('#rich-network-filter').value
			if (chainId) query.set('chainId', chainId)
			return await api(`/api/v1/richlist?${query}`)
		}
		let result
		if (append) result = await fetchPage(nextOffset, 50)
		else {
			const requestedCount = Math.max(50, richListItems.length)
			const firstLimit = Math.min(100, requestedCount)
			const firstPage = await fetchPage(0, firstLimit)
			const targetCount = Math.min(requestedCount, firstPage.total)
			const remainingOffsets = []
			for (let offset = firstLimit; offset < targetCount; offset += 100) remainingOffsets.push(offset)
			const remainingPages = await Promise.all(remainingOffsets.map((offset) => fetchPage(offset, Math.min(100, targetCount - offset))))
			result = { ...firstPage, items: [firstPage, ...remainingPages].flatMap((page) => page.items).slice(0, targetCount) }
		}
		if (requestVersion !== richListRequestVersion) return false
		if (append && result.total < richListItems.length) return await loadRichList()
		richListItems = append ? [...richListItems, ...result.items] : result.items
		richListTotal = result.total
		renderRichList()
		status.hidden = true
		return true
	} catch (error) {
		if (requestVersion !== richListRequestVersion) return false
		$('#richlist-rows').setAttribute('aria-busy', 'false')
		status.hidden = false
		status.textContent =
			richListItems.length === 0 ? `Rich list unavailable: ${error.message}` : `Refresh failed; showing last known rankings: ${error.message}`
		return false
	} finally {
		if (requestVersion === richListRequestVersion) more.disabled = false
	}
}

const renderPoolDetail = async (poolItem, requestVersion) => {
	const history = await api(`/api/v1/state/pools/${poolItem.chain_id}/${poolItem.pool_address}`)
	if (requestVersion !== stateDetailRequestVersion) return
	const fragment = document.createDocumentFragment()
	fragment.append(
		stateHeader(
			'Security pool',
			poolItem.question_title ?? 'Unknown question',
			`${poolItem.network_id} · ${short(poolItem.pool_address, 10, 6)} · universe ${short(poolItem.universe_id, 8, 6)}`,
			'Latest indexed',
		),
	)
	const metrics = element('div', 'metric-grid')
	metrics.append(
		metricCard('Settlement collateral', exactUnit(poolItem.settlement_collateral_atto_eth ?? poolItem.initial_settlement_collateral_atto_eth, 18, 'ETH', 2)),
		metricCard('Capacity ownership', exactUnit(poolItem.total_capacity_ownership_atto_rep, 18, 'REP', 2)),
		metricCard('Claimable vault fees', exactUnit(poolItem.total_claimable_vault_fees_atto_eth, 18, 'ETH', 3)),
		metricCard('Indexed vaults', number(poolItem.vault_count)),
	)
	fragment.append(metrics)
	fragment.append(
		chartCard(
			'Pool accounting history',
			history.snapshots,
			[
				{ key: 'settlement_collateral_atto_eth', label: 'Collateral', unit: 'ETH' },
				{ key: 'total_capacity_ownership_atto_rep', label: 'Capacity ownership', unit: 'REP', className: 'secondary' },
				{ key: 'total_claimable_vault_fees_atto_eth', label: 'Claimable fees', unit: 'ETH', className: 'tertiary' },
			],
			'Authoritative PoolAccountingCheckpoint results. Collateral and fees use attoETH; capacity ownership uses attoREP.',
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
		staticField('Unallocated accrued fees', exactUnit(poolItem.unallocated_accrued_fees_atto_eth, 18, 'ETH', 5)),
		staticField('Current retention rate', exactUnit(poolItem.current_retention_rate, 18, '', 9)),
		staticField('Escalation game', currentState.escalationGame ?? 'Not set'),
	)
	currentCard.append(currentGrid)
	fragment.append(currentCard)
	const staticCard = element('section', 'static-card')
	staticCard.append(element('h4', '', 'Immutable deployment configuration'))
	const grid = element('div', 'static-grid')
	grid.append(
		staticField('Question ID', poolItem.question_id),
		staticField('Parent pool', poolItem.parent_address),
		staticField('Share token', poolItem.share_token_address),
		staticField('Price coordinator', poolItem.coordinator_address),
		staticField('Truth auction', poolItem.truth_auction_address),
		staticField('Security multiplier', `${Number(poolItem.security_multiplier_bps) / 100}%`),
		staticField('Initial priority fee', exactUnit(poolItem.initial_priority_fee_atto_eth_per_gas, 9, 'gwei', 2)),
		staticField('Child pools', number(poolItem.child_count)),
	)
	staticCard.append(grid)
	fragment.append(staticCard)
	$('#state-detail').replaceChildren(fragment)
}

const renderVaultDetail = async (vaultItem, requestVersion) => {
	const history = await api(`/api/v1/state/vaults/${vaultItem.chain_id}/${vaultItem.pool_address}/${vaultItem.vault_address}`)
	if (requestVersion !== stateDetailRequestVersion) return
	const fragment = document.createDocumentFragment()
	fragment.append(
		stateHeader(
			'Security vault',
			short(vaultItem.vault_address, 12, 8),
			`${vaultItem.network_id} · pool ${short(vaultItem.pool_address, 10, 6)}`,
			'Latest indexed',
		),
	)
	const metrics = element('div', 'metric-grid')
	metrics.append(
		metricCard('REP backing units', exactUnit(vaultItem.rep_backing_units, 18, '', 2)),
		metricCard('Capacity ownership', exactUnit(vaultItem.capacity_ownership_atto_rep, 18, 'REP', 2)),
		metricCard('Claimable fees', exactUnit(vaultItem.claimable_fees_atto_eth, 18, 'ETH', 4)),
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
				{ key: 'claimable_fees_atto_eth', label: 'Claimable fees', unit: 'ETH', className: 'tertiary' },
			],
			'VaultAccountingCheckpoint history. REP backing units are protocol accounting units; capacity ownership uses attoREP and fees use attoETH.',
		),
	)
	const staticCard = element('section', 'static-card')
	staticCard.append(element('h4', '', 'Identity and complete current checkpoint'))
	const grid = element('div', 'static-grid')
	grid.append(
		staticField('Vault address', vaultItem.vault_address),
		staticField('Pool address', vaultItem.pool_address),
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

const renderQuestionDetail = async (question, requestVersion) => {
	const history = await api(`/api/v1/state/questions/${question.chain_id}/${question.question_id}`)
	if (requestVersion !== stateDetailRequestVersion) return
	const kind = question.outcome_options.length === 0 ? 'Scalar' : 'Categorical'
	const fragment = document.createDocumentFragment()
	fragment.append(
		stateHeader(
			'Immutable question',
			question.title,
			`${question.network_id} · ID ${short(question.question_id, 10, 8)}`,
			`${kind} · ${questionStatus(question)}`,
		),
	)
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
		staticField('Canonical pool deployments', String(history.pools.length)),
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
		label.textContent = universe.universe_id === '0' ? `${universe.network_id} genesis` : `Universe ${short(universe.universe_id, 7, 5)}`
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

const renderUniverseDetail = async (universe, requestVersion) => {
	const history = await api(`/api/v1/state/universes/${universe.chain_id}/${universe.universe_id}`)
	if (requestVersion !== stateDetailRequestVersion) return
	const fragment = document.createDocumentFragment()
	const title = universe.universe_id === '0' ? `${universe.network_id} genesis universe` : `Universe ${short(universe.universe_id, 12, 8)}`
	fragment.append(
		stateHeader(
			'Zoltar universe',
			title,
			`${universe.network_id} · outcome ${universe.forking_outcome_index} · parent ${short(universe.parent_universe_id, 8, 6)}`,
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
		staticField('REP token', universe.reputation_token_address),
		staticField('Fork question', universe.active_fork_question_id),
		staticField('Fork time', universe.active_fork_time ? new Date(universe.active_fork_time).toISOString() : 'Not forked'),
		staticField('Fork initiator', universe.forker_address),
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
			`${item.network_id} · ${counted(item.vault_count, 'vault')} · ${exactUnit(item.settlement_collateral_atto_eth, 18, 'ETH', 1)}`,
		]
	if (type === 'vaults') return [short(item.vault_address, 10, 6), `${item.network_id} · ${exactUnit(item.capacity_ownership_atto_rep, 18, 'REP', 1)} capacity`]
	if (type === 'questions') return [item.title, `${item.network_id} · ${questionStatus(item)} · ${counted(item.pool_count, 'pool')}`]
	return [
		item.universe_id === '0' ? `${item.network_id} genesis universe` : `Universe ${short(item.universe_id, 9, 6)}`,
		`${item.network_id} · ${counted(item.child_count, 'child', 'children')} · ${counted(item.pool_count, 'pool')}`,
	]
}

const selectEntity = async (item, { preserveDetail = false } = {}) => {
	selectedEntityKey = entityKey(activeStateType, item)
	for (const row of document.querySelectorAll('.entity-row')) row.setAttribute('aria-selected', String(row.dataset.key === selectedEntityKey))
	const requestVersion = ++stateDetailRequestVersion
	const detail = $('#state-detail')
	detail.setAttribute('aria-busy', 'true')
	const replaceWithLoading = !preserveDetail || detail.childElementCount === 0
	detail.querySelector('.detail-refresh-status')?.remove()
	let refreshStatus
	if (replaceWithLoading) detail.replaceChildren(element('div', 'state-placeholder', 'Loading historical checkpoints…'))
	else {
		refreshStatus = element('div', 'system-status detail-refresh-status', 'Refreshing historical checkpoints…')
		refreshStatus.setAttribute('role', 'status')
		detail.prepend(refreshStatus)
	}
	const url = new URL(location.href)
	url.searchParams.set('tab', activeStateType)
	url.searchParams.set('entity', selectedEntityKey)
	history.replaceState(null, '', url)
	try {
		if (activeStateType === 'pools') await renderPoolDetail(item, requestVersion)
		if (activeStateType === 'vaults') await renderVaultDetail(item, requestVersion)
		if (activeStateType === 'questions') await renderQuestionDetail(item, requestVersion)
		if (activeStateType === 'universes') await renderUniverseDetail(item, requestVersion)
		return requestVersion === stateDetailRequestVersion
	} catch (error) {
		if (requestVersion === stateDetailRequestVersion) {
			if (replaceWithLoading) {
				const failure = element('div', 'state-error')
				failure.append(element('span', '', `State history unavailable: ${error.message}`))
				const retry = element('button', '', 'Retry')
				retry.type = 'button'
				retry.addEventListener('click', () => selectEntity(item))
				failure.append(retry)
				detail.replaceChildren(failure)
			} else if (refreshStatus !== undefined) {
				refreshStatus.classList.add('error')
				refreshStatus.replaceChildren(element('span', '', `Historical refresh failed; showing last known details: ${error.message}`))
				const retry = element('button', '', 'Retry')
				retry.type = 'button'
				retry.addEventListener('click', () => selectEntity(item, { preserveDetail: true }))
				refreshStatus.append(retry)
			}
		}
		return false
	} finally {
		if (requestVersion === stateDetailRequestVersion) $('#state-detail').setAttribute('aria-busy', 'false')
	}
}

const renderEntityList = async ({ refreshSelected = false } = {}) => {
	const query = $('#entity-search').value.trim().toLowerCase()
	const network = $('#system-network-filter').value
	const catalogItems = stateData[activeStateType]
	const items = catalogItems.filter(
		(item) => (!network || String(item.chain_id) === network) && (!query || entityCopy(activeStateType, item).join(' ').toLowerCase().includes(query)),
	)
	$('#entity-list-title').textContent = `All ${activeStateType}`
	$('#entity-count').textContent = String(items.length)
	$('#entity-search').placeholder = `Filter ${activeStateType}…`
	const list = $('#entity-list')
	list.replaceChildren()
	for (const item of items) {
		const [title, meta] = entityCopy(activeStateType, item)
		const row = element('button', 'entity-row')
		row.type = 'button'
		row.dataset.key = entityKey(activeStateType, item)
		row.setAttribute('role', 'option')
		row.setAttribute('aria-selected', String(row.dataset.key === selectedEntityKey))
		row.append(element('span', 'entity-row-title', title), element('span', 'entity-row-meta', meta))
		row.addEventListener('click', () => selectEntity(item))
		list.append(row)
	}
	list.setAttribute('aria-busy', 'false')
	const selected = items.find((item) => entityKey(activeStateType, item) === selectedEntityKey)
	if (selected !== undefined) {
		if (refreshSelected) return await selectEntity(selected, { preserveDetail: true })
		return true
	}
	if (items[0] !== undefined) return await selectEntity(items[0])
	else {
		stateDetailRequestVersion++
		selectedEntityKey = undefined
		$('#state-detail').setAttribute('aria-busy', 'false')
		$('#state-detail').replaceChildren(element('div', 'state-placeholder', `No indexed ${activeStateType} match this view.`))
	}
	return true
}

const renderStateStats = () => {
	const stats = $('#state-stats')
	stats.replaceChildren()
	for (const [label, items] of [
		['Pools', stateData.pools],
		['Questions', stateData.questions],
		['Vaults', stateData.vaults],
		['Universes', stateData.universes],
	]) {
		const card = element('div', 'state-stat')
		card.append(element('span', '', `Canonical ${label.toLowerCase()}`), element('strong', '', number(items.length)))
		stats.append(card)
	}
	stats.setAttribute('aria-busy', 'false')
}

const setSystemControlsDisabled = (disabled) => {
	$('#system-network-filter').disabled = disabled
	$('#entity-search').disabled = disabled
	for (const tab of document.querySelectorAll('[data-state-tab]')) tab.disabled = disabled
	for (const row of document.querySelectorAll('.entity-row')) row.disabled = disabled
}

const loadSystemState = async () => {
	const requestVersion = ++catalogRequestVersion
	const alert = $('#system-alert')
	const status = $('#system-status')
	const hadData = stateData !== undefined
	alert.hidden = true
	alert.replaceChildren()
	status.hidden = false
	status.textContent = hadData ? 'Refreshing indexed registry…' : 'Loading indexed registry…'
	setSystemControlsDisabled(true)
	$('#state-stats').setAttribute('aria-busy', 'true')
	$('#entity-list').setAttribute('aria-busy', 'true')
	try {
		const chainId = $('#system-network-filter').value
		const nextStateData = await api(`/api/v1/state/catalog${chainId ? `?chainId=${chainId}` : ''}`)
		if (requestVersion !== catalogRequestVersion) return false
		stateData = nextStateData
		for (const poolItem of stateData.pools) poolItem.current_state = {}
		const orderedPoolStates = stateData.poolStates.toSorted(
			(left, right) => Number(left.block_number) - Number(right.block_number) || Number(left.log_index) - Number(right.log_index),
		)
		for (const state of orderedPoolStates) {
			const poolItem = stateData.pools.find(
				(candidate) => String(candidate.chain_id) === String(state.chain_id) && candidate.pool_address === state.pool_address,
			)
			if (poolItem !== undefined) Object.assign(poolItem.current_state, state.state)
		}
		renderStateStats()
		const detailRefreshed = await renderEntityList({ refreshSelected: true })
		if (requestVersion !== catalogRequestVersion) return false
		status.hidden = true
		const truncated = Object.entries(stateData.truncated ?? {})
			.filter(([, value]) => value)
			.map(([name]) => name)
		if (truncated.length > 0) {
			alert.hidden = false
			alert.append(element('span', '', `Large registry: showing ${stateData.limit} ${truncated.join(', ')} records. Select one network to narrow the result.`))
		}
		return detailRefreshed
	} catch (error) {
		if (requestVersion === catalogRequestVersion) {
			$('#state-stats').setAttribute('aria-busy', 'false')
			$('#entity-list').setAttribute('aria-busy', 'false')
			$('#state-detail').setAttribute('aria-busy', 'false')
			alert.hidden = false
			status.hidden = true
			alert.append(element('span', '', hadData ? `Refresh failed; showing last known state: ${error.message}` : `System state unavailable: ${error.message}`))
			const retry = element('button', '', 'Retry')
			retry.type = 'button'
			retry.addEventListener('click', loadSystemState)
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
		if (requestVersion === catalogRequestVersion) {
			$('#state-stats').setAttribute('aria-busy', 'false')
			$('#entity-list').setAttribute('aria-busy', 'false')
			setSystemControlsDisabled(false)
		}
	}
}

const setStateTab = (type) => {
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

$('#filters').addEventListener('submit', (event) => {
	event.preventDefault()
	if (!validateAddressFilter(true)) return
	syncActivityFilterUrl()
	loadLogs()
})
$('#clear-filters').addEventListener('click', () => {
	networkFilter.value = ''
	$('#event-filter').value = ''
	$('#address-filter').value = ''
	$('#decode-filter').value = ''
	validateAddressFilter()
	syncActivityFilterUrl()
	loadLogs()
})
$('#address-filter').addEventListener('input', validateAddressFilter)
$('#filters').addEventListener('input', () => {
	$('#clear-filters').disabled = !hasActivityFilters()
})
$('#refresh-networks').addEventListener('click', () => loadNetworks({ manual: true }))
$('#refresh-stale').addEventListener('click', async () => {
	const button = $('#refresh-stale')
	if (button.disabled) return
	button.disabled = true
	button.setAttribute('aria-busy', 'true')
	button.textContent = 'Retrying…'
	try {
		if (canonicalRefreshRequired) {
			const refreshed = await refreshAfterUpdates(1, true)
			if (refreshed) canonicalRefreshRequired = false
			updateFreshness()
		} else {
			await loadNetworks({ manual: true, refreshAfterCurrent: true })
			if (isSystem) await loadSystemState()
			else if (isRichList) await loadRichList()
			else if (validateAddressFilter()) await loadLogs()
		}
	} finally {
		button.disabled = false
		button.removeAttribute('aria-busy')
		button.textContent = 'Retry now'
	}
})
$('#copy-diagnostics').addEventListener('click', async (event) => {
	updateDiagnostics()
	const button = event.currentTarget
	try {
		await navigator.clipboard.writeText($('#diagnostics-output').textContent)
		button.textContent = 'Copied'
	} catch {
		button.textContent = 'Copy failed'
	}
	setTimeout(() => {
		button.textContent = 'Copy diagnostics'
	}, 1200)
})
$('#more').addEventListener('click', () => loadLogs({ append: true }))
$('#new-logs').addEventListener('click', () => loadLogs())
$('#close-detail').addEventListener('click', closeDetail)
dialog.addEventListener('click', (event) => {
	if (event.target === dialog) closeDetail()
})
dialog.addEventListener('close', clearDetailUrl)
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
	if (stateData !== undefined) renderEntityList()
})
$('#entity-search').addEventListener('keydown', (event) => {
	if (event.key !== 'Escape' || event.currentTarget.value === '') return
	event.preventDefault()
	event.currentTarget.value = ''
	if (stateData !== undefined) renderEntityList()
})
$('#system-network-filter').addEventListener('change', loadSystemState)
$('#rich-network-filter').addEventListener('change', () => loadRichList())
$('#rich-sort').addEventListener('change', () => loadRichList())
$('#richlist-more').addEventListener('click', () => loadRichList({ append: true }))

const refreshAfterUpdates = async (count, forceContentRefresh = false) => {
	const networkRefresh = loadNetworks()
	if (isSystem) {
		const [, contentRefreshed] = await Promise.all([networkRefresh, loadSystemState()])
		if (contentRefreshed && canonicalRefreshRequired && activeReorgRecovery === undefined) {
			canonicalRefreshRequired = false
			updateFreshness()
		}
		return contentRefreshed
	}
	if (isRichList) {
		const [, contentRefreshed] = await Promise.all([networkRefresh, loadRichList()])
		if (contentRefreshed && canonicalRefreshRequired && activeReorgRecovery === undefined) {
			canonicalRefreshRequired = false
			updateFreshness()
		}
		return contentRefreshed
	}
	if (forceContentRefresh || window.scrollY < 420) {
		const [, contentRefreshed] = await Promise.all([networkRefresh, loadLogs()])
		if (contentRefreshed && canonicalRefreshRequired && activeReorgRecovery === undefined) {
			canonicalRefreshRequired = false
			updateFreshness()
		}
		return contentRefreshed
	}
	await networkRefresh
	newLogCount += count
	$('#new-logs').textContent = `Show ${newLogCount} new update${newLogCount === 1 ? '' : 's'}`
	$('#new-logs').hidden = false
	return true
}

const refreshCanonicalViews = async (title, detail) => {
	const recovery = Symbol('canonical-recovery')
	activeReorgRecovery = recovery
	canonicalRefreshRequired = true
	const banner = $('#freshness-banner')
	banner.hidden = false
	$('#freshness-title').textContent = title
	$('#freshness-detail').textContent = detail
	updateDiagnostics()
	const refreshed = await refreshAfterUpdates(1, true)
	if (activeReorgRecovery !== recovery) return
	activeReorgRecovery = undefined
	if (!refreshed) {
		updateFreshness()
		return
	}
	canonicalRefreshRequired = false
	updateFreshness()
}

const queueBlockRefresh = () => {
	pendingBlockUpdates++
	if (blockRefreshTimer !== undefined) return
	blockRefreshTimer = window.setTimeout(() => {
		const count = pendingBlockUpdates
		pendingBlockUpdates = 0
		blockRefreshTimer = undefined
		void refreshAfterUpdates(count)
	}, 1_000)
}

const connectStream = () => {
	if (isDemo) {
		connection.className = 'connection live'
		$('#connection-label').textContent = 'Demo fixture'
		return
	}
	if (stream !== undefined) return
	const nextStream = new EventSource('/api/v1/stream')
	stream = nextStream
	nextStream.addEventListener('open', () => {
		lastStreamEventAt = new Date()
		connection.className = 'connection live'
		$('#connection-label').textContent = 'Live connection'
		if (streamHasOpened) void refreshAfterUpdates(1)
		streamHasOpened = true
	})
	nextStream.addEventListener('error', () => {
		connection.className = 'connection error'
		$('#connection-label').textContent = 'Reconnecting'
	})
	const liveUpdate = () => {
		lastStreamEventAt = new Date()
		updateDiagnostics()
		queueBlockRefresh()
	}
	nextStream.addEventListener('block', liveUpdate)
	nextStream.addEventListener('status', liveUpdate)
	nextStream.addEventListener('reorg', async (event) => {
		lastStreamEventAt = new Date()
		let depth = 'unknown'
		try {
			depth = JSON.parse(event.data).depth ?? depth
		} catch {
			// A malformed notification still triggers a canonical refresh.
		}
		await refreshCanonicalViews('Chain reorganization detected', `${depth} block${depth === '1' ? '' : 's'} replaced; canonical views are refreshing.`)
	})
	nextStream.addEventListener('reset', async () => {
		lastStreamEventAt = new Date()
		await refreshCanonicalViews('Live replay window expired', 'Refreshing canonical views from the current database state.')
	})
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
	await loadNetworks({ refreshAfterCurrent: true })
	if (isSystem) await loadSystemState()
	else if (isRichList) await loadRichList()
	else if (validateAddressFilter()) await loadLogs()
	else showInvalidAddressFilter()
})

setInterval(() => {
	for (const node of document.querySelectorAll('[data-time]'))
		node.textContent = node.classList.contains('cell-time') ? `${time(node.dataset.time)} · ${age(node.dataset.time)}` : age(node.dataset.time)
}, 1000)
setInterval(() => {
	if (document.hidden) return
	loadNetworks()
	if (!isDemo && (!lastStreamEventAt || Date.now() - lastStreamEventAt.getTime() > 30_000)) {
		if (isSystem) loadSystemState()
		else if (isRichList) loadRichList()
		else if (window.scrollY < 420 && validateAddressFilter()) loadLogs()
	}
}, 12_000)
document.addEventListener('visibilitychange', () => {
	if (!document.hidden) loadNetworks({ refreshAfterCurrent: true })
})

$('#event-filter').value = initialActivityFilters.event
$('#address-filter').value = initialActivityFilters.address
$('#decode-filter').value = ['true', 'false'].includes(initialActivityFilters.decoded) ? initialActivityFilters.decoded : ''
if (initialActivityFilters.network) {
	networkFilter.append(new Option(`Chain ${initialActivityFilters.network}`, initialActivityFilters.network))
	networkFilter.value = initialActivityFilters.network
	networkFilter.dataset.restored = 'true'
}
validateAddressFilter()
$('#clear-filters').disabled = !hasActivityFilters()

const deepLink = pageUrl.searchParams.get('log')
$('#activity').hidden = !isActivity
$('#system').hidden = !isSystem
$('#richlist').hidden = !isRichList
$('.skip-link').href = isSystem ? '#system' : isRichList ? '#richlist' : '#activity'
for (const link of document.querySelectorAll('.product-nav a')) if (new URL(link.href).pathname === location.pathname) link.setAttribute('aria-current', 'page')

const requestedTab = pageUrl.searchParams.get('tab')
if (isSystem) setStateTab(['pools', 'questions', 'vaults', 'universes'].includes(requestedTab) ? requestedTab : 'pools')
if (isSystem) selectedEntityKey = pageUrl.searchParams.get('entity') ?? undefined

const initialDashboardLoad = isSystem
	? Promise.all([loadNetworks(), loadSystemState()])
	: isRichList
		? Promise.all([loadNetworks(), loadRichList()])
		: (async () => {
				await loadNetworks({ synchronizeActivity: false })
				syncActivityFilterUrl()
				if (validateAddressFilter()) await loadLogs()
				else showInvalidAddressFilter()
			})()
if (isActivity && deepLink !== null) {
	const [chainId, blockHash, transactionHash, logIndex] = deepLink.split(':')
	if (chainId && blockHash && transactionHash && logIndex)
		openDetail({ chain_id: chainId, block_hash: blockHash, tx_hash: transactionHash, log_index: Number(logIndex) })
}
await initialDashboardLoad

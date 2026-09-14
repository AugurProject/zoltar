import { demoAmmPriceHistory, demoDenseUniswapRepEthPriceHistory, demoRepEthPriceHistory, demoUniswapRepEthPriceHistory } from './demo-fixtures.ts'

import { type ContractRecord, type LiveEventPayload } from '../../browser/browser-types.ts'

import { decodeItemsPage, isAccountTransaction, requiredArrayItem } from '../../browser/api-decoding.ts'

import { demoTimelineEvidenceStatus } from '../../browser/live-update.ts'

import { shortIdentifier } from '../../browser/identifier-format.ts'

import type { DemoContext } from '../../browser/demo-runtime.ts'

import { fetchApi } from '../../browser/fetch-api.ts'

export function createDemoApi(context: DemoContext) {
	const isDemo = true

	const demoState = context.pageUrl.searchParams.get('state')

	const priceDemo = context.pageUrl.searchParams.get('priceDemo')

	const detailState = context.pageUrl.searchParams.get('detailState')

	const deploymentState = context.pageUrl.searchParams.get('deploymentState')

	const networkState = context.pageUrl.searchParams.get('networkState')

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

	let demoEvictedAddress: string | undefined

	let demoReorgRefreshErrorConsumed = false

	let demoTransactionSnapshotInvalidated = false

	let demoCanonicalRouteRefreshErrorConsumed = false

	let demoTransactionRestoreErrorConsumed = false

	let demoTransactionAppendErrorConsumed = false

	let demoNetworkFallbackErrorConsumed = false

	let demoRouteRefreshErrorConsumed = false

	let demoRiskHistoryAppendErrorConsumed = false

	let demoStateHistoryAppendErrorConsumed = false

	let demoPortfolioAppendErrorConsumed = false

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
		if (networkState === 'stale') return demoNetworks.map(network => ({ ...network, last_success_at: new Date(Date.now() - 120_000).toISOString() }))
		if (networkState === 'stale-head')
			return demoNetworks.map(network => ({
				...network,
				indexed_block: network.observed_block,
				indexed_timestamp: new Date(Date.now() - 120_000).toISOString(),
				phase: 'live',
			}))
		if (networkState !== 'future-start') return demoNetworks
		return demoNetworks.map(network => ({
			...network,
			start_block: (BigInt(network.observed_block) + 1n).toString(),
			indexed_block: null,
			indexed_hash: null,
			indexed_timestamp: null,
			phase: 'live',
		}))
	}

	const demoManifestDeployment = (networkId: string, index: number, deploymentBlock: string | undefined): { deployment_block: string | null; deployment_timestamp: string | null } => {
		if (networkId === 'mainnet') return { deployment_block: deploymentBlock ?? null, deployment_timestamp: deploymentBlock === undefined ? null : new Date(Date.now() - (5 - index) * 86_400_000).toISOString() }
		if (index < 3) return { deployment_block: String(8_750_000 + index * 12), deployment_timestamp: networkId === 'sepolia' ? new Date(Date.now() - (3 - index) * 86_400_000).toISOString() : null }
		return { deployment_block: null, deployment_timestamp: null }
	}

	const DEMO_LOG_CONTRACT_LABELS = ['Security Pool 0x8c2f', 'OpenOracle', 'Genesis REP', 'Security Pool Factory'] as const

	const demoPoolQuestionTitle = (networkId: string) => (networkId === 'sepolia' ? 'Which client ships the next protocol release first?' : 'Will the 2030 global mean temperature anomaly exceed 1.5°C?')

	const historyPageSlice = <T>(records: readonly T[], split: number, offset: number) => (offset === 0 ? records.slice(split) : records.slice(0, split))

	const demoDisplayedRepEthPrices = <T extends { rep_per_eth_1e18: string }>(repEthPrices: readonly T[], firstRepEthPrice: T): T[] => {
		if (priceDemo === 'constant-zero') return [{ ...firstRepEthPrice, rep_per_eth_1e18: '0' }]
		if (priceDemo === 'constant-nonzero') return [firstRepEthPrice]
		if (priceDemo === 'constant-repeated') return repEthPrices.slice(0, 3).map(price => ({ ...price, rep_per_eth_1e18: firstRepEthPrice.rep_per_eth_1e18 }))
		return [...repEthPrices]
	}

	const demoUniswapPrices = () => (priceDemo === 'eight' ? demoDenseUniswapRepEthPriceHistory() : demoUniswapRepEthPriceHistory())

	const DEMO_OPEN_ORACLE_HISTORY = [
		{ event_name: 'ReportSubmitted', summary: 'REP/ETH report submitted' },
		{ event_name: 'ReportDisputed', summary: 'Replacement round accepted' },
		{ event_name: 'PriceReported', summary: 'Coordinator accepted the settled price' },
	] as const

	const demoSupplyEventName = (index: number) => {
		if (index === 0) return 'UniverseInitialized'
		return index === 4 ? 'UniverseForked' : 'MigrationRepAdded'
	}

	const demoContracts = demoNetworks.flatMap(network => {
		const manifestDefinitions: readonly (readonly [address: string, label: string, kind: string, deploymentBlock: string | undefined, exact: boolean])[] = [
			['0x7A0D94F55792C434d74a40883C6ed8545E406D12', 'Proxy Deployer', 'proxyDeployer', '22181455', true],
			['0x052c04adFF6C1BF51f52158e36441C1e99cdfDB4', 'Deployment Status Oracle', 'deploymentStatusOracle', '22181462', true],
			['0x529dcaC57677451CBfe766d88CcC133D082500df', 'OpenOracle', 'openOracle', '22181501', true],
			['0xaa280cf94Fc3531aDe40b479C17eBef53923291C', 'Zoltar', 'zoltar', undefined, true],
			['0xBea56ec12C943213408DA17f754A523A8aB38947', 'Security Pool Factory', 'securityPoolFactory', undefined, true],
			['0x221657776846890989a759ba2973e427dff5c9bb', 'Genesis REP', 'reputationToken', '7290001', true],
			['0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 'Wrapped Ether', 'weth', '4719568', true],
			['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'USD Coin', 'usdc', '6082465', true],
			['0x1F98431c8aD98523631AE4a59f267346ea31F984', 'Uniswap V3 Factory', 'uniswapV3Factory', '12369621', true],
		]
		const manifestContracts: ContractRecord[] = manifestDefinitions.map(([address, label, kind, deploymentBlock, exact], index) => ({
			chain_id: network.chain_id,
			address,
			label,
			kind,
			provenance: 'manifest',
			discovery_block: null,
			discovery_tx_hash: null,
			...demoManifestDeployment(network.id, index, deploymentBlock),
			deployment_block_exact: deploymentBlock === undefined ? null : exact,
			deployment_checked_block: network.indexed_block,
			explorer_base_url: network.explorer_base_url,
		}))
		return [
			...manifestContracts,
			{
				chain_id: network.chain_id,
				address: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
				label: 'Security Pool 0',
				kind: 'securityPool',
				provenance: 'DeploySecurityPool',
				discovery_block: network.indexed_block,
				discovery_tx_hash: demoHash,
				deployment_block: network.indexed_block,
				deployment_timestamp: network.indexed_timestamp,
				deployment_block_exact: true,
				deployment_checked_block: network.indexed_block,
				explorer_base_url: network.explorer_base_url,
			},
		]
	})

	const demoEvents = ['PoolAccountingCheckpoint', 'Transfer', 'PriceReported', 'ClaimDeposit', 'DeploySecurityPool', 'ReportSubmitted', 'UniverseInitialized', 'BidSubmitted']

	const demoLogs = Array.from({ length: 18 }, (_, index) => {
		const network = requiredArrayItem(demoNetworks, index % 3 === 0 ? 1 : 0, 'Demo network')
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
			contract_label: DEMO_LOG_CONTRACT_LABELS[index % DEMO_LOG_CONTRACT_LABELS.length],
			contract_kind: 'securityPool',
			event_name: demoEvents[index % demoEvents.length],
			function_name: index % 2 === 0 ? 'report' : 'checkpoint',
			function_signature: index % 2 === 0 ? 'report(uint256)' : 'checkpoint(uint8,address[])',
			action_summary: index % 2 === 0 ? 'report' : 'checkpoint',
			to_address: '0x7777777777777777777777777777777777777777',
			summary: index % 2 === 0 ? 'amount=4,250.75 REP · vault=Market maker (0x19B4…E2a0)' : `reportId=1842 · price=0.004281 ${network.id === 'sepolia' ? 'SepoliaETH' : 'ETH'} · outcomeIndex=2`,
			decode_status: index === 7 ? 'unknown' : 'decoded',
			canonical: true,
			finalized: index > 4,
			topics: [demoHash],
			data: '0x00',
			arguments: {
				['amountAttoRep']: (4_250_750n * 10n ** 15n).toString(),
				vault: '0x19B4a7C60926D8FBe420C2a49f1DB56D7800E2a0',
				coordinator: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
				recipients: ['0x7777777777777777777777777777777777777777', '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'],
			},
			display_arguments: {
				['amountAttoRep']: (4_250_750n * 10n ** 15n).toString(),
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
		const network = requiredArrayItem(demoNetworks, index % 3 === 0 ? 1 : 0, 'Demo rich-list network')
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
					address: requiredArrayItem(demoNetworks, 0, 'Mainnet demo network').chain_id === network.chain_id ? '0x221657776846890989a759ba2973e427dff5c9bb' : '0x754bc4ca2539560f1b48a9c3d2def5b9718f2c82',
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
				questionTitle: poolIndex === 0 ? demoPoolQuestionTitle(network.id) : null,
			})),
			vault_positions: Array.from({ length: vaultCount }, (_, vaultIndex) => ({
				poolAddress: `0x${(BigInt(index + 1) * 100n + BigInt(vaultIndex + 1)).toString(16).padStart(40, 'a')}`,
				questionTitle: network.id === 'sepolia' ? 'Which client ships the next protocol release first?' : 'Will the 2030 global mean temperature anomaly exceed 1.5°C?',
				repBackingUnits: String(BigInt(120 + vaultIndex) * 10n ** 18n),
				capacityOwnershipAttoRep: String(BigInt(85 + vaultIndex) * 10n ** 18n),
				claimableFeesAttoEth: String(BigInt(3 + vaultIndex) * 10n ** 16n),
				blockNumber: network.indexed_block,
			})),
		}
	})

	const demoInitialTransactionCounts = new Map(demoRichList.map(item => [`${item.chain_id}:${item.address.toLowerCase()}`, Number(item.transaction_count)]))

	const demoNetworkBaselines = new Map(demoNetworks.map(network => [network.chain_id, { blockNumber: BigInt(network.indexed_block), timestamp: new Date(network.indexed_timestamp).getTime() }]))

	const demoAddress = (seed: string) => `0x${seed.repeat(40).slice(0, 40)}`

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

	const mainnetDemoQuestion = requiredArrayItem(demoQuestions, 0, 'Mainnet demo question')

	const secondaryDemoQuestion = requiredArrayItem(demoQuestions, 1, 'Secondary demo question')

	const sepoliaDemoQuestion = requiredArrayItem(demoQuestions, 2, 'Sepolia demo question')

	const demoPools = [
		{
			chain_id: '1',
			network_id: 'mainnet',
			pool_address: demoAddress('a'),
			parent_address: demoAddress('0'),
			universe_id: '0',
			question_id: mainnetDemoQuestion.question_id,
			question_title: mainnetDemoQuestion.title,
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
			question_id: mainnetDemoQuestion.question_id,
			question_title: mainnetDemoQuestion.title,
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
			question_id: secondaryDemoQuestion.question_id,
			question_title: secondaryDemoQuestion.title,
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
			question_id: sepoliaDemoQuestion.question_id,
			question_title: sepoliaDemoQuestion.title,
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
		const poolItem = requiredArrayItem(demoPools, index % demoPools.length, 'Demo vault pool')
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
			active_fork_question_id: secondaryDemoQuestion.question_id,
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
			active_fork_question_id: sepoliaDemoQuestion.question_id,
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

	const demoSeries = (base: string, count = 12, variation = 0.32) =>
		Array.from({ length: count }, (_, index) => {
			const factor = 1 - variation + (variation * index) / Math.max(1, count - 1) + Math.sin(index * 1.4) * 0.025
			return String(BigInt(Math.max(1, Math.round(Number(base) * factor))))
		})

	const demoHistory = (path: string) => {
		const request = new URL(path, location.origin)
		const parts = request.pathname.split('/')
		const type = parts[4]
		const offset = request.searchParams.has('cursor') ? 1000 : 0
		const historyMore = context.pageUrl.searchParams.get('stateHistoryMore') === '1'
		const pagedHistory = (history: Readonly<Record<string, unknown>>, seriesKeys: readonly string[]) => {
			const page: Record<string, unknown> = { ...history }
			for (const key of seriesKeys) {
				const records = Array.isArray(history[key]) ? history[key] : []
				const split = Math.max(1, Math.ceil(records.length / 2))
				page[key] = historyMore ? historyPageSlice(records, split, offset) : records
			}
			const series = Object.fromEntries(seriesKeys.map(key => [key, Array.isArray(page[key]) ? page[key].length : 0]))
			const truncated = historyMore && offset === 0
			return {
				...page,
				truncated,
				limit: 1000,
				offset,
				coverage: {
					requestedFromBlock: request.searchParams.get('fromBlock') ?? '23000000',
					requestedToBlock: request.searchParams.get('toBlock') ?? '23514219',
					indexedFromBlock: '23000000',
					indexedThroughBlock: '23514219',
					indexedThroughHash: demoHash,
					limit: 1000,
					offset,
					series,
					complete: !truncated,
					rangeCovered: true,
					hasPreviousPages: offset > 0,
					...(truncated ? { nextCursor: 'demo-state-history-older' } : {}),
				},
			}
		}
		if (type === 'pools') {
			const poolItem = demoPools.find(item => item.pool_address === parts[6]) ?? requiredArrayItem(demoPools, 0, 'Default demo pool')
			const collateral = demoSeries(poolItem.settlement_collateral_atto_eth)
			const capacity = demoSeries(poolItem.total_capacity_ownership_atto_rep, 12, 0.4)
			const hasAmm = poolItem.question_id === mainnetDemoQuestion.question_id
			const hasRepEthPrices = poolItem !== requiredArrayItem(demoPools, 2, 'REP price demo pool')
			const repEthPrices = demoRepEthPriceHistory()
			const firstRepEthPrice = requiredArrayItem(repEthPrices, 0, 'Demo REP/ETH price')
			const displayedRepEthPrices = demoDisplayedRepEthPrices(repEthPrices, firstRepEthPrice)
			return pagedHistory(
				{
					snapshots: collateral.map((value, index) => ({
						timestamp: new Date(Date.now() - (11 - index) * 7 * 86_400_000).toISOString(),
						block_number: String(23100000 + index * 7700),
						settlement_collateral_atto_eth: value,
						total_capacity_ownership_atto_rep: requiredArrayItem(capacity, index, 'Demo capacity point'),
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
					uniswapRepEthPrices: hasRepEthPrices ? demoUniswapPrices() : [],
					openOracleHistory: hasRepEthPrices
						? displayedRepEthPrices.slice(-3).map((price, index) => ({
								timestamp: price.timestamp,
								block_number: price.block_number,
								...DEMO_OPEN_ORACLE_HISTORY[Math.min(index, DEMO_OPEN_ORACLE_HISTORY.length - 1)],
								coordinator_address: poolItem.coordinator_address,
							}))
						: [],
				},
				['snapshots', 'events', 'ammPrices', 'repEthPrices', 'uniswapRepEthPrices', 'openOracleHistory'],
			)
		}
		if (type === 'vaults') {
			const vaultItem = demoVaults.find(item => item.pool_address === parts[6] && item.vault_address === parts[7]) ?? requiredArrayItem(demoVaults, 0, 'Default demo vault')
			const rep = demoSeries(vaultItem.rep_backing_units, 10, 0.45)
			const capacity = demoSeries(vaultItem.capacity_ownership_atto_rep, 10, 0.5)
			return pagedHistory(
				{
					snapshots: rep.map((value, index) => ({
						timestamp: new Date(Date.now() - (9 - index) * 8 * 86_400_000).toISOString(),
						block_number: String(23110000 + index * 6800),
						rep_backing_units: value,
						capacity_ownership_atto_rep: requiredArrayItem(capacity, index, 'Demo vault capacity point'),
						claimable_fees_atto_eth: String(BigInt(1 + index) * 10n ** 16n),
					})),
				},
				['snapshots'],
			)
		}
		if (type === 'universes') {
			const universe = demoUniverses.find(item => item.universe_id === parts[6]) ?? requiredArrayItem(demoUniverses, 0, 'Default demo universe')
			const supply = Array.from({ length: 9 }, (_, index) => String((BigInt(universe.theoretical_supply_atto_rep) * BigInt(108 - index)) / 100n))
			return pagedHistory(
				{
					events: supply.map((value, index) => ({
						timestamp: new Date(Date.now() - (8 - index) * 12 * 86_400_000).toISOString(),
						block_number: String(23080000 + index * 11000),
						event_name: demoSupplyEventName(index),
						theoretical_supply_atto_rep: value,
					})),
				},
				['events'],
			)
		}
		return pagedHistory(
			{
				pools: demoPools.filter(item => item.question_id === parts[6]).map((item, index) => ({ ...item, timestamp: new Date(Date.now() - (50 - index * 12) * 86_400_000).toISOString() })),
				forks: [],
			},
			['pools', 'forks'],
		)
	}

	let demoLiveSequence = 0

	const applyDemoBlock = (payload: LiveEventPayload) => {
		if (!isDemo || context.pageUrl.searchParams.get('streamDemo') !== '1') return
		const chainId = String(payload.chainId)
		const network = demoNetworks.find(item => item.chain_id === chainId)
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
		const template = demoLogs.find(item => item.chain_id === chainId) ?? requiredArrayItem(demoLogs, 0, 'Demo live log template')
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
		const account = demoRichList.find(item => item.chain_id === chainId)
		if (account !== undefined) {
			account.transaction_count = String(Number(account.transaction_count) + 1)
			account.interaction_count = String(Number(account.interaction_count) + 1)
			account.native_balance = (BigInt(account.native_balance) + 10_000_000_000_000_000n).toString()
			account.native_balance_detail = { balance: account.native_balance, blockNumber: nextBlock }
			account.last_balance_refresh = timestamp
		}
		const pool = demoPools.find(item => item.chain_id === chainId)
		if (pool !== undefined) {
			pool.snapshot_block = nextBlock
			pool.settlement_collateral_atto_eth = (BigInt(pool.settlement_collateral_atto_eth) + 10_000_000_000_000_000n).toString()
		}
	}

	const demoOperations = (chainId: string, atBlock?: string) => {
		const network = demoNetworks.find(item => item.chain_id === chainId) ?? demoNetworks[0]
		const historicalBlock = atBlock !== undefined && /^\d+$/.test(atBlock) ? atBlock : undefined
		const historical = historicalBlock !== undefined
		const indexedHead = network?.indexed_block ?? '0'
		const observedHead = network?.observed_block ?? indexedHead
		const selectedBlock = historicalBlock ?? indexedHead
		const nonnegativeDifference = (upper: string, lower: string) => String(BigInt(upper) > BigInt(lower) ? BigInt(upper) - BigInt(lower) : 0n)
		const asOf = {
			blockNumber: selectedBlock,
			blockHash: network?.indexed_hash ?? demoHash,
			blockTimestamp: String(Math.floor(new Date(network?.indexed_timestamp ?? Date.now()).getTime() / 1_000)),
			indexedHead,
			observedHead,
			lagBlocks: nonnegativeDifference(observedHead, selectedBlock),
			historyDepthBlocks: nonnegativeDifference(indexedHead, selectedBlock),
			invalidationId: '0',
			abiSourceHash: 'sha256:demo-abi',
			applicationSourceHash: 'sha256:demo-application',
			projectionSourceHash: 'sha256:demo-projection',
			phase: historical ? 'historical' : (network?.phase ?? 'live'),
			lastSuccessfulRefresh: network?.last_success_at ?? new Date().toISOString(),
			historical,
		}
		const reports = [
			{
				open_oracle_address: '0x529dcaC57677451CBfe766d88CcC133D082500df',
				report_id: '1842',
				observed_rounds: 3,
				block_number: asOf.blockNumber,
				report_data: {
					token1: '0x0000000000000000000000000000000000000000',
					token2: '0x221657776846890989a759ba2973e427dff5c9bb',
					currentAmount1: '1000000000000000000',
					currentAmount2: '233590000000000000000',
					currentReporter: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
				},
				lifecycle: { state: 'Dispute window open', clock: 'timestamp', nextTransition: String(Number(asOf.blockTimestamp) + 1_800) },
			},
			{
				open_oracle_address: '0x529dcaC57677451CBfe766d88CcC133D082500df',
				report_id: '1841',
				observed_rounds: 1,
				block_number: String(BigInt(asOf.blockNumber) - 12n),
				report_data: { token1: '0x221657776846890989a759ba2973e427dff5c9bb', token2: '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' },
				lifecycle: { state: 'Settleable', clock: 'block' },
			},
		]
		const escalations = [
			{
				game_address: '0x7777777777777777777777777777777777777777',
				event_name: 'DepositOnOutcome',
				block_number: asOf.blockNumber,
				invalid_stake_atto_rep: '400000000000000000000',
				no_stake_atto_rep: '900000000000000000000',
				yes_stake_atto_rep: '1250000000000000000000',
			},
		]
		const auctions = [
			{
				auction_address: '0x8888888888888888888888888888888888888888',
				status: 'Open',
				bid_count: 18,
				bidder_count: 11,
				block_number: asOf.blockNumber,
				start_data: { attoEthRaiseCap: String(20_000_000_000_000_000_000n), maxAttoRepBeingSold: String(5_000_000_000_000_000_000_000n) },
			},
		]
		const risk = {
			pools: [
				{
					pool_address: '0x9999999999999999999999999999999999999999',
					block_number: asOf.blockNumber,
					read_status: 'success',
					source_method: 'poolAccountingState()',
					protocol_state: '0',
					scanner_severity: 'warning',
					scanner_reason: 'Pool is above the scanner capacity warning band',
					capacity: {
						usedAttoEth: (42n * 10n ** 18n).toString(),
						capacityAttoEth: (50n * 10n ** 18n).toString(),
						availableAttoEth: (8n * 10n ** 18n).toString(),
						utilizationBps: '8400',
					},
				},
			],
			vaults: [
				{
					pool_address: '0x9999999999999999999999999999999999999999',
					vault_address: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
					block_number: asOf.blockNumber,
					read_status: 'success',
					source_method: 'vaultAccountingState()',
					protocol_state: 'healthy',
					scanner_severity: 'warning',
					scanner_reason: 'Health factor is below the scanner warning threshold',
					risk: { healthFactorBps: '11350', targetHealthFactorBps: '12000', liquidationBoundaryBps: '10000' },
				},
			],
			recentLiquidations: [],
			approvalEvents: [
				{
					event_name: 'LiquidationApprovalConsumed',
					approval_identity: `0x${'a'.repeat(64)}`,
					receiver_vault: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
					block_number: asOf.blockNumber,
					transaction_index: 8,
					log_index: 3,
					event_data: {
						operationId: '42',
						consumedDebtAttoEth: (2n * 10n ** 18n).toString(),
						releasedDebtAttoEth: (3n * 10n ** 17n).toString(),
						resultingAvailableDebtAttoEth: (8n * 10n ** 18n).toString(),
						resultingReservedDebtAttoEth: 0n.toString(),
						resultingConsumedDebtAttoEth: (2n * 10n ** 18n).toString(),
					},
				},
				{
					event_name: 'LiquidationApprovalReserved',
					approval_identity: `0x${'a'.repeat(64)}`,
					receiver_vault: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
					block_number: asOf.blockNumber,
					transaction_index: 2,
					log_index: 1,
					event_data: { operationId: '42', reservedDebtAttoEth: (2n * 10n ** 18n).toString() },
				},
				{
					event_name: 'LiquidationApprovalNonceInvalidated',
					approval_identity: 'nonce:0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
					receiver_vault: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
					block_number: asOf.blockNumber,
					transaction_index: 9,
					log_index: 1,
					event_data: { previousNonce: '41', newNonce: '42' },
				},
			],
			pagination: { poolTotal: 1, poolHasMore: false, vaultTotal: 1, vaultHasMore: false },
		}
		return {
			chainId,
			asOf,
			data: {
				reports,
				escalations,
				auctions,
				risk,
				prices: [{ source_event: 'PriceReported', value: '233590000000000000000', block_number: asOf.blockNumber }],
				forks: [
					{
						universe_identity: '0',
						event_name: 'UniverseForked',
						block_number: asOf.blockNumber,
						child_count: 2,
						migrator_count: 14,
						migrated_atto_rep: '4500000000000000000000',
						obligation_events: 3,
					},
				],
				totals: { reports: reports.length, escalations: escalations.length, auctions: auctions.length, pools: risk.pools.length, vaults: risk.vaults.length },
				recentChanges: [
					{ semantic_event_kind: 'ReportDisputed', entity_identity: '0x529dca…:1842', block_number: asOf.blockNumber },
					{ semantic_event_kind: 'DepositOnOutcome', entity_identity: '0x777777…', block_number: asOf.blockNumber },
				],
			},
		}
	}

	const demoOperationsDetail = (path: string): unknown => {
		const request = new URL(path, location.origin)
		const parts = request.pathname.split('/').filter(Boolean)
		const domain = parts[3]
		const chainId = (domain === 'risk' ? parts[5] : parts[4]) ?? '1'
		const operations = demoOperations(chainId, request.searchParams.get('atBlock') ?? undefined)
		const identity = parts.slice(5).map(decodeURIComponent)
		const evidence = (eventName: string, eventData: Record<string, unknown>) => ({
			event_name: eventName,
			event_data: eventData,
			block_number: operations.asOf.blockNumber,
			block_hash: operations.asOf.blockHash,
			tx_hash: demoHash,
			log_index: 7,
			canonical: true,
		})
		const evidencePage = (item: Record<string, unknown>) => {
			const continuationFixture = context.pageUrl.searchParams.get('detailMore') === '1'
			if (continuationFixture && request.searchParams.has('cursor'))
				return {
					items: [{ ...item, block_number: String(BigInt(operations.asOf.blockNumber) - 1n), log_index: 2, tx_hash: `0x${'d'.repeat(64)}` }],
					limit: 100,
					hasMore: false,
				}
			return { items: [item], limit: 100, hasMore: continuationFixture, ...(continuationFixture ? { nextCursor: 'demo-detail-older' } : {}) }
		}
		if (domain === 'reports') {
			const report = operations.data.reports.find(item => item.open_oracle_address.toLowerCase() === identity[0]?.toLowerCase() && item.report_id === identity[1])
			const current = {
				...evidence('ReportDisputed', report?.report_data ?? {}),
				round_number: '2',
				report_data: report?.report_data ?? {},
				lifecycle: report?.lifecycle ?? { state: 'Awaiting indexed evidence', clock: 'timestamp' },
				comparison: {
					state: 'compared',
					previousRoundNumber: '1',
					previousBlockNumber: String(BigInt(operations.asOf.blockNumber) - 12n),
					changes: [
						{ field: 'currentAmount2', kind: 'changed', before: '230000000000000000000', after: '233590000000000000000' },
						{
							field: 'currentReporter',
							kind: 'changed',
							before: '0x1111111111111111111111111111111111111111',
							after: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
						},
					],
				},
			}
			const coordinatorDecision = {
				event_name: 'PriceReportRejected',
				summary: 'Replacement round was required',
				arguments: { reportId: identity[1], reason: 'Report was disputed' },
				emitter_address: '0x7777777777777777777777777777777777777777',
				block_number: operations.asOf.blockNumber,
			}
			const coordinatorDecisions = request.searchParams.has('decisionCursor')
				? { items: [{ ...coordinatorDecision, event_name: 'PendingReportRecovered' }], limit: 100, hasMore: false }
				: {
						items: [coordinatorDecision],
						limit: 100,
						hasMore: context.pageUrl.searchParams.get('decisionMore') === '1',
						...(context.pageUrl.searchParams.get('decisionMore') === '1' ? { nextCursor: 'demo-decision-older' } : {}),
					}
			return {
				chainId,
				asOf: operations.asOf,
				data: {
					identity: { openOracleAddress: identity[0], reportId: identity[1] },
					current,
					rounds: evidencePage(current),
					coordinatorDecisions,
				},
			}
		}
		if (domain === 'escalations') {
			const event = evidence('DepositOnOutcome', {
				depositor: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
				outcome: '1',
				attoRepAmount: '1250000000000000000000',
			})
			return {
				chainId,
				asOf: operations.asOf,
				data: {
					identity: identity[0],
					snapshot: {
						entity_identity: identity[0],
						block_number: operations.asOf.blockNumber,
						read_status: 'success',
						source_method: 'lifecycle(), balances(), totalCapital()',
						read_result: { phase: 'Active', requiredNextDepositAttoRep: (500n * 10n ** 18n).toString() },
					},
					deposits: [event],
					claims: [],
					events: evidencePage(event),
				},
			}
		}
		if (domain === 'auctions') {
			const bid = evidence('BidSubmitted', { bidder: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db', tick: '14', bidAmountAttoEth: (3n * 10n ** 18n).toString() })
			return {
				chainId,
				asOf: operations.asOf,
				data: {
					identity: identity[0],
					snapshot: {
						entity_identity: identity[0],
						block_number: operations.asOf.blockNumber,
						read_status: 'success',
						source_method: 'auctionState(), computeClearing()',
						read_result: { state: 'Open' },
					},
					demandCurve: [{ tick: '14', amountAttoEth: (3n * 10n ** 18n).toString(), cumulativeDemandAttoEth: (3n * 10n ** 18n).toString() }],
					events: evidencePage(bid),
				},
			}
		}
		if (domain === 'risk') {
			const kind = parts[4]
			const risk = operations.data.risk
			const entity = kind === 'pools' ? risk.pools.find(item => item.pool_address.toLowerCase() === parts[6]?.toLowerCase()) : risk.vaults.find(item => item.pool_address.toLowerCase() === parts[6]?.toLowerCase() && item.vault_address.toLowerCase() === parts[7]?.toLowerCase())
			const offset = request.searchParams.has('cursor') ? 100 : 0
			const historyMore = context.pageUrl.searchParams.get('riskHistoryMore') === '1'
			const historyBlock = String(BigInt(operations.asOf.blockNumber) - BigInt(offset === 0 ? 5 : 500))
			const historyRecord = (eventName: string, logIndex: number) => ({
				event_name: eventName,
				block_number: historyBlock,
				block_hash: `0x${BigInt(90_000 + offset + logIndex)
					.toString(16)
					.padStart(64, '0')}`,
				tx_hash: `0x${BigInt(100_000 + offset + logIndex)
					.toString(16)
					.padStart(64, '0')}`,
				log_index: logIndex,
				canonical: true,
			})
			return {
				chainId: parts[5] ?? chainId,
				asOf: operations.asOf,
				data: {
					...(entity ?? {}),
					approvalEvents: risk.approvalEvents,
					history: {
						stateSnapshots: [historyRecord('TaggedStateRead', 0)],
						accountingSnapshots: [historyRecord('VaultAccountingCheckpoint', 1)],
						lifecycleEvents: [historyRecord(offset === 0 ? 'VaultHealthChecked' : 'VaultDepositTargetHealthFactorRecorded', 2)],
						liquidations: offset === 0 ? [] : [historyRecord('VaultLiquidated', 3)],
						limit: 100,
						offset,
						truncated: historyMore && offset === 0,
						...(historyMore && offset === 0 ? { nextCursor: 'demo-risk-history-older' } : {}),
					},
				},
			}
		}
		if (domain === 'trading') {
			const swap = evidence('Swap', {
				yesForNo: true,
				amountIn: '1000000000000000000',
				amountOut: '970000000000000000',
				feeAmount: '3000000000000000',
				resultingYesReserve: '51000000000000000000',
				resultingNoReserve: '49030000000000000000',
			})
			return {
				chainId,
				asOf: operations.asOf,
				data: {
					market: identity[0],
					summary: {
						swaps_24h: 12,
						swaps_7d: 63,
						input_volume_24h: '18000000000000000000',
						input_volume_7d: '91000000000000000000',
						fees_24h: '54000000000000000',
						fees_7d: '273000000000000000',
					},
					twap24h: { state: 'Available', numerator: '49', denominator: '51', coverageSeconds: '86400', windowSeconds: '86400' },
					twap7d: { state: 'Partial coverage', numerator: '97', denominator: '100', coverageSeconds: '518400', windowSeconds: '604800' },
					candles: [
						{
							bucketStart: String(BigInt(operations.asOf.blockTimestamp) - 3600n),
							open: { numerator: '1', denominator: '1' },
							high: { numerator: '1', denominator: '1' },
							low: { numerator: '49', denominator: '51' },
							close: { numerator: '49', denominator: '51' },
							observations: 12,
						},
					],
					lpPositions: [
						{
							address: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
							balance: '12500000000000000000',
							received_liquidity: '15000000000000000000',
							sent_liquidity: '2500000000000000000',
						},
					],
					events: evidencePage(swap),
				},
			}
		}
		const migration = evidence('MigrationRepSplit', {
			universeId: identity[0],
			childUniverseId: '1',
			outcomeIndex: '1',
			migrator: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
			amountAttoRep: (4_500n * 10n ** 18n).toString(),
		})
		return {
			chainId,
			asOf: operations.asOf,
			data: {
				identity: identity[0],
				summary: {
					migrated_atto_rep: '4500000000000000000000',
					burned_atto_rep: '500000000000000000000',
					migrator_count: 1,
					child_count: 1,
					pool_migration_events: 4,
					obligations_initialized: 2,
					obligations_materialized: 1,
				},
				branches: [{ child_universe_id: '1', outcome_index: '1', migrated_atto_rep: '4500000000000000000000', migrator_count: 1, migration_count: 1 }],
				events: evidencePage(migration),
			},
		}
	}

	const api = async (path: string, { signal }: { signal?: AbortSignal } = {}): Promise<unknown> => {
		if (isDemo) {
			if (path.startsWith('/api/v1/networks')) {
				if (networkState === 'error') throw new Error('Network status could not be refreshed')
				demoNetworkRequests++
				const items = demoNetworkItems()
				return {
					items: context.pageUrl.searchParams.get('networkFallbackAfterLoad') === '1' && demoNetworkRequests > 1 ? items.filter(network => network.chain_id !== '1') : items,
				}
			}
			if (path.startsWith('/api/v1/contracts')) {
				const chainId = new URL(path, location.origin).searchParams.get('chainId')
				const items = demoContracts.filter(contract => contract.chain_id === chainId)
				if (deploymentState === 'bounded' && items[0] !== undefined)
					items[0] = {
						...items[0],
						deployment_block: '0',
						deployment_block_exact: false,
						deployment_timestamp: '2021-10-03T13:24:41.000Z',
					}
				if (deploymentState === 'absent' && items[0] !== undefined) items[0] = { ...items[0], deployment_block: null, deployment_block_exact: null, deployment_timestamp: null, deployment_checked_block: '0' }
				return { items }
			}
			if (path.startsWith('/api/v1/operations')) {
				if (demoState === 'loading') return await new Promise(() => {})
				if (demoState === 'error') throw new Error('Operations could not be loaded')
				return demoOperations(new URL(path, location.origin).searchParams.get('chainId') ?? '1')
			}
			if (/^\/api\/v1\/state\/risk(?:\?|$)/.test(path)) {
				if (demoState === 'loading') return await new Promise(() => {})
				if (demoState === 'error') throw new Error('Risk catalog could not be loaded')
				const request = new URL(path, location.origin)
				const chainId = request.searchParams.get('chainId') ?? '1'
				const operations = demoOperations(chainId, request.searchParams.get('atBlock') ?? undefined)
				const baseRisk = operations.data.risk
				const more = context.pageUrl.searchParams.get('catalogMore') === '1'
				const poolCursor = request.searchParams.get('poolCursor')
				const vaultCursor = request.searchParams.get('vaultCursor')
				if ((poolCursor !== null || vaultCursor !== null) && context.pageUrl.searchParams.get('catalogAppendDelay') === '1') await new Promise(resolve => setTimeout(resolve, 2_500))
				if ((poolCursor !== null || vaultCursor !== null) && context.pageUrl.searchParams.get('catalogAppendError') === '1') throw new Error('Additional risk records could not be loaded')
				const pools = poolCursor === null ? baseRisk.pools : baseRisk.pools.map(pool => ({ ...pool, pool_address: demoAddress('98'), block_number: String(BigInt(operations.asOf.blockNumber) - 100n) }))
				const vaults = vaultCursor === null ? baseRisk.vaults : baseRisk.vaults.map(vault => ({ ...vault, vault_address: demoAddress('c8'), block_number: String(BigInt(operations.asOf.blockNumber) - 100n) }))
				return {
					chainId,
					asOf: operations.asOf,
					data: {
						...baseRisk,
						pools,
						vaults,
						pagination: {
							poolTotal: more ? 2 : pools.length,
							vaultTotal: more ? 2 : vaults.length,
							poolHasMore: more && poolCursor === null,
							vaultHasMore: more && vaultCursor === null,
							...(more && poolCursor === null ? { poolNextCursor: 'demo-pool-older' } : {}),
							...(more && vaultCursor === null ? { vaultNextCursor: 'demo-vault-older' } : {}),
						},
					},
				}
			}
			if (/^\/api\/v1\/state\/(reports|escalations|auctions|forks|trading|timeline|integrity)(?:\?|$)/.test(path)) {
				if (demoState === 'loading') return await new Promise(() => {})
				if (demoState === 'error') throw new Error('Operations catalog could not be loaded')
				const request = new URL(path, location.origin)
				const chainId = request.searchParams.get('chainId') ?? '1'
				const operations = demoOperations(chainId, request.searchParams.get('atBlock') ?? undefined)
				const section = request.pathname.split('/').at(-1)
				const timelineFixture = [
					{
						entity_type: 'open-oracle-report',
						entity_identity: '0x529dcaC57677451CBfe766d88CcC133D082500df:1842',
						semantic_event_kind: 'ReportDisputed',
						source_contract: '0x529dcaC57677451CBfe766d88CcC133D082500df',
						block_number: operations.asOf.blockNumber,
						block_hash: operations.asOf.blockHash,
						tx_hash: demoHash,
						log_index: 7,
						canonical: true,
						evidence_status: demoTimelineEvidenceStatus(true),
					},
					{
						entity_type: 'reporter',
						entity_identity: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
						semantic_event_kind: 'ReportDisputed',
						source_contract: '0x529dcaC57677451CBfe766d88CcC133D082500df',
						block_number: operations.asOf.blockNumber,
						block_hash: operations.asOf.blockHash,
						tx_hash: demoHash,
						log_index: 7,
						canonical: true,
						evidence_status: demoTimelineEvidenceStatus(true),
					},
					{
						entity_type: 'open-oracle-report',
						entity_identity: '0x529dcaC57677451CBfe766d88CcC133D082500df:1842',
						semantic_event_kind: 'ReportDisputed',
						source_contract: '0x529dcaC57677451CBfe766d88CcC133D082500df',
						block_number: operations.asOf.blockNumber,
						block_hash: `0x${'4d'.repeat(32)}`,
						tx_hash: `0x${'9b'.repeat(32)}`,
						log_index: 7,
						canonical: false,
						evidence_status: demoTimelineEvidenceStatus(false, 'chain-reorg'),
						invalidation_reason: 'chain-reorg',
					},
				]
				const demoTradingFixture = [
					{
						pair_address: demoAddress('fa'),
						pool_address: demoPools[0]?.pool_address,
						question_title: demoPools[0]?.question_title,
						conditional_yes_bps: '5100',
						swap_count: 63,
						lp_holder_count: 4,
						price_block_number: operations.asOf.blockNumber,
					},
				]
				const integrityCombinedCauses = context.pageUrl.searchParams.get('integrityCombinedCauses') === '1'
				const demoIntegrityFixture = [
					{
						id: '1',
						reason: integrityCombinedCauses ? 'projection-rebuild' : 'chain-reorg',
						depth: '2',
						previous_block: operations.asOf.blockNumber,
						previous_hash: demoHash,
						ancestor_block: String(BigInt(operations.asOf.blockNumber) - 2n),
						ancestor_hash: `0x${'1834a6d2b779c501'.repeat(4)}`,
						causes: integrityCombinedCauses ? ['abi-redecode', 'manifest-reset', 'projection-rebuild'] : ['chain-reorg'],
						occurrence_counts: { block: '2', transaction: '9', log: '24', 'entity-state': '6' },
						indexer_run_id: '1',
						abi_source_hash: demoHash.slice(2),
						application_source_hash: `sha256:${demoHash.slice(2)}`,
						projection_source_hash: `sha256:${demoHash.slice(2)}`,
						detected_at: '2026-08-26T12:34:57.814Z',
					},
				]
				const catalogFixtures = new Map<string, () => readonly Readonly<Record<string, unknown>>[]>([
					['reports', () => operations.data.reports],
					['escalations', () => operations.data.escalations],
					['auctions', () => operations.data.auctions],
					['forks', () => operations.data.forks],
					['trading', () => demoTradingFixture],
					['timeline', () => timelineFixture.filter(item => request.searchParams.get('canonical') === 'all' || item.canonical)],
				])
				const fixtureItems = catalogFixtures.get(section ?? '')?.() ?? demoIntegrityFixture
				const items = context.pageUrl.searchParams.get('catalogEmpty') === '1' ? [] : fixtureItems
				const continuationFixture = context.pageUrl.searchParams.get('catalogMore') === '1'
				const cursor = request.searchParams.get('cursor')
				if (continuationFixture && cursor !== null) {
					if (context.pageUrl.searchParams.get('catalogAppendDelay') === '1') await new Promise(resolve => setTimeout(resolve, 2_500))
					if (context.pageUrl.searchParams.get('catalogAppendError') === '1') throw new Error('Older canonical records could not be loaded')
					const older = items.at(-1)
					return {
						chainId,
						asOf: operations.asOf,
						data: {
							items: older === undefined ? [] : [{ ...older, block_number: String(BigInt(operations.asOf.blockNumber) - 100n) }],
							...(section === 'forks' || section === 'timeline' ? { total: items.length + 1 } : {}),
							limit: 100,
							hasMore: false,
						},
					}
				}
				return {
					chainId,
					asOf: operations.asOf,
					data: {
						items,
						...(section === 'forks' || section === 'timeline' ? { total: items.length + (continuationFixture ? 1 : 0) } : {}),
						limit: 100,
						hasMore: continuationFixture,
						...(continuationFixture ? { nextCursor: 'demo-older' } : {}),
						...(section === 'integrity'
							? {
									migrations: [{ schema_version: '2', description: 'Historical integrity', applied_at: '2026-08-26T12:30:01.042Z' }],
									runs: [
										{
											id: '1',
											schema_version: '2',
											app_version: '0.1.0',
											abi_source_hash: demoHash.slice(2),
											application_source_hash: `sha256:${demoHash.slice(2)}`,
											projection_source_hash: `sha256:${demoHash.slice(2)}`,
											indexer_enabled: true,
											started_at: '2026-08-26T12:31:04.771Z',
											stopped_at: null,
										},
									],
								}
							: {}),
					},
				}
			}
			if (/^\/api\/v1\/state\/(reports|escalations|auctions|forks|trading|risk\/(?:pools|vaults))\//.test(path)) {
				if (demoState === 'loading') return await new Promise(() => {})
				if (demoState === 'error') throw new Error('Operations detail could not be loaded')
				const request = new URL(path, location.origin)
				const riskHistoryContinuation = request.pathname.includes('/risk/') && request.searchParams.has('cursor')
				if (riskHistoryContinuation && context.pageUrl.searchParams.get('riskHistoryAppendDelay') === '1') await new Promise(resolve => setTimeout(resolve, 2_500))
				if (riskHistoryContinuation && context.pageUrl.searchParams.get('riskHistoryAppendError') === '1' && !demoRiskHistoryAppendErrorConsumed) {
					demoRiskHistoryAppendErrorConsumed = true
					throw new Error('Older risk history could not be loaded')
				}
				if (request.searchParams.has('cursor') && context.pageUrl.searchParams.get('detailAppendDelay') === '1') await new Promise(resolve => setTimeout(resolve, 2_500))
				if (request.searchParams.has('cursor') && context.pageUrl.searchParams.get('detailAppendError') === '1') throw new Error('Older canonical evidence could not be loaded')
				return demoOperationsDetail(path)
			}
			if (path.startsWith('/api/v1/state/catalog')) {
				if (demoReorgObserved && context.pageUrl.searchParams.get('canonicalRouteRefreshError') === '1' && !demoCanonicalRouteRefreshErrorConsumed) {
					demoCanonicalRouteRefreshErrorConsumed = true
					throw new Error('The system state could not be refreshed')
				}
				if (demoState === 'error' && !demoErrorConsumed) {
					demoErrorConsumed = true
					throw new Error('The state catalog could not be read from the database')
				}
				if (demoState === 'loading') return await new Promise(() => {})
				if (demoState === 'delayed') await new Promise(resolve => setTimeout(resolve, 300))
				const request = new URL(path, location.origin)
				const chainId = request.searchParams.get('chainId')
				return {
					pools: demoCatalog.pools.filter(item => !chainId || item.chain_id === chainId),
					vaults: demoCatalog.vaults.filter(item => !chainId || item.chain_id === chainId),
					questions: demoCatalog.questions.filter(item => !chainId || item.chain_id === chainId),
					universes: demoCatalog.universes.filter(item => !chainId || item.chain_id === chainId),
					totals: {
						pools: demoCatalog.pools.filter(item => !chainId || item.chain_id === chainId).length,
						vaults: demoCatalog.vaults.filter(item => !chainId || item.chain_id === chainId).length,
						questions: demoCatalog.questions.filter(item => !chainId || item.chain_id === chainId).length,
						universes: demoCatalog.universes.filter(item => !chainId || item.chain_id === chainId).length,
					},
				}
			}
			if (path.startsWith('/api/v1/state/address-portfolio')) {
				const request = new URL(path, location.origin)
				const chainId = request.searchParams.get('chainId') ?? '1'
				const address = request.searchParams.get('address')?.toLowerCase()
				const item = demoRichList.find(candidate => candidate.chain_id === chainId && candidate.address.toLowerCase() === address)
				const operations = demoOperations(chainId)
				const more = context.pageUrl.searchParams.get('portfolioMore') === '1'
				const lpCursor = request.searchParams.get('lpCursor')
				const forkCursor = request.searchParams.get('forkCursor')
				const reportCursor = request.searchParams.get('reportCursor')
				const continuationRequested = lpCursor !== null || forkCursor !== null || reportCursor !== null
				if (continuationRequested && context.pageUrl.searchParams.get('portfolioAppendDelay') === '1') await new Promise(resolve => setTimeout(resolve, 2_500))
				if (continuationRequested && context.pageUrl.searchParams.get('portfolioAppendError') === '1' && !demoPortfolioAppendErrorConsumed) {
					demoPortfolioAppendErrorConsumed = true
					throw new Error('Additional account evidence could not be loaded')
				}
				const lpPositions = [
					{
						market_address: lpCursor === null ? demoAddress('a7') : demoAddress('a8'),
						pool_address: demoAddress('7'),
						question_title: 'Will the protocol meet its launch reliability target?',
						balance: '4250000000000000000',
						transfer_count: 6,
					},
				]
				const forkParticipation = [
					{
						universe_identity: forkCursor === null ? '0' : '1',
						event_name: 'MigrationRepAdded',
						block_number: String(BigInt(operations.asOf.blockNumber) - BigInt(forkCursor === null ? 0 : 100)),
						block_hash: demoHash,
						tx_hash: forkCursor === null ? `0x${'a'.repeat(64)}` : `0x${'b'.repeat(64)}`,
						log_index: 1,
					},
				]
				const reportParticipation = [
					{
						open_oracle_address: demoAddress('9'),
						report_id: reportCursor === null ? '1842' : '1841',
						event_name: 'ReportSubmitted',
						round_number: '2',
						block_number: String(BigInt(operations.asOf.blockNumber) - BigInt(reportCursor === null ? 0 : 100)),
						block_hash: demoHash,
						tx_hash: reportCursor === null ? `0x${'c'.repeat(64)}` : `0x${'d'.repeat(64)}`,
						log_index: 2,
					},
				]
				return {
					chainId,
					asOf: operations.asOf,
					data: {
						...(item ?? {
							chain_id: chainId,
							address: address ?? demoAddress('1'),
							availability: 'Awaiting indexed evidence',
						}),
						lp_positions: lpPositions,
						fork_participation: forkParticipation,
						report_participation: reportParticipation,
						portfolioPagination: {
							lp: {
								total: more ? 2 : 1,
								limit: 100,
								offset: lpCursor === null ? 0 : 1,
								hasMore: more && lpCursor === null,
								...(more && lpCursor === null ? { nextCursor: 'demo-lp-older' } : {}),
							},
							forks: {
								total: more ? 2 : 1,
								limit: 100,
								offset: forkCursor === null ? 0 : 1,
								hasMore: more && forkCursor === null,
								...(more && forkCursor === null ? { nextCursor: 'demo-fork-older' } : {}),
							},
							reports: {
								total: more ? 2 : 1,
								limit: 100,
								offset: reportCursor === null ? 0 : 1,
								hasMore: more && reportCursor === null,
								...(more && reportCursor === null ? { nextCursor: 'demo-report-older' } : {}),
							},
						},
					},
				}
			}
			if (path.startsWith('/api/v1/state/')) {
				demoStateDetailRequests++
				const stateHistoryRequest = new URL(path, location.origin)
				const stateHistoryOffset = stateHistoryRequest.searchParams.has('cursor') ? 1000 : 0
				if (stateHistoryOffset > 0 && context.pageUrl.searchParams.get('stateHistoryAppendDelay') === '1') await new Promise(resolve => setTimeout(resolve, 2_500))
				if (stateHistoryOffset > 0 && context.pageUrl.searchParams.get('stateHistoryAppendError') === '1' && !demoStateHistoryAppendErrorConsumed) {
					demoStateHistoryAppendErrorConsumed = true
					throw new Error('Older state history could not be loaded')
				}
				if (detailState === 'error' && !demoDetailErrorConsumed) {
					demoDetailErrorConsumed = true
					throw new Error('Historical checkpoints could not be read')
				}
				if (detailState === 'refresh-error' && demoStateDetailRequests === 2) throw new Error('The newest checkpoint could not be read')
				if (detailState === 'loading') return await new Promise(() => {})
				if (detailState === 'delayed') await new Promise(resolve => setTimeout(resolve, 800))
				return demoHistory(path)
			}
			if (path.startsWith('/api/v1/address-transactions')) {
				const request = new URL(path, location.origin)
				const chainId = request.searchParams.get('chainId')
				const address = request.searchParams.get('address')?.toLowerCase()
				const cursor = request.searchParams.get('cursor')
				demoTransactionRequests++
				window.__demoTransactionRequests = demoTransactionRequests
				if (context.pageUrl.searchParams.get('transactionAppendDelay') === '1' && cursor !== null) await new Promise(resolve => setTimeout(resolve, 1_500))
				if (context.pageUrl.searchParams.get('transactionAppendErrorOnce') === '1' && cursor !== null && !demoTransactionAppendErrorConsumed) {
					demoTransactionAppendErrorConsumed = true
					throw new Error('The next transaction page could not be read')
				}
				if ((context.pageUrl.searchParams.get('transactionLiveRefreshDelay') === '1' || context.pageUrl.searchParams.get('transactionLiveRefreshDelayLong') === '1') && !context.canonicalRefreshRequired && cursor === null && demoTransactionRequests > 1)
					await new Promise(resolve => setTimeout(resolve, context.pageUrl.searchParams.get('transactionLiveRefreshDelayLong') === '1' ? 3_500 : 800))
				if (context.pageUrl.searchParams.get('transactionRestoreDelay') === '1' && context.canonicalRefreshRequired && cursor === null && demoTransactionRequests > 1) await new Promise(resolve => setTimeout(resolve, 800))
				if (context.pageUrl.searchParams.get('transactionRestoreErrorOnce') === '1' && cursor === null && demoTransactionRequests > 1 && !demoTransactionRestoreErrorConsumed) {
					demoTransactionRestoreErrorConsumed = true
					throw new Error('The account transactions could not be restored')
				}
				if (cursor !== null && ((context.pageUrl.searchParams.get('transactionCursor409') === '1' && !demoTransactionSnapshotInvalidated) || context.pageUrl.searchParams.get('transactionCursor409Always') === '1')) {
					if (context.pageUrl.searchParams.get('transactionCursor409Always') !== '1') demoTransactionSnapshotInvalidated = true
					const error = new Error('The transaction snapshot changed after a chain update')
					error.status = 409
					throw error
				}
				if (context.pageUrl.searchParams.get('transactionRefreshError') === '1' && cursor === null && demoTransactionRequests > 1) throw new Error('The newest account transactions could not be read')
				if (demoReorgObserved && context.pageUrl.searchParams.get('evictTransactionOnReorg') === '1') demoTransactionSnapshotInvalidated = true
				const offset = cursor ? Number(JSON.parse(atob(cursor))) : 0
				const limit = Number(request.searchParams.get('limit') ?? 50)
				const owner = demoRichList.find(item => item.chain_id === chainId && item.address.toLowerCase() === address)
				const total = Math.max(0, Number(owner?.transaction_count ?? 0) - (demoTransactionSnapshotInvalidated ? 1 : 0))
				const network = demoNetworks.find(item => item.chain_id === chainId)
				const items = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, itemIndex) => {
					const index = offset + itemIndex + (demoTransactionSnapshotInvalidated ? 1 : 0)
					const initialTotal = demoInitialTransactionCounts.get(`${chainId}:${address}`) ?? total
					const ordinal = Number(owner?.transaction_count ?? 0) - index - 1
					const liveOrdinal = ordinal - initialTotal
					const baseline = chainId === null ? undefined : demoNetworkBaselines.get(chainId)
					const blockNumber = liveOrdinal >= 0 ? (baseline?.blockNumber ?? 0n) + BigInt(liveOrdinal + 1) : (baseline?.blockNumber ?? 0n) - BigInt(Math.max(0, initialTotal - ordinal - 1))
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
						explorer_base_url: network?.explorer_base_url ?? '',
					}
				})
				const nextOffset = offset + items.length
				return { items, total, limit, snapshotBlock: network?.indexed_block, nextCursor: nextOffset < total ? btoa(JSON.stringify(nextOffset)) : undefined }
			}
			if (path.startsWith('/api/v1/address-interactions')) {
				const transactions = decodeItemsPage(await api(path.replace('/address-interactions', '/address-transactions')), isAccountTransaction, 'Address transactions')
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
				const owner = demoRichList.find(item => item.chain_id === chainId && item.address.toLowerCase() === address)
				const fixedIdentities: Record<string, readonly [string, string]> = {
					'0xc9b36e44643fc5d882654ffd9791ae7171b0e9db': ['OpenOracle', 'openOracle'],
					'0x7777777777777777777777777777777777777777': ['Security Pool', 'securityPool'],
				}
				const fixedIdentity = address === undefined ? undefined : fixedIdentities[address]
				const catalogIdentity = [
					...demoPools.flatMap(pool => [
						[pool.chain_id, pool.pool_address, 'Security Pool', 'securityPool'],
						[pool.chain_id, pool.share_token_address, 'Share token', 'shareToken'],
						[pool.chain_id, pool.coordinator_address, 'Price coordinator', 'priceCoordinator'],
						[pool.chain_id, pool.truth_auction_address, 'Truth auction', 'truthAuction'],
					]),
					...demoUniverses.map(universe => [universe.chain_id, universe.reputation_token_address, universe.universe_id === '0' ? 'Genesis REP' : `Child REP · universe ${shortIdentifier(universe.universe_id)}`, 'reputationToken']),
					...demoRichList.flatMap(item => [...(item.rep_balances ?? []), ...(item.weth_balances ?? [])].map(token => [item.chain_id, token.address, 'contractLabel' in token ? token.contractLabel : token.name, 'universeId' in token ? 'reputationToken' : 'weth'])),
				].find((identity): identity is [string, string, string, string] => identity.length === 4 && typeof identity[0] === 'string' && typeof identity[1] === 'string' && typeof identity[3] === 'string' && identity[0] === chainId && identity[1].toLowerCase() === address)
				return {
					chainId: Number(chainId),
					address: address ?? '',
					label: owner?.label ?? fixedIdentity?.[0] ?? catalogIdentity?.[2],
					kind: owner?.kind ?? fixedIdentity?.[1] ?? catalogIdentity?.[3],
				}
			}
			if (path.startsWith('/api/v1/richlist')) {
				demoRichListRequests++
				const request = new URL(path, location.origin)
				if (context.pageUrl.searchParams.get('richRouteRefreshDelayAfterLoad') === '1' && demoRichListRequests > 1 && Number(request.searchParams.get('offset') ?? 0) === 0) {
					demoRouteRequestsInFlight++
					window.__demoRouteRequestsInFlight = demoRouteRequestsInFlight
					try {
						await new Promise(resolve => setTimeout(resolve, 1_500))
					} finally {
						demoRouteRequestsInFlight--
						window.__demoRouteRequestsInFlight = demoRouteRequestsInFlight
					}
				}
				const richRefreshErrorRequest = Number(context.pageUrl.searchParams.get('routeRefreshErrorRequest'))
				if (((context.pageUrl.searchParams.get('routeRefreshErrorAfterLoad') === '1' && demoRichListRequests > 1) || (Number.isInteger(richRefreshErrorRequest) && richRefreshErrorRequest > 0 && demoRichListRequests === richRefreshErrorRequest)) && !demoRouteRefreshErrorConsumed) {
					demoRouteRefreshErrorConsumed = true
					throw new Error('The newest account rankings could not be read')
				}
				if (demoReorgObserved && context.pageUrl.searchParams.get('canonicalRouteRefreshError') === '1' && !demoCanonicalRouteRefreshErrorConsumed) {
					demoCanonicalRouteRefreshErrorConsumed = true
					throw new Error('The account state could not be refreshed')
				}
				const chainId = request.searchParams.get('chainId')
				const address = request.searchParams.get('address')?.toLowerCase()
				const offset = Number(request.searchParams.get('offset') ?? 0)
				const limit = Number(request.searchParams.get('limit') ?? 50)
				if (context.pageUrl.searchParams.get('richAppendDelay') === '1' && offset > 0) await new Promise(resolve => setTimeout(resolve, 1_500))
				const filtered = demoRichList.filter(item => (!chainId || item.chain_id === chainId) && (!address || item.address.toLowerCase() === address) && !(demoReorgObserved && context.pageUrl.searchParams.get('evictAccountOnReorg') === '1' && item.address.toLowerCase() === demoEvictedAddress))
				const ranked =
					context.pageUrl.searchParams.get('richPaginationDemo') === '1' && address === undefined && filtered.length > 0
						? Array.from({ length: 120 }, (_, index) => ({
								...requiredArrayItem(filtered, index % filtered.length, 'Demo rich-list pagination template'),
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
				if (demoReorgObserved && context.pageUrl.searchParams.get('logRemovedOnReorg') === '1') {
					const error = new Error('The log was replaced after a chain update')
					error.status = 404
					throw error
				}
				const detailLog = demoLogs.find(item => item.chain_id === requestedChainId && item.tx_hash === requestedTransactionHash && item.log_index === Number(requestedLogIndex)) ?? requiredArrayItem(demoLogs, 0, 'Demo log detail')
				const detailNetwork = demoNetworks.find(network => network.chain_id === detailLog.chain_id)
				return {
					...detailLog,
					block_timestamp: detailLog.block_timestamp,
					origin_address: '0x1A620F3dC4Dba34F365C9233C34A22f8F48D2D34',
					to_address: '0x7777777777777777777777777777777777777777',
					value: '0',
					input: '0x4f8b2f2d',
					gas_used: '184220',
					contract_provenance: context.pageUrl.searchParams.get('detailLiveDemo') === '1' ? `Security Pool Factory.DeploySecurityPool · indexed block ${detailNetwork?.indexed_block}` : 'Security Pool Factory.DeploySecurityPool',
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
					function_signature: 'checkpoint(uint8,address[])',
					action_summary: 'checkpoint(reason=Trade)',
					relatedLogs: demoLogs.slice(0, 4),
				}
			}
			if (path.startsWith('/api/v1/logs')) {
				demoLogRequests++
				const activityRefreshErrorRequest = Number(context.pageUrl.searchParams.get('routeRefreshErrorRequest'))
				if (((context.pageUrl.searchParams.get('routeRefreshErrorAfterLoad') === '1' && demoLogRequests > 1) || (Number.isInteger(activityRefreshErrorRequest) && activityRefreshErrorRequest > 0 && demoLogRequests === activityRefreshErrorRequest)) && !demoRouteRefreshErrorConsumed) {
					demoRouteRefreshErrorConsumed = true
					throw new Error('The newest activity could not be read')
				}
				if (context.pageUrl.searchParams.get('networkFallbackRouteError') === '1' && context.selectedChainId() !== '1' && !demoNetworkFallbackErrorConsumed) {
					demoNetworkFallbackErrorConsumed = true
					throw new Error('Activity could not be loaded for the fallback network')
				}
				if (context.pageUrl.searchParams.get('reorgRefreshError') === '1' && demoLogRequests > 1 && !demoReorgRefreshErrorConsumed) {
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
					window.__demoRouteRequestsInFlight = demoRouteRequestsInFlight
					try {
						await new Promise(resolve => setTimeout(resolve, 800))
					} finally {
						demoRouteRequestsInFlight--
						window.__demoRouteRequestsInFlight = demoRouteRequestsInFlight
					}
				}
				const request = new URL(path, location.origin)
				if (context.pageUrl.searchParams.get('logRouteRefreshDelayAfterLoad') === '1' && demoLogRequests > 1 && !request.searchParams.has('cursor')) {
					demoRouteRequestsInFlight++
					window.__demoRouteRequestsInFlight = demoRouteRequestsInFlight
					try {
						await new Promise(resolve => setTimeout(resolve, 1_500))
					} finally {
						demoRouteRequestsInFlight--
						window.__demoRouteRequestsInFlight = demoRouteRequestsInFlight
					}
				}
				const chainId = request.searchParams.get('chainId')
				const event = request.searchParams.get('event')?.toLowerCase()
				const address = request.searchParams.get('address')?.toLowerCase()
				if (context.pageUrl.searchParams.get('logAppendDelay') === '1' && request.searchParams.has('cursor')) await new Promise(resolve => setTimeout(resolve, 3_500))
				if (address && !/^0x[0-9a-f]{40}$/.test(address)) throw new Error('Address filter is invalid')
				const filtered = demoState === 'empty' ? [] : demoLogs.filter(item => (!chainId || item.chain_id === chainId) && (event === undefined || item.event_name?.toLowerCase().includes(event) === true) && (!address || [item.emitter_address, item.origin_address].some(candidate => candidate?.toLowerCase() === address)))
				if (context.pageUrl.searchParams.get('logPaginationDemo') !== '1' || filtered.length === 0) return { items: filtered }
				const expanded = Array.from({ length: 220 }, (_, index) => {
					const ordinal = demoPaginationOrdinal(index, demoReorgObserved)
					const template = requiredArrayItem(filtered, ordinal % filtered.length, 'Demo activity pagination template')
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
				const encodedCursor = request.searchParams.get('cursor')
				const offset = encodedCursor === null ? 0 : Number(JSON.parse(atob(encodedCursor)))
				const limit = Number(request.searchParams.get('limit') ?? 100)
				const nextOffset = offset + limit
				return { items: expanded.slice(offset, nextOffset), nextCursor: nextOffset < expanded.length ? btoa(JSON.stringify(nextOffset)) : undefined }
			}
		}
		return await fetchApi(path, { signal })
	}

	const demoPaginationOrdinal = (index: number, reorgObserved: boolean) => {
		if (!reorgObserved) return index
		return index === 0 ? 10_000 : index - 1
	}

	return {
		api,
		applyBlock: applyDemoBlock,
		observeReorg(address: string | undefined) {
			demoReorgObserved = true
			demoEvictedAddress = address
		},
	}
}

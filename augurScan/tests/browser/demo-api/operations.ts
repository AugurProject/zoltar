import { requiredArrayItem } from '../../../browser/api-decoding.ts'
import { demoHash } from './chain-fixtures.ts'
import type { DemoEnvironment } from './environment.ts'

export const demoOperations = (env: DemoEnvironment, chainId: string, atBlock?: string) => {
	const { context } = env
	const { demoNetworks } = env.fixtures
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
			balance_block_number: asOf.blockNumber,
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
	const cappedKpiCatalog = context.pageUrl.searchParams.get('operationsKpiCapped') === '1'
	const reportTemplate = requiredArrayItem(reports, 0, 'Demo report')
	const settleableReport = requiredArrayItem(reports, 1, 'Settleable demo report')
	const escalationTemplate = requiredArrayItem(escalations, 0, 'Demo escalation')
	const auctionTemplate = requiredArrayItem(auctions, 0, 'Demo auction')
	const allReports = cappedKpiCatalog ? [...Array.from({ length: 250 }, (_, index) => ({ ...reportTemplate, report_id: String(10_000 + index), lifecycle: { ...reportTemplate.lifecycle, state: 'Finalized' } })), { ...settleableReport, report_id: '10250' }] : reports
	const allEscalations = cappedKpiCatalog ? [...Array.from({ length: 250 }, (_, index) => ({ ...escalationTemplate, game_address: `0x${(index + 1).toString(16).padStart(40, '0')}`, event_name: 'NonDecisionReached' })), { ...escalationTemplate, game_address: `0x${(251).toString(16).padStart(40, '0')}` }] : escalations
	const allAuctions = cappedKpiCatalog ? [...Array.from({ length: 250 }, (_, index) => ({ ...auctionTemplate, auction_address: `0x${(index + 1).toString(16).padStart(40, '0')}`, status: 'Closed' })), { ...auctionTemplate, auction_address: `0x${(251).toString(16).padStart(40, '0')}` }] : auctions
	const poolMetricsUnavailable = context.pageUrl.searchParams.get('poolMetrics') === 'unavailable'
	const risk = {
		pools: [
			{
				pool_address: '0x9999999999999999999999999999999999999999',
				block_number: asOf.blockNumber,
				read_status: poolMetricsUnavailable ? 'failed' : 'success',
				source_method: 'poolAccountingState()',
				protocol_state: poolMetricsUnavailable ? 'unavailable' : '0',
				scanner_severity: poolMetricsUnavailable ? 'unavailable' : 'warning',
				scanner_reason: poolMetricsUnavailable ? 'Tagged pool read unavailable' : 'Pool is above the scanner capacity warning band',
				read_result: {
					currentRetentionRate: String(999999987000000000n),
					settlementCollateralAttoEth: String(42n * 10n ** 18n),
					currentMintingCapacityAttoEth: String(50n * 10n ** 18n),
					totalPoolHeldAttoRep: String(120n * 10n ** 18n),
					totalUnderwritingLimitAttoEth: String(100n * 10n ** 18n),
					securityMultiplierBps: '25000',
				},
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
				risk: { healthFactorBps: '11350', liquidationBoundaryBps: '10000' },
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
			reports: allReports.slice(0, 250),
			escalations: allEscalations.slice(0, 250),
			auctions: allAuctions.slice(0, 250),
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
			totals: { reports: allReports.length, escalations: allEscalations.length, auctions: allAuctions.length, pools: risk.pools.length, vaults: risk.vaults.length },
			recentChanges: [
				{ semantic_event_kind: 'ReportDisputed', entity_type: 'report', entity_identity: '0x529dca…:1842', block_number: asOf.blockNumber, block_timestamp: new Date(Date.now() - 3_600_000).toISOString() },
				{ semantic_event_kind: 'DepositOnOutcome', entity_type: 'escalation', entity_identity: '0x777777…', block_number: asOf.blockNumber, block_timestamp: new Date().toISOString() },
			],
		},
	}
}

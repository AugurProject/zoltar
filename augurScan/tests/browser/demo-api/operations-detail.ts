import { demoTradingActivity } from '../demo-fixtures.ts'
import { demoHash } from './chain-fixtures.ts'
import type { DemoEnvironment } from './environment.ts'
import { demoOperations } from './operations.ts'

export const demoOperationsDetail = (env: DemoEnvironment, path: string): unknown => {
	const { context } = env
	const { claimState } = env.settings
	const { claimEvidence } = env.fixtures
	const request = new URL(path, location.origin)
	const parts = request.pathname.split('/').filter(Boolean)
	const domain = parts[3]
	const chainId = (domain === 'risk' ? parts[5] : parts[4]) ?? '1'
	const operations = demoOperations(env, chainId, request.searchParams.get('atBlock') ?? undefined)
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
			amountAttoRep: '1250000000000000000000',
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
					read_result: {
						startBondAttoRep: String(1000000000000000000n),
						nonDecisionThresholdAttoRep: String(500000000000000000000n),
						endTimestamp: '1750000000',
						bindingCapitalAttoRep: String(5000000000000000000n),
						outcomeBalancesAttoRep: ['1000000000000000000', '1250000000000000000000', '0'],
						questionResolution: '1',
						finalQuestionResolution: claimState === 'pending' ? '3' : '1',
						claimEvidence,
					},
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
					read_result: { finalized: true, clearingTick: '14', attoEthRaised: '3000000000000000000', totalAttoRepPurchased: String(12000000000000000000n), computeClearing: { tick: '14', funded: true } },
				},
				finalization: evidence('AuctionFinalized', { clearingTick: '14', grossAcceptedAttoEth: String(3000000000000000000n), repSoldAttoRep: String(12000000000000000000n), funded: true }),
				demandCurveTruncated: context.pageUrl.searchParams.get('demandTruncated') === '1',
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
					lifecycleEvents: [historyRecord(offset === 0 ? 'VaultHealthChecked' : 'RepDepositedToVault', 2)],
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
					eth_volume_atto_eth: '48250000000000000000',
					eth_volume_24h_atto_eth: '6400000000000000000',
					eth_volume_7d_atto_eth: '21700000000000000000',
					eth_trade_count: 41,
					eth_trade_count_24h: 5,
				},
				activity: {
					items: demoTradingActivity(operations.asOf),
					limit: 50,
					hasMore: false,
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

import { describe, expect, test } from 'bun:test'
import { getAddress, type Hex } from '../../src/ethereum.ts'
import { type Projection, projectionsFrom } from '../../src/projections.ts'
import type { StoredLog } from '../../src/types.ts'
import { encodedAmmPairTransfer } from '../support/amm-pair-transfer.ts'

const hash = `0x${'12'.repeat(32)}` as Hex
const pool = getAddress('0x1111111111111111111111111111111111111111')
const vault = getAddress('0x2222222222222222222222222222222222222222')
const atomic = (value: bigint): string => value.toString()

const log = (name: string, argumentsValue: Record<string, unknown>, address = pool, contractKind?: string): StoredLog => ({
	transactionHash: hash,
	blockHash: hash,
	blockNumber: 10n,
	transactionIndex: 0,
	logIndex: 0,
	address,
	contractKind,
	topics: [hash],
	data: '0x',
	decoded: { name, arguments: argumentsValue, status: 'decoded', summary: name },
})

const questionCreatedLog = log('QuestionCreated', {
	questionId: '42',
	createdTimestamp: '1000',
	questionData: {
		title: 'Will it rain?',
		description: 'Observed at the airport',
		startTime: '1100',
		endTime: '2100',
		numTicks: '0',
		displayValueMin: '0',
		displayValueMax: '0',
		answerUnit: '',
	},
	outcomeOptions: ['Yes', 'No'],
})

describe('state projections', () => {
	test('projects each question accounting checkpoint as pool state and as an accounting snapshot', () => {
		const projections = projectionsFrom(log('QuestionAccountingCheckpoint', { reason: 2, settlementCollateralAttoEth: 100n.toString(), shareTokenSupplyAttoShares: 200n.toString(), lastSettlementSecurityPoolTime: '300' }))
		expect(projections).toContainEqual({ type: 'poolState', poolAddress: pool.toLowerCase(), eventName: 'QuestionAccountingCheckpoint', state: { settlementCollateralAttoEth: 100n.toString(), shareTokenSupplyAttoShares: 200n.toString(), lastSettlementSecurityPoolTime: '300' } })
		const snapshot: Projection = { type: 'poolSnapshot', poolAddress: pool.toLowerCase(), reason: 2, settlementCollateralAttoEth: atomic(100n), shareTokenSupplyAttoShares: atomic(200n), lastSettlementSecurityPoolTime: atomic(300n) }
		expect(projections).toContainEqual(snapshot)
		// A uint8 enum decodes to a number; a replayed JSON record may carry it as a string.
		expect(projectionsFrom(log('QuestionAccountingCheckpoint', { reason: '2', settlementCollateralAttoEth: atomic(100n), shareTokenSupplyAttoShares: atomic(200n), lastSettlementSecurityPoolTime: '300' }))).toContainEqual(snapshot)
	})

	test('ignores accounting and approval events that no current contract emits', () => {
		for (const name of ['PoolAccountingCheckpoint', 'VaultAccountingCheckpoint', 'PoolForkModeActivated', 'TotalRepBackingUnitsSet', 'LiquidationApprovalSet', 'VaultLiquidated']) expect(projectionsFrom(log(name, { vault, reason: '5' }))).toEqual([])
	})

	test('captures immutable question metadata', () => {
		const [projection] = projectionsFrom(questionCreatedLog)
		expect(projection?.type).toBe('question')
		if (projection?.type !== 'question') throw new Error('question projection missing')
		expect(projection.questionId).toBe('42')
		expect(projection.outcomeOptions).toEqual(['Yes', 'No'])
		expect(projection.endTime).toBe('2100')
	})

	test('captures a pool deployment', () => {
		const [deployment] = projectionsFrom(
			log('DeployQuestionLedger', {
				questionLedger: pool,
				parent: '0x0000000000000000000000000000000000000000',
				universeId: '0',
				questionId: '42',
				priceFeed: vault,
				shareToken: vault,
				statoblastSecurityMultiplierBps: '15000',
				initialReportPriorityFeeAttoEthPerGas: atomic(10_000_000_000n),
			}),
		)
		expect(deployment).toMatchObject({ type: 'pool', poolAddress: pool.toLowerCase(), questionId: '42', universeId: '0' })
		for (const field of ['collateralRepairAuctionAddress', 'initialRetentionRate', 'initialSettlementCollateralAttoEth']) expect(deployment).not.toHaveProperty(field)
	})

	test('records universe lineage and changing theoretical supply', () => {
		const [child] = projectionsFrom(
			log('DeployChild', {
				universeId: '0',
				outcomeIndex: '2',
				childUniverseId: '9001',
				childReputationToken: vault,
				childUniverseTheoreticalSupplyAttoRep: atomic(7_000_000_000_000_000_000_000_000n),
			}),
		)
		expect(child).toMatchObject({ type: 'universe', universeId: '9001', parentUniverseId: '0', forkingOutcomeIndex: '2' })

		const [burn] = projectionsFrom(log('RepBurned', { universeId: '9001', universeTheoreticalSupplyAttoRep: atomic(6999n) }))
		expect(burn).toMatchObject({ type: 'universe', eventName: 'RepBurned', theoreticalSupplyAttoRep: atomic(6999n) })
	})

	test('normalizes every share supply event to the same logical field', () => {
		const [explicitSupply] = projectionsFrom(log('ShareTokenSupplySet', { shareTokenSupplyAttoShares: atomic(80n) }))
		const [createdSupply] = projectionsFrom(
			log('CompleteSetCreated', {
				resultingShareTokenSupplyAttoShares: atomic(100n),
				resultingSettlementCollateralAttoEth: atomic(200n),
			}),
		)
		const [redeemedSupply] = projectionsFrom(
			log('CompleteSetRedeemed', {
				resultingShareTokenSupplyAttoShares: atomic(60n),
				resultingSettlementCollateralAttoEth: atomic(120n),
			}),
		)

		expect(explicitSupply).toMatchObject({ type: 'poolState', state: { shareTokenSupplyAttoShares: atomic(80n) } })
		expect(createdSupply).toMatchObject({ type: 'poolState', state: { shareTokenSupplyAttoShares: atomic(100n) } })
		expect(redeemedSupply).toMatchObject({ type: 'poolState', state: { shareTokenSupplyAttoShares: atomic(60n) } })
	})

	test('records Augur AMM identity and derives complementary conditional prices from Sync reserves', () => {
		const pair = getAddress('0x3333333333333333333333333333333333333333')
		const [market] = projectionsFrom(
			log(
				'PairCreated',
				{
					questionLedger: pool,
					shareToken: vault,
					universeId: '7',
					pair,
					feeBps: '30',
				},
				pool,
				'ammFactory',
			),
		)
		expect(market).toMatchObject({
			type: 'ammMarket',
			pairAddress: pair.toLowerCase(),
			poolAddress: pool.toLowerCase(),
			universeId: '7',
			feeBps: '30',
		})

		const [price] = projectionsFrom(log('Sync', { yesReserve: '300', noReserve: '700' }, pair))
		expect(price).toEqual({
			type: 'ammPrice',
			pairAddress: pair.toLowerCase(),
			yesReserveAttoShares: atomic(300n),
			noReserveAttoShares: atomic(700n),
			conditionalYesBps: '7000',
			conditionalNoBps: '3000',
		})
		const [roundedPrice] = projectionsFrom(log('Sync', { yesReserve: '1', noReserve: '2' }, pair))
		expect(roundedPrice).toMatchObject({ conditionalYesBps: '6666', conditionalNoBps: '3334' })
		expect(projectionsFrom(log('Sync', { yesReserve: '0', noReserve: '0' }, pair))).toEqual([expect.objectContaining({ type: 'domainEvent', domain: 'trading', semanticEventKind: 'Sync' })])
	})

	test('retains an Augur AMM Swap as trading evidence without treating it as a reserve snapshot', () => {
		const pair = getAddress('0x3333333333333333333333333333333333333333')
		expect(
			projectionsFrom(
				log(
					'Swap',
					{
						sender: pool,
						recipient: vault,
						yesForNo: true,
						exactOutput: false,
						amountIn: '100',
						amountOut: '90',
						feeAmount: '1',
						resultingYesReserve: '400',
						resultingNoReserve: '600',
					},
					pair,
				),
			),
		).toEqual([expect.objectContaining({ type: 'domainEvent', domain: 'trading', semanticEventKind: 'Swap' })])
		expect(projectionsFrom(log('Sync', { yesReserve: '400', noReserve: '600' }, pair))).toEqual([
			{
				type: 'ammPrice',
				pairAddress: pair.toLowerCase(),
				yesReserveAttoShares: atomic(400n),
				noReserveAttoShares: atomic(600n),
				conditionalYesBps: '6000',
				conditionalNoBps: '4000',
			},
			expect.objectContaining({ type: 'domainEvent', domain: 'trading', semanticEventKind: 'Sync' }),
		])
	})

	test('does not classify Uniswap-shaped Swap events as Augur AMM trades', () => {
		const projected = projectionsFrom(log('Swap', { sender: pool, recipient: vault, amount0: '-1', amount1: '2', sqrtPriceX96: String(2n ** 96n), liquidity: '100' }))
		expect(projected.some(item => item.type === 'domainEvent' && item.domain === 'trading')).toBe(false)
	})

	test('does not classify Uniswap V2 Sync events as Augur AMM trades', () => {
		const projected = projectionsFrom(log('Sync', { reserve0: '300', reserve1: '700' }))
		expect(projected.some(item => item.type === 'domainEvent' && item.domain === 'trading')).toBe(false)
		expect(projected.some(item => item.type === 'ammPrice')).toBe(false)
	})

	test('retains LP share transfers and approvals only when the emitter is an Augur AMM pair', () => {
		const transfer = { ...log('Transfer', { from: pool, to: vault, value: '50' }), contractKind: 'ammPair' }
		const approval = { ...log('Approval', { owner: pool, spender: vault, value: '50' }), contractKind: 'ammPair' }
		expect(projectionsFrom(transfer).at(-1)).toMatchObject({
			type: 'domainEvent',
			domain: 'trading',
			entityType: 'amm',
			semanticEventKind: 'Transfer',
		})
		expect(projectionsFrom(log('Transfer', { from: pool, to: vault, value: '50' })).some(item => item.type === 'domainEvent')).toBe(false)
		expect(projectionsFrom(approval).at(-1)).toMatchObject({
			type: 'domainEvent',
			domain: 'trading',
			entityType: 'amm',
			semanticEventKind: 'Approval',
		})
		expect(projectionsFrom(log('Approval', { owner: pool, spender: vault, value: '50' })).some(item => item.type === 'domainEvent')).toBe(false)
	})

	test('stores an AMM pair LP transfer under the compiled ERC-20 argument names', () => {
		const { topics, data, decoded } = encodedAmmPairTransfer(pool, vault, 50n, vault)
		const transfer: StoredLog = { ...log('Transfer', {}, vault, 'ammPair'), topics, data, decoded }
		const projection = projectionsFrom(transfer).at(-1)
		if (projection?.type !== 'domainEvent') throw new Error('LP transfer did not project a domain event')
		// The trading, catalog, security pool, and detail LP queries read these exact keys from amm_trade_events.event_data.
		expect(projection).toMatchObject({ domain: 'trading', entityIdentity: vault.toLowerCase(), semanticEventKind: 'Transfer' })
		expect(Object.keys(projection.data).sort()).toEqual(['from', 'to', 'value'])
		expect(projection.data['value']).toBe('50')
	})

	test('adds stable timeline identities for registries, markets, and universes', () => {
		expect(projectionsFrom(questionCreatedLog).at(-1)).toMatchObject({
			domain: 'system',
			entityType: 'question',
			entityIdentity: '42',
		})
		expect(projectionsFrom(log('PairCreated', { pair: vault, questionLedger: pool, shareToken: vault, universeId: '7', feeBps: '30' }, pool, 'ammFactory')).at(-1)).toMatchObject({
			domain: 'trading',
			entityType: 'amm',
			entityIdentity: vault.toLowerCase(),
		})
		expect(
			projectionsFrom(
				log('UniverseInitialized', {
					universeId: '7',
					parentUniverseId: '0',
					forkingOutcomeIndex: '1',
					reputationToken: vault,
					universeTheoreticalSupplyAttoRep: atomic(100n),
					forkTime: '0',
					forkQuestionId: '0',
				}),
			).at(-1),
		).toMatchObject({
			domain: 'fork',
			entityIdentity: '7',
		})
	})

	test('projects accepted REP per ETH coordinator prices', () => {
		const [reported] = projectionsFrom(log('PriceReported', { reportId: '42', price: '19500000000000000000', lastSettlementTimestamp: '2000' }, vault))
		expect(reported).toMatchObject({
			type: 'repEthPrice',
			coordinatorAddress: vault.toLowerCase(),
			eventName: 'PriceReported',
			reportId: '42',
			repPerEth1e18: '19500000000000000000',
		})
		if (reported?.type !== 'repEthPrice') throw new Error('REP/ETH price projection missing')
		expect(reported.settlementTimestamp.toISOString()).toBe('1970-01-01T00:33:20.000Z')
	})

	test('retains auditable Uniswap market identity and raw price evidence', () => {
		const rep = getAddress('0x3333333333333333333333333333333333333333')
		const weth = getAddress('0x4444444444444444444444444444444444444444')
		const marketId = `0x${'ab'.repeat(32)}`
		const uniswapPairCreated = projectionsFrom(log('PairCreated', { token0: rep, token1: weth, pair: pool, '3': '1' }, pool, 'uniswapV2Factory'))
		expect(uniswapPairCreated[0]).toMatchObject({
			type: 'uniswapMarket',
			venue: 'v2',
			marketId: pool.toLowerCase(),
			feeHundredthsBip: '3000',
		})
		expect(uniswapPairCreated.some(projection => projection.type === 'domainEvent')).toBe(false)
		expect(projectionsFrom(log('Sync', { reserve0: '900', reserve1: '50' }))[0]).toEqual({
			type: 'uniswapPrice',
			venue: 'v2',
			marketId: pool.toLowerCase(),
			eventName: 'Sync',
			reserve0: '900',
			reserve1: '50',
		})
		expect(projectionsFrom(log('PoolCreated', { token0: rep, token1: weth, fee: '500', tickSpacing: '10', pool }))[0]).toMatchObject({
			type: 'uniswapMarket',
			venue: 'v3',
			feeHundredthsBip: '500',
			tickSpacing: '10',
		})
		expect(projectionsFrom(log('Swap', { sqrtPriceX96: String(2n ** 96n) }))[0]).toMatchObject({
			type: 'uniswapPrice',
			venue: 'v3',
			eventName: 'Swap',
		})
		expect(
			projectionsFrom(
				log('Initialize', {
					id: marketId,
					currency0: '0x0000000000000000000000000000000000000000',
					currency1: rep,
					fee: '3000',
					tickSpacing: '60',
					hooks: '0x0000000000000000000000000000000000000000',
					sqrtPriceX96: String(2n ** 96n),
				}),
			),
		).toEqual([expect.objectContaining({ type: 'uniswapMarket', venue: 'v4', marketId }), expect.objectContaining({ type: 'uniswapPrice', venue: 'v4', marketId, eventName: 'Initialize' })])
	})

	test('adds typed domain evidence for operations and unified timelines', () => {
		const report = projectionsFrom(
			log('ReportSubmitted', {
				reportId: '42',
				numReports: '1',
				currentReporter: vault,
				currentAmount1: '10',
				currentAmount2: '20',
			}),
		).at(-1)
		expect(report).toMatchObject({
			type: 'domainEvent',
			domain: 'report',
			entityType: 'open-oracle-report',
			entityIdentity: `${pool.toLowerCase()}:42`,
			semanticEventKind: 'ReportSubmitted',
		})
		const auction = projectionsFrom(log('BidSubmitted', { bidId: '1', bidder: vault, vault, lots: '2', minimumAttoRepPerLot: atomic(10n), targetHealthBps: '12000' })).at(-1)
		expect(auction).toMatchObject({ type: 'domainEvent', domain: 'auction', semanticEventKind: 'BidSubmitted' })
		// Refund accounting reads these auction events, so each must reach the auction projection.
		for (const [name, data] of [
			['RefundWithdrawn', { bidder: vault, recipient: vault, amountAttoEth: atomic(1n) }],
			['FeesRemoved', { bidId: '1', attoEth: atomic(1n), attoRep: atomic(2n) }],
			['RaisedWithdrawn', { recipient: vault, amountAttoEth: atomic(3n) }],
		] as const)
			expect(projectionsFrom(log(name, data)).at(-1)).toMatchObject({ type: 'domainEvent', domain: 'auction', entityType: 'auction', semanticEventKind: name })
	})

	test('classifies the remaining events of indexed contracts and ignores the unemitted ERC-1155 URI', () => {
		const cases = [
			['ReportOperationAttempted', { reportId: '7', sponsor: vault, operationIndex: '0', success: true }, 'oracle', 'price-feed', pool.toLowerCase()],
			['SecurityPoolDeployed', { securityPool: vault, creator: pool }, 'risk', 'security-pool', vault.toLowerCase()],
			['SecurityPoolRegistered', { securityPool: vault, originUniverseId: '0' }, 'risk', 'security-pool', vault.toLowerCase()],
			['RepairAuctionOpened', { conservativePrice: '1', minimumCollateralAttoRepPerLot: atomic(2n), maximumBidAttoRepPerLot: atomic(3n) }, 'risk', 'security-pool-auction', pool.toLowerCase()],
			['BidVaultCreated', { bidId: '1', bidder: vault, vault }, 'risk', 'security-pool-auction', pool.toLowerCase()],
			['RepairAuctionClosed', { filledLots: '1', raisedAttoEth: atomic(1n), soldAttoRep: atomic(2n) }, 'risk', 'security-pool-auction', pool.toLowerCase()],
			['SecurityPoolRecoveryRightsTransferred', { universeId: '1', from: vault, to: vault, amountsAttoShares: ['1', '2', '3'] }, 'system', 'share-token', pool.toLowerCase()],
			['SecurityPoolRecoveryRightsConsumed', { universeId: '1', holder: vault, amountAttoShares: atomic(1n), cumulativeAttoShares: atomic(1n) }, 'system', 'share-token', pool.toLowerCase()],
		] as const
		for (const [name, data, domain, entityType, entityIdentity] of cases) expect(projectionsFrom(log(name, data)).at(-1)).toMatchObject({ type: 'domainEvent', domain, entityType, entityIdentity, semanticEventKind: name })
		expect(projectionsFrom({ ...log('URI', { value: 'ipfs://share', id: '1' }), contractKind: 'shareToken' })).toEqual([])
	})

	test('a materialized auction bid belongs to the vault that owns the new position', () => {
		expect(projectionsFrom(log('RepairAuctionBidMaterialized', { bidId: '4', vault, positionId: '3', principal: '70', commitment: '10' })).at(-1)).toMatchObject({ domain: 'risk', entityType: 'vault', entityIdentity: `${pool.toLowerCase()}:${vault.toLowerCase()}` })
		// The cohort is the auction adapter's aggregate position, identified by its position id.
		expect(projectionsFrom(log('RepairAuctionCohortInstalled', { adapter: vault, positionId: '3', lots: '1', repPerLot: '2', commitmentPerLot: '3' })).at(-1)).toMatchObject({ entityType: 'capital-position', entityIdentity: `${pool.toLowerCase()}:3` })
	})

	test('classifies the events of contracts registered through security pool discovery', () => {
		const emitter = pool.toLowerCase()
		const game = vault.toLowerCase()
		const cases = [
			['BookCreated', { bookId: '2', sourceBookId: '1', cashAttoEth: atomic(5n), units: '5' }, 'risk', 'settlement-book', `${emitter}:2`],
			['SettlementMinted', { bookId: '1', questionId: '42', cashAttoEth: atomic(5n), outcomeShares: '5' }, 'risk', 'settlement-book', `${emitter}:1`],
			['SettlementRedeemed', { bookId: '1', questionId: '42', outcomeShares: '5', units: '5', cashAttoEth: atomic(5n) }, 'risk', 'settlement-book', `${emitter}:1`],
			['FinalityScheduled', { bookId: '1', questionId: '42', finalAfter: '100' }, 'risk', 'settlement-book', `${emitter}:1`],
			['FinalClaimsFrozen', { bookId: '1', frozenBookId: '1', securityPoolTimestamp: '100', units: '5', cashAttoEth: atomic(5n) }, 'risk', 'settlement-book', `${emitter}:1`],
			['FeeStreamReplaced', { bookId: '1', questionId: '42', rateAttoEthPerSecond: atomic(3n), end: '200' }, 'risk', 'settlement-book', `${emitter}:1`],
			['AggregateFeesAccrued', { bookId: '1', securityPoolTimestamp: '150', cashAttoEth: atomic(9n) }, 'risk', 'settlement-book', `${emitter}:1`],
			['PremiumFunded', { universeId: '3', questionId: '42', amountAttoEth: atomic(1n), units: '1' }, 'risk', 'security-pool-services', `${emitter}:3`],
			['PremiumRecovered', { universeId: '3', questionId: '42', recipient: vault, amountAttoEth: atomic(1n) }, 'risk', 'security-pool-services', `${emitter}:3`],
			['UnusedServiceCashBurned', { universeId: '3', amountAttoEth: atomic(1n) }, 'risk', 'security-pool-services', `${emitter}:3`],
			['RecoveryRepPaid', { universeId: '3', questionId: '42', recipient: vault, amountAttoRep: atomic(2n) }, 'risk', 'security-pool-settlement', `${emitter}:3`],
			['ReporterBalanceChanged', { universeId: '3', questionId: '42', balanceAttoRep: atomic(7n) }, 'risk', 'reporter-ledger', `${emitter}:3`],
			// The reporter ledger names the game, so both events belong to that game rather than to the ledger.
			['GameRegistered', { universeId: '3', questionId: '42', game: vault }, 'escalation', 'escalation', game],
			['ReporterFinalityScheduled', { game: vault, finalAfter: '100' }, 'escalation', 'escalation', game],
			['ReporterForkFrozen', { universeId: '3', migrationAttoRep: atomic(4n), protectedParentAttoRep: atomic(1n) }, 'fork', 'security-pool-branch', `${emitter}:3`],
			// The child's reporter escrow is created under the source universe that forked.
			['ReporterChildCreated', { sourceUniverseId: '3', childUniverseId: '4', escrowAttoRep: atomic(4n) }, 'fork', 'security-pool-branch', `${emitter}:3`],
			// The escrow completes a report for the feed that created it, so the entity is that feed.
			['ReportCompleted', { reportId: '7', priceFeed: vault, outcome: 1 }, 'oracle', 'price-feed', game],
		] as const
		for (const [name, data, domain, entityType, entityIdentity] of cases) expect(projectionsFrom(log(name, data)).at(-1)).toMatchObject({ type: 'domainEvent', domain, entityType, entityIdentity, semanticEventKind: name })
	})

	test('repair and recovery funding evidence keeps custody universes separate from settlement book IDs', () => {
		const emitter = pool.toLowerCase()
		const cashAttoEth = atomic(5n)
		const amountAttoRep = atomic(2n)
		const bookRepair = { ...log('SettlementBookRepaired', { bookId: '7', cashAttoEth }), contractKind: 'securityPoolSettlementBook' as const }
		const custodyRepair = { ...log('SettlementRepaired', { universeId: '3', sponsor: vault, cashAttoEth }), contractKind: 'securityPoolSettlement' as const }
		const funded = { ...log('RecoveryRepFunded', { universeId: '3', questionId: '42', payer: vault, amountAttoRep }), contractKind: 'securityPoolSettlement' as const }
		expect(projectionsFrom(bookRepair).at(-1)).toMatchObject({ domain: 'risk', entityType: 'settlement-book', entityIdentity: `${emitter}:7`, data: { bookId: '7', cashAttoEth } })
		expect(projectionsFrom(custodyRepair).at(-1)).toMatchObject({ domain: 'risk', entityType: 'security-pool-settlement', entityIdentity: `${emitter}:3`, data: { universeId: '3', sponsor: vault, cashAttoEth } })
		expect(projectionsFrom(funded).at(-1)).toMatchObject({ domain: 'risk', entityType: 'security-pool-settlement', entityIdentity: `${emitter}:3`, data: { questionId: '42', payer: vault, amountAttoRep } })
	})

	test('records standalone health changes in owner activity (#1418)', () => {
		expect(projectionsFrom(log('HealthTargetSet', { owner: vault, targetHealthFactorBps: '12000' })).at(-1)).toMatchObject({
			domain: 'risk',
			entityType: 'vault',
			entityIdentity: `${pool.toLowerCase()}:${vault.toLowerCase()}`,
			data: { owner: vault, targetHealthFactorBps: '12000' },
		})
	})

	test('covers coordinator, escalation, risk, trading, and fork lifecycle taxonomy with stable keys', () => {
		expect(projectionsFrom(log('PendingReportRecovered', { reportId: '1' })).at(-1)).toMatchObject({
			type: 'domainEvent',
			domain: 'oracle',
			entityType: 'price-coordinator',
			entityIdentity: pool.toLowerCase(),
		})
		expect(projectionsFrom(log('GameStarted', { activationTime: '1' })).at(-1)).toMatchObject({
			domain: 'escalation',
			entityIdentity: pool.toLowerCase(),
		})
		expect(projectionsFrom(log('CommitmentAuthorized', { owner: vault, positionId: '1' })).at(-1)).toMatchObject({
			domain: 'risk',
			entityType: 'vault',
			entityIdentity: `${pool.toLowerCase()}:${vault.toLowerCase()}`,
		})
		expect(projectionsFrom(log('PrincipalDeposited', { owner: vault })).at(-1)).toMatchObject({
			domain: 'risk',
			entityType: 'vault',
			entityIdentity: `${pool.toLowerCase()}:${vault.toLowerCase()}`,
		})
		expect(projectionsFrom(log('ForkContinuationResidualRepBurned', { amountAttoRep: atomic(1n) })).at(-1)).toMatchObject({
			domain: 'escalation',
			entityIdentity: pool.toLowerCase(),
		})
		expect(projectionsFrom(log('PredeploymentSharesQuarantined', { invalidAmount: '1' })).at(-1)).toMatchObject({
			domain: 'trading',
			entityType: 'amm',
		})
		expect(projectionsFrom(log('BranchActivated', { universeId: '7' })).at(-1)).toMatchObject({
			domain: 'fork',
			entityType: 'security-pool-branch',
			entityIdentity: `${pool.toLowerCase()}:7`,
		})
		expect(projectionsFrom(log('MigrationRepSplit', { universeId: '2', childUniverseId: '7' })).at(-1)).toMatchObject({
			domain: 'fork',
			entityIdentity: '2',
		})
		expect(projectionsFrom(log('Migrate', { migrator: vault, fromId: '1', toId: '2', amountAttoShares: atomic(7n) })).at(-1)).toMatchObject({
			domain: 'system',
			entityType: 'share-token',
			entityIdentity: pool.toLowerCase(),
		})
	})
})

for (const seconds of ['0', '8640000000000', '8640000000001', '281474976710655']) {
	test(`preserves question timestamps as exact seconds: ${seconds}`, () => {
		const [projection] = projectionsFrom(
			log('QuestionCreated', {
				questionId: '42',
				createdTimestamp: '1000',
				outcomeOptions: [],
				questionData: { title: 'Distant future', description: '', startTime: seconds, endTime: seconds, numTicks: '100', displayValueMin: '0', displayValueMax: '100', answerUnit: '' },
			}),
		)
		expect(projection).toMatchObject({ type: 'question', startTime: seconds, endTime: seconds })
	})
}

describe('previously raw-only lifecycle evidence', () => {
	for (const [name, data, kind, entityType, identity] of [
		['OrdinarySettlementInitialized', { outcome: '1', winningPrincipalAttoRep: 100n.toString(), reservedAttoRep: 130n.toString() }, 'escalationGame', 'escalation', pool],
		['ReputationTokenInitialized', { universeId: '7', repNumber: '2' }, 'reputationToken', 'reputation-token', pool],
		['ChildReputationTokenInitialized', { universeId: '7', reputationToken: vault, repNumber: '2' }, 'zoltar', 'fork', '7'],
		['PositionExitedByTransfer', { owner: vault, pair: vault, completeSetShares: '12' }, 'ammRouter', 'amm', vault],
		['CompleteSetRedeemedByTransfer', { questionLedger: vault, completeSetShares: '12' }, 'ammRouter', 'pool', vault],
	] as const) {
		test(`projects ${name} with its owning entity`, () => {
			expect(projectionsFrom(log(name, data, pool, kind))).toContainEqual(expect.objectContaining({ type: 'domainEvent', semanticEventKind: name, entityType, entityIdentity: identity }))
		})
	}
})

test('question accounting rejects values outside the current three-reason enum', () => {
	for (const reason of [-1, 3, 5, 255]) expect(() => projectionsFrom(log('QuestionAccountingCheckpoint', { reason, settlementCollateralAttoEth: 100n.toString(), shareTokenSupplyAttoShares: 200n.toString(), lastSettlementSecurityPoolTime: '300' }))).toThrow('accounting reason')
})

test('question accounting preserves the security pool clock as an exact integer beyond wall-clock range', () => {
	const clock = (1n << 48n) - 1n
	expect(projectionsFrom(log('QuestionAccountingCheckpoint', { reason: 2, settlementCollateralAttoEth: 100n.toString(), shareTokenSupplyAttoShares: 200n.toString(), lastSettlementSecurityPoolTime: clock.toString() }))).toContainEqual({
		type: 'poolSnapshot',
		poolAddress: pool.toLowerCase(),
		reason: 2,
		settlementCollateralAttoEth: atomic(100n),
		shareTokenSupplyAttoShares: atomic(200n),
		lastSettlementSecurityPoolTime: atomic(clock),
	})
})

test('attributes internal balance approvals to the OpenOracle contract', () => {
	expect(projectionsFrom(log('InternalApproval', { owner: vault, spender: pool, token: vault, amount: '1' }, pool, 'openOracle'))).toContainEqual(expect.objectContaining({ type: 'domainEvent', domain: 'oracle', entityType: 'open-oracle', entityIdentity: pool.toLowerCase() }))
	expect(projectionsFrom(log('PriceRequested', { reportId: '1' }, pool, 'sharedPoolPriceFeed'))).toContainEqual(expect.objectContaining({ type: 'domainEvent', domain: 'oracle', entityType: 'price-feed' }))
})

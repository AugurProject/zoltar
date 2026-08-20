import { describe, expect, test } from 'bun:test'
import { getAddress, type Hex } from '../src/ethereum.ts'
import { projectionsFrom } from '../src/projections.ts'
import type { StoredLog } from '../src/types.ts'

const hash = `0x${'12'.repeat(32)}` as Hex
const pool = getAddress('0x1111111111111111111111111111111111111111')
const vault = getAddress('0x2222222222222222222222222222222222222222')
const atomic = (value: bigint): string => value.toString()

const log = (name: string, argumentsValue: Record<string, unknown>, address = pool): StoredLog => ({
	transactionHash: hash,
	blockHash: hash,
	blockNumber: 10n,
	transactionIndex: 0,
	logIndex: 0,
	address,
	topics: [hash],
	data: '0x',
	decoded: { name, arguments: argumentsValue, status: 'decoded', summary: name },
})

describe('state projections', () => {
	test('captures immutable question metadata', () => {
		const [projection] = projectionsFrom(
			log('QuestionCreated', {
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
			}),
		)
		expect(projection?.type).toBe('question')
		if (projection?.type !== 'question') throw new Error('question projection missing')
		expect(projection.questionId).toBe('42')
		expect(projection.outcomeOptions).toEqual(['Yes', 'No'])
		expect(projection.endTime.toISOString()).toBe('1970-01-01T00:35:00.000Z')
	})

	test('captures complete pool and vault accounting snapshots', () => {
		const [deployment] = projectionsFrom(
			log('DeploySecurityPool', {
				securityPool: pool,
				parent: '0x0000000000000000000000000000000000000000',
				universeId: '0',
				questionId: '42',
				truthAuction: '0x0000000000000000000000000000000000000000',
				priceOracleManagerAndOperatorQueuer: vault,
				shareToken: vault,
				statoblastSecurityMultiplierBps: '15000',
				initialReportPriorityFeeAttoEthPerGas: atomic(10_000_000_000n),
				currentRetentionRate: '999999000000000000',
				settlementCollateralAttoEth: atomic(12_000_000_000_000_000_000n),
			}),
		)
		expect(deployment).toMatchObject({ type: 'pool', poolAddress: pool.toLowerCase(), questionId: '42', universeId: '0' })

		const [poolProjection] = projectionsFrom(
			log('PoolAccountingCheckpoint', {
				reason: '5',
				vault,
				settlementCollateralAttoEth: atomic(12_000_000_000_000_000_000n),
				totalCapacityOwnershipAttoRep: atomic(9_000_000_000_000_000_000n),
				feeEligibleCapacityOwnershipAttoRep: atomic(8_000_000_000_000_000_000n),
				totalClaimableVaultFeesAttoEth: atomic(40n),
				unallocatedAccruedFeesAttoEth: atomic(3n),
				feeIndex: '10',
				feeIndexRemainder: '1',
				totalFeesOwedRemainder: '2',
				uncheckpointedFeeEligibleCapacityOwnershipAttoRep: atomic(4n),
				lastUpdatedFeeAccumulator: '2000',
				currentRetentionRate: '999999000000000000',
			}),
		)
		expect(poolProjection?.type).toBe('poolSnapshot')
		if (poolProjection?.type !== 'poolSnapshot') throw new Error('pool projection missing')
		expect(poolProjection.settlementCollateralAttoEth).toBe('12000000000000000000')
		expect(poolProjection.totalCapacityOwnershipAttoRep).toBe('9000000000000000000')
		expect(poolProjection.feeEligibleCapacityOwnershipAttoRep).toBe('8000000000000000000')

		const [vaultProjection, resultingPoolState] = projectionsFrom(
			log('VaultAccountingCheckpoint', {
				vault,
				repBackingUnits: '50',
				capacityOwnershipAttoRep: atomic(60n),
				claimableFeesAttoEth: atomic(70n),
				feeIndex: '80',
				vaultFeeRemainder: '90',
				resultingTotalRepBackingUnits: '100',
				resultingFeeEligibleCapacityOwnershipAttoRep: atomic(110n),
			}),
		)
		expect(vaultProjection?.type).toBe('vaultSnapshot')
		if (vaultProjection?.type !== 'vaultSnapshot') throw new Error('vault projection missing')
		expect(vaultProjection.vaultAddress).toBe(vault.toLowerCase())
		expect(vaultProjection.capacityOwnershipAttoRep).toBe('60')
		expect(resultingPoolState).toMatchObject({ type: 'poolState', state: { totalRepBackingUnits: '100' } })
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
			log('PairCreated', {
				securityPool: pool,
				shareToken: vault,
				universeId: '7',
				pair,
				feeBps: '30',
			}),
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
		expect(projectionsFrom(log('Sync', { yesReserve: '0', noReserve: '0' }, pair))).toEqual([
			expect.objectContaining({ type: 'domainEvent', domain: 'trading', semanticEventKind: 'Sync' }),
		])
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
		const projected = projectionsFrom(
			log('Swap', { sender: pool, recipient: vault, amount0: '-1', amount1: '2', sqrtPriceX96: String(2n ** 96n), liquidity: '100' }),
		)
		expect(projected.some((item) => item.type === 'domainEvent' && item.domain === 'trading')).toBe(false)
	})

	test('distinguishes initialization seeds from accepted REP per ETH coordinator prices', () => {
		const [originSeed] = projectionsFrom(log('RepEthPriceSet', { price: '0' }, vault))
		expect(originSeed).toEqual({
			type: 'repEthPrice',
			coordinatorAddress: vault.toLowerCase(),
			eventName: 'RepEthPriceSet',
			repPerEth1e18: '0',
		})
		const [childSeed] = projectionsFrom(log('RepEthPriceSet', { price: '18000000000000000000' }, vault))
		expect(childSeed).toEqual({
			type: 'repEthPrice',
			coordinatorAddress: vault.toLowerCase(),
			eventName: 'RepEthPriceSet',
			repPerEth1e18: '18000000000000000000',
		})

		const [reported] = projectionsFrom(log('PriceReported', { reportId: '42', price: '19500000000000000000', lastSettlementTimestamp: '2000' }, vault))
		expect(reported).toMatchObject({
			type: 'repEthPrice',
			coordinatorAddress: vault.toLowerCase(),
			eventName: 'PriceReported',
			reportId: '42',
			repPerEth1e18: '19500000000000000000',
		})
		if (reported?.type !== 'repEthPrice') throw new Error('REP/ETH price projection missing')
		expect(reported.settlementTimestamp?.toISOString()).toBe('1970-01-01T00:33:20.000Z')
	})

	test('retains auditable Uniswap market identity and raw price evidence', () => {
		const rep = getAddress('0x3333333333333333333333333333333333333333')
		const weth = getAddress('0x4444444444444444444444444444444444444444')
		const marketId = `0x${'ab'.repeat(32)}`
		expect(projectionsFrom(log('PairCreated', { token0: rep, token1: weth, pair: pool, '3': '1' }))[0]).toMatchObject({
			type: 'uniswapMarket',
			venue: 'v2',
			marketId: pool.toLowerCase(),
			feeHundredthsBip: '3000',
		})
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
		).toEqual([
			expect.objectContaining({ type: 'uniswapMarket', venue: 'v4', marketId }),
			expect.objectContaining({ type: 'uniswapPrice', venue: 'v4', marketId, eventName: 'Initialize' }),
		])
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
		const auction = projectionsFrom(log('BidSubmitted', { bidder: vault, tick: '-3', bidIndex: '0', bidAmountAttoEth: atomic(10n) })).at(-1)
		expect(auction).toMatchObject({ type: 'domainEvent', domain: 'auction', semanticEventKind: 'BidSubmitted' })
	})

	test('covers coordinator, escalation, risk, trading, and fork lifecycle taxonomy with stable keys', () => {
		expect(projectionsFrom(log('CoordinatorStateCheckpoint', { reportId: '1' })).at(-1)).toMatchObject({
			type: 'domainEvent',
			domain: 'oracle',
			entityType: 'price-coordinator',
			entityIdentity: pool.toLowerCase(),
		})
		expect(projectionsFrom(log('GameStarted', { activationTime: '1' })).at(-1)).toMatchObject({
			domain: 'escalation',
			entityIdentity: pool.toLowerCase(),
		})
		expect(projectionsFrom(log('VaultBadDebtRecorded', { targetVault: vault })).at(-1)).toMatchObject({
			domain: 'risk',
			entityType: 'vault',
			entityIdentity: `${pool.toLowerCase()}:${vault.toLowerCase()}`,
		})
		for (const eventName of [
			'LiquidationApprovalSet',
			'LiquidationApprovalReserved',
			'LiquidationApprovalReleased',
			'LiquidationApprovalConsumed',
			'LiquidationApprovalRevoked',
			'LiquidationApprovalNonceInvalidated',
		])
			expect(projectionsFrom(log(eventName, { approvalId: `0x${'a'.repeat(64)}`, receiverVault: vault })).at(-1)).toMatchObject({
				domain: 'approval',
				entityType: 'liquidation-approval',
				semanticEventKind: eventName,
			})
		expect(projectionsFrom(log('PredeploymentSharesQuarantined', { invalidAmount: '1' })).at(-1)).toMatchObject({
			domain: 'trading',
			entityType: 'amm',
		})
		expect(projectionsFrom(log('SecurityPoolForkSnapshot', { parentPool: vault })).at(-1)).toMatchObject({
			domain: 'fork',
			entityIdentity: vault.toLowerCase(),
		})
		expect(projectionsFrom(log('Migrate', { childUniverseId: '7' })).at(-1)).toMatchObject({ domain: 'fork', entityIdentity: '7' })
	})
})

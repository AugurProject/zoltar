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
				totalCoverageCommitmentAttoEth: atomic(9_000_000_000_000_000_000n),
				feeEligibleCoverageCommitmentAttoEth: atomic(8_000_000_000_000_000_000n),
				totalClaimableVaultFeesAttoEth: atomic(40n),
				unallocatedAccruedFeesAttoEth: atomic(3n),
				feeIndex: '10',
				feeIndexRemainder: '1',
				totalFeesOwedRemainder: '2',
				uncheckpointedFeeEligibleCoverageCommitmentAttoEth: atomic(4n),
				lastUpdatedFeeAccumulator: '2000',
				currentRetentionRate: '999999000000000000',
			}),
		)
		expect(poolProjection?.type).toBe('poolSnapshot')
		if (poolProjection?.type !== 'poolSnapshot') throw new Error('pool projection missing')
		expect(poolProjection.settlementCollateralAttoEth).toBe('12000000000000000000')

		const [vaultProjection, resultingPoolState] = projectionsFrom(
			log('VaultAccountingCheckpoint', {
				vault,
				repBackingUnits: '50',
				coverageCommitmentAttoEth: atomic(60n),
				claimableFeesAttoEth: atomic(70n),
				feeIndex: '80',
				vaultFeeRemainder: '90',
				resultingTotalRepBackingUnits: '100',
				resultingFeeEligibleCoverageCommitmentAttoEth: atomic(110n),
			}),
		)
		expect(vaultProjection?.type).toBe('vaultSnapshot')
		if (vaultProjection?.type !== 'vaultSnapshot') throw new Error('vault projection missing')
		expect(vaultProjection.vaultAddress).toBe(vault.toLowerCase())
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
})

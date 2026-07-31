import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/bot-shared/ethereum'
import { parseStrategy } from '../../src/config/settings.ts'
import { BPS_DENOMINATOR, PRICE_PRECISION, calculateLiquidationTransfer, conservativeLiquidationRep, evaluateCandidate, surplusRepForWithdrawal, vaultHealthBps, type PoolRiskContext, type VaultPosition } from '../../src/core/strategy.ts'
import { candidateScreeningPrice } from '../../src/monitoring/pool-monitor.ts'

const poolAddress = getAddress('0x0000000000000000000000000000000000000010')
const managerAddress = getAddress('0x0000000000000000000000000000000000000020')
const callerAddress = getAddress('0x0000000000000000000000000000000000000030')
const targetAddress = getAddress('0x0000000000000000000000000000000000000040')

function strategy() {
	return parseStrategy({
		allowAutomaticDeposits: true,
		allowAutomaticVaultMigrations: true,
		allowAutomaticWithdrawals: true,
		candidatePriority: 'largest-bonus',
		fallbackRepPerEthPrice: '0',
		maximumGasCostEth: '0.02',
		maximumLiquidationDebtEth: '25',
		maximumOracleRequestCostEth: '0.02',
		maximumRepPerPool: '10000',
		maximumTotalDeployedRep: '25000',
		minimumLiquidationDebtEth: '1',
		minimumRepWithdrawal: '10',
		minimumRewardValueEth: '0.02',
		redeemFeesAboveEth: '0.01',
		stalePriceFundingBufferBps: 15000,
		stagedOperationValidForSeconds: 240,
		vaultTargetHealthBps: 12500,
		vaultTopUpHealthBps: 11000,
		vaultWithdrawHealthBps: 15000,
		walletRepReserve: '100',
	})
}

function vault(address: typeof callerAddress, rep: bigint, allowance: bigint): VaultPosition {
	return {
		address,
		allowance,
		ownership: rep * PRICE_PRECISION,
		rep,
		unpaidEthFees: 0n,
	}
}

describe('liquidation strategy', () => {
	test('matches the protocol fixed-bonus transfer and full-close rules', () => {
		const transfer = calculateLiquidationTransfer({
			currentDenominator: 1_000n * PRICE_PRECISION,
			currentTargetOwnership: 1_000n * PRICE_PRECISION,
			currentTotalRep: 1_000n * PRICE_PRECISION,
			price: 10n * PRICE_PRECISION,
			requestedDebt: 75n * PRICE_PRECISION,
			snapshotDenominator: 1_000n * PRICE_PRECISION,
			snapshotTargetAllowance: 75n * PRICE_PRECISION,
			snapshotTargetOwnership: 1_000n * PRICE_PRECISION,
			snapshotTotalRep: 1_000n * PRICE_PRECISION,
		})
		expect(transfer.debtToMove).toBe(75n * PRICE_PRECISION)
		expect(transfer.repToMove).toBe(787_500000000000000000n)
		expect(transfer.ownershipToMove).toBe(787_500000000000000000n)
	})

	test('calculates the REP pre-funding required by an empty liquidator vault', () => {
		const pool: PoolRiskContext = {
			address: poolAddress,
			denominator: 1_000n * PRICE_PRECISION,
			manager: managerAddress,
			minLiquidationPriceDistanceBps: 0n,
			multiplierBps: 20_000n,
			price: 10n * PRICE_PRECISION,
			totalRep: 1_000n * PRICE_PRECISION,
		}
		const candidate = evaluateCandidate(pool, vault(targetAddress, 1_000n * PRICE_PRECISION, 75n * PRICE_PRECISION), vault(callerAddress, 0n, 0n), strategy())
		expect(candidate?.debtToMove).toBe(25n * PRICE_PRECISION)
		expect(candidate?.repToMove).toBe(262_500000000000000000n)
		expect(candidate?.topUpRep).toBe(362_500000000000000000n)
		expect(candidate?.bonusValueEth).toBe(1_250000000000000000n)
		expect(candidate?.resultingHealthBps).toBe(12_500n)
	})

	test('uses the configured fallback to screen a never-seeded pool', () => {
		expect(candidateScreeningPrice(0n, 10n * PRICE_PRECISION)).toBe(10n * PRICE_PRECISION)
		expect(candidateScreeningPrice(0n, 0n)).toBe(0n)
	})

	test('caps stale exposure using the buffered acquisition ceiling', () => {
		const target = vault(targetAddress, 1_000n * PRICE_PRECISION, 75n * PRICE_PRECISION)
		const candidate = {
			debtToMove: 25n * PRICE_PRECISION,
			target,
		}
		expect(conservativeLiquidationRep(candidate, 10n * PRICE_PRECISION)).toBe(262_500000000000000000n)
		expect(conservativeLiquidationRep(candidate, 15n * PRICE_PRECISION)).toBe(393_750000000000000000n)
	})

	test('reserves nominal buffered REP when a residual-debt full close can exceed the snapshot REP', () => {
		const candidate = {
			debtToMove: PRICE_PRECISION,
			target: vault(targetAddress, 10_300000000000000000n, PRICE_PRECISION),
		}
		expect(conservativeLiquidationRep(candidate, 10n * PRICE_PRECISION)).toBe(10_500000000000000000n)
		candidate.target.rep = 11n * PRICE_PRECISION
		expect(conservativeLiquidationRep(candidate, 10n * PRICE_PRECISION)).toBe(11n * PRICE_PRECISION)
	})

	test('rejects a multiplier where the seized REP is already safe for moved debt', () => {
		const candidate = evaluateCandidate(
			{
				address: poolAddress,
				denominator: 1_000n * PRICE_PRECISION,
				manager: managerAddress,
				minLiquidationPriceDistanceBps: 0n,
				multiplierBps: 10_400n,
				price: 10n * PRICE_PRECISION,
				totalRep: 1_000n * PRICE_PRECISION,
			},
			vault(targetAddress, 500n * PRICE_PRECISION, 75n * PRICE_PRECISION),
			vault(callerAddress, 0n, 0n),
			strategy(),
		)
		expect(candidate).toBeUndefined()
	})

	test('pre-funds the protocol ten REP minimum for a small new vault', () => {
		const settings = strategy()
		settings.maximumLiquidationDebtEth = PRICE_PRECISION
		settings.minimumRewardValueEth = 0n
		const candidate = evaluateCandidate(
			{
				address: poolAddress,
				denominator: 100n * PRICE_PRECISION,
				manager: managerAddress,
				minLiquidationPriceDistanceBps: 0n,
				multiplierBps: 20_000n,
				price: PRICE_PRECISION,
				totalRep: 100n * PRICE_PRECISION,
			},
			vault(targetAddress, 20n * PRICE_PRECISION, 15n * PRICE_PRECISION),
			vault(callerAddress, 0n, 0n),
			settings,
		)
		expect(candidate?.repToMove).toBe(1_050000000000000000n)
		expect(candidate?.topUpRep).toBe(8_950000000000000000n)
	})

	test('rejects liquidations below the coordinator price-distance threshold', () => {
		const pool: PoolRiskContext = {
			address: poolAddress,
			denominator: 1_000n * PRICE_PRECISION,
			manager: managerAddress,
			minLiquidationPriceDistanceBps: 3_334n,
			multiplierBps: 20_000n,
			price: 10n * PRICE_PRECISION,
			totalRep: 1_000n * PRICE_PRECISION,
		}
		const target = vault(targetAddress, 1_000n * PRICE_PRECISION, 75n * PRICE_PRECISION)
		expect(evaluateCandidate(pool, target, vault(callerAddress, 0n, 0n), strategy())).toBeUndefined()
		pool.minLiquidationPriceDistanceBps = 3_333n
		expect(evaluateCandidate(pool, target, vault(callerAddress, 0n, 0n), strategy())).toBeDefined()
	})

	test('withdraws surplus only above the configured health threshold', () => {
		const settings = strategy()
		const pool = { multiplierBps: 20_000n, price: 10n * PRICE_PRECISION }
		const caller = vault(callerAddress, 1_000n * PRICE_PRECISION, 25n * PRICE_PRECISION)
		expect(vaultHealthBps(caller.rep, caller.allowance, pool.multiplierBps, pool.price)).toBe(20_000n)
		expect(surplusRepForWithdrawal(caller, pool, settings)).toBe(375n * PRICE_PRECISION)
		const marginal = vault(callerAddress, 600n * PRICE_PRECISION, 25n * PRICE_PRECISION)
		expect(surplusRepForWithdrawal(marginal, pool, settings)).toBe(0n)
	})

	test('keeps the protocol safety threshold at 100 percent', () => {
		expect(BPS_DENOMINATOR).toBe(10_000n)
	})
})

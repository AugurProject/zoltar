import { describe, expect, test } from 'bun:test'
import { parseStrategy } from '../../src/config/settings.ts'
import { BPS_DENOMINATOR, PRICE_PRECISION, calculateLiquidationTransfer, conservativeLiquidationRep, evaluateCandidate, liquidationExecutionAllowed, requiredRepForOpenInterest, selectAllowedCandidate, surplusRepForWithdrawal, vaultHealthBps, type PoolRiskContext, type VaultPosition } from '../../src/core/strategy.ts'
import { candidateScreeningPrice, getVaultRegistryScanCount, hasCurrentVaultState, MAX_VAULT_REGISTRY_ENTRIES_SCANNED } from '../../src/monitoring/pool-monitor.ts'
import { getAddress } from '../helpers/ethereum.ts'

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
		maximumPerPoolRep: '10000',
		maximumTotalDeployedRep: '25000',
		minimumLiquidationDebtEth: '1',
		minimumRepWithdrawalRep: '10',
		minimumRewardValueEth: '0.02',
		redeemFeesAboveEth: '0.01',
		stalePriceFundingBufferBps: 15000,
		stagedOperationValidForSeconds: 240,
		vaultTargetHealthBps: 12500,
		vaultTopUpHealthBps: 11000,
		vaultWithdrawHealthBps: 15000,
		walletReserveRep: '100',
	})
}

function vault(address: typeof callerAddress, vaultAttoRepBacking: bigint, openInterestAttoEth: bigint): VaultPosition {
	return {
		address,
		backingUnits: vaultAttoRepBacking * PRICE_PRECISION,
		badDebtAttoEth: 0n,
		capacityOwnershipAttoRep: openInterestAttoEth * 10n,
		claimableFeesAttoEth: 0n,
		disputeStakedAttoRep: 0n,
		openInterestAttoEth,
		vaultAttoRepBacking,
	}
}

function pool(): PoolRiskContext {
	return {
		address: poolAddress,
		denominator: 1_000n * PRICE_PRECISION,
		feeEligibleCapacityOwnershipAttoRep: 1_000n * PRICE_PRECISION,
		manager: managerAddress,
		minimumSecurityBondDebtAttoEth: PRICE_PRECISION,
		minimumVaultRepDepositAttoRep: 10n * PRICE_PRECISION,
		minLiquidationPriceDistanceBps: 0n,
		multiplierBps: 20_000n,
		price: 10n * PRICE_PRECISION,
		settlementCollateralAttoEth: 100n * PRICE_PRECISION,
		totalAttoRep: 1_000n * PRICE_PRECISION,
		totalCapacityOwnershipAttoRep: 1_000n * PRICE_PRECISION,
	}
}

describe('dynamic-capacity liquidation strategy', () => {
	test('known-vault scans skip exited entries without hiding current economic state', () => {
		expect(MAX_VAULT_REGISTRY_ENTRIES_SCANNED).toBe(1_000n)
		expect(getVaultRegistryScanCount(999n)).toBe(999n)
		expect(getVaultRegistryScanCount(1_001n)).toBe(1_000n)
		const exited = vault(targetAddress, 0n, 0n)
		expect(hasCurrentVaultState(exited)).toBe(false)
		expect(hasCurrentVaultState({ ...exited, badDebtAttoEth: 1n })).toBe(true)
		expect(hasCurrentVaultState({ ...exited, claimableFeesAttoEth: 1n })).toBe(true)
		expect(hasCurrentVaultState({ ...exited, disputeStakedAttoRep: 1n })).toBe(true)
		expect(hasCurrentVaultState(vault(targetAddress, 1n, 0n))).toBe(true)
	})

	test('matches the protocol bundled debt, capacity, and fixed-bonus transfer', () => {
		const transfer = calculateLiquidationTransfer({
			currentPoolHeldAttoRepBalance: 1_000n * PRICE_PRECISION,
			currentTargetBackingUnits: 1_000n * PRICE_PRECISION,
			currentTotalRepBackingUnits: 1_000n * PRICE_PRECISION,
			minimumRemainingAttoRep: 0n,
			price: 10n * PRICE_PRECISION,
			requestedDebtAttoEth: 75n * PRICE_PRECISION,
			snapshotTargetCapacityOwnershipAttoRep: 750n * PRICE_PRECISION,
			snapshotTargetOpenInterestAttoEth: 75n * PRICE_PRECISION,
		})
		expect(transfer.debtToMoveAttoEth).toBe(75n * PRICE_PRECISION)
		expect(transfer.capacityOwnershipToMoveAttoRep).toBe(750n * PRICE_PRECISION)
		expect(transfer.vaultAttoRepBackingToTransfer).toBe(787_500000000000000000n)
	})

	test('pre-funds both health branches for an empty self-receiving vault', () => {
		const candidate = evaluateCandidate(pool(), vault(targetAddress, 1_000n * PRICE_PRECISION, 75n * PRICE_PRECISION), vault(callerAddress, 0n, 0n), strategy())
		expect(candidate?.requestedDebtAttoEth).toBe(25n * PRICE_PRECISION)
		expect(candidate?.debtToMoveAttoEth).toBe(25n * PRICE_PRECISION)
		expect(candidate?.capacityOwnershipToMoveAttoRep).toBe(250n * PRICE_PRECISION)
		expect(candidate?.vaultAttoRepBackingToTransfer).toBe(262_500000000000000000n)
		expect(candidate?.topUpAttoRep).toBe(362_500000000000000000n)
		expect(candidate?.resultingHealthBps).toBe(12_500n)
	})

	test('rejects a receiver whose exact bad debt absorbs the moved ownership gross open interest', () => {
		const receiver = vault(callerAddress, 100n * PRICE_PRECISION, 0n)
		receiver.badDebtAttoEth = 30n * PRICE_PRECISION
		const candidate = evaluateCandidate(pool(), vault(targetAddress, 1_000n * PRICE_PRECISION, 75n * PRICE_PRECISION), receiver, strategy())

		expect(candidate).toBeUndefined()
	})

	test('accepts a healthy liquidation award bundle in a low-multiplier pool', () => {
		const lowMultiplierPool = { ...pool(), multiplierBps: 10_002n }
		const candidate = evaluateCandidate(lowMultiplierPool, vault(targetAddress, 1_000n * PRICE_PRECISION, 100n * PRICE_PRECISION), vault(callerAddress, 0n, 0n), strategy())
		expect(candidate?.debtToMoveAttoEth).toBe(25n * PRICE_PRECISION)
		expect(candidate?.topUpAttoRep).toBeGreaterThan(0n)
	})

	test('assigns receiver debt against total capacity before auction ownership is claimed', () => {
		const unclaimedPool = {
			...pool(),
			denominator: 107n * PRICE_PRECISION,
			feeEligibleCapacityOwnershipAttoRep: 2n * PRICE_PRECISION,
			minimumSecurityBondDebtAttoEth: 1n,
			minimumVaultRepDepositAttoRep: 1n,
			multiplierBps: 20_000n,
			price: PRICE_PRECISION,
			settlementCollateralAttoEth: 8n * PRICE_PRECISION,
			totalAttoRep: 107n * PRICE_PRECISION,
			totalCapacityOwnershipAttoRep: 4n * PRICE_PRECISION,
		}
		const target = {
			...vault(targetAddress, 7n * PRICE_PRECISION, 4n * PRICE_PRECISION),
			capacityOwnershipAttoRep: 2n * PRICE_PRECISION,
		}
		const receiver = {
			...vault(callerAddress, 100n * PRICE_PRECISION, 2n * PRICE_PRECISION),
			capacityOwnershipAttoRep: PRICE_PRECISION,
		}
		const settings = strategy()
		settings.maximumLiquidationDebtAttoEth = 4n * PRICE_PRECISION
		settings.minimumLiquidationDebtAttoEth = 1n
		settings.minimumRewardValueAttoEth = 0n

		const candidate = evaluateCandidate(unclaimedPool, target, receiver, settings)

		expect(candidate?.debtToMoveAttoEth).toBe(4n * PRICE_PRECISION)
		expect(candidate?.capacityOwnershipToMoveAttoRep).toBe(2n * PRICE_PRECISION)
	})

	test('prefunds at least the standalone minimum for an empty receiver vault', () => {
		const minimumPool = { ...pool(), minimumVaultRepDepositAttoRep: 30n * PRICE_PRECISION }
		const settings = strategy()
		settings.maximumLiquidationDebtAttoEth = PRICE_PRECISION
		const candidate = evaluateCandidate(minimumPool, vault(targetAddress, 1_000n * PRICE_PRECISION, 75n * PRICE_PRECISION), vault(callerAddress, 0n, 0n), settings)
		expect(candidate?.vaultAttoRepBackingToTransfer).toBe(10_500000000000000000n)
		expect(candidate?.topUpAttoRep).toBe(30n * PRICE_PRECISION)
	})

	test('rounds required REP upward across the protocol health calculation', () => {
		expect(requiredRepForOpenInterest(1n, 20_000n, PRICE_PRECISION, 12_500n)).toBe(3n)
	})

	test('uses dispute-staked REP only for associated backing, not free backing', () => {
		const target = vault(targetAddress, 400n * PRICE_PRECISION, 25n * PRICE_PRECISION)
		target.disputeStakedAttoRep = 100n * PRICE_PRECISION
		expect(vaultHealthBps(target.vaultAttoRepBacking, target.openInterestAttoEth, 20_000n, 10n * PRICE_PRECISION, target.disputeStakedAttoRep)).toBe(10_000n)
		expect(requiredRepForOpenInterest(target.openInterestAttoEth, 20_000n, 10n * PRICE_PRECISION, 10_000n, target.disputeStakedAttoRep)).toBe(400n * PRICE_PRECISION)
	})

	test('screens stale pools with fallback price but never treats it as executable', () => {
		expect(candidateScreeningPrice(0n, 10n * PRICE_PRECISION)).toBe(10n * PRICE_PRECISION)
		expect(liquidationExecutionAllowed(0n, true)).toBe(false)
		expect(liquidationExecutionAllowed(10n * PRICE_PRECISION, true)).toBe(true)
	})

	test('selects the highest-priority allowed candidate', () => {
		const lower = evaluateCandidate(pool(), vault(targetAddress, 1_000n * PRICE_PRECISION, 75n * PRICE_PRECISION), vault(callerAddress, 0n, 0n), strategy())
		if (lower === undefined) throw new Error('Expected a liquidation candidate')
		const higher = { ...lower, bonusValueAttoEth: lower.bonusValueAttoEth + 1n, target: { ...lower.target, address: managerAddress } }
		expect(selectAllowedCandidate([lower, higher], 'largest-bonus', candidate => candidate.target.address === lower.target.address)).toBe(lower)
	})

	test('uses actual estimated debt moved for the REP acquisition ceiling', () => {
		const candidate = { debtToMoveAttoEth: 25n * PRICE_PRECISION, target: vault(targetAddress, 1_000n * PRICE_PRECISION, 75n * PRICE_PRECISION) }
		expect(conservativeLiquidationRep(candidate, 10n * PRICE_PRECISION)).toBe(262_500000000000000000n)
	})

	test('rejects a receiver whose resulting debt is below the pool minimum', () => {
		const settings = strategy()
		settings.maximumLiquidationDebtAttoEth = PRICE_PRECISION / 2n
		settings.minimumLiquidationDebtAttoEth = 1n
		settings.minimumRewardValueAttoEth = 0n
		expect(evaluateCandidate(pool(), vault(targetAddress, 1_000n * PRICE_PRECISION, 75n * PRICE_PRECISION), vault(callerAddress, 0n, 0n), settings)).toBeUndefined()
	})

	test('withdraws only REP above the configured two-branch health target', () => {
		const caller = vault(callerAddress, 1_000n * PRICE_PRECISION, 25n * PRICE_PRECISION)
		expect(vaultHealthBps(caller.vaultAttoRepBacking, caller.openInterestAttoEth, 20_000n, 10n * PRICE_PRECISION)).toBe(20_000n)
		expect(surplusRepForWithdrawal(caller, { minimumVaultRepDepositAttoRep: 10n * PRICE_PRECISION, multiplierBps: 20_000n, price: 10n * PRICE_PRECISION }, strategy())).toBe(375n * PRICE_PRECISION)
		expect(BPS_DENOMINATOR).toBe(10_000n)
	})

	test('retains the configured vault REP minimum while live debt remains', () => {
		const caller = vault(callerAddress, 1_000n * PRICE_PRECISION, PRICE_PRECISION)
		expect(surplusRepForWithdrawal(caller, { minimumVaultRepDepositAttoRep: 500n * PRICE_PRECISION, multiplierBps: 10_002n, price: PRICE_PRECISION }, strategy())).toBe(500n * PRICE_PRECISION)
	})
})

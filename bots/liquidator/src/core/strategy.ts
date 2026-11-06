import type { Address } from '@zoltar/bot-shared/ethereum'
import { ceilDiv } from '@zoltar/core-shared/math/bigint'
import { getLiquidationMigrationSecurityMultiplierBps } from '@zoltar/statoblast-shared/statoblast/liquidation'

const PRICE_PRECISION = 10n ** 18n
const BPS_DENOMINATOR = 10_000n

export type VaultPosition = {
	address: Address
	backingUnits: bigint
	badDebtAttoEth: bigint
	underwritingLimitAttoEth: bigint
	claimableFeesAttoEth: bigint
	/** Escrow still eligible for collateral, after source surplus accrual. */
	disputeStakedAttoRep: bigint
	openInterestAttoEth: bigint
	vaultAttoRepBacking: bigint
}

type PoolRiskContext = {
	address: Address
	denominator: bigint
	feeEligibleUnderwritingLimitAttoEth: bigint
	manager: Address
	minimumSecurityBondDebtAttoEth: bigint
	minimumVaultRepDepositAttoRep: bigint
	minLiquidationPriceDistanceBps: bigint
	multiplierBps: bigint
	price: bigint
	settlementCollateralAttoEth: bigint
	totalAttoRep: bigint
	totalUnderwritingLimitAttoEth: bigint
}

export type LiquidationCandidate = {
	bonusValueAttoEth: bigint
	underwritingLimitToMoveAttoEth: bigint
	debtToMoveAttoEth: bigint
	pool: PoolRiskContext
	priceDistanceBps: bigint
	requestedDebtAttoEth: bigint
	resultingHealthBps: bigint
	target: VaultPosition
	topUpAttoRep: bigint
	vaultAttoRepBackingToTransfer: bigint
}

function mulDivUp(left: bigint, right: bigint, denominator: bigint) {
	return ceilDiv(left * right, denominator)
}

export function vaultHealthBps(vaultAttoRepBacking: bigint, underwritingLimitAttoEth: bigint, multiplierBps: bigint, price: bigint, disputeStakedAttoRep = 0n) {
	if (underwritingLimitAttoEth === 0n || price === 0n) return undefined
	const baseRequiredAttoRep = mulDivUp(underwritingLimitAttoEth, price, PRICE_PRECISION)
	const associatedAtProtocolMinimum = mulDivUp(baseRequiredAttoRep, multiplierBps, BPS_DENOMINATOR)
	const freeAtProtocolMinimum = mulDivUp(baseRequiredAttoRep, getLiquidationMigrationSecurityMultiplierBps(multiplierBps), BPS_DENOMINATOR)
	const associatedHealth = associatedAtProtocolMinimum === 0n ? BPS_DENOMINATOR : ((vaultAttoRepBacking + disputeStakedAttoRep) * BPS_DENOMINATOR) / associatedAtProtocolMinimum
	const freeHealth = freeAtProtocolMinimum === 0n ? BPS_DENOMINATOR : (vaultAttoRepBacking * BPS_DENOMINATOR) / freeAtProtocolMinimum
	return associatedHealth < freeHealth ? associatedHealth : freeHealth
}

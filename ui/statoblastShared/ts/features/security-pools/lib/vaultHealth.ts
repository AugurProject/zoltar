import { ceilDiv } from '@zoltar/core-shared/math/bigint'
import { LIQUIDATION_BPS_DENOMINATOR, LIQUIDATION_PRICE_PRECISION } from '@zoltar/statoblast-shared/statoblast/liquidation'
import type { SecurityPoolVaultSummary } from '../../../types/contracts.js'
import { isVaultHealthyAtFactor } from './liquidation.js'

type VaultHealthInput = { multiplierBps: bigint | undefined; repPerEthPrice: bigint | undefined; vault: Pick<SecurityPoolVaultSummary, 'disputeStakedAttoRep' | 'underwritingLimitAttoEth' | 'vaultAttoRepBacking'> }

export type VaultHealthTier = 'underwater' | 'nearMinimum' | 'healthy' | 'unknown'

/** Backing plus dispute stake per unit of the REP the commitment requires at the given price, in basis points; undefined without a usable price or a commitment. */
export function getAssociatedRepPerCapacityBps({ disputeStakedAttoRep, repPerEthPrice, underwritingLimitAttoEth, vaultAttoRepBacking }: { disputeStakedAttoRep: bigint; repPerEthPrice: bigint | undefined; underwritingLimitAttoEth: bigint; vaultAttoRepBacking: bigint }) {
	const requiredBaseAttoRep = repPerEthPrice === undefined || repPerEthPrice <= 0n ? undefined : ceilDiv(underwritingLimitAttoEth * repPerEthPrice, LIQUIDATION_PRICE_PRECISION)
	return requiredBaseAttoRep === undefined || requiredBaseAttoRep === 0n ? undefined : ((vaultAttoRepBacking + disputeStakedAttoRep) * LIQUIDATION_BPS_DENOMINATOR) / requiredBaseAttoRep
}

/** A healthy vault within 5% of the security multiplier reads as near minimum; without a health verdict the tier is unknown. */
export function getVaultHealthTier({ associatedRepPerCapacityBps, isCurrentlyHealthy, multiplierBps }: { associatedRepPerCapacityBps: bigint | undefined; isCurrentlyHealthy: boolean | undefined; multiplierBps: bigint | undefined }): VaultHealthTier {
	if (isCurrentlyHealthy === false) return 'underwater'
	if (isCurrentlyHealthy !== true) return 'unknown'
	if (associatedRepPerCapacityBps !== undefined && multiplierBps !== undefined && associatedRepPerCapacityBps <= (multiplierBps * 105n) / 100n) return 'nearMinimum'
	return 'healthy'
}

/** Whether a vault meets the pool's security multiplier at the given price, the verdict every vault view shows; undefined without a usable price or multiplier. */
export function isVaultCurrentlyHealthy({ multiplierBps, repPerEthPrice, vault }: VaultHealthInput) {
	if (repPerEthPrice === undefined || repPerEthPrice <= 0n || multiplierBps === undefined) return undefined
	return isVaultHealthyAtFactor({
		disputeStakedAttoRep: vault.disputeStakedAttoRep,
		healthFactorBps: LIQUIDATION_BPS_DENOMINATOR,
		poolHeldVaultRepBackingAttoRep: vault.vaultAttoRepBacking,
		poolSecurityMultiplierBps: multiplierBps,
		repPerEthPrice,
		underwritingLimitAttoEth: vault.underwritingLimitAttoEth,
	})
}

/** A directory vault's health tier and backing ratio at the UI price estimate. */
export function getVaultSummaryHealth({ multiplierBps, repPerEthPrice, vault }: VaultHealthInput): { associatedRepPerCapacityBps: bigint | undefined; tier: VaultHealthTier } {
	const isCurrentlyHealthy = isVaultCurrentlyHealthy({ multiplierBps, repPerEthPrice, vault })
	if (isCurrentlyHealthy === undefined) return { associatedRepPerCapacityBps: undefined, tier: 'unknown' }
	const associatedRepPerCapacityBps = getAssociatedRepPerCapacityBps({ disputeStakedAttoRep: vault.disputeStakedAttoRep, repPerEthPrice, underwritingLimitAttoEth: vault.underwritingLimitAttoEth, vaultAttoRepBacking: vault.vaultAttoRepBacking })
	return { associatedRepPerCapacityBps, tier: getVaultHealthTier({ associatedRepPerCapacityBps, isCurrentlyHealthy, multiplierBps }) }
}

const RISK_RANK: Record<VaultHealthTier, number> = { underwater: 0, nearMinimum: 1, healthy: 2, unknown: 2 }

/** Orders vaults riskiest first; the sort is stable, so equal tiers keep their given order. */
export function sortByVaultHealthRisk<Item>(items: readonly Item[], getTier: (item: Item) => VaultHealthTier) {
	return [...items].sort((left, right) => RISK_RANK[getTier(left)] - RISK_RANK[getTier(right)])
}

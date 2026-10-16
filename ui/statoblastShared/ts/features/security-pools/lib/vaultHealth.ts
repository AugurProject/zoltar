import { LIQUIDATION_BPS_DENOMINATOR } from '@zoltar/statoblast-shared/statoblast/liquidation'
import type { SecurityPoolVaultSummary } from '../../../types/contracts.js'
import { getBaseRequiredRepAttoRep, isVaultHealthyAtFactor } from './liquidation.js'

type VaultHealthInput = { multiplierBps: bigint | undefined; repPerEthPrice: bigint | undefined; vault: Pick<SecurityPoolVaultSummary, 'disputeStakedAttoRep' | 'underwritingLimitAttoEth' | 'vaultAttoRepBacking'> }

export type VaultHealthTier = 'underwater' | 'nearMinimum' | 'healthy' | 'unknown'

/** Backing plus dispute stake per unit of the REP the commitment requires at the given price, in basis points; undefined without a usable price or a commitment. */
function getAssociatedRepPerCapacityBps({ disputeStakedAttoRep, repPerEthPrice, underwritingLimitAttoEth, vaultAttoRepBacking }: { disputeStakedAttoRep: bigint; repPerEthPrice: bigint | undefined; underwritingLimitAttoEth: bigint; vaultAttoRepBacking: bigint }) {
	const requiredBaseAttoRep = repPerEthPrice === undefined || repPerEthPrice <= 0n ? undefined : getBaseRequiredRepAttoRep(underwritingLimitAttoEth, repPerEthPrice)
	return requiredBaseAttoRep === undefined || requiredBaseAttoRep === 0n ? undefined : ((vaultAttoRepBacking + disputeStakedAttoRep) * LIQUIDATION_BPS_DENOMINATOR) / requiredBaseAttoRep
}

/**
 * A healthy vault within 5% of the security multiplier reads as near minimum; without a health verdict the tier is unknown.
 * @internal Exported for tests of the tier boundaries.
 */
export function getVaultHealthTier({ associatedRepPerCapacityBps, isCurrentlyHealthy, multiplierBps }: { associatedRepPerCapacityBps: bigint | undefined; isCurrentlyHealthy: boolean | undefined; multiplierBps: bigint | undefined }): VaultHealthTier {
	if (isCurrentlyHealthy === false) return 'underwater'
	if (isCurrentlyHealthy !== true) return 'unknown'
	if (associatedRepPerCapacityBps !== undefined && multiplierBps !== undefined && associatedRepPerCapacityBps <= (multiplierBps * 105n) / 100n) return 'nearMinimum'
	return 'healthy'
}

/** Whether a vault meets the pool's security multiplier at the given price; undefined without a usable price or multiplier. */
function isVaultCurrentlyHealthy({ multiplierBps, repPerEthPrice, vault }: VaultHealthInput) {
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

/** A vault's health tier and backing ratio at the UI price estimate, as every vault view shows them. After resolution liquidation is closed, so an ended pool's vaults carry neither. */
export function getVaultSummaryHealth({ multiplierBps, poolEnded, repPerEthPrice, vault }: VaultHealthInput & { poolEnded: boolean }): { associatedRepPerCapacityBps: bigint | undefined; tier: VaultHealthTier } {
	if (poolEnded) return { associatedRepPerCapacityBps: undefined, tier: 'unknown' }
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

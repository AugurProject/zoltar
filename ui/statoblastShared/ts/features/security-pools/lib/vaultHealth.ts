import { ceilDiv } from '@zoltar/core-shared/math/bigint'
import type { SecurityPoolVaultSummary } from '../../../types/contracts.js'
import { isVaultHealthyAtFactor } from './liquidation.js'

const BPS = 10_000n

export type VaultHealthTier = 'underwater' | 'nearMinimum' | 'healthy' | 'unknown'

/** Backing plus dispute stake per unit of the REP the commitment requires at the given price, in basis points; undefined without a usable price or a commitment. */
export function getAssociatedRepPerCapacityBps({ disputeStakedAttoRep, repPerEthPrice, underwritingLimitAttoEth, vaultAttoRepBacking }: { disputeStakedAttoRep: bigint; repPerEthPrice: bigint | undefined; underwritingLimitAttoEth: bigint; vaultAttoRepBacking: bigint }) {
	const requiredBaseAttoRep = repPerEthPrice === undefined || repPerEthPrice <= 0n ? undefined : ceilDiv(underwritingLimitAttoEth * repPerEthPrice, 10n ** 18n)
	return requiredBaseAttoRep === undefined || requiredBaseAttoRep === 0n ? undefined : ((vaultAttoRepBacking + disputeStakedAttoRep) * BPS) / requiredBaseAttoRep
}

/** A healthy vault within 5% of the security multiplier reads as near minimum; without a health verdict the tier is unknown. */
export function getVaultHealthTier({ associatedRepPerCapacityBps, isCurrentlyHealthy, multiplierBps }: { associatedRepPerCapacityBps: bigint | undefined; isCurrentlyHealthy: boolean | undefined; multiplierBps: bigint | undefined }): VaultHealthTier {
	if (isCurrentlyHealthy === false) return 'underwater'
	if (isCurrentlyHealthy !== true) return 'unknown'
	if (associatedRepPerCapacityBps !== undefined && multiplierBps !== undefined && associatedRepPerCapacityBps <= (multiplierBps * 105n) / 100n) return 'nearMinimum'
	return 'healthy'
}

/** A directory vault's health at the UI price estimate, by the same rules and price as the selected vault's verdict. */
export function getVaultSummaryHealth({ multiplierBps, repPerEthPrice, vault }: { multiplierBps: bigint | undefined; repPerEthPrice: bigint | undefined; vault: SecurityPoolVaultSummary }): { associatedRepPerCapacityBps: bigint | undefined; tier: VaultHealthTier } {
	if (repPerEthPrice === undefined || repPerEthPrice <= 0n || multiplierBps === undefined) return { associatedRepPerCapacityBps: undefined, tier: 'unknown' }
	const isCurrentlyHealthy = isVaultHealthyAtFactor({
		disputeStakedAttoRep: vault.disputeStakedAttoRep,
		healthFactorBps: BPS,
		poolHeldVaultRepBackingAttoRep: vault.vaultAttoRepBacking,
		poolSecurityMultiplierBps: multiplierBps,
		repPerEthPrice,
		underwritingLimitAttoEth: vault.underwritingLimitAttoEth,
	})
	const associatedRepPerCapacityBps = getAssociatedRepPerCapacityBps({ disputeStakedAttoRep: vault.disputeStakedAttoRep, repPerEthPrice, underwritingLimitAttoEth: vault.underwritingLimitAttoEth, vaultAttoRepBacking: vault.vaultAttoRepBacking })
	return { associatedRepPerCapacityBps, tier: getVaultHealthTier({ associatedRepPerCapacityBps, isCurrentlyHealthy, multiplierBps }) }
}

const RISK_RANK: Record<VaultHealthTier, number> = { underwater: 0, nearMinimum: 1, healthy: 2, unknown: 2 }

/** Orders vaults riskiest first; equal tiers keep their given order. */
export function sortByVaultHealthRisk<Item>(items: readonly Item[], getTier: (item: Item) => VaultHealthTier) {
	return items
		.map((item, index) => ({ index, item, rank: RISK_RANK[getTier(item)] }))
		.sort((left, right) => left.rank - right.rank || left.index - right.index)
		.map(entry => entry.item)
}

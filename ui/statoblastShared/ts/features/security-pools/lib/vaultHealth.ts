import { ceilDiv } from '@zoltar/core-shared/math/bigint'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import type { BadgeTone } from '@zoltar/ui-core-shared/types/components.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as workspaceCopy from '../../../copy/poolWorkspace.js'
import type { SecurityPoolVaultSummary } from '../../../types/contracts.js'
import { isVaultHealthyAtFactor } from './liquidation.js'

type VaultHealthStatus = 'healthy' | 'nearMinimum' | 'underwater' | 'unknown'

/** REP backing (pool-held plus dispute-staked) per unit of ETH commitment at the REP price, in basis points; undefined without a price or commitment. */
export function getAssociatedRepPerCapacityBps({ disputeStakedAttoRep, repPerEthPrice, underwritingLimitAttoEth, vaultAttoRepBacking }: { disputeStakedAttoRep: bigint; repPerEthPrice: bigint | undefined; underwritingLimitAttoEth: bigint; vaultAttoRepBacking: bigint }) {
	if (repPerEthPrice === undefined || repPerEthPrice <= 0n) return undefined
	const requiredBaseAttoRep = ceilDiv(underwritingLimitAttoEth * repPerEthPrice, 10n ** 18n)
	return requiredBaseAttoRep === 0n ? undefined : ((vaultAttoRepBacking + disputeStakedAttoRep) * 10_000n) / requiredBaseAttoRep
}

/** Underwater fails the protocol health check; a healthy vault within 5% of the pool multiplier is near its minimum. */
export function getVaultHealthStatus({ associatedRepPerCapacityBps, isCurrentlyHealthy, statoblastSecurityMultiplierBps }: { associatedRepPerCapacityBps: bigint | undefined; isCurrentlyHealthy: boolean | undefined; statoblastSecurityMultiplierBps: bigint | undefined }): VaultHealthStatus {
	if (isCurrentlyHealthy === undefined) return 'unknown'
	if (!isCurrentlyHealthy) return 'underwater'
	if (associatedRepPerCapacityBps !== undefined && statoblastSecurityMultiplierBps !== undefined && associatedRepPerCapacityBps <= (statoblastSecurityMultiplierBps * 105n) / 100n) return 'nearMinimum'
	return 'healthy'
}

/** A directory row's health at the selected pool's REP price, by the same check as the vault details view. */
export function getVaultSummaryHealthStatus({ repPerEthPrice, statoblastSecurityMultiplierBps, vault }: { repPerEthPrice: bigint | undefined; statoblastSecurityMultiplierBps: bigint | undefined; vault: SecurityPoolVaultSummary }) {
	if (repPerEthPrice === undefined || repPerEthPrice <= 0n || statoblastSecurityMultiplierBps === undefined) return 'unknown'
	return getVaultHealthStatus({
		associatedRepPerCapacityBps: getAssociatedRepPerCapacityBps({ disputeStakedAttoRep: vault.disputeStakedAttoRep, repPerEthPrice, underwritingLimitAttoEth: vault.underwritingLimitAttoEth, vaultAttoRepBacking: vault.vaultAttoRepBacking }),
		isCurrentlyHealthy: isVaultHealthyAtFactor({
			disputeStakedAttoRep: vault.disputeStakedAttoRep,
			healthFactorBps: 10_000n,
			poolHeldVaultRepBackingAttoRep: vault.vaultAttoRepBacking,
			poolSecurityMultiplierBps: statoblastSecurityMultiplierBps,
			repPerEthPrice,
			underwritingLimitAttoEth: vault.underwritingLimitAttoEth,
		}),
		statoblastSecurityMultiplierBps,
	})
}

export function getVaultHealthPresentation(status: VaultHealthStatus): { label: string; tone: BadgeTone } {
	switch (status) {
		case 'healthy':
			return { label: securityPoolCopy.vaultHealthHealthy, tone: 'ok' }
		case 'nearMinimum':
			return { label: securityPoolCopy.vaultHealthNearMinimum, tone: 'warning' }
		case 'underwater':
			return { label: securityPoolCopy.vaultHealthUnderwater, tone: 'danger' }
		case 'unknown':
			return { label: workspaceCopy.healthUnknown, tone: 'muted' }
		default:
			return assertNever(status)
	}
}

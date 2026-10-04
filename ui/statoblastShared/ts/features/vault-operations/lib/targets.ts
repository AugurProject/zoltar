import { getDeterministicLiquidationFailureReason, getMaxLiquidationAmount } from '../../security-pools/lib/liquidation.js'
import type { ListedSecurityPool, SecurityPoolVaultSummary, SecurityVaultDetails } from '../../../types/contracts.js'
import type { VaultOperationsInput } from '@zoltar/statoblast-shared/statoblast/vaultOperations'
import * as copy from '../../../copy/vaultOperations.js'
import * as liquidationCopy from '../../../copy/liquidation.js'

export function getVaultOperationsTargetState(pool: ListedSecurityPool, owned: SecurityVaultDetails | undefined, target: SecurityPoolVaultSummary, input: VaultOperationsInput | undefined, price: bigint, minLiquidationPriceDistanceBps: bigint | undefined) {
	if (target.vaultAttoRepBacking <= 0n) return { maximum: 0n, reason: copy.targetNoBacking }
	if (target.underwritingLimitAttoEth <= 0n) return { maximum: 0n, reason: liquidationCopy.targetHasNoCommitmentReason }
	if (owned === undefined || minLiquidationPriceDistanceBps === undefined) return { maximum: undefined, reason: copy.loading }
	if (price <= 0n) return { maximum: undefined, reason: copy.targetPriceNeeded }
	const receiver = { ...owned, vaultAttoRepBacking: owned.vaultAttoRepBacking + (input?.depositAttoRep ?? 0n), underwritingLimitAttoEth: input?.changeCommitment ? input.commitmentAttoEth : owned.underwritingLimitAttoEth }
	const maximum = getMaxLiquidationAmount({ minLiquidationPriceDistanceBps, repPerEthPrice: price, statoblastSecurityMultiplierBps: pool.statoblastSecurityMultiplierBps, targetVaultSummary: target })
	const reason = getDeterministicLiquidationFailureReason({
		callerVaultSummary: receiver,
		requestedDebtAttoEth: target.underwritingLimitAttoEth,
		maxLiquidationDebtAttoEth: maximum,
		minLiquidationPriceDistanceBps,
		minimumSecurityBondDebtAttoEth: owned.minimumSecurityBondDebtAttoEth,
		minimumVaultRepDepositAttoRep: owned.minimumVaultRepDepositAttoRep,
		repPerEthPrice: price,
		statoblastSecurityMultiplierBps: pool.statoblastSecurityMultiplierBps,
		targetVaultSummary: target,
		totalUnderwritingLimitAttoEth: owned.totalUnderwritingLimitAttoEth - owned.underwritingLimitAttoEth + receiver.underwritingLimitAttoEth,
		settlementCollateralAttoEth: pool.settlementCollateralAttoEth,
	})
	return { maximum, reason }
}

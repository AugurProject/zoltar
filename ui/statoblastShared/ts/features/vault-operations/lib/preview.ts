import type { VaultOperationsInput } from '@zoltar/statoblast-shared/statoblast/vaultOperations'
import { getLiquidationFailureReason, simulateLiquidation } from '../../security-pools/lib/liquidation.js'
import type { ListedSecurityPool, SecurityPoolVaultSummary, SecurityVaultDetails } from '../../../types/contracts.js'
import { getSecurityVaultWithdrawableRepAmount, getVaultBackingFactorAdjustmentGuard } from '../../security-pools/lib/securityVault.js'
import * as copy from '../../../copy/vaultOperations.js'
import * as liquidationCopy from '../../../copy/liquidation.js'

export function previewVaultOperations(pool: ListedSecurityPool, owned: SecurityVaultDetails, targets: SecurityPoolVaultSummary[], input: VaultOperationsInput, price: bigint, minLiquidationPriceDistanceBps?: bigint, isPriceValid = true) {
	let receiver: SecurityPoolVaultSummary = {
		vaultAddress: owned.vaultAddress,
		vaultAttoRepBacking: owned.vaultAttoRepBacking + input.depositAttoRep,
		underwritingLimitAttoEth: input.changeCommitment ? input.commitmentAttoEth : owned.underwritingLimitAttoEth,
		disputeStakedAttoRep: owned.disputeStakedAttoRep,
		claimableFeesAttoEth: owned.claimableFeesAttoEth,
		badDebtAttoEth: owned.badDebtAttoEth,
	}
	if (input.changeCommitment) {
		const reason = getVaultBackingFactorAdjustmentGuard(
			{ ...owned, vaultAttoRepBacking: receiver.vaultAttoRepBacking, totalUnderwritingLimitAttoEth: pool.totalUnderwritingLimitAttoEth, settlementCollateralAttoEth: pool.settlementCollateralAttoEth },
			input.commitmentAttoEth,
			isPriceValid ? price : undefined,
			pool.statoblastSecurityMultiplierBps,
		)
		if (reason !== undefined) throw new Error(reason)
	}
	const totalLimit = pool.totalUnderwritingLimitAttoEth - owned.underwritingLimitAttoEth + receiver.underwritingLimitAttoEth
	for (const selected of input.liquidations) {
		if (selected.requestedDebtAttoEth <= 0n) throw new Error(liquidationCopy.liquidationAmountRequired)
		const target = targets.find(candidate => candidate.vaultAddress.toLowerCase() === selected.targetVault.toLowerCase())
		if (target === undefined) throw new Error(copy.targetUnavailable)
		if (target.vaultAttoRepBacking <= 0n) throw new Error(copy.targetNoBacking)
		const parameters = {
			callerVaultSummary: receiver,
			requestedDebtAttoEth: selected.requestedDebtAttoEth,
			totalUnderwritingLimitAttoEth: totalLimit,
			minimumVaultRepDepositAttoRep: owned.minimumVaultRepDepositAttoRep ?? 0n,
			repPerEthPrice: price,
			settlementCollateralAttoEth: pool.settlementCollateralAttoEth,
			statoblastSecurityMultiplierBps: pool.statoblastSecurityMultiplierBps,
			targetVaultSummary: target,
			minLiquidationPriceDistanceBps,
			minimumSecurityBondDebtAttoEth: owned.minimumSecurityBondDebtAttoEth,
			minimumReceiverHealthFactorBps: input.minimumReceiverHealthFactorBps,
		}
		const reason = getLiquidationFailureReason(parameters)
		if (reason !== undefined) throw new Error(reason)
		const transfer = simulateLiquidation(parameters)
		receiver = { ...receiver, ...transfer.callerAfter }
	}
	const withdrawable = getSecurityVaultWithdrawableRepAmount({
		vaultAttoRepBacking: receiver.vaultAttoRepBacking,
		disputeStakedAttoRep: receiver.disputeStakedAttoRep,
		underwritingLimitAttoEth: receiver.underwritingLimitAttoEth,
		repPerEthPrice: price,
		statoblastSecurityMultiplierBps: pool.statoblastSecurityMultiplierBps,
		totalPoolHeldAttoRep: (owned.totalPoolHeldRepBalanceAttoRep ?? pool.totalPoolHeldAttoRep) + input.depositAttoRep,
		totalUnderwritingLimitAttoEth: totalLimit,
		minimumVaultRepDepositAttoRep: owned.minimumVaultRepDepositAttoRep,
	})
	if (input.withdrawAttoRep > 0n) {
		if (receiver.disputeStakedAttoRep > 0n) throw new Error(copy.withdrawEscrow)
		if (isPriceValid && withdrawable !== undefined && input.withdrawAttoRep > withdrawable) throw new Error(copy.withdrawCoverage)
	}
	const afterRequestedWithdrawal = receiver.vaultAttoRepBacking - input.withdrawAttoRep
	const backing = input.withdrawAttoRep > 0n && afterRequestedWithdrawal < (owned.minimumVaultRepDepositAttoRep ?? 0n) ? 0n : afterRequestedWithdrawal
	return { backing, withdrawable, commitment: receiver.underwritingLimitAttoEth }
}

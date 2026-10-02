import type { VaultOperationsInput } from '@zoltar/statoblast-shared/statoblast/vaultOperations'
import { simulateLiquidation } from '../../security-pools/lib/liquidation.js'
import type { ListedSecurityPool, SecurityPoolVaultSummary, SecurityVaultDetails } from '../../../types/contracts.js'

export function previewVaultOperations(pool: ListedSecurityPool, owned: SecurityVaultDetails, targets: SecurityPoolVaultSummary[], input: VaultOperationsInput, price: bigint) {
	let receiver: SecurityPoolVaultSummary = {
		vaultAddress: owned.vaultAddress,
		vaultAttoRepBacking: owned.vaultAttoRepBacking + input.depositAttoRep,
		underwritingLimitAttoEth: input.changeCommitment ? input.commitmentAttoEth : owned.underwritingLimitAttoEth,
		disputeStakedAttoRep: owned.disputeStakedAttoRep,
		claimableFeesAttoEth: owned.claimableFeesAttoEth,
	}
	const totalLimit = pool.totalUnderwritingLimitAttoEth - owned.underwritingLimitAttoEth + receiver.underwritingLimitAttoEth
	for (const selected of input.liquidations) {
		const target = targets.find(candidate => candidate.vaultAddress.toLowerCase() === selected.targetVault.toLowerCase())
		if (target === undefined) throw new Error('A selected liquidation target is still loading.')
		const transfer = simulateLiquidation({
			callerVaultSummary: receiver,
			requestedDebtAttoEth: selected.requestedDebtAttoEth,
			totalUnderwritingLimitAttoEth: totalLimit,
			minimumVaultRepDepositAttoRep: owned.minimumVaultRepDepositAttoRep ?? 0n,
			repPerEthPrice: price,
			settlementCollateralAttoEth: pool.settlementCollateralAttoEth,
			statoblastSecurityMultiplierBps: pool.statoblastSecurityMultiplierBps,
			targetVaultSummary: target,
		})
		receiver = { ...receiver, ...transfer.callerAfter }
	}
	const afterRequestedWithdrawal = receiver.vaultAttoRepBacking - input.withdrawAttoRep
	const backing = input.withdrawAttoRep > 0n && afterRequestedWithdrawal < (owned.minimumVaultRepDepositAttoRep ?? 0n) ? 0n : afterRequestedWithdrawal
	return { backing, commitment: receiver.underwritingLimitAttoEth }
}

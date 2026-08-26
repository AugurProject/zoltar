import { paddedTransactionGas } from '@zoltar/bot-shared/execution/transaction-submission'
import type { StrategySettings } from '../config/settings.ts'
import type { OperationPlan, OperationStep } from '../operations/types.ts'

export const MINIMUM_DEADLINE_SAFETY_SECONDS = 60n

export function unsignedQuantity(value: string | undefined, label: string, fallback = 0n) {
	if (value === undefined) return fallback
	if (!/^(?:0|[1-9]\d*)$/.test(value)) throw new Error(`${label} must be an unsigned integer`)
	return BigInt(value)
}

export function maximumFeePerGas(baseFeePerGas: bigint) {
	if (baseFeePerGas < 0n) throw new Error('Block base fee cannot be negative')
	return baseFeePerGas * 2n + 2n * 10n ** 9n
}

export function transactionGasCeiling(gasEstimate: bigint, baseFeePerGas: bigint) {
	if (gasEstimate <= 0n) throw new Error('Gas estimate must be positive')
	return paddedTransactionGas(gasEstimate) * maximumFeePerGas(baseFeePerGas)
}

export function assertOperationPlanFresh(plan: Pick<OperationPlan, 'createdAtBlock' | 'id' | 'steps'>, currentBlock: bigint, validForBlocks: bigint) {
	const createdAtBlock = unsignedQuantity(plan.createdAtBlock, `${plan.id} creation block`)
	if (validForBlocks <= 0n) throw new Error('Workflow validity must be positive')
	if (createdAtBlock > currentBlock) throw new Error(`${plan.id} was planned at a future block`)
	if (currentBlock - createdAtBlock > validForBlocks) throw new Error(`${plan.id} expired before execution`)
	if (plan.steps.length === 0) throw new Error(`${plan.id} has no executable steps`)
	const stepIds = new Set(plan.steps.map(step => step.id))
	if (stepIds.size !== plan.steps.length) throw new Error(`${plan.id} contains duplicate step identifiers`)
}

export function operationSubmissionLastValidBlock(plan: Pick<OperationPlan, 'deadlineTimestamp' | 'id' | 'lastValidBlockNumber'>, currentBlock: bigint, currentTimestamp: bigint, mode: 'private' | 'public') {
	const lastValidBlockNumber = plan.lastValidBlockNumber === undefined ? undefined : unsignedQuantity(plan.lastValidBlockNumber, `${plan.id} last valid block`)
	const deadlineTimestamp = plan.deadlineTimestamp === undefined ? undefined : unsignedQuantity(plan.deadlineTimestamp, `${plan.id} deadline timestamp`)
	if (mode === 'public' && (lastValidBlockNumber !== undefined || deadlineTimestamp !== undefined)) {
		throw new Error(`${plan.id} is deadline-bound and requires private submission`)
	}
	if (lastValidBlockNumber !== undefined && currentBlock >= lastValidBlockNumber) {
		throw new Error(`${plan.id} block deadline expired before signing`)
	}
	if (deadlineTimestamp !== undefined && currentTimestamp + MINIMUM_DEADLINE_SAFETY_SECONDS >= deadlineTimestamp) {
		throw new Error(`${plan.id} timestamp deadline is too close for safe signing`)
	}
	if (deadlineTimestamp === undefined) return lastValidBlockNumber
	const nextBlockOnly = currentBlock + 1n
	return lastValidBlockNumber === undefined || nextBlockOnly < lastValidBlockNumber ? nextBlockOnly : lastValidBlockNumber
}

export function assertOperationPrincipalCaps(plan: Pick<OperationPlan, 'id' | 'steps'>, strategy: Pick<StrategySettings, 'maximumEthPerOperationAttoEth' | 'maximumRepPerOperationAttoRep'>) {
	let nativeDebit = 0n
	let repDebit = 0n
	for (const step of plan.steps) {
		let declaredNativeDebit = 0n
		for (const debit of step.walletAssetDebits) {
			const debitAmount = unsignedQuantity(debit.amount, `${step.label} ${debit.kind} wallet debit`)
			if (debitAmount === 0n) {
				throw new Error(`${step.label} wallet debits must be positive`)
			}
			if (debit.kind === 'native') {
				declaredNativeDebit += debitAmount
				nativeDebit += debitAmount
			} else if (debit.kind === 'erc20' || debit.kind === 'open-oracle-credit') {
				if (debit.category === 'rep') repDebit += debitAmount
				else if (debit.category === 'weth' || (debit.kind === 'open-oracle-credit' && debit.asset === 'ETH')) nativeDebit += debitAmount
			}
		}
		const transactionValue = unsignedQuantity(step.value, `${step.label} value`)
		if (declaredNativeDebit !== transactionValue) {
			throw new Error(`${step.label} native wallet debit does not match its transaction value`)
		}
	}
	if (nativeDebit > strategy.maximumEthPerOperationAttoEth) {
		throw new Error(`${plan.id} exceeds strategy.maximumEthPerOperation across its ETH and WETH principal`)
	}
	if (repDebit > strategy.maximumRepPerOperationAttoRep) {
		throw new Error(`${plan.id} exceeds strategy.maximumRepPerOperation across its workflow`)
	}
	return { nativeDebit, repDebit }
}

export function assertStepSafety(parameters: { baseFeePerGas: bigint; ethBalanceAttoEth: bigint; gasEstimate: bigint; step: OperationStep; strategy: Pick<StrategySettings, 'maximumEthPerOperationAttoEth' | 'maximumGasCostAttoEth' | 'minimumEthReserveAttoEth'> }) {
	const value = unsignedQuantity(parameters.step.value, `${parameters.step.label} value`)
	if (value > parameters.strategy.maximumEthPerOperationAttoEth) {
		throw new Error(`${parameters.step.label} value exceeds strategy.maximumEthPerOperation`)
	}
	const paddedGas = paddedTransactionGas(parameters.gasEstimate)
	const declaredGasLimit = unsignedQuantity(parameters.step.gasLimit, `${parameters.step.label} gas limit`, paddedGas)
	if (paddedGas > declaredGasLimit) {
		throw new Error(`${parameters.step.label} padded gas estimate exceeds its planned gas limit`)
	}
	const maximumGasCost = transactionGasCeiling(parameters.gasEstimate, parameters.baseFeePerGas)
	if (maximumGasCost > parameters.strategy.maximumGasCostAttoEth) {
		throw new Error(`${parameters.step.label} estimated gas ceiling exceeds strategy.maximumGasCostEth`)
	}
	const requiredBalance = parameters.strategy.minimumEthReserveAttoEth + value + maximumGasCost
	if (parameters.ethBalanceAttoEth < requiredBalance) {
		throw new Error(`${parameters.step.label} would breach the wallet ETH reserve`)
	}
	return { maximumGasCost, paddedGas, value }
}

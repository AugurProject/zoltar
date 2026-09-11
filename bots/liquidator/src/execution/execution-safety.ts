import { type StrategySettings } from '#config/settings'
import { BPS_DENOMINATOR, type LiquidationCandidate, requiredRepForOpenInterest, surplusRepForWithdrawal, vaultHealthBps } from '#core/strategy'
import type { finalizedReceiptWithQuorum } from '#execution/recovery'
import { type PoolObservation, type RuntimeState } from '#state/operator-state'
import { type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import { maximumFeePerGas, paddedTransactionGas } from '@zoltar/bot-shared/execution/transaction-submission'

const MAX_UINT256 = 2n ** 256n - 1n

const shutdownChecks = new WeakMap<object, () => boolean>()

export class TransactionAwaitingCanonicalFinality extends Error {
	readonly hash: Hex

	constructor(label: string, hash: Hex) {
		super(`${label} transaction ${hash} is awaiting canonical finality`)
		this.name = 'TransactionAwaitingCanonicalFinality'
		this.hash = hash
	}
}

export class OperatorStopping extends Error {
	constructor() {
		super('Operator stopping before transaction submission')
		this.name = 'OperatorStopping'
	}
}

export function requireFinalizedTransactionReceipt(label: string, hash: Hex, result: Awaited<ReturnType<typeof finalizedReceiptWithQuorum>>) {
	if (result.receipt !== undefined) return result.receipt
	if (!result.observed) throw new Error(`${label} receipt disappeared before canonical finality`)
	throw new TransactionAwaitingCanonicalFinality(label, hash)
}

function assertGasCostLimit(gasEstimate: bigint, maxFeePerGas: bigint, maximumGasCost: bigint, label = 'Transaction') {
	if (maxFeePerGas * paddedTransactionGas(gasEstimate) > maximumGasCost) {
		throw new Error(`${label} estimated gas ceiling exceeds strategy.maximumGasCostAttoEth`)
	}
}

export function assertGasCostLimitForBaseFee(gasEstimate: bigint, baseFeePerGas: bigint, maximumGasCost: bigint, label = 'Transaction') {
	assertGasCostLimit(gasEstimate, maximumFeePerGas(baseFeePerGas), maximumGasCost, label)
}

export function assertExecutionActive(state: Pick<RuntimeState, 'paused'>) {
	assertOperatorNotStopping(state)
	if (state.paused) throw new Error('Operator paused before transaction submission')
}

export function assertOperatorNotStopping(state: Pick<RuntimeState, 'paused'>) {
	if (shutdownChecks.get(state)?.() ?? false) throw new OperatorStopping()
}

export function setExecutionShutdownCheck(state: RuntimeState, isRequested: () => boolean) {
	shutdownChecks.set(state, isRequested)
}

export async function assertMarketPriceStillAllowed(priceStillAllowed: () => boolean | Promise<boolean>) {
	if (!(await priceStillAllowed())) throw new Error('Market consensus expired or no longer confirms the price before transaction submission')
}

export function assertRepLimits(parameters: { acquiredAmountAttoRep?: bigint | undefined; currentPoolAttoRep: bigint; currentTotalAttoRep: bigint; depositAmountAttoRep: bigint; maximumPoolAttoRep: bigint; maximumTotalAttoRep: bigint }) {
	const acquiredAmountAttoRep = parameters.acquiredAmountAttoRep ?? 0n
	if (parameters.currentPoolAttoRep + parameters.depositAmountAttoRep + acquiredAmountAttoRep > parameters.maximumPoolAttoRep) {
		throw new Error('REP deployment would exceed strategy.maximumAttoRepPerPool')
	}
	if (parameters.currentTotalAttoRep + parameters.depositAmountAttoRep + acquiredAmountAttoRep > parameters.maximumTotalAttoRep) {
		throw new Error('REP deployment would exceed strategy.maximumTotalDeployedRep')
	}
}

export function liquidationExecutionStep(topUpAttoRep: bigint) {
	if (topUpAttoRep === 0n) return { kind: 'stage' as const }
	const capacityOwnershipAddedAttoRep = (topUpAttoRep * BPS_DENOMINATOR) / MAX_UINT256
	if (capacityOwnershipAddedAttoRep !== 0n) {
		throw new Error('Liquidation top-up is too large for a backing-only deposit')
	}
	return { kind: 'deposit-and-rescreen' as const, targetHealthFactorBps: MAX_UINT256 }
}

export function conservativeStaleTopUp(parameters: { callerDisputeStakedAttoRep?: bigint; callerOpenInterestAttoEth: bigint; callerAttoRep: bigint; requestedDebtAttoEth: bigint; fallbackPrice: bigint; minimumTopUp: bigint; multiplierBps: bigint; referencePrice: bigint; safetyBps: bigint; targetHealthBps: bigint }) {
	const referencePrice = parameters.referencePrice > 0n ? parameters.referencePrice : parameters.fallbackPrice
	if (referencePrice === 0n) throw new Error('Stale unseeded oracle requires strategy.fallbackRepPerEthPrice')
	const bufferedPrice = (referencePrice * parameters.safetyBps + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR
	const requiredAttoRep = requiredRepForOpenInterest(parameters.callerOpenInterestAttoEth + parameters.requestedDebtAttoEth, parameters.multiplierBps, bufferedPrice, parameters.targetHealthBps, parameters.callerDisputeStakedAttoRep ?? 0n)
	const conservativeTopUp = requiredAttoRep > parameters.callerAttoRep ? requiredAttoRep - parameters.callerAttoRep : 0n
	return conservativeTopUp > parameters.minimumTopUp ? conservativeTopUp : parameters.minimumTopUp
}

export function assertStaleLiquidationExposureBound(candidate: Pick<LiquidationCandidate, 'requestedDebtAttoEth' | 'target'>) {
	if (candidate.requestedDebtAttoEth >= candidate.target.openInterestAttoEth) {
		throw new Error('Stale full-close liquidation cannot guarantee the configured REP exposure limits')
	}
}

type VaultMaintenancePlan = { amountAttoRep: bigint; kind: 'deposit' | 'withdraw' } | { kind: 'fees' } | undefined

export function planVaultMaintenance(
	pool: Pick<PoolObservation, 'botVault' | 'isPriceValid' | 'lastPrice' | 'minimumVaultRepDepositAttoRep' | 'multiplierBps'>,
	strategy: Pick<StrategySettings, 'allowAutomaticWithdrawals' | 'minimumRepWithdrawalAttoRep' | 'redeemFeesAboveAttoEth' | 'vaultTargetHealthBps' | 'vaultTopUpHealthBps' | 'vaultWithdrawHealthBps'>,
	walletAddress: Address,
	priceDependentMaintenanceAllowed: boolean,
	prioritizeLiquidationCandidate = false,
): VaultMaintenancePlan {
	if (priceDependentMaintenanceAllowed && pool.lastPrice > 0n) {
		const health = vaultHealthBps(pool.botVault.vaultAttoRepBacking, pool.botVault.openInterestAttoEth, pool.multiplierBps, pool.lastPrice, pool.botVault.disputeStakedAttoRep)
		if (pool.botVault.openInterestAttoEth > 0n && health !== undefined && health < strategy.vaultTopUpHealthBps) {
			const targetAttoRep = requiredRepForOpenInterest(pool.botVault.openInterestAttoEth, pool.multiplierBps, pool.lastPrice, strategy.vaultTargetHealthBps, pool.botVault.disputeStakedAttoRep)
			return { amountAttoRep: targetAttoRep > pool.botVault.vaultAttoRepBacking ? targetAttoRep - pool.botVault.vaultAttoRepBacking : 0n, kind: 'deposit' }
		}
		if (!prioritizeLiquidationCandidate && strategy.allowAutomaticWithdrawals && pool.isPriceValid && pool.botVault.address.toLowerCase() === walletAddress.toLowerCase()) {
			const surplusAttoRep = surplusRepForWithdrawal(pool.botVault, { minimumVaultRepDepositAttoRep: pool.minimumVaultRepDepositAttoRep, multiplierBps: pool.multiplierBps, price: pool.lastPrice }, strategy)
			if (surplusAttoRep > 0n) return { amountAttoRep: surplusAttoRep, kind: 'withdraw' }
		}
	}
	if (pool.botVault.claimableFeesAttoEth > 0n && pool.botVault.claimableFeesAttoEth >= strategy.redeemFeesAboveAttoEth) return { kind: 'fees' }
	return undefined
}

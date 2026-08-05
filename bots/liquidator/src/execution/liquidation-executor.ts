import { createPublicClient, encodeFunctionData, http, type Account, type Address, type Chain, type Hex, type Transport, type WalletClient } from '@zoltar/bot-shared/ethereum'
import { paddedTransactionGas, prepareSignedTransaction, submitSignedTransaction } from '@zoltar/bot-shared/execution/transaction-submission'
import { sendRawTransactionToRpc } from '@zoltar/bot-shared/monitoring/connectivity'
import { quorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import type { DesiredPoolSettings, OperatorSettings, StrategySettings } from '#config/settings'
import { coordinatorAbi, erc20Abi, securityPoolAbi, securityPoolFactoryAbi, securityPoolForkerAbi, wethAbi } from '#contracts/abi'
import { isPoolExecutionEligible, type VaultMigration } from '#core/fork-migration'
import { BPS_DENOMINATOR, LIQUIDATION_REP_BONUS_BPS, PRICE_PRECISION, conservativeLiquidationRep, requiredRepForCoverageCommitment, surplusRepForWithdrawal, vaultHealthBps, type LiquidationCandidate } from '#core/strategy'
import { recordActivity, saveDurableState, type PendingTransactionIntent, type PoolObservation, type RuntimeState } from '#state/operator-state'
import { validateReceiptExpectation } from '#execution/receipt-validation'
import { finalizedReceiptWithQuorum } from '#execution/recovery'

export { requirePendingStagedOperation, requireSuccessfulStagedOperation, validateReceiptExpectation } from '#execution/receipt-validation'

type WriteClient = WalletClient<Transport, Chain, Account>

type Call = {
	data: Hex
	gas: bigint
	label: string
	preSubmit?: (() => Promise<unknown> | unknown) | undefined
	receiptExpectation?: PendingTransactionIntent['receiptExpectation'] | undefined
	to: Address
	value?: bigint | undefined
}

export class TransactionAwaitingCanonicalFinality extends Error {
	readonly hash: Hex

	constructor(label: string, hash: Hex) {
		super(`${label} transaction ${hash} is awaiting canonical finality`)
		this.name = 'TransactionAwaitingCanonicalFinality'
		this.hash = hash
	}
}

export function requireFinalizedTransactionReceipt(label: string, hash: Hex, result: Awaited<ReturnType<typeof finalizedReceiptWithQuorum>>) {
	if (result.receipt !== undefined) return result.receipt
	if (!result.observed) throw new Error(`${label} receipt disappeared before canonical finality`)
	throw new TransactionAwaitingCanonicalFinality(label, hash)
}

function maximumFeePerGas(baseFeePerGas: bigint) {
	return baseFeePerGas * 2n + 2n * 10n ** 9n
}

export function assertGasCostLimit(gasEstimate: bigint, maxFeePerGas: bigint, maximumGasCost: bigint, label = 'Transaction') {
	if (maxFeePerGas * paddedTransactionGas(gasEstimate) > maximumGasCost) {
		throw new Error(`${label} estimated gas ceiling exceeds strategy.maximumGasCostAttoEth`)
	}
}

export function assertExecutionActive(state: Pick<RuntimeState, 'paused'>) {
	if (state.paused) throw new Error('Operator paused before transaction submission')
}

export async function assertMarketPriceStillAllowed(priceStillAllowed: () => boolean | Promise<boolean>) {
	if (!(await priceStillAllowed())) throw new Error('Market consensus expired or no longer confirms the price before transaction submission')
}

async function submitCall(wallet: WriteClient, settings: OperatorSettings, state: RuntimeState, call: Call, kind: PendingTransactionIntent['kind']) {
	assertExecutionActive(state)
	const account = wallet.account
	if (account.signTransaction === undefined || account.signMessage === undefined) {
		throw new Error('Execution signer cannot sign transactions')
	}
	const block = await wallet.getBlock()
	if (block.number === undefined || block.baseFeePerGas === undefined) {
		throw new Error('Latest block is missing number or base fee')
	}
	assertExecutionActive(state)
	assertGasCostLimit(call.gas, maximumFeePerGas(block.baseFeePerGas), settings.strategy.maximumGasCostAttoEth, call.label)
	await wallet.call({
		account,
		data: call.data,
		gas: call.gas,
		to: call.to,
		value: call.value,
	})
	assertExecutionActive(state)
	recordActivity(state, {
		details: `to=${call.to} data=${call.data} value=${(call.value ?? 0n).toString()}`,
		kind,
		message: `Preparing: ${call.label}`,
		status: 'info',
	})
	await saveDurableState(settings.runtime.stateFile, state)
	const nonce = await agreedPendingNonce(wallet, settings, account.address)
	assertExecutionActive(state)
	const signed = await prepareSignedTransaction({
		baseFeePerGas: block.baseFeePerGas,
		blockNumber: block.number,
		chainId: settings.network.chainId,
		data: call.data,
		from: account.address,
		gasEstimate: call.gas,
		nonce,
		signTransaction: account.signTransaction,
		to: call.to,
		value: call.value,
	})
	await call.preSubmit?.()
	state.pendingTransactions.push({
		hash: signed.hash,
		kind,
		label: call.label,
		maxBlockNumber: signed.maxBlockNumber,
		mode: settings.submission.mode,
		nonce: signed.transaction.nonce,
		receiptExpectation: call.receiptExpectation ?? { type: 'transaction' },
		requiresMarketEvidence: call.preSubmit !== undefined,
		sender: account.address,
		serializedTransaction: signed.serializedTransaction,
		submissionBlock: block.number,
	})
	recordActivity(state, {
		hash: signed.hash,
		kind,
		message: `Signed intent persisted: ${call.label}`,
		status: 'pending',
	})
	await saveDurableState(settings.runtime.stateFile, state)
	assertExecutionActive(state)
	try {
		await call.preSubmit?.()
	} catch (error) {
		state.pendingTransactions = state.pendingTransactions.filter(intent => intent.hash.toLowerCase() !== signed.hash.toLowerCase())
		recordActivity(state, {
			hash: signed.hash,
			kind,
			message: `Persisted intent abandoned after final market check: ${call.label}`,
			status: 'failed',
		})
		await saveDurableState(settings.runtime.stateFile, state)
		throw error
	}
	await submitSignedTransaction({
		address: account.address,
		hash: signed.hash,
		maxBlockNumber: signed.maxBlockNumber,
		publicRpcUrls: settings.connectivity.publicRpcUrls,
		publicSubmit: sendRawTransactionToRpc,
		serializedTransaction: signed.serializedTransaction,
		settings: settings.submission,
		signMessage: account.signMessage,
	})
	const hash: Hex = signed.hash
	await wallet.waitForTransactionReceipt({
		hash,
		pollingInterval: Math.min(settings.runtime.pollMilliseconds, 5_000),
		timeout: 180_000,
	})
	const receiptResult = await finalizedReceiptWithQuorum(settings, wallet, hash)
	const receipt = requireFinalizedTransactionReceipt(call.label, hash, receiptResult)
	if (receipt.status !== 'success') {
		throw new Error(`${call.label} reverted in transaction ${receipt.transactionHash}`)
	}
	const receiptOutcome = validateReceiptExpectation(receipt, call.receiptExpectation ?? { type: 'transaction' })
	if (receiptOutcome.queuedOperationId !== undefined && call.receiptExpectation?.type === 'pending-liquidation') {
		state.pendingStagedOperations.push({
			coordinator: call.receiptExpectation.coordinator,
			operationId: receiptOutcome.queuedOperationId,
			queuedBlock: receipt.blockNumber,
			target: call.receiptExpectation.target,
		})
	}
	state.pendingTransactions = state.pendingTransactions.filter(intent => intent.hash.toLowerCase() !== receipt.transactionHash.toLowerCase())
	recordActivity(state, {
		hash: receipt.transactionHash,
		kind,
		message: call.label,
		status: 'confirmed',
	})
	await saveDurableState(settings.runtime.stateFile, state)
	return receipt.transactionHash
}

export async function executeOriginPoolDeployment(wallet: WriteClient, settings: OperatorSettings, state: RuntimeState, desired: DesiredPoolSettings) {
	if (!settings.strategy.allowAutomaticPoolCreation) throw new Error('Automatic origin-pool creation is disabled')
	if (!settings.approvedUniverses.includes(desired.universeId)) throw new Error('Desired origin pool universe is not approved')
	return submitCall(
		wallet,
		settings,
		state,
		{
			data: encodeFunctionData({
				abi: securityPoolFactoryAbi,
				args: [desired.universeId, desired.questionId, desired.statoblastSecurityMultiplierBps, desired.initialReportPriorityFeeAttoEthPerGas],
				functionName: 'deployOriginSecurityPool',
			}),
			gas: 7_000_000n,
			label: `Deploy origin security pool for question ${desired.questionId.toString()} in universe ${desired.universeId.toString()}`,
			to: settings.deployment.securityPoolFactory,
		},
		'deployment',
	)
}

export async function executeVaultMigration(wallet: WriteClient, settings: OperatorSettings, state: RuntimeState, migration: VaultMigration) {
	if (migration.parent.systemState !== 1n) throw new Error('Vault migration parent is not forked')
	if (!settings.approvedUniverses.includes(migration.childUniverse.id)) throw new Error('Vault migration child universe is not approved')
	if (migration.childUniverse.parentId !== migration.parent.universeId) throw new Error('Vault migration child universe does not descend from the parent universe')
	if (migration.childPool !== undefined && migration.childPool.parent.toLowerCase() !== migration.parent.address.toLowerCase()) throw new Error('Vault migration child pool does not descend from the parent pool')
	await submitCall(
		wallet,
		settings,
		state,
		{
			data: encodeFunctionData({
				abi: securityPoolForkerAbi,
				args: [migration.parent.address, migration.outcomeIndex],
				functionName: 'migrateVault',
			}),
			gas: 4_000_000n,
			label: `Migrate liquidator vault to approved universe ${migration.childUniverse.id.toString()}`,
			to: migration.parent.securityPoolForker,
		},
		'migration',
	)
}

async function agreedPendingNonce(wallet: WriteClient, settings: OperatorSettings, address: Address) {
	const endpoints = [settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls]
	const observations = await Promise.all(
		endpoints.map(async endpoint => ({
			endpoint,
			value: await createPublicClient({
				chain: wallet.chain,
				transport: http(endpoint),
			}).getTransactionCount({ address, blockTag: 'pending' }),
		})),
	)
	return quorumValue('pending signer nonce', observations)
}

async function ensureAllowance(wallet: WriteClient, settings: OperatorSettings, state: RuntimeState, token: Address, spender: Address, amount: bigint, kind: 'deposit' | 'liquidation', priceStillAllowed?: (() => boolean | Promise<boolean>) | undefined) {
	const allowance = await wallet.readContract({
		abi: erc20Abi,
		address: token,
		args: [wallet.account.address, spender],
		functionName: 'allowance',
	})
	if (allowance >= amount) return
	await submitCall(
		wallet,
		settings,
		state,
		{
			data: encodeFunctionData({
				abi: erc20Abi,
				args: [spender, amount],
				functionName: 'approve',
			}),
			gas: 80_000n,
			label: `Approve ${kind === 'deposit' ? 'pool' : 'oracle'} REP funding`,
			...(priceStillAllowed === undefined ? {} : { preSubmit: () => assertMarketPriceStillAllowed(priceStillAllowed) }),
			to: token,
		},
		kind,
	)
}

export function assertRepLimits(parameters: { acquiredAmountAttoRep?: bigint | undefined; currentPoolRepAttoRep: bigint; currentTotalRepAttoRep: bigint; depositAmountAttoRep: bigint; maximumPoolRepAttoRep: bigint; maximumTotalRepAttoRep: bigint }) {
	const acquiredAmountAttoRep = parameters.acquiredAmountAttoRep ?? 0n
	if (parameters.currentPoolRepAttoRep + parameters.depositAmountAttoRep + acquiredAmountAttoRep > parameters.maximumPoolRepAttoRep) {
		throw new Error('REP deployment would exceed strategy.maximumRepPerPoolAttoRep')
	}
	if (parameters.currentTotalRepAttoRep + parameters.depositAmountAttoRep + acquiredAmountAttoRep > parameters.maximumTotalRepAttoRep) {
		throw new Error('REP deployment would exceed strategy.maximumTotalDeployedRepAttoRep')
	}
}

export function assertRepExposureLimits(settings: OperatorSettings, state: RuntimeState, pool: PoolObservation, depositAmountAttoRep: bigint, acquiredAmountAttoRep = 0n) {
	const poolReservedRepAttoRep = reservedLiquidationRep(pool, settings)
	const totalDeployedRepAttoRep = state.pools.reduce((total, observedPool) => total + observedPool.botVault.vaultRepBackingAttoRep + reservedLiquidationRep(observedPool, settings), 0n)
	assertRepLimits({
		acquiredAmountAttoRep,
		currentPoolRepAttoRep: pool.botVault.vaultRepBackingAttoRep + poolReservedRepAttoRep,
		currentTotalRepAttoRep: totalDeployedRepAttoRep,
		depositAmountAttoRep,
		maximumPoolRepAttoRep: settings.strategy.maximumRepPerPoolAttoRep,
		maximumTotalRepAttoRep: settings.strategy.maximumTotalDeployedRepAttoRep,
	})
}

function reservedLiquidationRep(pool: PoolObservation, settings: OperatorSettings) {
	const referencePrice = pool.lastPrice > 0n ? pool.lastPrice : settings.strategy.fallbackRepPerEthPrice
	const bufferedPrice = (referencePrice * settings.strategy.stalePriceFundingBufferBps + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR
	return pool.stagedOperations.reduce((total, operation) => {
		if (operation.operation !== 0n || operation.initiatorVault.toLowerCase() !== pool.botVault.address.toLowerCase()) return total
		const snapshotVaultRepBackingAttoRep = operation.snapshotTotalRepBackingUnits === 0n ? operation.snapshotTargetBackingUnits / PRICE_PRECISION : (operation.snapshotTargetBackingUnits * operation.snapshotTotalPoolHeldRepAttoRep) / operation.snapshotTotalRepBackingUnits
		const estimatedRepAttoRep = (operation.amount * bufferedPrice * (BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS) + PRICE_PRECISION * BPS_DENOMINATOR - 1n) / (PRICE_PRECISION * BPS_DENOMINATOR)
		if (operation.isPendingSettlement || operation.amount === operation.snapshotTargetCoverageCommitmentAttoEth) return total + (estimatedRepAttoRep > snapshotVaultRepBackingAttoRep ? estimatedRepAttoRep : snapshotVaultRepBackingAttoRep)
		return total + (estimatedRepAttoRep < snapshotVaultRepBackingAttoRep ? estimatedRepAttoRep : snapshotVaultRepBackingAttoRep)
	}, 0n)
}

async function depositRepToVault(wallet: WriteClient, settings: OperatorSettings, state: RuntimeState, pool: PoolObservation, amountAttoRep: bigint, priceStillAllowed?: (() => boolean | Promise<boolean>) | undefined) {
	if (amountAttoRep === 0n) return
	assertRepExposureLimits(settings, state, pool, amountAttoRep)
	if (!settings.strategy.allowAutomaticDeposits) {
		throw new Error('Candidate requires REP but automatic deposits are disabled')
	}
	const walletBalance = await wallet.readContract({
		abi: erc20Abi,
		address: pool.repToken,
		args: [wallet.account.address],
		functionName: 'balanceOf',
	})
	if (walletBalance < amountAttoRep + settings.strategy.walletRepReserveAttoRep) {
		throw new Error('Wallet REP reserve would be breached by the required pool deposit')
	}
	await ensureAllowance(wallet, settings, state, pool.repToken, pool.address, amountAttoRep, 'deposit', priceStillAllowed)
	await submitCall(
		wallet,
		settings,
		state,
		{
			data: encodeFunctionData({
				abi: securityPoolAbi,
				args: [amountAttoRep],
				functionName: 'depositRepToVault',
			}),
			gas: 300_000n,
			label: 'Deposit REP for liquidator vault health',
			...(priceStillAllowed === undefined ? {} : { preSubmit: () => assertMarketPriceStillAllowed(priceStillAllowed) }),
			to: pool.address,
		},
		'deposit',
	)
}

export function conservativeStaleTopUp(parameters: { callerCoverageCommitmentAttoEth: bigint; callerRepAttoRep: bigint; coverageCommitmentToTransferAttoEth: bigint; fallbackPrice: bigint; minimumTopUp: bigint; multiplierBps: bigint; referencePrice: bigint; safetyBps: bigint; targetHealthBps: bigint }) {
	const referencePrice = parameters.referencePrice > 0n ? parameters.referencePrice : parameters.fallbackPrice
	if (referencePrice === 0n) throw new Error('Stale unseeded oracle requires strategy.fallbackRepPerEthPrice')
	const bufferedPrice = (referencePrice * parameters.safetyBps + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR
	const requiredRepAttoRep = requiredRepForCoverageCommitment(parameters.callerCoverageCommitmentAttoEth + parameters.coverageCommitmentToTransferAttoEth, parameters.multiplierBps, bufferedPrice, parameters.targetHealthBps)
	const conservativeTopUp = requiredRepAttoRep > parameters.callerRepAttoRep ? requiredRepAttoRep - parameters.callerRepAttoRep : 0n
	return conservativeTopUp > parameters.minimumTopUp ? conservativeTopUp : parameters.minimumTopUp
}

export function assertStaleLiquidationExposureBound(candidate: Pick<LiquidationCandidate, 'coverageCommitmentToTransferAttoEth' | 'target'>) {
	if (candidate.coverageCommitmentToTransferAttoEth === candidate.target.coverageCommitmentAttoEth) {
		throw new Error('Stale full-close liquidation cannot guarantee the configured REP exposure limits')
	}
}

async function fundStaleOracle(wallet: WriteClient, settings: OperatorSettings, state: RuntimeState, pool: PoolObservation, reservedTopUpRepAttoRep: bigint, priceStillAllowed: () => boolean | Promise<boolean>) {
	if (pool.requestPriceCostAttoEth > settings.strategy.maximumOracleRequestCostAttoEth) {
		throw new Error('Oracle request cost exceeds strategy.maximumOracleRequestCostAttoEth')
	}
	const proposedPrice = pool.lastPrice > 0n ? pool.lastPrice : settings.strategy.fallbackRepPerEthPrice
	if (proposedPrice === 0n) {
		throw new Error('Stale unseeded oracle requires strategy.fallbackRepPerEthPrice')
	}
	const initialWethAttoEth = pool.minimumToken1ReportAttoEth + pool.minimumToken1ReportAttoEth / 50n + 1n
	const initialRepAttoRep = (initialWethAttoEth * proposedPrice + 10n ** 18n - 1n) / 10n ** 18n
	const currentRepAttoRep = await wallet.readContract({
		abi: erc20Abi,
		address: pool.repToken,
		args: [wallet.account.address],
		functionName: 'balanceOf',
	})
	if (currentRepAttoRep < initialRepAttoRep + reservedTopUpRepAttoRep + settings.strategy.walletRepReserveAttoRep) {
		throw new Error('Oracle initial report would breach the wallet REP reserve')
	}
	const currentWethAttoEth = await wallet.readContract({
		abi: erc20Abi,
		address: settings.deployment.weth,
		args: [wallet.account.address],
		functionName: 'balanceOf',
	})
	if (currentWethAttoEth < initialWethAttoEth) {
		await submitCall(
			wallet,
			settings,
			state,
			{
				data: encodeFunctionData({ abi: wethAbi, args: [], functionName: 'deposit' }),
				gas: 80_000n,
				label: 'Wrap ETH for oracle initial report',
				preSubmit: () => assertMarketPriceStillAllowed(priceStillAllowed),
				to: settings.deployment.weth,
				value: initialWethAttoEth - currentWethAttoEth,
			},
			'liquidation',
		)
	}
	await ensureAllowance(wallet, settings, state, pool.repToken, pool.manager, initialRepAttoRep, 'liquidation', priceStillAllowed)
	const wethAllowanceAttoEth = await wallet.readContract({
		abi: erc20Abi,
		address: settings.deployment.weth,
		args: [wallet.account.address, pool.manager],
		functionName: 'allowance',
	})
	if (wethAllowanceAttoEth < initialWethAttoEth) {
		await submitCall(
			wallet,
			settings,
			state,
			{
				data: encodeFunctionData({
					abi: erc20Abi,
					args: [pool.manager, initialWethAttoEth],
					functionName: 'approve',
				}),
				gas: 80_000n,
				label: 'Approve oracle WETH funding',
				preSubmit: () => assertMarketPriceStillAllowed(priceStillAllowed),
				to: settings.deployment.weth,
			},
			'liquidation',
		)
	}
	return { initialWethAttoEth, proposedPrice }
}

export async function executeLiquidation(wallet: WriteClient, settings: OperatorSettings, state: RuntimeState, pool: PoolObservation, candidate: LiquidationCandidate, priceStillAllowed: () => boolean | Promise<boolean>) {
	if (!pool.isPriceValid) assertStaleLiquidationExposureBound(candidate)
	const topUpRepAttoRep = pool.isPriceValid
		? candidate.topUpRepAttoRep
		: conservativeStaleTopUp({
				callerCoverageCommitmentAttoEth: pool.botVault.coverageCommitmentAttoEth,
				callerRepAttoRep: pool.botVault.vaultRepBackingAttoRep,
				coverageCommitmentToTransferAttoEth: candidate.coverageCommitmentToTransferAttoEth,
				fallbackPrice: settings.strategy.fallbackRepPerEthPrice,
				minimumTopUp: candidate.topUpRepAttoRep,
				multiplierBps: pool.multiplierBps,
				referencePrice: pool.lastPrice,
				safetyBps: settings.strategy.stalePriceFundingBufferBps,
				targetHealthBps: settings.strategy.vaultTargetHealthBps,
			})
	const acquisitionPrice = pool.isPriceValid ? candidate.pool.price : (candidate.pool.price * settings.strategy.stalePriceFundingBufferBps + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR
	const acquiredRepCeiling = conservativeLiquidationRep(candidate, acquisitionPrice)
	assertRepExposureLimits(settings, state, pool, topUpRepAttoRep, acquiredRepCeiling)
	await depositRepToVault(wallet, settings, state, pool, topUpRepAttoRep, priceStillAllowed)
	const usesExistingPendingReport = !pool.isPriceValid && pool.pendingReportId > 0n
	if (usesExistingPendingReport && pool.pendingReportSponsor.toLowerCase() !== wallet.account.address.toLowerCase()) {
		throw new Error('A different sponsor owns the pool pending price report')
	}
	const oracleFunding = pool.isPriceValid || usesExistingPendingReport ? { initialWethAttoEth: 0n, proposedPrice: 0n } : await fundStaleOracle(wallet, settings, state, pool, 0n, priceStillAllowed)
	await submitCall(
		wallet,
		settings,
		state,
		{
			data: encodeFunctionData({
				abi: coordinatorAbi,
				args: [0, candidate.target.address, candidate.coverageCommitmentToTransferAttoEth, settings.strategy.stagedOperationValidForSeconds, oracleFunding.proposedPrice, oracleFunding.initialWethAttoEth],
				functionName: 'requestPriceIfNeededAndStageOperation',
			}),
			gas: pool.isPriceValid ? 1_000_000n : 2_000_000n,
			label: pool.isPriceValid ? 'Execute security-pool liquidation' : usesExistingPendingReport ? 'Queue liquidation behind the existing price report' : 'Queue liquidation and request a fresh REP price',
			preSubmit: () => assertMarketPriceStillAllowed(priceStillAllowed),
			receiptExpectation: pool.isPriceValid ? { coordinator: pool.manager, operation: 0, type: 'staged-success' } : { amount: candidate.coverageCommitmentToTransferAttoEth, coordinator: pool.manager, initiator: wallet.account.address, target: candidate.target.address, type: 'pending-liquidation' },
			to: pool.manager,
			value: pool.isPriceValid || usesExistingPendingReport ? 0n : pool.requestPriceCostAttoEth,
		},
		'liquidation',
	)
}

type VaultMaintenancePlan = { amountAttoRep: bigint; kind: 'deposit' | 'withdraw' } | { kind: 'fees' } | undefined

export function planVaultMaintenance(
	pool: Pick<PoolObservation, 'botVault' | 'isPriceValid' | 'lastPrice' | 'multiplierBps'>,
	strategy: Pick<StrategySettings, 'allowAutomaticWithdrawals' | 'minimumRepWithdrawalAttoRep' | 'redeemFeesAboveAttoEth' | 'vaultTargetHealthBps' | 'vaultTopUpHealthBps' | 'vaultWithdrawHealthBps'>,
	walletAddress: Address,
	priceDependentMaintenanceAllowed: boolean,
): VaultMaintenancePlan {
	if (priceDependentMaintenanceAllowed && pool.lastPrice > 0n) {
		const health = vaultHealthBps(pool.botVault.vaultRepBackingAttoRep, pool.botVault.coverageCommitmentAttoEth, pool.multiplierBps, pool.lastPrice)
		if (pool.botVault.coverageCommitmentAttoEth > 0n && health !== undefined && health < strategy.vaultTopUpHealthBps) {
			const targetRepAttoRep = requiredRepForCoverageCommitment(pool.botVault.coverageCommitmentAttoEth, pool.multiplierBps, pool.lastPrice, strategy.vaultTargetHealthBps)
			return { amountAttoRep: targetRepAttoRep > pool.botVault.vaultRepBackingAttoRep ? targetRepAttoRep - pool.botVault.vaultRepBackingAttoRep : 0n, kind: 'deposit' }
		}
		if (strategy.allowAutomaticWithdrawals && pool.isPriceValid && pool.botVault.address.toLowerCase() === walletAddress.toLowerCase()) {
			const surplusAttoRep = surplusRepForWithdrawal(pool.botVault, { multiplierBps: pool.multiplierBps, price: pool.lastPrice }, strategy)
			if (surplusAttoRep > 0n) return { amountAttoRep: surplusAttoRep, kind: 'withdraw' }
		}
	}
	if (pool.botVault.claimableFeesAttoEth > 0n && pool.botVault.claimableFeesAttoEth >= strategy.redeemFeesAboveAttoEth) return { kind: 'fees' }
	return undefined
}

export async function maintainVault(wallet: WriteClient, settings: OperatorSettings, state: RuntimeState, pool: PoolObservation, priceStillAllowed: () => boolean | Promise<boolean>) {
	if (!isPoolExecutionEligible(pool)) return false
	const plan = planVaultMaintenance(pool, settings.strategy, wallet.account.address, await priceStillAllowed())
	if (plan?.kind === 'deposit') {
		await depositRepToVault(wallet, settings, state, pool, plan.amountAttoRep, priceStillAllowed)
		return true
	}
	if (plan?.kind === 'withdraw') {
		await submitCall(
			wallet,
			settings,
			state,
			{
				data: encodeFunctionData({
					abi: coordinatorAbi,
					args: [1, wallet.account.address, plan.amountAttoRep, settings.strategy.stagedOperationValidForSeconds, 0n, 0n],
					functionName: 'requestPriceIfNeededAndStageOperation',
				}),
				gas: 700_000n,
				label: 'Withdraw surplus REP from liquidator vault',
				preSubmit: () => assertMarketPriceStillAllowed(priceStillAllowed),
				receiptExpectation: { coordinator: pool.manager, operation: 1, type: 'staged-success' },
				to: pool.manager,
			},
			'withdrawal',
		)
		return true
	}
	if (plan?.kind === 'fees') {
		await submitCall(
			wallet,
			settings,
			state,
			{
				data: encodeFunctionData({
					abi: securityPoolAbi,
					args: [wallet.account.address],
					functionName: 'redeemFees',
				}),
				gas: 250_000n,
				label: 'Redeem security-pool ETH fees',
				to: pool.address,
			},
			'fees',
		)
		return true
	}
	return false
}

export function dryRunCandidate(state: RuntimeState, candidate: LiquidationCandidate) {
	recordActivity(state, {
		details: `pool=${candidate.pool.address} target=${candidate.target.address} coverageCommitmentTransferAttoEth=${candidate.coverageCommitmentToTransferAttoEth.toString()} repTopUpAttoRep=${candidate.topUpRepAttoRep.toString()} bonusAttoEth=${candidate.bonusValueAttoEth.toString()}`,
		kind: 'liquidation',
		message: 'Liquidation candidate selected',
		status: 'dry-run',
	})
}

export function isVaultHealthyEnoughForExecution(pool: PoolObservation) {
	const health = vaultHealthBps(pool.botVault.vaultRepBackingAttoRep, pool.botVault.coverageCommitmentAttoEth, pool.multiplierBps, pool.lastPrice)
	return health === undefined || health >= BPS_DENOMINATOR
}

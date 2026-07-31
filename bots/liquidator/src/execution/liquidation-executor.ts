import { createPublicClient, decodeEventLog, encodeFunctionData, http, type Account, type Address, type Chain, type Hex, type TransactionReceipt, type Transport, type WalletClient } from '@zoltar/bot-shared/ethereum'
import { paddedTransactionGas, prepareSignedTransaction, submitSignedTransaction } from '@zoltar/bot-shared/execution/transaction-submission'
import { sendRawTransactionToRpc } from '@zoltar/bot-shared/monitoring/connectivity'
import { quorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import type { OperatorSettings, StrategySettings } from '#config/settings'
import { coordinatorAbi, erc20Abi, securityPoolAbi, securityPoolForkerAbi, wethAbi } from '#contracts/abi'
import { isPoolExecutionEligible, type VaultMigration } from '#core/fork-migration'
import { BPS_DENOMINATOR, LIQUIDATION_REP_BONUS_BPS, PRICE_PRECISION, conservativeLiquidationRep, requiredRepForAllowance, surplusRepForWithdrawal, vaultHealthBps, type LiquidationCandidate } from '#core/strategy'
import { recordActivity, saveDurableState, type PendingTransactionIntent, type PoolObservation, type RuntimeState } from '#state/operator-state'

type WriteClient = WalletClient<Transport, Chain, Account>

type Call = {
	data: Hex
	gas: bigint
	label: string
	receiptExpectation?: PendingTransactionIntent['receiptExpectation'] | undefined
	to: Address
	value?: bigint | undefined
}

function maximumFeePerGas(baseFeePerGas: bigint) {
	return baseFeePerGas * 2n + 2n * 10n ** 9n
}

export function assertGasCostLimit(gasEstimate: bigint, maxFeePerGas: bigint, maximumGasCost: bigint, label = 'Transaction') {
	if (maxFeePerGas * paddedTransactionGas(gasEstimate) > maximumGasCost) {
		throw new Error(`${label} estimated gas ceiling exceeds strategy.maximumGasCostEth`)
	}
}

export function assertExecutionActive(state: Pick<RuntimeState, 'paused'>) {
	if (state.paused) throw new Error('Operator paused before transaction submission')
}

async function submitCall(wallet: WriteClient, settings: OperatorSettings, state: RuntimeState, call: Call, kind: 'deposit' | 'fees' | 'liquidation' | 'migration' | 'withdrawal') {
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
	assertGasCostLimit(call.gas, maximumFeePerGas(block.baseFeePerGas), settings.strategy.maximumGasCostEth, call.label)
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
	state.pendingTransactions.push({
		hash: signed.hash,
		kind,
		label: call.label,
		maxBlockNumber: signed.maxBlockNumber,
		mode: settings.submission.mode,
		nonce: signed.transaction.nonce,
		receiptExpectation: call.receiptExpectation ?? { type: 'transaction' },
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
	const receipt = await wallet.waitForTransactionReceipt({
		hash,
		pollingInterval: Math.min(settings.runtime.pollMilliseconds, 5_000),
		timeout: 180_000,
	})
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

async function ensureAllowance(wallet: WriteClient, settings: OperatorSettings, state: RuntimeState, token: Address, spender: Address, amount: bigint, kind: 'deposit' | 'liquidation') {
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
			to: token,
		},
		kind,
	)
}

export function assertRepLimits(parameters: { acquiredAmount?: bigint | undefined; currentPoolRep: bigint; currentTotalRep: bigint; depositAmount: bigint; maximumPoolRep: bigint; maximumTotalRep: bigint }) {
	const acquiredAmount = parameters.acquiredAmount ?? 0n
	if (parameters.currentPoolRep + parameters.depositAmount + acquiredAmount > parameters.maximumPoolRep) {
		throw new Error('REP deployment would exceed strategy.maximumRepPerPool')
	}
	if (parameters.currentTotalRep + parameters.depositAmount + acquiredAmount > parameters.maximumTotalRep) {
		throw new Error('REP deployment would exceed strategy.maximumTotalDeployedRep')
	}
}

export function assertRepExposureLimits(settings: OperatorSettings, state: RuntimeState, pool: PoolObservation, depositAmount: bigint, acquiredAmount = 0n) {
	const poolReservedRep = reservedLiquidationRep(pool, settings)
	const totalDeployedRep = state.pools.reduce((total, observedPool) => total + observedPool.botVault.rep + reservedLiquidationRep(observedPool, settings), 0n)
	assertRepLimits({
		acquiredAmount,
		currentPoolRep: pool.botVault.rep + poolReservedRep,
		currentTotalRep: totalDeployedRep,
		depositAmount,
		maximumPoolRep: settings.strategy.maximumRepPerPool,
		maximumTotalRep: settings.strategy.maximumTotalDeployedRep,
	})
}

function reservedLiquidationRep(pool: PoolObservation, settings: OperatorSettings) {
	const referencePrice = pool.lastPrice > 0n ? pool.lastPrice : settings.strategy.fallbackRepPerEthPrice
	const bufferedPrice = (referencePrice * settings.strategy.stalePriceFundingBufferBps + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR
	return pool.stagedOperations.reduce((total, operation) => {
		if (operation.operation !== 0n || operation.initiatorVault.toLowerCase() !== pool.botVault.address.toLowerCase()) return total
		const snapshotRep = operation.snapshotDenominator === 0n ? operation.snapshotTargetOwnership / PRICE_PRECISION : (operation.snapshotTargetOwnership * operation.snapshotTotalRep) / operation.snapshotDenominator
		const estimatedRep = (operation.amount * bufferedPrice * (BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS) + PRICE_PRECISION * BPS_DENOMINATOR - 1n) / (PRICE_PRECISION * BPS_DENOMINATOR)
		if (operation.isPendingSettlement || operation.amount === operation.snapshotTargetAllowance) return total + (estimatedRep > snapshotRep ? estimatedRep : snapshotRep)
		return total + (estimatedRep < snapshotRep ? estimatedRep : snapshotRep)
	}, 0n)
}

async function depositRep(wallet: WriteClient, settings: OperatorSettings, state: RuntimeState, pool: PoolObservation, amount: bigint) {
	if (amount === 0n) return
	assertRepExposureLimits(settings, state, pool, amount)
	if (!settings.strategy.allowAutomaticDeposits) {
		throw new Error('Candidate requires REP but automatic deposits are disabled')
	}
	const walletBalance = await wallet.readContract({
		abi: erc20Abi,
		address: pool.repToken,
		args: [wallet.account.address],
		functionName: 'balanceOf',
	})
	if (walletBalance < amount + settings.strategy.walletRepReserve) {
		throw new Error('Wallet REP reserve would be breached by the required pool deposit')
	}
	await ensureAllowance(wallet, settings, state, pool.repToken, pool.address, amount, 'deposit')
	await submitCall(
		wallet,
		settings,
		state,
		{
			data: encodeFunctionData({
				abi: securityPoolAbi,
				args: [amount],
				functionName: 'depositRep',
			}),
			gas: 300_000n,
			label: 'Deposit REP for liquidator vault health',
			to: pool.address,
		},
		'deposit',
	)
}

export function requireSuccessfulStagedOperation(receipt: TransactionReceipt, coordinator: Address, operation: 0 | 1) {
	for (const log of receipt.logs) {
		if (log.address.toLowerCase() !== coordinator.toLowerCase()) continue
		try {
			const decoded = decodeEventLog({ abi: coordinatorAbi, data: log.data, topics: log.topics })
			if (decoded.eventName !== 'ExecutedStagedOperation' || decoded.args.operation !== BigInt(operation)) continue
			if (!decoded.args.success) {
				throw new Error(`Staged operation failed: ${decoded.args.errorMessage}`)
			}
			return
		} catch (error) {
			if (error instanceof Error && error.message.startsWith('Staged operation failed:')) throw error
		}
	}
	throw new Error('Coordinator receipt did not confirm the staged operation outcome')
}

export function requirePendingStagedOperation(receipt: TransactionReceipt, coordinator: Address, initiator: Address, target: Address, amount: bigint) {
	for (const log of receipt.logs) {
		if (log.address.toLowerCase() !== coordinator.toLowerCase()) continue
		try {
			const decoded = decodeEventLog({ abi: coordinatorAbi, data: log.data, topics: log.topics })
			if (decoded.eventName !== 'StagedOperationQueued') continue
			if (decoded.args.operation === 0n && decoded.args.initiatorVault.toLowerCase() === initiator.toLowerCase() && decoded.args.targetVault.toLowerCase() === target.toLowerCase() && decoded.args.amount === amount && decoded.args.isPendingSlot) return decoded.args.operationId
		} catch (error) {
			void error
		}
	}
	throw new Error('Coordinator did not place the liquidation in a pending settlement slot')
}

export function validateReceiptExpectation(receipt: TransactionReceipt, expectation: PendingTransactionIntent['receiptExpectation']) {
	if (expectation.type === 'transaction') return { queuedOperationId: undefined }
	if (expectation.type === 'staged-success') {
		requireSuccessfulStagedOperation(receipt, expectation.coordinator, expectation.operation)
		return { queuedOperationId: undefined }
	}
	return { queuedOperationId: requirePendingStagedOperation(receipt, expectation.coordinator, expectation.initiator, expectation.target, expectation.amount) }
}

export function conservativeStaleTopUp(parameters: { callerAllowance: bigint; callerRep: bigint; debtToMove: bigint; fallbackPrice: bigint; minimumTopUp: bigint; multiplierBps: bigint; referencePrice: bigint; safetyBps: bigint; targetHealthBps: bigint }) {
	const referencePrice = parameters.referencePrice > 0n ? parameters.referencePrice : parameters.fallbackPrice
	if (referencePrice === 0n) throw new Error('Stale unseeded oracle requires strategy.fallbackRepPerEthPrice')
	const bufferedPrice = (referencePrice * parameters.safetyBps + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR
	const requiredRep = requiredRepForAllowance(parameters.callerAllowance + parameters.debtToMove, parameters.multiplierBps, bufferedPrice, parameters.targetHealthBps)
	const conservativeTopUp = requiredRep > parameters.callerRep ? requiredRep - parameters.callerRep : 0n
	return conservativeTopUp > parameters.minimumTopUp ? conservativeTopUp : parameters.minimumTopUp
}

export function assertStaleLiquidationExposureBound(candidate: Pick<LiquidationCandidate, 'debtToMove' | 'target'>) {
	if (candidate.debtToMove === candidate.target.allowance) {
		throw new Error('Stale full-close liquidation cannot guarantee the configured REP exposure limits')
	}
}

async function fundStaleOracle(wallet: WriteClient, settings: OperatorSettings, state: RuntimeState, pool: PoolObservation, reservedTopUpRep: bigint) {
	if (pool.requestPriceCostEth > settings.strategy.maximumOracleRequestCostEth) {
		throw new Error('Oracle request cost exceeds strategy.maximumOracleRequestCostEth')
	}
	const proposedPrice = pool.lastPrice > 0n ? pool.lastPrice : settings.strategy.fallbackRepPerEthPrice
	if (proposedPrice === 0n) {
		throw new Error('Stale unseeded oracle requires strategy.fallbackRepPerEthPrice')
	}
	const initialWeth = pool.minimumToken1Report + pool.minimumToken1Report / 50n + 1n
	const initialRep = (initialWeth * proposedPrice + 10n ** 18n - 1n) / 10n ** 18n
	const currentRep = await wallet.readContract({
		abi: erc20Abi,
		address: pool.repToken,
		args: [wallet.account.address],
		functionName: 'balanceOf',
	})
	if (currentRep < initialRep + reservedTopUpRep + settings.strategy.walletRepReserve) {
		throw new Error('Oracle initial report would breach the wallet REP reserve')
	}
	const currentWeth = await wallet.readContract({
		abi: erc20Abi,
		address: settings.deployment.weth,
		args: [wallet.account.address],
		functionName: 'balanceOf',
	})
	if (currentWeth < initialWeth) {
		await submitCall(
			wallet,
			settings,
			state,
			{
				data: encodeFunctionData({ abi: wethAbi, args: [], functionName: 'deposit' }),
				gas: 80_000n,
				label: 'Wrap ETH for oracle initial report',
				to: settings.deployment.weth,
				value: initialWeth - currentWeth,
			},
			'liquidation',
		)
	}
	await ensureAllowance(wallet, settings, state, pool.repToken, pool.manager, initialRep, 'liquidation')
	const wethAllowance = await wallet.readContract({
		abi: erc20Abi,
		address: settings.deployment.weth,
		args: [wallet.account.address, pool.manager],
		functionName: 'allowance',
	})
	if (wethAllowance < initialWeth) {
		await submitCall(
			wallet,
			settings,
			state,
			{
				data: encodeFunctionData({
					abi: erc20Abi,
					args: [pool.manager, initialWeth],
					functionName: 'approve',
				}),
				gas: 80_000n,
				label: 'Approve oracle WETH funding',
				to: settings.deployment.weth,
			},
			'liquidation',
		)
	}
	return { initialWeth, proposedPrice }
}

export async function executeLiquidation(wallet: WriteClient, settings: OperatorSettings, state: RuntimeState, pool: PoolObservation, candidate: LiquidationCandidate) {
	if (!pool.isPriceValid) assertStaleLiquidationExposureBound(candidate)
	const topUpRep = pool.isPriceValid
		? candidate.topUpRep
		: conservativeStaleTopUp({
				callerAllowance: pool.botVault.allowance,
				callerRep: pool.botVault.rep,
				debtToMove: candidate.debtToMove,
				fallbackPrice: settings.strategy.fallbackRepPerEthPrice,
				minimumTopUp: candidate.topUpRep,
				multiplierBps: pool.multiplierBps,
				referencePrice: pool.lastPrice,
				safetyBps: settings.strategy.stalePriceFundingBufferBps,
				targetHealthBps: settings.strategy.vaultTargetHealthBps,
			})
	const acquisitionPrice = pool.isPriceValid ? candidate.pool.price : (candidate.pool.price * settings.strategy.stalePriceFundingBufferBps + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR
	const acquiredRepCeiling = conservativeLiquidationRep(candidate, acquisitionPrice)
	assertRepExposureLimits(settings, state, pool, topUpRep, acquiredRepCeiling)
	await depositRep(wallet, settings, state, pool, topUpRep)
	const usesExistingPendingReport = !pool.isPriceValid && pool.pendingReportId > 0n
	if (usesExistingPendingReport && pool.pendingReportSponsor.toLowerCase() !== wallet.account.address.toLowerCase()) {
		throw new Error('A different sponsor owns the pool pending price report')
	}
	const oracleFunding = pool.isPriceValid || usesExistingPendingReport ? { initialWeth: 0n, proposedPrice: 0n } : await fundStaleOracle(wallet, settings, state, pool, 0n)
	await submitCall(
		wallet,
		settings,
		state,
		{
			data: encodeFunctionData({
				abi: coordinatorAbi,
				args: [0, candidate.target.address, candidate.debtToMove, settings.strategy.stagedOperationValidForSeconds, oracleFunding.proposedPrice, oracleFunding.initialWeth],
				functionName: 'requestPriceIfNeededAndStageOperation',
			}),
			gas: pool.isPriceValid ? 1_000_000n : 2_000_000n,
			label: pool.isPriceValid ? 'Execute security-pool liquidation' : usesExistingPendingReport ? 'Queue liquidation behind the existing price report' : 'Queue liquidation and request a fresh REP price',
			receiptExpectation: pool.isPriceValid ? { coordinator: pool.manager, operation: 0, type: 'staged-success' } : { amount: candidate.debtToMove, coordinator: pool.manager, initiator: wallet.account.address, target: candidate.target.address, type: 'pending-liquidation' },
			to: pool.manager,
			value: pool.isPriceValid || usesExistingPendingReport ? 0n : pool.requestPriceCostEth,
		},
		'liquidation',
	)
}

type VaultMaintenancePlan = { amount: bigint; kind: 'deposit' | 'withdraw' } | { kind: 'fees' } | undefined

export function planVaultMaintenance(
	pool: Pick<PoolObservation, 'botVault' | 'isPriceValid' | 'lastPrice' | 'multiplierBps'>,
	strategy: Pick<StrategySettings, 'allowAutomaticWithdrawals' | 'minimumRepWithdrawal' | 'redeemFeesAboveEth' | 'vaultTargetHealthBps' | 'vaultTopUpHealthBps' | 'vaultWithdrawHealthBps'>,
	walletAddress: Address,
	priceDependentMaintenanceAllowed: boolean,
): VaultMaintenancePlan {
	if (priceDependentMaintenanceAllowed && pool.lastPrice > 0n) {
		const health = vaultHealthBps(pool.botVault.rep, pool.botVault.allowance, pool.multiplierBps, pool.lastPrice)
		if (pool.botVault.allowance > 0n && health !== undefined && health < strategy.vaultTopUpHealthBps) {
			const targetRep = requiredRepForAllowance(pool.botVault.allowance, pool.multiplierBps, pool.lastPrice, strategy.vaultTargetHealthBps)
			return { amount: targetRep > pool.botVault.rep ? targetRep - pool.botVault.rep : 0n, kind: 'deposit' }
		}
		if (strategy.allowAutomaticWithdrawals && pool.isPriceValid && pool.botVault.address.toLowerCase() === walletAddress.toLowerCase()) {
			const surplus = surplusRepForWithdrawal(pool.botVault, { multiplierBps: pool.multiplierBps, price: pool.lastPrice }, strategy)
			if (surplus > 0n) return { amount: surplus, kind: 'withdraw' }
		}
	}
	if (pool.botVault.unpaidEthFees >= strategy.redeemFeesAboveEth) return { kind: 'fees' }
	return undefined
}

export async function maintainVault(wallet: WriteClient, settings: OperatorSettings, state: RuntimeState, pool: PoolObservation, priceDependentMaintenanceAllowed: boolean) {
	if (!isPoolExecutionEligible(pool)) return false
	const plan = planVaultMaintenance(pool, settings.strategy, wallet.account.address, priceDependentMaintenanceAllowed)
	if (plan?.kind === 'deposit') {
		await depositRep(wallet, settings, state, pool, plan.amount)
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
					args: [1, wallet.account.address, plan.amount, settings.strategy.stagedOperationValidForSeconds, 0n, 0n],
					functionName: 'requestPriceIfNeededAndStageOperation',
				}),
				gas: 700_000n,
				label: 'Withdraw surplus REP from liquidator vault',
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
		details: `pool=${candidate.pool.address} target=${candidate.target.address} debt=${candidate.debtToMove.toString()} repTopUp=${candidate.topUpRep.toString()} bonusEth=${candidate.bonusValueEth.toString()}`,
		kind: 'liquidation',
		message: 'Liquidation candidate selected',
		status: 'dry-run',
	})
}

export function isVaultHealthyEnoughForExecution(pool: PoolObservation) {
	const health = vaultHealthBps(pool.botVault.rep, pool.botVault.allowance, pool.multiplierBps, pool.lastPrice)
	return health === undefined || health >= BPS_DENOMINATOR
}

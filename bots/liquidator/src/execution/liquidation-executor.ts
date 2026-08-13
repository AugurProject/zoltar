import { createPublicClient, createWalletClient, encodeFunctionData, type Account, type Address, type Chain, type Hex, type Transport, type WalletClient } from '@zoltar/bot-shared/ethereum'
import { paddedTransactionGas, prepareSignedTransaction, submitSignedTransaction } from '@zoltar/bot-shared/execution/transaction-submission'
import { sendRawTransactionToRpc } from '@zoltar/bot-shared/monitoring/connectivity'
import { settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import type { DesiredPoolSettings, OperatorSettings, StrategySettings } from '#config/settings'
import { coordinatorAbi, erc20Abi, securityPoolAbi, securityPoolFactoryAbi, securityPoolForkerAbi, wethAbi } from '#contracts/abi'
import { isPoolExecutionEligible, type VaultMigration } from '#core/fork-migration'
import { BPS_DENOMINATOR, LIQUIDATION_REP_BONUS_BPS, PRICE_PRECISION, conservativeLiquidationRep, requiredRepForOpenInterest, surplusRepForWithdrawal, vaultHealthBps, type LiquidationCandidate } from '#core/strategy'
import { recordActivity, saveDurableState, type PendingTransactionIntent, type PoolObservation, type RuntimeState } from '#state/operator-state'
import { validateReceiptExpectation } from '#execution/receipt-validation'
import { finalizedReceiptWithQuorum } from '#execution/recovery'
import type { createRpcEndpointPool } from '@zoltar/bot-shared/ethereum/rpc-resilience'

export { requirePendingStagedOperation, requireSuccessfulStagedOperation, validateReceiptExpectation } from '#execution/receipt-validation'

type WriteClient = WalletClient<Transport, Chain, Account>
type RpcPool = ReturnType<typeof createRpcEndpointPool>

const MAX_UINT256 = 2n ** 256n - 1n

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

function executionReadClients(wallet: WriteClient, settings: OperatorSettings, pool: RpcPool) {
	return [settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls].map(endpoint => ({ client: createWalletClient({ account: wallet.account, chain: wallet.chain, transport: pool.transportFor(endpoint) }), endpoint }))
}

async function agreedErc20Balance(wallet: WriteClient, settings: OperatorSettings, pool: RpcPool, token: Address) {
	return settledQuorumValue(
		'wallet token balance',
		executionReadClients(wallet, settings, pool).map(async ({ client, endpoint }) => ({ endpoint, value: await client.readContract({ abi: erc20Abi, address: token, args: [wallet.account.address], functionName: 'balanceOf' }) })),
	)
}

async function agreedErc20Allowance(wallet: WriteClient, settings: OperatorSettings, pool: RpcPool, token: Address, spender: Address) {
	return settledQuorumValue(
		'wallet token allowance',
		executionReadClients(wallet, settings, pool).map(async ({ client, endpoint }) => ({ endpoint, value: await client.readContract({ abi: erc20Abi, address: token, args: [wallet.account.address, spender], functionName: 'allowance' }) })),
	)
}

async function submitCall(wallet: WriteClient, settings: OperatorSettings, state: RuntimeState, pool: RpcPool, call: Call, kind: PendingTransactionIntent['kind']) {
	assertExecutionActive(state)
	const account = wallet.account
	if (account.signTransaction === undefined || account.signMessage === undefined) {
		throw new Error('Execution signer cannot sign transactions')
	}
	const block = await settledQuorumValue(
		`${call.label} signing block`,
		executionReadClients(wallet, settings, pool).map(async ({ client, endpoint }) => {
			const candidate = await client.getBlock()
			return { endpoint, value: { baseFeePerGas: candidate.baseFeePerGas, hash: candidate.hash, number: candidate.number } }
		}),
	)
	if (block.number === undefined || block.baseFeePerGas === undefined) {
		throw new Error('Latest block is missing number or base fee')
	}
	assertExecutionActive(state)
	assertGasCostLimit(call.gas, maximumFeePerGas(block.baseFeePerGas), settings.strategy.maximumGasCostAttoEth, call.label)
	await settledQuorumValue(
		`${call.label} simulation`,
		executionReadClients(wallet, settings, pool).map(async ({ client, endpoint }) => ({
			endpoint,
			value: await client.call({ account, data: call.data, gas: call.gas, to: call.to, value: call.value }),
		})),
	)
	assertExecutionActive(state)
	recordActivity(state, {
		details: `to=${call.to} data=${call.data} value=${(call.value ?? 0n).toString()}`,
		kind,
		message: `Preparing: ${call.label}`,
		status: 'info',
	})
	await saveDurableState(settings.runtime.stateFile, state)
	const nonce = await agreedPendingNonce(wallet, settings, account.address, pool)
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
	const receiptResult = await finalizedReceiptWithQuorum(settings, wallet, hash, pool)
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

export async function executeOriginPoolDeployment(wallet: WriteClient, settings: OperatorSettings, state: RuntimeState, desired: DesiredPoolSettings, pool: RpcPool) {
	if (!settings.strategy.allowAutomaticPoolCreation) throw new Error('Automatic origin-pool creation is disabled')
	if (!settings.approvedUniverses.includes(desired.universeId)) throw new Error('Desired origin pool universe is not approved')
	return submitCall(
		wallet,
		settings,
		state,
		pool,
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

export async function executeVaultMigration(wallet: WriteClient, settings: OperatorSettings, state: RuntimeState, migration: VaultMigration, pool: RpcPool) {
	if (migration.parent.systemState !== 1n) throw new Error('Vault migration parent is not forked')
	if (!settings.approvedUniverses.includes(migration.childUniverse.id)) throw new Error('Vault migration child universe is not approved')
	if (migration.childUniverse.parentId !== migration.parent.universeId) throw new Error('Vault migration child universe does not descend from the parent universe')
	if (migration.childPool !== undefined && migration.childPool.parent.toLowerCase() !== migration.parent.address.toLowerCase()) throw new Error('Vault migration child pool does not descend from the parent pool')
	await submitCall(
		wallet,
		settings,
		state,
		pool,
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

async function agreedPendingNonce(wallet: WriteClient, settings: OperatorSettings, address: Address, pool: RpcPool) {
	const endpoints = [settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls]
	return settledQuorumValue(
		'pending signer nonce',
		endpoints.map(async endpoint => ({
			endpoint,
			value: await createPublicClient({
				chain: wallet.chain,
				transport: pool.transportFor(endpoint),
			}).getTransactionCount({ address, blockTag: 'pending' }),
		})),
	)
}

async function ensureAllowance(wallet: WriteClient, settings: OperatorSettings, state: RuntimeState, pool: RpcPool, token: Address, spender: Address, amount: bigint, kind: 'deposit' | 'liquidation', priceStillAllowed?: (() => boolean | Promise<boolean>) | undefined) {
	const allowance = await agreedErc20Allowance(wallet, settings, pool, token, spender)
	if (allowance >= amount) return
	await submitCall(
		wallet,
		settings,
		state,
		pool,
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

export function assertRepLimits(parameters: { acquiredAmountAttoRep?: bigint | undefined; currentPoolAttoRep: bigint; currentTotalAttoRep: bigint; depositAmountAttoRep: bigint; maximumPoolAttoRep: bigint; maximumTotalAttoRep: bigint }) {
	const acquiredAmountAttoRep = parameters.acquiredAmountAttoRep ?? 0n
	if (parameters.currentPoolAttoRep + parameters.depositAmountAttoRep + acquiredAmountAttoRep > parameters.maximumPoolAttoRep) {
		throw new Error('REP deployment would exceed strategy.maximumAttoRepPerPool')
	}
	if (parameters.currentTotalAttoRep + parameters.depositAmountAttoRep + acquiredAmountAttoRep > parameters.maximumTotalAttoRep) {
		throw new Error('REP deployment would exceed strategy.maximumTotalDeployedRep')
	}
}

export function assertRepExposureLimits(settings: OperatorSettings, state: RuntimeState, pool: PoolObservation, depositAmountAttoRep: bigint, acquiredAmountAttoRep = 0n) {
	const poolReservedAttoRep = reservedLiquidationRep(pool, settings)
	const totalDeployedAttoRep = state.pools.reduce((total, observedPool) => total + observedPool.botVault.vaultAttoRepBacking + reservedLiquidationRep(observedPool, settings), 0n)
	assertRepLimits({
		acquiredAmountAttoRep,
		currentPoolAttoRep: pool.botVault.vaultAttoRepBacking + poolReservedAttoRep,
		currentTotalAttoRep: totalDeployedAttoRep,
		depositAmountAttoRep,
		maximumPoolAttoRep: settings.strategy.maximumAttoRepPerPool,
		maximumTotalAttoRep: settings.strategy.maximumTotalDeployedRep,
	})
}

function reservedLiquidationRep(pool: PoolObservation, settings: OperatorSettings) {
	const referencePrice = pool.lastPrice > 0n ? pool.lastPrice : settings.strategy.fallbackRepPerEthPrice
	const bufferedPrice = (referencePrice * settings.strategy.stalePriceFundingBufferBps + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR
	return pool.stagedOperations.reduce((total, operation) => {
		if (operation.operation !== 0n || operation.receiverVault.toLowerCase() !== pool.botVault.address.toLowerCase()) return total
		const snapshotVaultRepBackingAttoRep = operation.snapshotTotalRepBackingUnits === 0n ? operation.snapshotTargetBackingUnits / PRICE_PRECISION : (operation.snapshotTargetBackingUnits * operation.snapshotTotalPoolHeldAttoRep) / operation.snapshotTotalRepBackingUnits
		const estimatedAttoRep = (operation.operationAmountAttoRepOrAttoEth * bufferedPrice * (BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS) + PRICE_PRECISION * BPS_DENOMINATOR - 1n) / (PRICE_PRECISION * BPS_DENOMINATOR)
		if (operation.isPendingSettlement || operation.operationAmountAttoRepOrAttoEth === operation.snapshotTargetOpenInterestAttoEth) return total + (estimatedAttoRep > snapshotVaultRepBackingAttoRep ? estimatedAttoRep : snapshotVaultRepBackingAttoRep)
		return total + (estimatedAttoRep < snapshotVaultRepBackingAttoRep ? estimatedAttoRep : snapshotVaultRepBackingAttoRep)
	}, 0n)
}

async function depositRepToVault(wallet: WriteClient, settings: OperatorSettings, state: RuntimeState, rpcPool: RpcPool, pool: PoolObservation, amountAttoRep: bigint, priceStillAllowed?: (() => boolean | Promise<boolean>) | undefined, targetHealthFactorBps = settings.strategy.vaultTargetHealthBps) {
	if (amountAttoRep === 0n) return
	assertRepExposureLimits(settings, state, pool, amountAttoRep)
	if (!settings.strategy.allowAutomaticDeposits) {
		throw new Error('Candidate requires REP but automatic deposits are disabled')
	}
	const walletBalance = await agreedErc20Balance(wallet, settings, rpcPool, pool.repToken)
	if (walletBalance < amountAttoRep + settings.strategy.walletAttoRepReserve) {
		throw new Error('Wallet REP reserve would be breached by the required pool deposit')
	}
	await ensureAllowance(wallet, settings, state, rpcPool, pool.repToken, pool.address, amountAttoRep, 'deposit', priceStillAllowed)
	await submitCall(
		wallet,
		settings,
		state,
		rpcPool,
		{
			data: encodeFunctionData({
				abi: securityPoolAbi,
				args: [amountAttoRep, targetHealthFactorBps],
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

async function fundStaleOracle(wallet: WriteClient, settings: OperatorSettings, state: RuntimeState, rpcPool: RpcPool, pool: PoolObservation, reservedTopUpAttoRep: bigint, priceStillAllowed: () => boolean | Promise<boolean>) {
	if (pool.requestPriceCostAttoEth > settings.strategy.maximumOracleRequestCostAttoEth) {
		throw new Error('Oracle request cost exceeds strategy.maximumOracleRequestCostAttoEth')
	}
	const proposedPrice = pool.lastPrice > 0n ? pool.lastPrice : settings.strategy.fallbackRepPerEthPrice
	if (proposedPrice === 0n) {
		throw new Error('Stale unseeded oracle requires strategy.fallbackRepPerEthPrice')
	}
	const initialAttoWeth = pool.minimumToken1ReportAttoEth + pool.minimumToken1ReportAttoEth / 50n + 1n
	const initialAttoRep = (initialAttoWeth * proposedPrice + 10n ** 18n - 1n) / 10n ** 18n
	const currentAttoRep = await agreedErc20Balance(wallet, settings, rpcPool, pool.repToken)
	if (currentAttoRep < initialAttoRep + reservedTopUpAttoRep + settings.strategy.walletAttoRepReserve) {
		throw new Error('Oracle initial report would breach the wallet REP reserve')
	}
	const currentAttoWeth = await agreedErc20Balance(wallet, settings, rpcPool, settings.deployment.weth)
	if (currentAttoWeth < initialAttoWeth) {
		await submitCall(
			wallet,
			settings,
			state,
			rpcPool,
			{
				data: encodeFunctionData({ abi: wethAbi, args: [], functionName: 'deposit' }),
				gas: 80_000n,
				label: 'Wrap ETH for oracle initial report',
				preSubmit: () => assertMarketPriceStillAllowed(priceStillAllowed),
				to: settings.deployment.weth,
				value: initialAttoWeth - currentAttoWeth,
			},
			'liquidation',
		)
	}
	await ensureAllowance(wallet, settings, state, rpcPool, pool.repToken, pool.manager, initialAttoRep, 'liquidation', priceStillAllowed)
	const wethAllowanceAttoEth = await agreedErc20Allowance(wallet, settings, rpcPool, settings.deployment.weth, pool.manager)
	if (wethAllowanceAttoEth < initialAttoWeth) {
		await submitCall(
			wallet,
			settings,
			state,
			rpcPool,
			{
				data: encodeFunctionData({
					abi: erc20Abi,
					args: [pool.manager, initialAttoWeth],
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
	return { initialAttoWeth, proposedPrice }
}

export async function executeLiquidation(wallet: WriteClient, settings: OperatorSettings, state: RuntimeState, rpcPool: RpcPool, pool: PoolObservation, candidate: LiquidationCandidate, priceStillAllowed: () => boolean | Promise<boolean>) {
	if (!pool.isPriceValid) assertStaleLiquidationExposureBound(candidate)
	const topUpAttoRep = pool.isPriceValid
		? candidate.topUpAttoRep
		: conservativeStaleTopUp({
				callerDisputeStakedAttoRep: pool.botVault.disputeStakedAttoRep,
				callerOpenInterestAttoEth: pool.botVault.openInterestAttoEth,
				callerAttoRep: pool.botVault.vaultAttoRepBacking,
				requestedDebtAttoEth: candidate.debtToMoveAttoEth,
				fallbackPrice: settings.strategy.fallbackRepPerEthPrice,
				minimumTopUp: candidate.topUpAttoRep,
				multiplierBps: pool.multiplierBps,
				referencePrice: pool.lastPrice,
				safetyBps: settings.strategy.stalePriceFundingBufferBps,
				targetHealthBps: settings.strategy.vaultTargetHealthBps,
			})
	const acquisitionPrice = pool.isPriceValid ? candidate.pool.price : (candidate.pool.price * settings.strategy.stalePriceFundingBufferBps + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR
	const acquiredRepCeiling = conservativeLiquidationRep(candidate, acquisitionPrice)
	assertRepExposureLimits(settings, state, pool, topUpAttoRep, acquiredRepCeiling)
	const executionStep = liquidationExecutionStep(topUpAttoRep)
	if (executionStep.kind === 'deposit-and-rescreen') {
		await depositRepToVault(wallet, settings, state, rpcPool, pool, topUpAttoRep, priceStillAllowed, executionStep.targetHealthFactorBps)
		recordActivity(state, {
			details: `pool=${pool.address} target=${candidate.target.address} topUpAttoRep=${topUpAttoRep.toString()}`,
			kind: 'liquidation',
			message: 'Liquidation top-up deposited; live pool state must be rescanned before staging',
			status: 'info',
		})
		await saveDurableState(settings.runtime.stateFile, state)
		return
	}
	const usesExistingPendingReport = !pool.isPriceValid && pool.pendingReportId > 0n
	if (usesExistingPendingReport && pool.pendingReportSponsor.toLowerCase() !== wallet.account.address.toLowerCase()) {
		throw new Error('A different sponsor owns the pool pending price report')
	}
	const oracleFunding = pool.isPriceValid || usesExistingPendingReport ? { initialAttoWeth: 0n, proposedPrice: 0n } : await fundStaleOracle(wallet, settings, state, rpcPool, pool, 0n, priceStillAllowed)
	await submitCall(
		wallet,
		settings,
		state,
		rpcPool,
		{
			data: encodeFunctionData({
				abi: coordinatorAbi,
				args: [candidate.target.address, wallet.account.address, candidate.requestedDebtAttoEth, `0x${'00'.repeat(32)}`, settings.strategy.stagedOperationValidForSeconds, oracleFunding.proposedPrice, oracleFunding.initialAttoWeth],
				functionName: 'requestPriceIfNeededAndStageLiquidation',
			}),
			gas: pool.isPriceValid ? 1_000_000n : 2_000_000n,
			label: pool.isPriceValid ? 'Execute security-pool liquidation' : usesExistingPendingReport ? 'Queue liquidation behind the existing price report' : 'Queue liquidation and request a fresh REP price',
			preSubmit: () => assertMarketPriceStillAllowed(priceStillAllowed),
			receiptExpectation: pool.isPriceValid ? { coordinator: pool.manager, operation: 0, type: 'staged-success' } : { amount: candidate.requestedDebtAttoEth, coordinator: pool.manager, operator: wallet.account.address, receiver: wallet.account.address, target: candidate.target.address, type: 'pending-liquidation' },
			to: pool.manager,
			value: pool.isPriceValid || usesExistingPendingReport ? 0n : pool.requestPriceCostAttoEth,
		},
		'liquidation',
	)
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

export async function maintainVault(wallet: WriteClient, settings: OperatorSettings, state: RuntimeState, rpcPool: RpcPool, pool: PoolObservation, priceStillAllowed: () => boolean | Promise<boolean>) {
	if (!isPoolExecutionEligible(pool)) return false
	const plan = planVaultMaintenance(pool, settings.strategy, wallet.account.address, await priceStillAllowed(), pool.candidates.length > 0)
	if (plan?.kind === 'deposit') {
		await depositRepToVault(wallet, settings, state, rpcPool, pool, plan.amountAttoRep, priceStillAllowed)
		return true
	}
	if (plan?.kind === 'withdraw') {
		await submitCall(
			wallet,
			settings,
			state,
			rpcPool,
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
			rpcPool,
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
		details: `pool=${candidate.pool.address} target=${candidate.target.address} requestedDebtAttoEth=${candidate.requestedDebtAttoEth.toString()} estimatedDebtMovedAttoEth=${candidate.debtToMoveAttoEth.toString()} repTopUpAttoRep=${candidate.topUpAttoRep.toString()} bonusAttoEth=${candidate.bonusValueAttoEth.toString()}`,
		kind: 'liquidation',
		message: 'Liquidation candidate selected',
		status: 'dry-run',
	})
}

export function isVaultHealthyEnoughForExecution(pool: PoolObservation) {
	const health = vaultHealthBps(pool.botVault.vaultAttoRepBacking, pool.botVault.openInterestAttoEth, pool.multiplierBps, pool.lastPrice, pool.botVault.disputeStakedAttoRep)
	return health === undefined || health >= BPS_DENOMINATOR
}

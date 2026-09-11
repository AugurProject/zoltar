import { createPublicClient, createWalletClient, encodeFunctionData, type Account, type Address, type Chain, type Hex, type Transport, type WalletClient } from '@zoltar/bot-shared/ethereum'
import { prepareSignedTransaction, submitSignedTransaction } from '@zoltar/bot-shared/execution/transaction-submission'
import { sendRawTransactionToRpc } from '@zoltar/bot-shared/monitoring/connectivity'
import { settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import type { DesiredPoolSettings, OperatorSettings } from '#config/settings'
import { openOraclePriceCoordinatorAbi, reputationTokenAbi, securityPoolAbi, securityPoolFactoryAbi, securityPoolForkerAbi, weth9Abi } from '@zoltar/bot-shared/contracts/abi'
import { isPoolExecutionEligible, type VaultMigration } from '#core/fork-migration'
import { BPS_DENOMINATOR, LIQUIDATION_REP_BONUS_BPS, PRICE_PRECISION, conservativeLiquidationRep, liquidationSubmissionLabel, type LiquidationCandidate } from '#core/strategy'
import { recordActivity, saveDurableState, type PendingTransactionIntent, type PoolObservation, type RuntimeState } from '#state/operator-state'
import { validateReceiptExpectation } from '#execution/receipt-validation'
import { finalizedReceiptWithQuorum } from '#execution/recovery'
import type { createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { assertExecutionActive, assertGasCostLimitForBaseFee, assertMarketPriceStillAllowed, assertOperatorNotStopping, assertRepLimits, assertStaleLiquidationExposureBound, conservativeStaleTopUp, liquidationExecutionStep, planVaultMaintenance, requireFinalizedTransactionReceipt } from '#execution/execution-safety'

type WriteClient = WalletClient<Transport, Chain, Account>
type RpcPool = ReturnType<typeof createRpcEndpointPool>

type Call = {
	data: Hex
	gas: bigint
	label: string
	preSubmit?: (() => Promise<unknown> | unknown) | undefined
	receiptExpectation?: PendingTransactionIntent['receiptExpectation'] | undefined
	to: Address
	value?: bigint | undefined
}

function executionReadClients(wallet: WriteClient, settings: OperatorSettings, pool: RpcPool) {
	return [settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls].map(endpoint => ({ client: createWalletClient({ account: wallet.account, chain: wallet.chain, transport: pool.transportFor(endpoint) }), endpoint }))
}

async function agreedErc20Balance(wallet: WriteClient, settings: OperatorSettings, pool: RpcPool, token: Address) {
	return settledQuorumValue(
		'wallet token balance',
		executionReadClients(wallet, settings, pool).map(async ({ client, endpoint }) => ({ endpoint, value: await client.readContract({ abi: reputationTokenAbi, address: token, args: [wallet.account.address], functionName: 'balanceOf' }) })),
		settings.connectivity.rpcQuorum,
	)
}

async function agreedErc20Allowance(wallet: WriteClient, settings: OperatorSettings, pool: RpcPool, token: Address, spender: Address) {
	return settledQuorumValue(
		'wallet token allowance',
		executionReadClients(wallet, settings, pool).map(async ({ client, endpoint }) => ({ endpoint, value: await client.readContract({ abi: reputationTokenAbi, address: token, args: [wallet.account.address, spender], functionName: 'allowance' }) })),
		settings.connectivity.rpcQuorum,
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
		settings.connectivity.rpcQuorum,
	)
	if (block.number === undefined || block.baseFeePerGas === undefined) {
		throw new Error('Latest block is missing number or base fee')
	}
	assertExecutionActive(state)
	assertGasCostLimitForBaseFee(call.gas, block.baseFeePerGas, settings.strategy.maximumGasCostAttoEth, call.label)
	await settledQuorumValue(
		`${call.label} simulation`,
		executionReadClients(wallet, settings, pool).map(async ({ client, endpoint }) => ({
			endpoint,
			value: await client.call({ account, data: call.data, gas: call.gas, to: call.to, value: call.value }),
		})),
		settings.connectivity.rpcQuorum,
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
	try {
		assertExecutionActive(state)
		await call.preSubmit?.()
		assertExecutionActive(state)
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
	const receiptDeadline = Date.now() + 180_000
	for (;;) {
		try {
			await wallet.waitForTransactionReceipt({
				hash,
				pollingInterval: Math.min(settings.runtime.pollMilliseconds, 5_000),
				timeout: Math.min(settings.runtime.pollMilliseconds, 5_000),
			})
			break
		} catch (error) {
			assertOperatorNotStopping(state)
			if (Date.now() >= receiptDeadline) throw error
		}
	}
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
		settings.connectivity.rpcQuorum,
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
				abi: reputationTokenAbi,
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

function assertRepExposureLimits(settings: OperatorSettings, state: RuntimeState, pool: PoolObservation, depositAmountAttoRep: bigint, acquiredAmountAttoRep = 0n) {
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
				data: encodeFunctionData({ abi: weth9Abi, args: [], functionName: 'deposit' }),
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
					abi: reputationTokenAbi,
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
				abi: openOraclePriceCoordinatorAbi,
				args: [candidate.target.address, wallet.account.address, candidate.requestedDebtAttoEth, `0x${'00'.repeat(32)}`, settings.strategy.stagedOperationValidForSeconds, oracleFunding.proposedPrice, oracleFunding.initialAttoWeth],
				functionName: 'requestPriceIfNeededAndStageLiquidation',
			}),
			gas: pool.isPriceValid ? 1_000_000n : 2_000_000n,
			label: liquidationSubmissionLabel(pool.isPriceValid, usesExistingPendingReport),
			preSubmit: () => assertMarketPriceStillAllowed(priceStillAllowed),
			receiptExpectation: pool.isPriceValid ? { coordinator: pool.manager, operation: 0, type: 'staged-success' } : { amount: candidate.requestedDebtAttoEth, coordinator: pool.manager, operator: wallet.account.address, receiver: wallet.account.address, target: candidate.target.address, type: 'pending-liquidation' },
			to: pool.manager,
			value: pool.isPriceValid || usesExistingPendingReport ? 0n : pool.requestPriceCostAttoEth,
		},
		'liquidation',
	)
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
					abi: openOraclePriceCoordinatorAbi,
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

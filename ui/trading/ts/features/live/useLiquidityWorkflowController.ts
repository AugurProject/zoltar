import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { capSubmissionDeadline } from '../../protocol/submissionWindow.js'
import * as workflowCopy from '../../copy/workflows.js'
import { useEffect, useState } from 'preact/hooks'
import { tryParseNonNegativeDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import { SHARE_QUANTITY_DECIMALS } from '../../lib/shareValue.js'
import { marketAcceptsNewRisk, type LiquidityOperation, type LiveMarket } from '../../protocol/live.js'
import * as liquidityCopy from '../../copy/liquidity.js'
import type { LiveLiquidityServices } from '../LiveLiquidityControls.js'
import type { LiveWorkflowContext } from './liveTradingTypes.js'
import { useTransactionSubmission } from './useTransactionSubmission.js'
import { liquidityHoldingFeeBlocker } from '../../protocol/holdingFees.js'
import { liquiditySlippageBounds } from '../../protocol/liquidity.js'
import { estimateLiquidity, type LiquidityPreview } from './liquidityEstimate.js'

export function liquidityOperationAvailable(operation: LiquidityOperation, market: LiveMarket, nowSeconds: bigint) {
	return operation === 'remove' || marketAcceptsNewRisk(market, nowSeconds)
}

function poolInitialized(market: LiveMarket) {
	return market.pair !== undefined && market.lpTotalSupply > 0n
}

/** The operation a fresh liquidity view opens on: initialize an empty pool, otherwise add, or remove once the market stops taking new risk. */
function defaultLiquidityOperation(market: LiveMarket, nowSeconds: bigint): LiquidityOperation {
	if (!poolInitialized(market)) return 'initialize'
	return marketAcceptsNewRisk(market, nowSeconds) ? 'add' : 'remove'
}

/** The previewed amounts a liquidity transaction approves; its signed bounds are these adjusted by the slippage setting. */
function liquidityExpectation(estimate: LiquidityPreview) {
	if (estimate.operation === 'remove') return { expectedLiquidity: 0n, expectedYes: estimate.yesOut, expectedNo: estimate.noOut, expectedYesDeposit: 0n, expectedNoDeposit: 0n }
	return { expectedLiquidity: estimate.liquidity, expectedYes: 0n, expectedNo: 0n, expectedYesDeposit: estimate.yesUsed, expectedNoDeposit: estimate.noUsed }
}

export function useLiquidityWorkflowController({
	configuration,
	market,
	balanceState,
	account,
	walletClient,
	externallyLocked,
	nowSeconds,
	settings,
	refresh,
	onKnownReceipt,
	executeWithCurrentWalletContext,
	createGuardedWalletWrite,
	onWorkflowLockChange,
	onMarketCreated,
	services,
}: LiveWorkflowContext &
	Readonly<{
		nowSeconds: bigint
		services: LiveLiquidityServices
		onMarketCreated?: ((pool: Address) => void) | undefined
	}>) {
	const [operation, setOperation] = useState<LiquidityOperation>(() => defaultLiquidityOperation(market, nowSeconds))
	const [amount, setAmount] = useState('')
	const [probability, setProbability] = useState('50')
	// ETH deposits and fixed-scale LP quantities use different decimal precisions.
	const parsed = tryParseNonNegativeDecimalInput(amount.trim(), operation === 'remove' ? SHARE_QUANTITY_DECIMALS : 18)
	const parsedProbability = tryParseNonNegativeDecimalInput(probability.trim(), 2)
	const conditionalBps = parsedProbability !== undefined && parsedProbability > 0n && parsedProbability < 10_000n ? parsedProbability : undefined
	const operationAvailable = liquidityOperationAvailable(operation, market, nowSeconds)
	const transaction = useTransactionSubmission({
		operation: 'liquidity',
		label: liquidityCopy.liquidityTransaction,
		activityTitle: workflowCopy.formatLiquidityActivity(market.title),
		account,
		chainId: configuration.chainId,
		market: market.pool,
		walletClient,
		externallyLocked,
		onWorkflowLockChange,
		onKnownReceipt,
		failureFallback: liquidityCopy.transactionFailed,
	})
	const estimate = parsed === undefined ? undefined : estimateLiquidity(market, operation, parsed, conditionalBps)
	const bounds = estimate === undefined ? undefined : liquiditySlippageBounds(liquidityExpectation(estimate), settings.slippageBps)
	let previewBlocker: string | undefined
	if (estimate === undefined || bounds === undefined) {
		if (parsed !== undefined && parsed > 0n) previewBlocker = operation === 'remove' ? liquidityCopy.removalAmountTooSmall : liquidityCopy.initialAmountTooSmall
	} else if (estimate.operation === 'add')
		previewBlocker = liquidityHoldingFeeBlocker(market, estimate.amount, bounds.maximumYesDeposit, bounds.maximumNoDeposit, capSubmissionDeadline(market, 'add', nowSeconds + settings.validityMinutes * 60n), {
			completeSetShares: estimate.completeSets,
			yesUsed: estimate.yesUsed,
			noUsed: estimate.noUsed,
		})
	const initialized = poolInitialized(market)
	const acceptsNewRisk = marketAcceptsNewRisk(market, nowSeconds)
	useEffect(() => {
		if (transaction.workflowLocked) return
		let next: LiquidityOperation | undefined
		if (initialized && operation === 'initialize') next = acceptsNewRisk ? 'add' : 'remove'
		else if (!initialized && operation !== 'initialize') next = 'initialize'
		else if (initialized && operation === 'add' && !acceptsNewRisk) next = 'remove'
		if (next === undefined) return
		setOperation(next)
		setAmount('')
	}, [acceptsNewRisk, initialized, operation, transaction.workflowLocked])

	async function submit() {
		if (walletClient === undefined || account === undefined || transaction.workflowLocked || balanceState !== 'ready') return
		if (estimate === undefined || previewBlocker !== undefined) return
		if (!liquidityOperationAvailable(operation, market, nowSeconds)) {
			transaction.dispatchWorkflow({ type: 'failed', operation: 'liquidity', message: liquidityCopy.closedToAdditions })
			return
		}
		await transaction.submit({
			prepare: async () => {
				await executeWithCurrentWalletContext(account, 'Wallet network changed. Switch back before submitting.', 'Wallet account changed. Reconnect and try again.', async () => undefined)
				return {
					market,
					operation,
					amount: estimate.amount,
					conditionalYesBps: conditionalBps ?? 5_000n,
					deadline: { validityMinutes: settings.validityMinutes },
					slippageBps: settings.slippageBps,
					...liquidityExpectation(estimate),
				}
			},
			send: async (prepared, requestSignature) => {
				const guarded = createGuardedWalletWrite(account, 'Wallet network changed while the transaction was checked. Reconnect and try again.', 'Wallet account changed while the transaction was checked. Reconnect and try again.')
				// submitFreshLiquidity re-simulates at the latest block and keeps the approved minimums.
				return await services.submitFreshLiquidity(walletClient, configuration, account, prepared, async write => await guarded(async () => await requestSignature(write)))
			},
			afterSlippageRejected: async () => await refresh({ background: true }),
			afterConfirmed: async prepared => {
				setAmount('')
				// Initializing a pool without a pair deployed its market, so the caller knows this market was created here.
				if (prepared.operation === 'initialize' && prepared.market.pair === undefined) onMarketCreated?.(prepared.market.pool)
				await refresh()
			},
		})
	}

	return {
		operation,
		amount,
		probability,
		parsed,
		conditionalBps,
		operationAvailable,
		estimate,
		/** The minimums and maximums the transaction signs for this estimate, shown in the preview. */
		bounds,
		previewBlocker,
		transaction,
		selectOperation(next: LiquidityOperation) {
			if (!transaction.invalidate()) return
			if (next !== operation) setAmount('')
			setOperation(next)
		},
		updateAmount(value: string) {
			if (!transaction.invalidate()) return
			setAmount(value)
		},
		updateProbability(value: string) {
			if (!transaction.invalidate()) return
			setProbability(value)
		},
		submit,
	}
}

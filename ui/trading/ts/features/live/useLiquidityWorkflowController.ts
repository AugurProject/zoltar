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
import { maximumAfterSlippage } from '../../protocol/tradeQuote.js'
import { estimateLiquidity } from './liquidityEstimate.js'

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
	services,
}: LiveWorkflowContext &
	Readonly<{
		nowSeconds: bigint
		services: LiveLiquidityServices
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
	let previewBlocker: string | undefined
	if (estimate === undefined) {
		if (parsed !== undefined && parsed > 0n) previewBlocker = operation === 'remove' ? liquidityCopy.removalAmountTooSmall : liquidityCopy.initialAmountTooSmall
	} else if (estimate.operation === 'add')
		previewBlocker = liquidityHoldingFeeBlocker(market, estimate.amount, maximumAfterSlippage(estimate.yesUsed, settings.slippageBps), maximumAfterSlippage(estimate.noUsed, settings.slippageBps), nowSeconds + settings.validityMinutes * 60n, {
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
					expectedLiquidity: estimate.operation === 'remove' ? 0n : estimate.liquidity,
					expectedYes: estimate.operation === 'remove' ? estimate.yesOut : 0n,
					expectedNo: estimate.operation === 'remove' ? estimate.noOut : 0n,
					expectedYesDeposit: estimate.operation === 'remove' ? 0n : estimate.yesUsed,
					expectedNoDeposit: estimate.operation === 'remove' ? 0n : estimate.noUsed,
				}
			},
			send: async (prepared, requestSignature) => {
				const guarded = createGuardedWalletWrite(account, 'Wallet network changed while the transaction was checked. Reconnect and try again.', 'Wallet account changed while the transaction was checked. Reconnect and try again.')
				// submitFreshLiquidity re-simulates at the latest block and keeps the approved minimums.
				return await services.submitFreshLiquidity(walletClient, configuration, account, prepared, async write => await guarded(async () => await requestSignature(write)))
			},
			afterSlippageRejected: async () => await refresh({ background: true }),
			afterConfirmed: async () => {
				setAmount('')
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

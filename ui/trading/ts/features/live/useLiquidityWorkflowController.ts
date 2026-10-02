import * as workflowCopy from '../../copy/workflows.js'
import { useEffect, useState } from 'preact/hooks'
import { withReadTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import { tryParseNonNegativeDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import { SHARE_QUANTITY_DECIMALS } from '../../lib/shareValue.js'
import { marketAcceptsNewRisk, type LiquidityOperation, type LiveMarket } from '../../protocol/live.js'
import * as liquidityCopy from '../../copy/liquidity.js'
import type { LiveLiquidityServices } from '../LiveLiquidityControls.js'
import type { LiveWorkflowContext } from './liveTradingTypes.js'
import { useQuotedTransaction } from './useQuotedTransaction.js'
import { estimateLiquidity } from './liquidityEstimate.js'

type LiquidityQuote = Awaited<ReturnType<LiveLiquidityServices['simulateLiquidity']>>

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

/** Everything a liquidity quote prices: the exact reserves, LP supply, pool rate, and lifecycle state. */
function liquidityQuoteBasis(market: LiveMarket) {
	return [market.pool, market.pair ?? '', market.yesReserve, market.noReserve, market.lpTotalSupply, market.settlementCollateralAttoEth, market.shareTokenSupplyAttoShares, market.tradingStatus ?? '', market.systemState, market.questionOutcome, market.universeForkTime, market.awaitingForkContinuation ? 1 : 0].join(':')
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
	const quotable = account !== undefined && walletClient !== undefined && balanceState === 'ready' && operationAvailable && parsed !== undefined && parsed > 0n && (operation !== 'initialize' || conditionalBps !== undefined)
	// The key names every input the quote prices, so a background refresh that moves the pool retires the quote and re-quotes.
	const quoteKey = quotable ? [account, configuration.chainId, configuration.router, liquidityQuoteBasis(market), operation, parsed, conditionalBps ?? '', settings.slippageBps, settings.validityMinutes].join('|') : undefined
	const transaction = useQuotedTransaction<LiquidityQuote>({
		operation: 'liquidity',
		label: liquidityCopy.liquidityTransaction,
		activityTitle: workflowCopy.formatLiquidityActivity(market.title),
		account,
		chainId: configuration.chainId,
		market: market.pool,
		walletClient,
		externallyLocked,
		quoteSource: {
			key: quoteKey,
			load: async () => {
				if (account === undefined || walletClient === undefined || parsed === undefined) throw new Error(liquidityCopy.quoteUnavailable)
				return await services.simulateLiquidity(walletClient, configuration, market, account, operation, parsed, conditionalBps ?? 5_000n, settings.validityMinutes, settings.slippageBps)
			},
		},
		onWorkflowLockChange,
		onKnownReceipt,
		failureFallback: liquidityCopy.transactionFailed,
		quoteFailureFallback: liquidityCopy.quoteFailed,
	})
	const { quote } = transaction
	// Without a wallet quote, the public pool state still prices the amount.
	const estimate = quotable || parsed === undefined ? undefined : estimateLiquidity(market, operation, parsed, conditionalBps)
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
		if (walletClient === undefined || account === undefined || quote === undefined || transaction.workflowLocked) return
		if (!liquidityOperationAvailable(quote.operation, quote.market, nowSeconds)) {
			transaction.dispatchWorkflow({ type: 'failed', operation: 'liquidity', message: liquidityCopy.closedToAdditions })
			return
		}
		await transaction.submit({
			prepare: async () => {
				await executeWithCurrentWalletContext(account, 'Wallet network changed; switch back before submitting', 'Wallet account changed; reconnect and try again', async () => undefined)
				// Simulate again right before signing: the quoted minimums stay, the deadline starts now.
				const fresh = await withReadTimeout(services.simulateLiquidity(walletClient, configuration, quote.market, account, quote.operation, quote.amount, quote.conditionalYesBps, settings.validityMinutes, quote.slippageBps))
				return { ...quote, deadline: fresh.deadline }
			},
			send: async (prepared, requestSignature) => {
				const guarded = createGuardedWalletWrite(account, 'Wallet network changed during liquidity revalidation; reconnect and try again', 'Wallet account changed during liquidity revalidation; reconnect and try again')
				// submitFreshLiquidity re-simulates at the latest block and keeps the quoted minimums.
				return await services.submitFreshLiquidity(walletClient, configuration, account, prepared, async write => await guarded(async () => await requestSignature(write)))
			},
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

import type { Address, WalletClient } from '@zoltar/core-shared/evm/ethereum'
import { withReadTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import type { LiveMarket, SettlementOperation, ShareOutcome } from '../../protocol/live.js'
import type { TradeSettings } from '../../lib/tradeSettings.js'
import * as settlementCopy from '../../copy/settlement.js'
import type { LiveSettlementServices } from '../LiveSettlementControls.js'
import type { GuardedWalletWrite } from '../liveTradingControllerHelpers.js'
import type { BalanceState } from './liveTradingTypes.js'
import { useQuotedTransaction } from './useQuotedTransaction.js'

type SettlementSimulation = Awaited<ReturnType<LiveSettlementServices['simulate']>>

export function useSettlementWorkflowController({
	configuration,
	market,
	account,
	walletClient,
	externallyLocked,
	balanceState,
	operation,
	parsedAmount,
	sourceOutcome,
	targetOutcomeIndexes,
	inputBlocker,
	contextKey,
	settings,
	refresh,
	onKnownReceipt,
	executeWithCurrentWalletContext,
	createGuardedWalletWrite,
	onWorkflowLockChange,
	onMigrationConfirmed,
	services,
}: {
	configuration: DeploymentConfiguration
	market: LiveMarket
	account: Address | undefined
	walletClient: WalletClient | undefined
	externallyLocked: boolean
	balanceState: BalanceState
	operation: SettlementOperation
	parsedAmount: bigint | undefined
	sourceOutcome: ShareOutcome
	targetOutcomeIndexes: readonly bigint[]
	inputBlocker: string | undefined
	/** Every input and pool field the settlement quote depends on; a change re-quotes. */
	contextKey: string
	settings: TradeSettings
	refresh(): Promise<void>
	onKnownReceipt(): void
	executeWithCurrentWalletContext<T>(account: Address, networkFailure: string, accountFailure: string, action: () => Promise<T>): Promise<T>
	createGuardedWalletWrite(account: Address, networkFailure: string, accountFailure: string): GuardedWalletWrite
	onWorkflowLockChange(locked: boolean): void
	onMigrationConfirmed(): void
	services: LiveSettlementServices
}) {
	const simulationParameters = (): Readonly<{ amount?: bigint; validityMinutes?: bigint; slippageBps?: bigint; sourceOutcome?: ShareOutcome; targetOutcomeIndexes?: readonly bigint[] }> => {
		if (operation === 'redeem-complete-set' && parsedAmount !== undefined) return { amount: parsedAmount, validityMinutes: settings.validityMinutes, slippageBps: settings.slippageBps }
		if (operation === 'migrate-shares') return { sourceOutcome, targetOutcomeIndexes }
		return {}
	}
	const quotable = account !== undefined && walletClient !== undefined && balanceState === 'ready' && inputBlocker === undefined
	const transaction = useQuotedTransaction<SettlementSimulation>({
		operation: 'settlement',
		label: settlementCopy.settlementTransaction,
		account,
		chainId: configuration.chainId,
		market: market.pool,
		walletClient,
		externallyLocked,
		quoteSource: {
			key: quotable ? `${contextKey}\u0000${settings.slippageBps.toString()}\u0000${settings.validityMinutes.toString()}` : undefined,
			load: async () => {
				if (account === undefined || walletClient === undefined) throw new Error(settlementCopy.quoteUnavailable)
				return await services.simulate(walletClient, configuration, market, account, operation, simulationParameters())
			},
		},
		onWorkflowLockChange,
		onKnownReceipt,
		failureFallback: settlementCopy.transactionFailed,
		quoteFailureFallback: settlementCopy.quoteFailed,
	})

	async function submitCurrent() {
		const selectedQuote = transaction.quote
		if (walletClient === undefined || account === undefined || selectedQuote === undefined || transaction.workflowLocked) return
		await transaction.submit({
			prepare: async () => {
				await executeWithCurrentWalletContext(account, 'Wallet network changed; switch back before submitting', 'Wallet account changed; reconnect and try again', async () => undefined)
				// Simulate again right before signing; a redemption keeps the quoted minimum but gets a fresh deadline.
				const fresh = await withReadTimeout(services.simulate(walletClient, configuration, selectedQuote.market, account, selectedQuote.operation, simulationParameters()))
				return selectedQuote.operation === 'redeem-complete-set' && fresh.operation === 'redeem-complete-set' ? { ...selectedQuote, deadline: fresh.deadline } : selectedQuote
			},
			send: async (prepared, requestSignature) => {
				const guarded = createGuardedWalletWrite(account, 'Wallet network changed during settlement revalidation; reconnect and try again', 'Wallet account changed during settlement revalidation; reconnect and try again')
				// The settlement services re-simulate at the latest block before writing and keep the quoted minimums.
				return await services.submit(walletClient, configuration, account, prepared, async write => await guarded(async () => await requestSignature(write)))
			},
			afterConfirmed: async prepared => {
				await refresh()
				if (prepared.operation === 'migrate-shares') onMigrationConfirmed()
			},
		})
	}

	return { transaction, invalidateInputs: () => transaction.invalidate(), submitCurrent }
}

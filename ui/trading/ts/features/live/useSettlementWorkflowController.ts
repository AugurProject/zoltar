import * as workflowCopy from '../../copy/workflows.js'
import type { SettlementOperation, ShareOutcome } from '../../protocol/live.js'
import * as settlementCopy from '../../copy/settlement.js'
import type { LiveSettlementServices } from '../LiveSettlementControls.js'
import type { LiveWorkflowContext } from './liveTradingTypes.js'
import { useTransactionSubmission } from './useTransactionSubmission.js'

import { sellHoldingFeeBlocker } from '../../protocol/holdingFees.js'
import { minimumAfterSlippage } from '../../protocol/tradeQuote.js'
import type { SettlementApproval } from '../../protocol/settlement.js'

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
	settings,
	refresh,
	onKnownReceipt,
	executeWithCurrentWalletContext,
	createGuardedWalletWrite,
	onWorkflowLockChange,
	onMigrationConfirmed,
	onRedemptionConfirmed,
	services,
}: LiveWorkflowContext &
	Readonly<{
		operation: SettlementOperation
		parsedAmount: bigint | undefined
		sourceOutcome: ShareOutcome
		targetOutcomeIndexes: readonly bigint[]
		inputBlocker: string | undefined
		onMigrationConfirmed(): void
		onRedemptionConfirmed?(): void
		services: LiveSettlementServices
	}>) {
	let approval: SettlementApproval | undefined
	if (inputBlocker === undefined) {
		if (operation === 'redeem-complete-set' && parsedAmount !== undefined && market.shareTokenSupplyAttoShares > 0n) {
			const expectedAttoEth = (parsedAmount * market.settlementCollateralAttoEth) / market.shareTokenSupplyAttoShares
			if (expectedAttoEth > 0n) approval = { operation, market, amount: parsedAmount, expectedAttoEth, minimumAttoEth: minimumAfterSlippage(expectedAttoEth, settings.slippageBps), slippageBps: settings.slippageBps, deadline: { validityMinutes: settings.validityMinutes } }
		} else if (operation === 'migrate-shares') approval = { operation, market, sourceOutcome, targetOutcomeIndexes }
		else if (operation === 'redeem-winning-shares') approval = { operation, market }
	}
	let previewBlocker: string | undefined
	if (approval === undefined) previewBlocker = settlementCopy.zeroRedemptionReason
	else if (approval.operation === 'redeem-complete-set') previewBlocker = sellHoldingFeeBlocker(market, approval.amount, approval.minimumAttoEth, (market.valuation?.timestamp ?? 0n) + settings.validityMinutes * 60n)
	const transaction = useTransactionSubmission({
		operation: 'settlement',
		label: settlementCopy.settlementTransaction,
		activityTitle: workflowCopy.formatSettlementActivity(market.title),
		account,
		chainId: configuration.chainId,
		market: market.pool,
		walletClient,
		externallyLocked,
		onWorkflowLockChange,
		onKnownReceipt,
		failureFallback: settlementCopy.transactionFailed,
	})

	async function submitCurrent() {
		const selectedQuote = approval
		if (walletClient === undefined || account === undefined || selectedQuote === undefined || balanceState !== 'ready' || previewBlocker !== undefined || transaction.workflowLocked) return
		await transaction.submit({
			prepare: async () => {
				await executeWithCurrentWalletContext(account, 'Wallet network changed; switch back before submitting', 'Wallet account changed; reconnect and try again', async () => undefined)
				return selectedQuote
			},
			send: async (prepared, requestSignature) => {
				const guarded = createGuardedWalletWrite(account, 'Wallet network changed during settlement revalidation; reconnect and try again', 'Wallet account changed during settlement revalidation; reconnect and try again')
				// The settlement services re-simulate at the latest block before writing and keep the approved minimums.
				return await services.submit(walletClient, configuration, account, prepared, async write => await guarded(async () => await requestSignature(write)))
			},
			afterConfirmed: async prepared => {
				if (prepared.operation !== 'migrate-shares') onRedemptionConfirmed?.()
				await refresh()
				if (prepared.operation === 'migrate-shares') onMigrationConfirmed()
			},
		})
	}

	return { approval, previewBlocker, transaction, invalidateInputs: () => transaction.invalidate(), submitCurrent }
}

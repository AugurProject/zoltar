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
	nowSeconds,
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
	let previewApproval: SettlementApproval | undefined
	if (inputBlocker === undefined) {
		if (operation === 'redeem-complete-set' && parsedAmount !== undefined && market.shareTokenSupplyAttoShares > 0n) {
			const expectedAttoEth = (parsedAmount * market.settlementCollateralAttoEth) / market.shareTokenSupplyAttoShares
			if (expectedAttoEth > 0n) previewApproval = { operation, market, amount: parsedAmount, expectedAttoEth, minimumAttoEth: minimumAfterSlippage(expectedAttoEth, settings.slippageBps), slippageBps: settings.slippageBps, deadline: { validityMinutes: settings.validityMinutes } }
		} else if (operation === 'migrate-shares') previewApproval = { operation, market, sourceOutcome, targetOutcomeIndexes }
		else if (operation === 'redeem-winning-shares') previewApproval = { operation, market }
	}
	let previewBlocker: string | undefined
	if (previewApproval === undefined) previewBlocker = settlementCopy.zeroRedemptionReason
	else if (previewApproval.operation === 'redeem-complete-set') previewBlocker = sellHoldingFeeBlocker(market, previewApproval.amount, previewApproval.minimumAttoEth, nowSeconds + settings.validityMinutes * 60n)
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
		const approval = previewApproval
		if (walletClient === undefined || account === undefined || approval === undefined || balanceState !== 'ready' || previewBlocker !== undefined || transaction.workflowLocked) return
		await transaction.submit({
			prepare: async () => {
				await executeWithCurrentWalletContext(account, 'Wallet network changed. Switch back before submitting.', 'Wallet account changed. Reconnect and try again.', async () => undefined)
				return approval
			},
			send: async (prepared, requestSignature) => {
				const guarded = createGuardedWalletWrite(account, 'Wallet network changed while the transaction was checked. Reconnect and try again.', 'Wallet account changed while the transaction was checked. Reconnect and try again.')
				// The settlement services re-simulate at the latest block before writing and keep the approved minimums.
				return await services.submit(walletClient, configuration, account, prepared, async write => await guarded(async () => await requestSignature(write)))
			},
			afterSlippageRejected: async () => await refresh({ background: true }),
			afterConfirmed: async prepared => {
				if (prepared.operation !== 'migrate-shares') onRedemptionConfirmed?.()
				await refresh()
				if (prepared.operation === 'migrate-shares') onMigrationConfirmed()
			},
		})
	}

	return { approval: previewApproval, previewBlocker, transaction, invalidateInputs: () => transaction.invalidate(), submitCurrent }
}

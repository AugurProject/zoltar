import { useCallback, useRef, useState } from 'preact/hooks'
import type { Address, WalletClient } from '@zoltar/core-shared/evm/ethereum'
import * as workflowCopy from '../../copy/workflows.js'
import { transactionMarketKey } from './transactionWorkflow.js'
import { useQuotedTransaction } from './useQuotedTransaction.js'

export type TradeMode = 'entry' | 'exit'

type TicketInputs = Readonly<{
	mode: TradeMode
	side: 'YES' | 'NO'
	amount: string
	/** The impact the user accepted; a later estimate with a higher impact needs a new acknowledgment. */
	acknowledgedImpactBps: bigint | undefined
}>

// Amount fields start empty: a prefilled value reads like a recommendation.
const emptyTicketInputs: TicketInputs = { mode: 'entry', side: 'YES', amount: '', acknowledgedImpactBps: undefined }

/**
 * Trade-ticket inputs plus the shared quoted-transaction engine, both kept per market: a trade running on one market
 * leaves every other market's ticket free. The liquidity or settlement panel on screen reports its own lock, which
 * holds that market's trade ticket too.
 */
export function useTransactionWorkflow({
	onWorkflowLockChange,
	account,
	chainId,
	market,
	marketTitle,
	walletClient,
}: {
	onWorkflowLockChange(locked: boolean): void
	account: Address | undefined
	chainId: number | undefined
	market: Address | undefined
	marketTitle?: string | undefined
	walletClient: WalletClient | undefined
}) {
	const currentMarket = transactionMarketKey(market)
	const [ticketInputs, setTicketInputs] = useState<Readonly<Record<string, TicketInputs>>>({})
	const inputs = ticketInputs[currentMarket] ?? emptyTicketInputs
	const updateInputs = (target: string, update: Partial<TicketInputs>) => setTicketInputs(current => ({ ...current, [target]: { ...(current[target] ?? emptyTicketInputs), ...update } }))
	const liquidityWorkflowLockedRef = useRef(false)
	const knownReceiptRef = useRef<() => void>(() => undefined)
	// The ref answers synchronous checks inside callbacks; the state re-renders the tickets when a lock changes.
	const positionLockedMarketsRef = useRef(new Set<string>()).current
	const [positionLockedMarkets, setPositionLockedMarkets] = useState<readonly string[]>([])
	const [liquidityWorkflowLocked, setLiquidityWorkflowLocked] = useState(false)
	const reportLock = useCallback(() => onWorkflowLockChange(positionLockedMarketsRef.size > 0 || liquidityWorkflowLockedRef.current), [onWorkflowLockChange])
	const updatePositionWorkflowLock = useCallback(
		(locked: boolean, lockedMarket: string) => {
			if (locked) positionLockedMarketsRef.add(lockedMarket)
			else positionLockedMarketsRef.delete(lockedMarket)
			setPositionLockedMarkets([...positionLockedMarketsRef])
			reportLock()
		},
		[reportLock],
	)
	const updateLiquidityWorkflowLock = useCallback(
		(locked: boolean) => {
			liquidityWorkflowLockedRef.current = locked
			setLiquidityWorkflowLocked(locked)
			reportLock()
		},
		[reportLock],
	)
	const transaction = useQuotedTransaction({
		operation: 'trade',
		label: workflowCopy.tradeLabel,
		activityTitle: marketTitle === undefined ? undefined : workflowCopy.formatTradeActivity(marketTitle),
		account,
		chainId,
		market,
		walletClient,
		externallyLocked: liquidityWorkflowLocked,
		onWorkflowLockChange: updatePositionWorkflowLock,
		onKnownReceipt: () => knownReceiptRef.current(),
		failureFallback: workflowCopy.tradeFailed,
		resetOnIdentityChange: false,
	})

	return {
		...inputs,
		setMode: (mode: TradeMode) => updateInputs(currentMarket, { mode }),
		setSide: (side: 'YES' | 'NO') => updateInputs(currentMarket, { side }),
		setAmount: (amount: string) => updateInputs(currentMarket, { amount }),
		setAcknowledgedImpactBps: (acknowledgedImpactBps: bigint | undefined) => updateInputs(currentMarket, { acknowledgedImpactBps }),
		/** Clears the amount a confirmed trade used on its own market, whichever market is on screen by then. */
		clearConfirmedAmount: (confirmedMarket: Address) => updateInputs(transactionMarketKey(confirmedMarket), { amount: '', acknowledgedImpactBps: undefined }),
		transaction,
		dispatchWorkflow: transaction.dispatchWorkflow,
		resetUnlocked: transaction.resetUnlocked,
		invalidateWalletContext: transaction.invalidateWalletContext,
		state: transaction.state,
		positionHash: transaction.transactionHash,
		message: transaction.error,
		positionReceiptWarning: transaction.receiptWarning,
		/** True while a trade on the given market holds its lock. */
		isPositionLocked: (target: Address | undefined) => positionLockedMarketsRef.has(transactionMarketKey(target)),
		/** True while any trade or the liquidity or settlement panel on screen holds a lock (wallet changes wait for all). */
		anyWorkflowLocked: () => positionLockedMarketsRef.size > 0 || liquidityWorkflowLockedRef.current,
		liquidityWorkflowLockedRef,
		knownReceiptRef,
		/** Any lock at all: wallet connection and network switching wait for every running transaction. */
		workflowLocked: positionLockedMarkets.length > 0 || liquidityWorkflowLocked,
		/** Whether the market on screen has its own trade or panel lock. */
		marketWorkflowLocked: positionLockedMarkets.includes(currentMarket) || liquidityWorkflowLocked,
		updateLiquidityWorkflowLock,
	}
}

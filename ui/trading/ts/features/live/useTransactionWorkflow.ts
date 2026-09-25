import { useCallback, useRef, useState } from 'preact/hooks'
import type { Address, WalletClient } from '@zoltar/core-shared/evm/ethereum'
import * as workflowCopy from '../../copy/workflows.js'
import { useQuotedTransaction } from './useQuotedTransaction.js'

export type TradeMode = 'entry' | 'exit'

/** Trade-ticket inputs plus the shared quoted-transaction engine; the position and liquidity locks are tracked together so neither can start while the other runs. */
export function useTransactionWorkflow({ onWorkflowLockChange, account, chainId, market, walletClient }: { onWorkflowLockChange(locked: boolean): void; account: Address | undefined; chainId: number | undefined; market: Address | undefined; walletClient: WalletClient | undefined }) {
	const [mode, setMode] = useState<TradeMode>('entry')
	const [side, setSide] = useState<'YES' | 'NO'>('YES')
	// Amount fields start empty: a prefilled value reads like a recommendation.
	const [amount, setAmount] = useState('')
	const [impactAcknowledged, setImpactAcknowledged] = useState(false)
	const positionWorkflowLockedRef = useRef(false)
	const liquidityWorkflowLockedRef = useRef(false)
	const knownReceiptRef = useRef<() => void>(() => undefined)
	const [positionWorkflowLocked, setPositionWorkflowLocked] = useState(false)
	const [liquidityWorkflowLocked, setLiquidityWorkflowLocked] = useState(false)
	const workflowLocked = positionWorkflowLocked || liquidityWorkflowLocked
	const updatePositionWorkflowLock = useCallback(
		(locked: boolean) => {
			positionWorkflowLockedRef.current = locked
			setPositionWorkflowLocked(locked)
			onWorkflowLockChange(positionWorkflowLockedRef.current || liquidityWorkflowLockedRef.current)
		},
		[onWorkflowLockChange],
	)
	const updateLiquidityWorkflowLock = useCallback(
		(locked: boolean) => {
			liquidityWorkflowLockedRef.current = locked
			setLiquidityWorkflowLocked(locked)
			onWorkflowLockChange(positionWorkflowLockedRef.current || liquidityWorkflowLockedRef.current)
		},
		[onWorkflowLockChange],
	)
	const transaction = useQuotedTransaction({
		operation: 'trade',
		label: workflowCopy.tradeLabel,
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
		mode,
		setMode,
		side,
		setSide,
		amount,
		setAmount,
		impactAcknowledged,
		setImpactAcknowledged,
		transaction,
		dispatchWorkflow: transaction.dispatchWorkflow,
		state: transaction.state,
		positionHash: transaction.transactionHash,
		message: transaction.error,
		positionReceiptWarning: transaction.receiptWarning,
		positionWorkflowLockedRef,
		liquidityWorkflowLockedRef,
		knownReceiptRef,
		workflowLocked,
		updateLiquidityWorkflowLock,
	}
}

import { useCallback, useEffect, useReducer, useRef, useState } from 'preact/hooks'
import { createExclusiveWorkflowGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import type { Quote } from './liveTradingTypes.js'
import * as workflowCopy from '../../copy/workflows.js'
import { idleTransactionWorkflow, transactionPhase, transactionWorkflowError, transactionWorkflowHash, transactionWorkflowReceiptWarning, transactionWorkflowReducer } from './transactionWorkflow.js'

export function useTransactionWorkflow(onWorkflowLockChange: (locked: boolean) => void, defaultSlippage: string, defaultValidityMinutes: string) {
	const [mode, setMode] = useState<'entry' | 'exit'>('entry')
	const [side, setSide] = useState<'YES' | 'NO'>('YES')
	const [amount, setAmount] = useState('0.01')
	const [slippage, setSlippage] = useState(defaultSlippage)
	const [transactionValidityMinutes, setTransactionValidityMinutes] = useState(defaultValidityMinutes)
	const [quote, setQuote] = useState<Quote>()
	const [workflowState, dispatchWorkflow] = useReducer(transactionWorkflowReducer, idleTransactionWorkflow)
	const state = transactionPhase(workflowState)
	const positionHash = transactionWorkflowHash(workflowState)
	const message = transactionWorkflowError(workflowState, workflowCopy.tradeTransactionReverted)
	const positionReceiptWarning = transactionWorkflowReceiptWarning(workflowState)
	const positionWorkflow = useRef(createExclusiveWorkflowGuard()).current
	const positionWorkflowLockedRef = useRef(false)
	const liquidityWorkflowLockedRef = useRef(false)
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

	useEffect(
		() => () => {
			if (positionWorkflow.isActive()) positionWorkflow.finish()
			onWorkflowLockChange(false)
		},
		[onWorkflowLockChange, positionWorkflow],
	)

	return {
		mode,
		setMode,
		side,
		setSide,
		amount,
		setAmount,
		slippage,
		setSlippage,
		transactionValidityMinutes,
		setTransactionValidityMinutes,
		quote,
		setQuote,
		workflowState,
		dispatchWorkflow,
		state,
		positionHash,
		message,
		positionReceiptWarning,
		positionWorkflow,
		positionWorkflowLockedRef,
		liquidityWorkflowLockedRef,
		workflowLocked,
		updatePositionWorkflowLock,
		updateLiquidityWorkflowLock,
	}
}

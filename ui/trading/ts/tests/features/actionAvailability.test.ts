import { describe, expect, test } from 'bun:test'
import { resolveLiquidityAvailability, resolveSettlementAvailability, type LiquidityAvailabilityInputs, type SettlementAvailabilityInputs } from '../../features/live/actionAvailability.js'
import { resolveActionGroupMessage, transactionPendingLabel, transactionStatusText } from '../../features/live/transactionPresentation.js'
import * as copy from '../../copy/availability.js'

const eth = 10n ** 18n
const shares = 10n ** 36n

const readyLiquidity: LiquidityAvailabilityInputs = {
	walletConnected: true,
	networkMismatchReason: undefined,
	balanceState: 'ready',
	operation: 'add',
	marketClosed: false,
	requestedAmount: eth,
	walletEthAttoEth: 5n * eth,
	lpBalance: 2n * shares,
	initializePriceValid: true,
	workflowLocked: false,
	quoteState: 'ready',
	quoteError: undefined,
}

const readySettlement: SettlementAvailabilityInputs = {
	walletConnected: true,
	networkMismatchReason: undefined,
	balanceState: 'ready',
	inputBlocker: undefined,
	workflowLocked: false,
	quoteState: 'ready',
	quoteError: undefined,
}

describe('liquidity action availability', () => {
	test('compares additions against ETH and removals against LP tokens', () => {
		expect(resolveLiquidityAvailability(readyLiquidity).disabled).toBeFalse()
		expect(resolveLiquidityAvailability({ ...readyLiquidity, requestedAmount: 6n * eth }).reason).toBe(copy.insufficientEthReason)
		expect(resolveLiquidityAvailability({ ...readyLiquidity, operation: 'initialize', requestedAmount: 6n * eth }).reason).toBe(copy.insufficientEthReason)
		expect(resolveLiquidityAvailability({ ...readyLiquidity, operation: 'remove', requestedAmount: 3n * shares }).reason).toBe(copy.insufficientLpReason)
		expect(resolveLiquidityAvailability({ ...readyLiquidity, operation: 'remove', requestedAmount: 2n * shares }).disabled).toBeFalse()
		expect(resolveLiquidityAvailability({ ...readyLiquidity, operation: 'remove', requestedAmount: 3n * shares, lpBalance: undefined }).disabled).toBeFalse()
	})

	test('closed markets block additions but not removals', () => {
		expect(resolveLiquidityAvailability({ ...readyLiquidity, marketClosed: true }).reason).toBe(copy.marketClosedReason)
		expect(resolveLiquidityAvailability({ ...readyLiquidity, operation: 'remove', requestedAmount: shares, marketClosed: true }).disabled).toBeFalse()
	})

	test('orders wallet, balance, amount, price, workflow, and quote blockers', () => {
		const blocked: LiquidityAvailabilityInputs = { ...readyLiquidity, walletConnected: false, balanceState: 'disconnected', requestedAmount: undefined, operation: 'initialize', initializePriceValid: false, workflowLocked: true, quoteState: 'error', quoteError: 'Quote failed.' }
		expect(resolveLiquidityAvailability(blocked).reason).toBe(copy.connectWalletReason)
		expect(resolveLiquidityAvailability({ ...blocked, walletConnected: true, networkMismatchReason: 'Switch to Local.' }).reason).toBe('Switch to Local.')
		expect(resolveLiquidityAvailability({ ...blocked, walletConnected: true, balanceState: 'loading' })).toEqual({ disabled: true, loading: true, reason: copy.balancesLoadingReason })
		expect(resolveLiquidityAvailability({ ...blocked, walletConnected: true, balanceState: 'ready' }).reason).toBe(copy.amountRequiredReason)
		expect(resolveLiquidityAvailability({ ...blocked, walletConnected: true, balanceState: 'ready', requestedAmount: eth }).reason).toBe(copy.initializePriceInvalidReason)
		expect(resolveLiquidityAvailability({ ...blocked, walletConnected: true, balanceState: 'ready', requestedAmount: eth, initializePriceValid: true }).reason).toBe(copy.transactionInProgressReason)
		expect(resolveLiquidityAvailability({ ...blocked, walletConnected: true, balanceState: 'ready', requestedAmount: eth, initializePriceValid: true, workflowLocked: false }).reason).toBe('Quote failed.')
		expect(resolveLiquidityAvailability({ ...readyLiquidity, quoteState: 'loading' })).toEqual({ disabled: true, loading: true, reason: copy.quoteLoadingReason })
		expect(resolveLiquidityAvailability({ ...readyLiquidity, quoteState: 'error', quoteError: undefined }).reason).toBe(copy.quoteUnavailableReason)
	})
})

describe('settlement action availability', () => {
	test('orders wallet, balance, input, workflow, and quote blockers', () => {
		expect(resolveSettlementAvailability(readySettlement).disabled).toBeFalse()
		const blocked: SettlementAvailabilityInputs = { ...readySettlement, walletConnected: false, balanceState: 'error', inputBlocker: 'Select at least one child branch', workflowLocked: true, quoteState: 'idle' }
		expect(resolveSettlementAvailability(blocked).reason).toBe(copy.connectWalletReason)
		expect(resolveSettlementAvailability({ ...blocked, networkMismatchReason: 'Switch to Local.' }).reason).toBe('Switch to Local.')
		expect(resolveSettlementAvailability({ ...blocked, walletConnected: true }).reason).toBe(copy.balancesUnavailableReason)
		expect(resolveSettlementAvailability({ ...blocked, walletConnected: true, balanceState: 'ready' }).reason).toBe('Select at least one child branch')
		expect(resolveSettlementAvailability({ ...blocked, walletConnected: true, balanceState: 'ready', inputBlocker: undefined }).reason).toBe(copy.transactionInProgressReason)
		expect(resolveSettlementAvailability({ ...blocked, walletConnected: true, balanceState: 'ready', inputBlocker: undefined, workflowLocked: false })).toEqual({ disabled: true, loading: true, reason: copy.quoteLoadingReason })
		expect(resolveSettlementAvailability({ ...readySettlement, balanceState: 'loading' })).toEqual({ disabled: true, loading: true, reason: copy.balancesLoadingReason })
		expect(resolveSettlementAvailability({ ...readySettlement, inputBlocker: 'Loading fork details…', inputBlockerLoading: true })).toEqual({ disabled: true, loading: true, reason: 'Loading fork details…' })
		expect(resolveSettlementAvailability({ ...readySettlement, inputBlocker: 'Select at least one child branch' }).loading).toBeUndefined()
	})
})

describe('transaction presentation', () => {
	test('steps the pending label from the price check to the wallet to the chain', () => {
		expect(transactionPendingLabel('preparing')).toBe('Checking price…')
		expect(transactionPendingLabel('submitting')).toBe('Confirm in wallet…')
		expect(transactionPendingLabel('pending')).toBe('Waiting for confirmation…')
	})

	test('names each phase by the action the user pressed', () => {
		expect(transactionStatusText('idle', 'Buy YES')).toBeUndefined()
		expect(transactionStatusText('preparing', 'Buy YES')).toBe('Buy YES: checking the latest price before your wallet opens…')
		expect(transactionStatusText('submitting', 'Buy YES')).toBe('Buy YES: confirm in your wallet.')
		expect(transactionStatusText('pending', 'Buy YES')).toBe('Buy YES sent. Waiting for confirmation…')
		expect(transactionStatusText('confirmed', 'Buy YES')).toBe('Buy YES confirmed.')
		expect(transactionStatusText('error', 'Buy YES')).toBeUndefined()
	})

	test('shows the blocking reason for idle and failed actions and keeps progress text otherwise', () => {
		const blocked = { disabled: true, reason: 'Insufficient balance.' }
		expect(resolveActionGroupMessage('idle', blocked, undefined)).toBe('Insufficient balance.')
		expect(resolveActionGroupMessage('error', blocked, undefined)).toBe('Insufficient balance.')
		expect(resolveActionGroupMessage('idle', { disabled: false, reason: undefined }, undefined)).toBeUndefined()
		expect(resolveActionGroupMessage('pending', blocked, 'Buy YES sent. Waiting for confirmation…')).toBe('Buy YES sent. Waiting for confirmation…')
		expect(resolveActionGroupMessage('confirmed', { disabled: true, reason: 'Transaction in progress.' }, 'Buy YES confirmed.')).toBe('Buy YES confirmed.')
	})
})

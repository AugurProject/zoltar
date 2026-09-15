import { describe, expect, test } from 'bun:test'
import {
	resolveActionGroupMessage,
	resolveLiquiditySimulateAvailability,
	resolveLiquiditySubmitAvailability,
	resolvePositionSimulateAvailability,
	resolvePositionSubmitAvailability,
	resolveSettlementSimulateAvailability,
	resolveSettlementSubmitAvailability,
	type LiquidityAvailabilityInputs,
	type PositionAvailabilityInputs,
	type SettlementAvailabilityInputs,
} from '../../features/live/actionAvailability.js'
import * as copy from '../../copy/availability.js'

const eth = 10n ** 18n
const shares = 10n ** 36n

const readyEntry: PositionAvailabilityInputs = {
	walletConnected: true,
	networkMismatchReason: undefined,
	balanceState: 'ready',
	mode: 'entry',
	side: 'YES',
	marketClosed: false,
	enteredAmount: eth,
	requestedAmount: eth,
	amountError: undefined,
	walletEthAttoEth: 5n * eth,
	outcomeBalance: 3n * shares,
	exceedsInsurance: false,
	exitTooSmall: false,
	protectionValid: true,
	workflowLocked: false,
}

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
	protectionValid: true,
	workflowLocked: false,
}

const readySettlement: SettlementAvailabilityInputs = {
	walletConnected: true,
	networkMismatchReason: undefined,
	balanceState: 'ready',
	inputBlocker: undefined,
	protectionValid: true,
	workflowLocked: false,
}

describe('position action availability', () => {
	test('enables simulation when every prerequisite holds', () => {
		expect(resolvePositionSimulateAvailability(readyEntry)).toEqual({ disabled: false, reason: undefined })
	})

	test('reports blockers in priority order', () => {
		const everythingWrong: PositionAvailabilityInputs = {
			...readyEntry,
			walletConnected: false,
			networkMismatchReason: 'Switch to Local.',
			balanceState: 'loading',
			marketClosed: true,
			enteredAmount: 0n,
			requestedAmount: 0n,
			walletEthAttoEth: 0n,
			exceedsInsurance: true,
			exitTooSmall: true,
			protectionValid: false,
			workflowLocked: true,
		}
		const expectedOrder: Array<[Partial<PositionAvailabilityInputs>, string]> = [
			[{}, 'Switch to Local.'],
			[{ networkMismatchReason: undefined }, copy.connectWalletReason],
			[{ networkMismatchReason: undefined, walletConnected: true }, copy.marketClosedReason],
			[{ networkMismatchReason: undefined, walletConnected: true, marketClosed: false }, copy.balancesLoadingReason],
			[{ networkMismatchReason: undefined, walletConnected: true, marketClosed: false, balanceState: 'error' }, copy.balancesUnavailableReason],
			[{ networkMismatchReason: undefined, walletConnected: true, marketClosed: false, balanceState: 'ready' }, copy.amountRequiredReason],
			[{ networkMismatchReason: undefined, walletConnected: true, marketClosed: false, balanceState: 'ready', amountError: 'Use no more than 18 decimal places' }, 'Use no more than 18 decimal places'],
			[{ networkMismatchReason: undefined, walletConnected: true, marketClosed: false, balanceState: 'ready', enteredAmount: eth, requestedAmount: eth }, copy.insufficientEthReason],
			[{ networkMismatchReason: undefined, walletConnected: true, marketClosed: false, balanceState: 'ready', enteredAmount: eth, requestedAmount: eth, walletEthAttoEth: eth }, copy.exitExceedsInsuranceReason],
			[{ networkMismatchReason: undefined, walletConnected: true, marketClosed: false, balanceState: 'ready', enteredAmount: eth, requestedAmount: eth, walletEthAttoEth: eth, exceedsInsurance: false }, copy.amountTooSmallReason],
			[{ networkMismatchReason: undefined, walletConnected: true, marketClosed: false, balanceState: 'ready', enteredAmount: eth, requestedAmount: eth, walletEthAttoEth: eth, exceedsInsurance: false, exitTooSmall: false }, copy.protectionInvalidReason],
			[{ networkMismatchReason: undefined, walletConnected: true, marketClosed: false, balanceState: 'ready', enteredAmount: eth, requestedAmount: eth, walletEthAttoEth: eth, exceedsInsurance: false, exitTooSmall: false, protectionValid: true }, copy.transactionInProgressReason],
		]
		for (const [overrides, reason] of expectedOrder) expect(resolvePositionSimulateAvailability({ ...everythingWrong, ...overrides })).toEqual(reason === copy.balancesLoadingReason ? { disabled: true, loading: true, reason } : { disabled: true, reason })
	})

	test('treats a wallet on another chain as connected but blocked', () => {
		expect(resolvePositionSimulateAvailability({ ...readyEntry, walletConnected: false, networkMismatchReason: 'Switch to Local.' }).reason).toBe('Switch to Local.')
		expect(resolvePositionSimulateAvailability({ ...readyEntry, walletConnected: true, networkMismatchReason: 'Switch to Local.' }).reason).toBe('Switch to Local.')
	})

	test('compares entries against the wallet ETH balance and exits against the outcome balance', () => {
		expect(resolvePositionSimulateAvailability({ ...readyEntry, enteredAmount: 6n * eth, requestedAmount: 6n * eth }).reason).toBe(copy.insufficientEthReason)
		expect(resolvePositionSimulateAvailability({ ...readyEntry, enteredAmount: 5n * eth, requestedAmount: 5n * eth }).disabled).toBeFalse()
		// An unknown wallet balance cannot prove failure, so it never blocks.
		expect(resolvePositionSimulateAvailability({ ...readyEntry, enteredAmount: 6n * eth, requestedAmount: 6n * eth, walletEthAttoEth: undefined }).disabled).toBeFalse()
		const exit: PositionAvailabilityInputs = { ...readyEntry, mode: 'exit', side: 'NO', enteredAmount: 4n * eth, requestedAmount: 4n * shares }
		expect(resolvePositionSimulateAvailability(exit).reason).toBe(copy.formatInsufficientOutcomeReason('NO'))
		expect(resolvePositionSimulateAvailability({ ...exit, requestedAmount: 3n * shares }).disabled).toBeFalse()
		expect(resolvePositionSimulateAvailability({ ...exit, requestedAmount: 4n * shares, walletEthAttoEth: 0n }).reason).toBe(copy.formatInsufficientOutcomeReason('NO'))
	})

	test('uses the insured-exit detail when the caller supplies one', () => {
		expect(resolvePositionSimulateAvailability({ ...readyEntry, mode: 'exit', exceedsInsurance: true, exceedsInsuranceDetail: 'Reduce the exit amount.' }).reason).toBe('Reduce the exit amount.')
	})

	test('submission additionally requires a ready quote', () => {
		expect(resolvePositionSubmitAvailability({ ...readyEntry, quoteReady: false })).toEqual({ disabled: true, reason: copy.quoteRequiredReason })
		expect(resolvePositionSubmitAvailability({ ...readyEntry, quoteReady: true })).toEqual({ disabled: false, reason: undefined })
		expect(resolvePositionSubmitAvailability({ ...readyEntry, workflowLocked: true, quoteReady: true }).reason).toBe(copy.transactionInProgressReason)
	})
})

describe('liquidity action availability', () => {
	test('compares additions against ETH and removals against LP tokens', () => {
		expect(resolveLiquiditySimulateAvailability(readyLiquidity).disabled).toBeFalse()
		expect(resolveLiquiditySimulateAvailability({ ...readyLiquidity, requestedAmount: 6n * eth }).reason).toBe(copy.insufficientEthReason)
		expect(resolveLiquiditySimulateAvailability({ ...readyLiquidity, operation: 'initialize', requestedAmount: 6n * eth }).reason).toBe(copy.insufficientEthReason)
		expect(resolveLiquiditySimulateAvailability({ ...readyLiquidity, operation: 'remove', requestedAmount: 3n * shares }).reason).toBe(copy.insufficientLpReason)
		expect(resolveLiquiditySimulateAvailability({ ...readyLiquidity, operation: 'remove', requestedAmount: 2n * shares }).disabled).toBeFalse()
		expect(resolveLiquiditySimulateAvailability({ ...readyLiquidity, operation: 'remove', requestedAmount: 3n * shares, lpBalance: undefined }).disabled).toBeFalse()
	})

	test('closed markets block additions but not removals', () => {
		expect(resolveLiquiditySimulateAvailability({ ...readyLiquidity, marketClosed: true }).reason).toBe(copy.marketClosedReason)
		expect(resolveLiquiditySimulateAvailability({ ...readyLiquidity, operation: 'remove', requestedAmount: shares, marketClosed: true }).disabled).toBeFalse()
	})

	test('orders wallet, balance, amount, price, protection, and workflow blockers', () => {
		const blocked: LiquidityAvailabilityInputs = { ...readyLiquidity, walletConnected: false, balanceState: 'disconnected', requestedAmount: undefined, operation: 'initialize', initializePriceValid: false, protectionValid: false, workflowLocked: true }
		expect(resolveLiquiditySimulateAvailability(blocked).reason).toBe(copy.connectWalletReason)
		expect(resolveLiquiditySimulateAvailability({ ...blocked, walletConnected: true, networkMismatchReason: 'Switch to Local.' }).reason).toBe('Switch to Local.')
		expect(resolveLiquiditySimulateAvailability({ ...blocked, walletConnected: true, balanceState: 'loading' }).reason).toBe(copy.balancesLoadingReason)
		expect(resolveLiquiditySimulateAvailability({ ...blocked, walletConnected: true, balanceState: 'ready' }).reason).toBe(copy.amountRequiredReason)
		expect(resolveLiquiditySimulateAvailability({ ...blocked, walletConnected: true, balanceState: 'ready', requestedAmount: eth }).reason).toBe(copy.initializePriceInvalidReason)
		expect(resolveLiquiditySimulateAvailability({ ...blocked, walletConnected: true, balanceState: 'ready', requestedAmount: eth, initializePriceValid: true }).reason).toBe(copy.protectionInvalidReason)
		expect(resolveLiquiditySimulateAvailability({ ...blocked, walletConnected: true, balanceState: 'ready', requestedAmount: eth, initializePriceValid: true, protectionValid: true }).reason).toBe(copy.transactionInProgressReason)
		expect(resolveLiquiditySubmitAvailability({ ...readyLiquidity, quoteReady: false }).reason).toBe(copy.quoteRequiredReason)
		expect(resolveLiquiditySubmitAvailability({ ...readyLiquidity, quoteReady: true }).disabled).toBeFalse()
	})
})

describe('settlement action availability', () => {
	test('orders wallet, balance, input, protection, workflow, and quote blockers', () => {
		expect(resolveSettlementSimulateAvailability(readySettlement).disabled).toBeFalse()
		const blocked: SettlementAvailabilityInputs = { ...readySettlement, walletConnected: false, balanceState: 'error', inputBlocker: 'Select at least one child branch', protectionValid: false, workflowLocked: true }
		expect(resolveSettlementSimulateAvailability(blocked).reason).toBe(copy.connectWalletReason)
		expect(resolveSettlementSimulateAvailability({ ...blocked, networkMismatchReason: 'Switch to Local.' }).reason).toBe('Switch to Local.')
		expect(resolveSettlementSimulateAvailability({ ...blocked, walletConnected: true }).reason).toBe(copy.balancesUnavailableReason)
		expect(resolveSettlementSimulateAvailability({ ...blocked, walletConnected: true, balanceState: 'ready' }).reason).toBe('Select at least one child branch')
		expect(resolveSettlementSimulateAvailability({ ...blocked, walletConnected: true, balanceState: 'ready', inputBlocker: undefined }).reason).toBe(copy.protectionInvalidReason)
		expect(resolveSettlementSimulateAvailability({ ...blocked, walletConnected: true, balanceState: 'ready', inputBlocker: undefined, protectionValid: true }).reason).toBe(copy.transactionInProgressReason)
		expect(resolveSettlementSubmitAvailability({ ...readySettlement, quoteReady: false }).reason).toBe(copy.quoteRequiredReason)
		expect(resolveSettlementSimulateAvailability({ ...readySettlement, balanceState: 'loading' })).toEqual({ disabled: true, loading: true, reason: copy.balancesLoadingReason })
		expect(resolveSettlementSimulateAvailability({ ...readySettlement, inputBlocker: 'Loading fork details…', inputBlockerLoading: true })).toEqual({ disabled: true, loading: true, reason: 'Loading fork details…' })
		expect(resolveSettlementSimulateAvailability({ ...readySettlement, inputBlocker: 'Select at least one child branch' }).loading).toBeUndefined()
		expect(resolveSettlementSubmitAvailability({ ...readySettlement, quoteReady: true }).disabled).toBeFalse()
	})
})

describe('resolveActionGroupMessage', () => {
	test('shows the blocking reason for idle and ready actions and keeps progress text otherwise', () => {
		const blocked = { disabled: true, reason: 'Insufficient balance.' }
		expect(resolveActionGroupMessage('idle', blocked, undefined)).toBe('Insufficient balance.')
		expect(resolveActionGroupMessage('ready', blocked, 'Authoritative simulation ready')).toBe('Insufficient balance.')
		expect(resolveActionGroupMessage('ready', { disabled: false, reason: undefined }, 'Authoritative simulation ready')).toBe('Authoritative simulation ready')
		expect(resolveActionGroupMessage('pending', blocked, 'Enter YES pending on-chain')).toBe('Enter YES pending on-chain')
		expect(resolveActionGroupMessage('confirmed', { disabled: true, reason: 'Transaction in progress.' }, 'Enter YES confirmed on-chain')).toBe('Enter YES confirmed on-chain')
	})
})

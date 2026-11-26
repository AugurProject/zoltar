import { describe, expect, test } from 'bun:test'
import { describeTransactionFailure, isSlippageFailure } from '../../protocol/transactionFailure.js'

// Shaped like viem's ContractFunctionExecutionError wrapping a ContractFunctionRevertedError.
function revertError(reason: string) {
	const cause = Object.assign(new Error(`The contract function "enterPosition" reverted with the following reason:\n${reason}`), { name: 'ContractFunctionRevertedError', reason })
	return Object.assign(new Error('Execution reverted'), { name: 'ContractFunctionExecutionError', shortMessage: 'The contract function "enterPosition" reverted.', cause })
}

describe('transaction failure explanations', () => {
	test.each([
		['Purchase fee exceeds budget', 'The purchase fee exceeded your funding budget.'],
		['Minimum REP output', 'The price moved past your slippage limit.'],
		['Exchange rate undefined', 'The amount is too small to trade.'],
		['Minimum long shares', 'The price moved past your slippage limit.'],
		['Liquidity price slippage', 'The price moved past your slippage limit.'],
		['Deadline expired', 'The transaction deadline passed.'],
		['LP permit or allowance', 'The liquidity permit expired or was already used.'],
		['Question ended', 'Trading has ended for this market.'],
		['Purchase exceeds healthy capacity', 'This question does not have enough minting capacity for this size.'],
		['Security pool backing insufficient', 'The security pool does not have enough backing for this size.'],
		['Net input is zero', 'The amount is too small to trade.'],
		['Already initialized', 'Someone already added the first liquidity.'],
	])('explains the %s revert string with a cause and a next step', (reason, cause) => {
		const message = describeTransactionFailure(revertError(reason), 'Trade failed')
		expect(message.startsWith(`${cause} `)).toBeTrue()
		expect(message.length).toBeGreaterThan(cause.length + 5)
	})

	test('finds a revert string in a plain message and in the pre-signing limit check', () => {
		expect(describeTransactionFailure(new Error('execution reverted: Swap slippage'), 'Trade failed')).toContain('The price moved past your slippage limit.')
		expect(describeTransactionFailure(new Error('Refreshed estimate no longer satisfies the approved minimum LP tokens'), 'Trade failed')).toContain('The price moved past your slippage limit.')
	})

	test('explains a pre-signing settlement deadline failure with expiration guidance', () => {
		expect(describeTransactionFailure(new Error('Transaction deadline has passed; try again'), 'Settlement transaction failed')).toBe('The transaction deadline passed. Try again, or allow more time in Settings.')
	})

	test('explains wallet cancellations and missing gas funds', () => {
		expect(describeTransactionFailure(Object.assign(new Error('User rejected the request.'), { code: 4001 }), 'Trade failed')).toBe('Canceled in wallet. Nothing was sent. Press the button again when ready.')
		expect(describeTransactionFailure(new Error('insufficient funds for gas * price + value'), 'Trade failed')).toBe('Your wallet has insufficient native funds for this transaction. Check the ETH available for gas and any ETH included in the payment.')
	})

	test('refreshes only slippage failures, excluding wallet cancellations and RPC failures', () => {
		expect(isSlippageFailure(revertError('Swap slippage'))).toBeTrue()
		expect(isSlippageFailure(revertError('Purchase fee exceeds budget'))).toBeTrue()
		expect(isSlippageFailure(revertError('Minimum REP output'))).toBeTrue()
		expect(isSlippageFailure(new Error('Refreshed estimate no longer satisfies the approved maximum NO deposit'))).toBeTrue()
		expect(isSlippageFailure(Object.assign(new Error('Swap slippage'), { code: 4001 }))).toBeFalse()
		expect(isSlippageFailure(new Error('RPC timed out'))).toBeFalse()
	})

	test('keeps unknown failures on the sanitized public message', () => {
		expect(describeTransactionFailure(new Error('RPC timed out'), 'Trade failed')).toBe('RPC timed out.')
		expect(describeTransactionFailure(new Error(`call args: 0x${'11'.repeat(20)}`), 'Trade failed')).toBe('Trade failed.')
		expect(describeTransactionFailure('not an error', 'Trade failed')).toBe('Trade failed.')
	})
})

test('#1759 purchase fee funding failure recommends a fresh quote without changing slippage', () => {
	const message = describeTransactionFailure(revertError('Purchase fee exceeds budget'), 'Trade failed')
	expect(message).toContain('purchase fee')
	expect(message.toLowerCase()).not.toContain('slippage')
	expect(message).toContain('Try again')
})

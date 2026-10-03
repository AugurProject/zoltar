import { describe, expect, test } from 'bun:test'
import { describeTransactionFailure, isSlippageFailure } from '../../protocol/transactionFailure.js'

// Shaped like viem's ContractFunctionExecutionError wrapping a ContractFunctionRevertedError.
function revertError(reason: string) {
	const cause = Object.assign(new Error(`The contract function "enterPosition" reverted with the following reason:\n${reason}`), { name: 'ContractFunctionRevertedError', reason })
	return Object.assign(new Error('Execution reverted'), { name: 'ContractFunctionExecutionError', shortMessage: 'The contract function "enterPosition" reverted.', cause })
}

describe('transaction failure explanations', () => {
	test.each([
		['Minimum long shares', 'The price moved past your slippage limit.'],
		['Liquidity price slippage', 'The price moved past your slippage limit.'],
		['Deadline expired', 'The transaction expired before it was mined.'],
		['Question ended', 'This market no longer accepts this action.'],
		['Over capacity', 'The security pool does not have enough minting capacity for this size.'],
		['Vault backing insufficient', 'The security pool does not have enough backing for this size.'],
		['Net input is zero', 'The amount is too small to trade.'],
		['Pair already initialized', 'Someone already added the first liquidity.'],
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
		expect(describeTransactionFailure(new Error('Transaction deadline has passed; try again'), 'Settlement transaction failed')).toBe('The transaction expired before it was mined. Try again, or allow more time in Settings.')
	})

	test('explains wallet cancellations and missing gas funds', () => {
		expect(describeTransactionFailure(Object.assign(new Error('User rejected the request.'), { code: 4001 }), 'Trade failed')).toBe('Action canceled in wallet. Nothing was sent. Press the button again when ready.')
		expect(describeTransactionFailure(new Error('insufficient funds for gas * price + value'), 'Trade failed')).toBe('Your wallet does not have enough ETH for this amount plus gas. Lower the amount or add ETH to your wallet.')
	})

	test('refreshes only slippage failures, excluding wallet cancellations and RPC failures', () => {
		expect(isSlippageFailure(revertError('Swap slippage'))).toBeTrue()
		expect(isSlippageFailure(new Error('Refreshed estimate no longer satisfies the approved maximum NO deposit'))).toBeTrue()
		expect(isSlippageFailure(Object.assign(new Error('Swap slippage'), { code: 4001 }))).toBeFalse()
		expect(isSlippageFailure(new Error('RPC timed out'))).toBeFalse()
	})

	test('keeps unknown failures on the sanitized public message', () => {
		expect(describeTransactionFailure(new Error('RPC timed out'), 'Trade failed')).toBe('RPC timed out')
		expect(describeTransactionFailure(new Error(`call args: 0x${'11'.repeat(20)}`), 'Trade failed')).toBe('Trade failed')
		expect(describeTransactionFailure('not an error', 'Trade failed')).toBe('Trade failed')
	})
})

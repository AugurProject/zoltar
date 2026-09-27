import { isWalletRejection } from '@zoltar/ui-core-shared/lib/errors.js'
import { publicErrorMessage } from './publicError.js'

/** A failed transaction explained as what went wrong and what the user can do next. */
export type TransactionFailureExplanation = Readonly<{ cause: string; nextStep: string }>

type RevertExplanation = TransactionFailureExplanation & Readonly<{ reasons: readonly string[] }>

// Contracts revert with plain strings (see solidity/contracts/trading and SecurityPool); each group shares one explanation.
const REVERT_EXPLANATIONS: readonly RevertExplanation[] = [
	{
		// The last reason is the client-side check that the pre-signing simulation still meets the quoted limits.
		reasons: ['Minimum long shares', 'Maximum long shares', 'Minimum ETH output', 'Swap slippage', 'Liquidity slippage', 'Liquidity price slippage', 'Minimum liquidity', 'Refreshed quote no longer satisfies'],
		cause: 'The price moved past your slippage limit.',
		nextStep: 'Try again at the new price, or raise the slippage tolerance in Settings.',
	},
	{ reasons: ['Deadline expired'], cause: 'The transaction expired before it was mined.', nextStep: 'Try again, or allow more time in Settings.' },
	{
		reasons: ['Question ended', 'Question resolved', 'Universe forked', 'Fork continuation pending', 'Pool inactive', 'Forked', 'Fork await', 'Fork paused'],
		cause: 'This market no longer accepts this action.',
		nextStep: 'Reload the market to see its current status.',
	},
	{ reasons: ['Pool backing insufficient', 'Collateral low', 'Vault backing insufficient'], cause: 'The security pool does not have enough backing for this size.', nextStep: 'Try a smaller amount.' },
	{
		reasons: ['Insufficient output', 'Net input is zero', 'Input is zero', 'ETH input is zero', 'Complete set is zero', 'Liquidity rounds to zero', 'Liquidity output is zero', 'Liquidity is zero', 'Initial reserves round to zero', 'Initial liquidity too small'],
		cause: 'The amount is too small to trade.',
		nextStep: 'Enter a larger amount.',
	},
	{ reasons: ['Invalid output', 'Balance below reserve'], cause: 'The pool cannot fill an order this large.', nextStep: 'Try a smaller amount.' },
	{ reasons: ['Exchange rate undefined'], cause: 'The security pool has no collateral rate yet.', nextStep: 'Wait for the pool to be funded, then try again.' },
	{ reasons: ['Pair already initialized', 'Already initialized'], cause: 'Someone already added the first liquidity.', nextStep: 'Reload the market and add liquidity instead.' },
]

const INSUFFICIENT_FUNDS: TransactionFailureExplanation = { cause: 'Your wallet does not have enough ETH for this amount plus gas.', nextStep: 'Lower the amount or add ETH to your wallet.' }
const WALLET_REJECTED: TransactionFailureExplanation = { cause: 'You canceled the request in your wallet.', nextStep: 'Nothing was sent. Press the button again when ready.' }
export const REVERTED_ON_CHAIN: TransactionFailureExplanation = { cause: 'The transaction reverted on-chain; only the gas fee was spent.', nextStep: 'Check the market status and try again.' }

function errorTexts(error: unknown, seen = new Set<object>()): string[] {
	if (typeof error === 'string') return [error]
	if (typeof error !== 'object' || error === null || seen.has(error)) return []
	seen.add(error)
	const texts: string[] = []
	for (const key of ['reason', 'shortMessage', 'details', 'message']) {
		const value = Reflect.get(error, key)
		if (typeof value === 'string' && value !== '') texts.push(value)
	}
	return [...texts, ...errorTexts(Reflect.get(error, 'cause'), seen)]
}

/** The contract revert string carried anywhere in an error chain, when it is one this interface knows how to explain. */
function knownRevertReason(error: unknown) {
	const texts = errorTexts(error)
	for (const explanation of REVERT_EXPLANATIONS) {
		const reason = explanation.reasons.find(candidate => texts.some(text => text.includes(candidate)))
		if (reason !== undefined) return reason
	}
	return undefined
}

/** Maps a wallet, RPC, or contract failure to a cause and next step; unknown failures keep their sanitized message. */
function explainTransactionFailure(error: unknown): TransactionFailureExplanation | undefined {
	if (isWalletRejection(error)) return WALLET_REJECTED
	const reason = knownRevertReason(error)
	if (reason !== undefined) return REVERT_EXPLANATIONS.find(explanation => explanation.reasons.includes(reason))
	if (errorTexts(error).some(text => /insufficient funds/i.test(text))) return INSUFFICIENT_FUNDS
	return undefined
}

export function formatTransactionFailure(explanation: TransactionFailureExplanation) {
	return `${explanation.cause} ${explanation.nextStep}`
}

export function describeTransactionFailure(error: unknown, fallback: string) {
	const explanation = explainTransactionFailure(error)
	return explanation === undefined ? publicErrorMessage(error, fallback) : formatTransactionFailure(explanation)
}

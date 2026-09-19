import { endpointRpcError } from '../monitoring/connectivity.ts'

/**
 * JSON-RPC codes a node uses to refuse a transaction at its pool with a descriptive message (generic server error;
 * transaction rejected). Internal errors and provider limits are excluded because a gateway can return them after
 * forwarding the transaction upstream, so these codes only count together with an explicit pool message.
 */
const TRANSACTION_REJECTION_CODES = new Set([-32000, -32003, -32010])

/** Invalid params means the request was never processed, so the node holds nothing whatever the message says. */
const INVALID_PARAMS_CODE = -32602

/**
 * Messages a node's transaction pool uses when it refuses a transaction outright. Only these prove the node does not
 * hold the transaction: the same generic code also carries gateway conditions such as an upstream timeout that can
 * follow an ingestion, so an unrecognised message is treated as an unknown outcome.
 */
const TRANSACTION_REJECTION_MESSAGES = [
	/\bnonce too low\b/,
	/\binsufficient funds\b/,
	/\bunderpriced\b/,
	/\bexceeds block gas limit\b/,
	/\bgas limit too high\b/,
	/\bintrinsic gas too low\b/,
	/\binvalid (?:sender|signature|chain id|transaction)\b/,
	/\btx(?:pool| pool|n pool)? is full\b/,
	/\bfee cap less than block base fee\b/,
	/\bmax fee per gas less than block base fee\b/,
	/\boversized data\b/,
	/\btransaction type not supported\b/,
]

/** Whether a JSON-RPC error proves the node refused the transaction rather than possibly having ingested it. */
function isTransactionRejection(rpcError: { code: number; message: string }) {
	if (rpcError.code === INVALID_PARAMS_CODE) return true
	if (!TRANSACTION_REJECTION_CODES.has(rpcError.code)) return false
	const message = rpcError.message.toLowerCase()
	return TRANSACTION_REJECTION_MESSAGES.some(pattern => pattern.test(message))
}

/** True when the endpoint refused the transaction at its pool, so it is known not to hold it; a transport failure, an internal error, or an unrecognised message leaves that unknown. */
export function isEndpointRejection(error: unknown) {
	const rpcError = endpointRpcError(error)
	return rpcError !== undefined && isTransactionRejection(rpcError)
}

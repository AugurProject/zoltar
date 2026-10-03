import { expect, test } from 'bun:test'
import { unsupportedTraceError } from '../../src/indexer/transaction-selection.ts'

test('only unsupported tracing degrades coverage; transient failures remain retryable', () => {
	expect(unsupportedTraceError(new Error('RPC request failed', { cause: new Error('method not found') }))).toBe(true)
	expect(unsupportedTraceError(new Error('rate limit exceeded'))).toBe(false)
})

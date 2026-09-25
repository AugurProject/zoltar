import { expect, test } from 'bun:test'
import { relevantCallTrace, protocolCallDestination, unsupportedTraceError } from '../../src/indexer/transaction-selection.ts'

test('selects first-party calls independently of logs and excludes global shared dependencies', () => {
	expect(protocolCallDestination({ kind: 'securityPool' })).toBe(true)
	expect(protocolCallDestination({ kind: 'reputationToken' })).toBe(true)
	expect(protocolCallDestination({ kind: 'weth' })).toBe(false)
	expect(protocolCallDestination({ kind: 'uniswapV3Factory' })).toBe(false)
})

test('finds nested reverted calls without requiring an emitted log', () => {
	const targets = new Set(['0x1111111111111111111111111111111111111111'])
	expect(relevantCallTrace({ to: '0x2222222222222222222222222222222222222222', calls: [{ to: [...targets][0], error: 'execution reverted', value: '0x1' }] }, targets)).toBe(true)
	expect(relevantCallTrace({ to: '0x2222222222222222222222222222222222222222' }, targets)).toBe(false)
})

test('only unsupported tracing degrades coverage; transient failures remain retryable', () => {
	expect(unsupportedTraceError(new Error('RPC request failed', { cause: new Error('method not found') }))).toBe(true)
	expect(unsupportedTraceError(new Error('rate limit exceeded'))).toBe(false)
})

import { describe, expect, test } from 'bun:test'
import { parseRpcResponse } from '../deploy/rpc.ts'

describe('deployment JSON-RPC response validation', () => {
	test('accepts results and rejects malformed error objects', () => {
		expect(parseRpcResponse({ jsonrpc: '2.0', id: 1, result: '0x1' }, 'eth_chainId')).toBe('0x1')
		expect(() => parseRpcResponse({ jsonrpc: '2.0', id: 1, error: {} }, 'eth_chainId')).toThrow('malformed JSON-RPC error data')
		expect(() => parseRpcResponse({ jsonrpc: '2.0', id: 1, error: { code: '-1', message: 'failed' } }, 'eth_chainId')).toThrow('malformed JSON-RPC error data')
		expect(() => parseRpcResponse({ jsonrpc: '2.0', id: 1, error: { code: -1 } }, 'eth_chainId')).toThrow('malformed JSON-RPC error data')
	})
})

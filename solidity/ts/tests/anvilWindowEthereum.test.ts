import { expect, test } from 'bun:test'
import { getDefaultAnvilRpcUrl, normalizeAnvilTransactionParams, validateLocalAnvilRpcUrl } from '../testsuite/simulator/AnvilWindowEthereum'

test('getDefaultAnvilRpcUrl uses localhost for host CLI execution', () => {
	expect(getDefaultAnvilRpcUrl()).toBe('http://127.0.0.1:8545')
})

test('validateLocalAnvilRpcUrl accepts local HTTP endpoints', () => {
	expect(() => validateLocalAnvilRpcUrl('http://127.0.0.1:8545')).not.toThrow()
	expect(() => validateLocalAnvilRpcUrl('http://host.docker.internal:8545')).not.toThrow()
})

test('validateLocalAnvilRpcUrl rejects non-HTTP endpoints', () => {
	expect(() => validateLocalAnvilRpcUrl('https://127.0.0.1:8545')).toThrow('Must use http:// for a local Anvil endpoint')
})

test('validateLocalAnvilRpcUrl rejects non-local endpoints', () => {
	expect(() => validateLocalAnvilRpcUrl('http://example.com:8545')).toThrow("ANVIL_RPC points to unauthorized host 'example.com'")
})

test('normalizeAnvilTransactionParams forces legacy zero-gas pricing for send transactions', () => {
	const params = [
		{
			from: '0x1234',
			to: '0x5678',
			maxFeePerGas: '0x1',
			maxPriorityFeePerGas: '0x2',
			type: '0x2',
			value: '0x0',
		},
	]

	expect(normalizeAnvilTransactionParams(params)).toEqual([
		{
			from: '0x1234',
			to: '0x5678',
			gasPrice: '0x0',
			value: '0x0',
		},
	])
})

test('normalizeAnvilTransactionParams preserves explicit legacy gas pricing for basefee tests', () => {
	const params = [
		{
			from: '0x1234',
			to: '0x5678',
			gasPrice: '0x1',
			maxFeePerGas: '0x2',
			maxPriorityFeePerGas: '0x3',
			type: '0x2',
			value: '0x0',
		},
	]

	expect(normalizeAnvilTransactionParams(params)).toEqual([
		{
			from: '0x1234',
			to: '0x5678',
			gasPrice: '0x1',
			value: '0x0',
		},
	])
})

test('normalizeAnvilTransactionParams leaves non-object params unchanged', () => {
	const params = ['latest']

	expect(normalizeAnvilTransactionParams(params)).toEqual(params)
})

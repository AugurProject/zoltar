import { expect, test } from 'bun:test'
import { getDefaultAnvilRpcUrl, normalizeAnvilTransactionParams, preserveAnvilFeeCap } from '../testsuite/simulator/AnvilWindowEthereum'

test('getDefaultAnvilRpcUrl uses localhost on Windows and docker host elsewhere', () => {
	const expected = process.platform === 'win32' ? 'http://127.0.0.1:8545' : 'http://host.docker.internal:8545'

	expect(getDefaultAnvilRpcUrl()).toBe(expected)
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

test('normalizeAnvilTransactionParams preserves fee cap when explicitly requested', () => {
	const params = [
		preserveAnvilFeeCap({
			from: '0x1234',
			to: '0x5678',
			maxFeePerGas: '0x10',
			maxPriorityFeePerGas: '0x1',
			type: '0x2',
			value: '0x0',
		}),
	]

	expect(normalizeAnvilTransactionParams(params)).toEqual([
		{
			from: '0x1234',
			to: '0x5678',
			maxFeePerGas: '0x10',
			maxPriorityFeePerGas: '0x1',
			type: '0x2',
			value: '0x0',
		},
	])
})

test('normalizeAnvilTransactionParams leaves non-object params unchanged', () => {
	const params = ['latest']

	expect(normalizeAnvilTransactionParams(params)).toEqual(params)
})

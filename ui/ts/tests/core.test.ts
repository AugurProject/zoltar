/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress, type Address, type Hash } from 'viem'
import { getMulticall3Address } from '../contracts/deploymentHelpers.js'
import { readOptionalMulticall, readRequiredMulticall, writeContractAndWait, writeContractAndWaitForReceipt } from '../contracts/core.js'
import type { ReadClient, WriteClient } from '../types/contracts.js'

type MulticallRequest = Parameters<ReadClient['multicall']>[0]
type WriteContractClient = Pick<WriteClient, 'sendTransaction' | 'waitForTransactionReceipt'> & {
	call?: WriteClient['call']
}

describe('contract core helpers', () => {
	test('readRequiredMulticall forwards allowFailure false to the multicall address', async () => {
		let capturedRequest: MulticallRequest | undefined
		const readClient = {
			multicall: async request => {
				capturedRequest = request
				return [{ result: 1n }]
			},
		} as ReadClient

		const values = await readRequiredMulticall(readClient, [{ abi: [], address: getAddress('0x1111111111111111111111111111111111111111'), functionName: 'foo' } as const])
		const request = capturedRequest

		expect(request?.allowFailure).toBe(false)
		expect(request?.multicallAddress).toBe(getMulticall3Address())
		expect(values).toEqual([{ result: 1n }])
	})

	test('readOptionalMulticall forwards allowFailure true to the multicall address', async () => {
		let capturedRequest: MulticallRequest | undefined
		const readClient = {
			multicall: async request => {
				capturedRequest = request
				return [{ result: 1n }]
			},
		} as ReadClient

		const values = await readOptionalMulticall(readClient, [{ abi: [], address: getAddress('0x1111111111111111111111111111111111111111'), functionName: 'foo' } as const])
		const request = capturedRequest

		expect(request?.allowFailure).toBe(true)
		expect(request?.multicallAddress).toBe(getMulticall3Address())
		expect(values).toEqual([{ result: 1n }])
	})

	test('writeContractAndWait and writeContractAndWaitForReceipt return hashes for successful writes', async () => {
		const hash = `0x${'a'.repeat(64)}` as Hash
		const contractCall: WriteContractClient = {
			sendTransaction: async () => hash,
			waitForTransactionReceipt: async () => ({ status: 'success' }),
		}

		const returnedHashOnly = await writeContractAndWait(contractCall, () => ({
			abi: [{ type: 'function', stateMutability: 'payable', name: 'foo', inputs: [], outputs: [] }] as const,
			address: getAddress('0x1111111111111111111111111111111111111111'),
			functionName: 'foo',
			gas: 21_000n,
		}))
		const returnedHashWithReceipt = await writeContractAndWaitForReceipt(contractCall, () => ({
			abi: [{ type: 'function', stateMutability: 'payable', name: 'foo', inputs: [], outputs: [] }] as const,
			address: getAddress('0x1111111111111111111111111111111111111111'),
			functionName: 'foo',
			gas: 21_000n,
		}))

		expect(returnedHashOnly).toBe(hash)
		expect(returnedHashWithReceipt.hash).toBe(hash)
		expect(returnedHashWithReceipt.receipt.status).toBe('success')
	})

	test('writeContractAndWaitForReceipt maps transaction revert and fallback error messages', async () => {
		const hash = `0x${'b'.repeat(64)}` as Hash
		const callError = new Error('revert-message')
		const callClient: WriteContractClient = {
			call: async () => {
				throw callError
			},
			sendTransaction: async () => hash,
			waitForTransactionReceipt: async () => ({ status: 'reverted' }),
		}
		await expect(
			writeContractAndWaitForReceipt(
				callClient,
				() =>
					({
						abi: [{ type: 'function', stateMutability: 'payable', name: 'bar', inputs: [], outputs: [] }] as const,
						address: getAddress('0x2222222222222222222222222222222222222222'),
						functionName: 'bar',
					}) as never,
			),
		).rejects.toThrow('revert-message')
	})

	test('writeContractAndWaitForReceipt falls back to the primary error message when no call-level reason exists', async () => {
		const fallbackClient: WriteContractClient = {
			sendTransaction: async () => {
				throw new Error('provider failed')
			},
			waitForTransactionReceipt: async () => ({ status: 'success' }),
		}
		await expect(
			writeContractAndWaitForReceipt(
				fallbackClient,
				() =>
					({
						abi: [{ type: 'function', stateMutability: 'payable', name: 'baz', inputs: [], outputs: [] }] as const,
						address: getAddress('0x3333333333333333333333333333333333333333'),
						functionName: 'baz',
					}) as never,
			),
		).rejects.toThrow('provider failed')
	})

	test('writeContractAndWaitForReceipt throws a generic revert message when no reason can be resolved', async () => {
		const genericClient: WriteContractClient = {
			sendTransaction: async () => `0x${'c'.repeat(64)}` as Hash,
			waitForTransactionReceipt: async () => ({ status: 'reverted' }),
		}
		await expect(
			writeContractAndWaitForReceipt(
				genericClient,
				() =>
					({
						abi: [{ type: 'function', stateMutability: 'payable', name: 'zap', inputs: [], outputs: [] }] as const,
						address: getAddress('0x4444444444444444444444444444444444444444'),
						functionName: 'zap',
					}) as never,
			),
		).rejects.toThrow('Transaction reverted')
	})
})

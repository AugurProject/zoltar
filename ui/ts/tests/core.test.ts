/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { encodeFunctionData, getAddress, type Hash, type TransactionReceipt } from '@zoltar/shared/ethereum'
import { getMulticall3Address } from '../contracts/deploymentHelpers.js'
import { readOptionalMulticall, readRequiredMulticall, writeContractAndWait, writeContractAndWaitForReceipt } from '../contracts/core.js'
import type { ReadClient, WriteClient } from '../types/contracts.js'

type MulticallRequest = Parameters<ReadClient['multicall']>[0]
type WriteContractClient = Pick<WriteClient, 'sendTransaction' | 'waitForTransactionReceipt'> &
	Partial<Pick<WriteClient, 'onTransactionPrepared'>> & {
		call?: WriteClient['call']
	}

function hashReceipt(status: TransactionReceipt['status']): TransactionReceipt {
	return {
		blockHash: '0x0',
		blockNumber: 0n,
		contractAddress: null,
		cumulativeGasUsed: 0n,
		from: getAddress('0x0000000000000000000000000000000000000000'),
		gasUsed: 0n,
		logs: [],
		logsBloom: '0x',
		status,
		to: getAddress('0x0000000000000000000000000000000000000000'),
		transactionHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
		transactionIndex: 0n,
		type: 'eip1559',
	} as unknown as TransactionReceipt
}

describe('contract core helpers', () => {
	test('readRequiredMulticall forwards allowFailure false to the multicall address', async () => {
		let capturedRequest: MulticallRequest | undefined
		const readClient = {
			multicall: async (request: MulticallRequest) => {
				capturedRequest = request
				return [{ result: 1n, status: 'success' } as never]
			},
		} as unknown as ReadClient

		const values = await readRequiredMulticall(readClient, [{ abi: [], address: getAddress('0x1111111111111111111111111111111111111111'), functionName: 'foo' } as const])
		const request = capturedRequest

		expect(request?.allowFailure).toBe(false)
		expect(request?.multicallAddress).toBe(getMulticall3Address())
		expect(values as unknown).toEqual([{ result: 1n, status: 'success' }])
	})

	test('readOptionalMulticall forwards allowFailure true to the multicall address', async () => {
		let capturedRequest: MulticallRequest | undefined
		const readClient = {
			multicall: async (request: MulticallRequest) => {
				capturedRequest = request
				return [{ result: 1n, status: 'success' } as never]
			},
		} as unknown as ReadClient

		const values = await readOptionalMulticall(readClient, [{ abi: [], address: getAddress('0x1111111111111111111111111111111111111111'), functionName: 'foo' } as const])
		const request = capturedRequest

		expect(request?.allowFailure).toBe(true)
		expect(request?.multicallAddress).toBe(getMulticall3Address())
		expect(values as unknown).toEqual([{ result: 1n, status: 'success' }])
	})

	test('writeContractAndWait and writeContractAndWaitForReceipt return hashes for successful writes', async () => {
		const hash = `0x${'a'.repeat(64)}` as Hash
		const contractCall: WriteContractClient = {
			sendTransaction: async () => hash,
			waitForTransactionReceipt: async () => hashReceipt('success'),
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

	test('writeContractAndWaitForReceipt includes encoded calldata in prepared previews', async () => {
		const hash = `0x${'d'.repeat(64)}` as Hash
		const abi = [{ type: 'function', stateMutability: 'nonpayable', name: 'setValue', inputs: [{ name: 'value', type: 'uint256' }], outputs: [] }] as const
		const address = getAddress('0x5555555555555555555555555555555555555555')
		const args = [42n] as const
		const encodedData = encodeFunctionData({
			abi,
			functionName: 'setValue',
			args,
		})
		let preparedData: string | undefined
		let sentData: string | undefined
		const contractCall: WriteContractClient = {
			onTransactionPrepared: preview => {
				preparedData = preview.data
			},
			sendTransaction: async request => {
				sentData = request.data
				return hash
			},
			waitForTransactionReceipt: async () => hashReceipt('success'),
		}

		await writeContractAndWaitForReceipt(contractCall, () => ({
			abi,
			address,
			args,
			functionName: 'setValue',
		}))

		expect(preparedData).toBe(encodedData)
		expect(sentData).toBe(encodedData)
	})

	test('writeContractAndWaitForReceipt maps transaction revert and fallback error messages', async () => {
		const hash = `0x${'b'.repeat(64)}` as Hash
		const callError = new Error('revert-message')
		const callClient: WriteContractClient = {
			call: async () => {
				throw callError
			},
			sendTransaction: async () => hash,
			waitForTransactionReceipt: async () => hashReceipt('reverted'),
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
			waitForTransactionReceipt: async () => hashReceipt('success'),
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
			waitForTransactionReceipt: async () => hashReceipt('reverted'),
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

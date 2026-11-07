/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { hexToBytes } from '@zoltar/core-shared/evm/ethereum'
import { formatSimulationTransactionReceipt, type SimulationReceiptSource } from '../../simulation/transactionReceipts.js'

const BLOCK_HASH = `0x${'ab'.repeat(32)}` as const
const TRANSACTION_HASH = `0x${'cd'.repeat(32)}` as const
const SENDER = '0x00000000000000000000000000000000000000a1'
const RECIPIENT = '0x00000000000000000000000000000000000000b2'

function createSource(overrides: { createdAddress?: string; status?: number; transaction?: Partial<SimulationReceiptSource['transaction']> } = {}): SimulationReceiptSource {
	const transaction: SimulationReceiptSource['transaction'] = {
		getSenderAddress: () => ({ toString: () => SENDER }),
		hash: () => hexToBytes(TRANSACTION_HASH),
		maxFeePerGas: 10n,
		maxPriorityFeePerGas: 2n,
		nonce: 3n,
		to: { toString: () => RECIPIENT },
		type: 2,
		...overrides.transaction,
	}
	return {
		block: { hash: () => hexToBytes(BLOCK_HASH), header: { baseFeePerGas: 7n, number: 5n } },
		result: {
			...(overrides.createdAddress === undefined ? {} : { createdAddress: { toString: () => overrides.createdAddress ?? '' } }),
			receipt: {
				bitvector: new Uint8Array(256),
				cumulativeBlockGasUsed: 21_000n,
				logs: [[hexToBytes(RECIPIENT), [hexToBytes(`0x${'11'.repeat(32)}`)], hexToBytes('0x1234')]],
				status: overrides.status ?? 1,
			},
			totalGasSpent: 21_000n,
		},
		transaction,
		transactionIndex: 0,
	}
}

describe('simulation transaction receipts', () => {
	test('formats a sealed transaction as a JSON-RPC receipt', () => {
		expect(formatSimulationTransactionReceipt(createSource())).toEqual({
			blockHash: BLOCK_HASH,
			blockNumber: '0x5',
			contractAddress: null,
			cumulativeGasUsed: '0x5208',
			effectiveGasPrice: '0x9',
			from: SENDER,
			gasUsed: '0x5208',
			logs: [
				{
					address: RECIPIENT,
					blockHash: BLOCK_HASH,
					blockNumber: '0x5',
					data: '0x1234',
					logIndex: '0x0',
					removed: false,
					topics: [`0x${'11'.repeat(32)}`],
					transactionHash: TRANSACTION_HASH,
					transactionIndex: '0x0',
				},
			],
			logsBloom: `0x${'00'.repeat(256)}`,
			status: '0x1',
			to: RECIPIENT,
			transactionHash: TRANSACTION_HASH,
			transactionIndex: '0x0',
			type: '0x2',
		})
	})

	test('caps the effective gas price at the fee cap and reads legacy gas prices directly', () => {
		expect(formatSimulationTransactionReceipt(createSource({ transaction: { maxFeePerGas: 8n, maxPriorityFeePerGas: 5n } })).effectiveGasPrice).toBe('0x8')
		const legacy = createSource()
		const { maxFeePerGas: _maxFeePerGas, maxPriorityFeePerGas: _maxPriorityFeePerGas, ...legacyTransaction } = createSource().transaction as SimulationReceiptSource['transaction'] & { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }
		expect(formatSimulationTransactionReceipt({ ...legacy, transaction: { ...legacyTransaction, gasPrice: 12n, type: 0 } }).effectiveGasPrice).toBe('0xc')
	})

	test('reports failed transactions and contract creations', () => {
		expect(formatSimulationTransactionReceipt(createSource({ status: 0 })).status).toBe('0x0')
		const creation = formatSimulationTransactionReceipt(createSource({ createdAddress: RECIPIENT, transaction: { to: undefined } }))
		expect(creation.contractAddress).toBe(RECIPIENT)
		expect(creation.to).toBeNull()
	})
})

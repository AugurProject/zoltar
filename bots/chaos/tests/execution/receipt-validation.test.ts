import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, keccak256, toHex, type Address, type Hash } from '../support/bot-shared.ts'
import { requireSuccessfulReceipt, validateStepReceiptEvidence } from '../../src/execution/receipt-validation.ts'
import type { OperationStep } from '../../src/operations/types.ts'

const emitter = '0x0000000000000000000000000000000000000001' as Address
const account = '0x0000000000000000000000000000000000000002' as Address
const topic = `0x${'11'.repeat(32)}` as Hash
const transactionHash = `0x${'22'.repeat(32)}` as Hash
const blockHash = `0x${'33'.repeat(32)}` as Hash

function step(evidence: OperationStep['evidence']): OperationStep {
	return {
		data: '0x',
		evidence,
		gasLimit: '100000',
		id: 'step',
		label: 'Test step',
		preflightCalls: [],
		to: emitter,
		walletAssetDebits: [],
	}
}

const receipt = {
	blockHash,
	blockNumber: 10n,
	logs: [{ address: emitter, data: '0x' as const, topics: [topic] }],
	status: 'success' as const,
	transactionHash,
}

describe('chaos semantic receipt validation', () => {
	test('requires every declared event and accepts an exact emitter/topic match', () => {
		expect(validateStepReceiptEvidence(step([{ emitter, kind: 'event', signature: 'Changed()', topic0: topic }]), receipt)).toEqual(receipt)
		expect(() => validateStepReceiptEvidence(step([{ emitter, kind: 'event', signature: 'Other()', topic0: transactionHash }]), receipt)).toThrow('did not emit Other()')
	})

	test('validates captured balance and storage postconditions', () => {
		const balanceEvidence = { account, asset: 'ETH' as const, direction: 'decrease' as const, kind: 'balance-change' as const }
		const storageEvidence = {
			abi: 'function counter() view returns (uint256)',
			args: [],
			contract: emitter,
			expected: '3',
			functionName: 'counter',
			kind: 'storage-postcondition' as const,
			relation: 'at-least' as const,
		}
		expect(
			validateStepReceiptEvidence(step([balanceEvidence, storageEvidence]), receipt, {
				balances: [{ after: 9n, before: 10n, evidence: balanceEvidence }],
				storage: [{ after: '4', before: '2', evidence: storageEvidence }],
			}),
		).toEqual(receipt)
	})

	test('decodes staged-operation success instead of trusting the event topic alone', () => {
		const signature = 'ExecutedStagedOperation(uint256,uint8,bool,string)'
		const stagedTopic = keccak256(toHex(signature))
		const stagedReceipt = {
			...receipt,
			logs: [
				{
					address: emitter,
					data: encodeAbiParameters(
						[
							{ name: 'operation', type: 'uint8' },
							{ name: 'success', type: 'bool' },
							{ name: 'errorMessage', type: 'string' },
						],
						[0, false, 'settlement failed'],
					),
					topics: [stagedTopic, toHex(7n, { size: 32 })],
				},
			],
		}
		const evidence = {
			abi: 'event ExecutedStagedOperation(uint256 indexed operationId, uint8 operation, bool success, string errorMessage)',
			emitter,
			equals: true,
			field: 'success',
			indexed: { operationId: '7' },
			kind: 'decoded-event-field' as const,
			signature,
			topic0: stagedTopic,
		}
		expect(() => validateStepReceiptEvidence(step([evidence]), stagedReceipt)).toThrow('ExecutedStagedOperation(uint256,uint8,bool,string).success to equal true')
	})

	test('does not treat an empty evidence declaration as verified', () => {
		expect(() => validateStepReceiptEvidence(step([]), receipt)).toThrow('does not declare semantic receipt evidence')
	})

	test('rejects reverted receipts before semantic validation', () => {
		expect(() => requireSuccessfulReceipt('Test step', { ...receipt, status: 'reverted' })).toThrow(`reverted in transaction ${transactionHash}`)
	})
})

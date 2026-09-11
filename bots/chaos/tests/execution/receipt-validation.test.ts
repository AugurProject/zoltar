import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, keccak256, toHex, type Address, type Hash } from '@zoltar/bot-shared/ethereum'
import { receiptVisibilityDisposition, requireSuccessfulReceipt, stepReceiptEvidenceDisposition } from '../../src/execution/receipt-validation.ts'
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
		expect(stepReceiptEvidenceDisposition(step([{ emitter, kind: 'event', signature: 'Changed()', topic0: topic }]), receipt)).toBe('confirmed')
		expect(() => stepReceiptEvidenceDisposition(step([{ emitter, kind: 'event', signature: 'Other()', topic0: transactionHash }]), receipt)).toThrow('did not emit Other()')
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
			stepReceiptEvidenceDisposition(step([balanceEvidence, storageEvidence]), receipt, {
				balances: [{ after: 9n, before: 10n, evidence: balanceEvidence }],
				storage: [{ after: '4', before: '2', evidence: storageEvidence }],
			}),
		).toBe('confirmed')
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
		expect(() => stepReceiptEvidenceDisposition(step([evidence]), stagedReceipt)).toThrow('ExecutedStagedOperation(uint256,uint8,bool,string).success to equal true')
	})

	test('does not treat an empty evidence declaration as verified', () => {
		expect(() => stepReceiptEvidenceDisposition(step([]), receipt)).toThrow('does not declare semantic receipt evidence')
	})

	test('rejects reverted receipts before semantic validation', () => {
		expect(() => requireSuccessfulReceipt('Test step', { ...receipt, status: 'reverted' })).toThrow(`reverted in transaction ${transactionHash}`)
	})
})

describe('receipt visibility disposition', () => {
	/** Mirrors the production propagation-grace and finality-grace constants in receipt-validation.ts. */
	const GRACE_MILLISECONDS = 60_000
	const FINALITY_GRACE_MILLISECONDS = 1_200_000

	test('marks a freshly broadcast, unobserved receipt as pending rather than alarming', () => {
		const submittedAt = new Date(Date.now() - GRACE_MILLISECONDS / 2).toISOString()

		expect(receiptVisibilityDisposition(false, submittedAt)).toEqual(['not yet visible to the RPC quorum; this is expected immediately after broadcast', 'pending'])
	})

	test('escalates to alarming once an unobserved receipt outlives the propagation grace period', () => {
		const submittedAt = new Date(Date.now() - GRACE_MILLISECONDS * 2).toISOString()

		expect(receiptVisibilityDisposition(false, submittedAt)).toEqual(['receipt is not visible to the RPC quorum', 'alarming'])
	})

	test('treats an unknown submission time as alarming rather than assuming it is fresh', () => {
		expect(receiptVisibilityDisposition(false, undefined)[1]).toBe('alarming')
	})

	test('treats an observed but not-yet-finalized receipt as pending while finality is still within its normal window', () => {
		const submittedAt = new Date(Date.now() - GRACE_MILLISECONDS * 10).toISOString()

		expect(receiptVisibilityDisposition(true, submittedAt)).toEqual(['awaiting canonical finality', 'pending'])
	})

	test('escalates to alarming once an observed but unfinalized receipt outlives the finality grace period', () => {
		const submittedAt = new Date(Date.now() - FINALITY_GRACE_MILLISECONDS * 2).toISOString()

		expect(receiptVisibilityDisposition(true, submittedAt)).toEqual(['awaiting canonical finality', 'alarming'])
	})
})

import { describe, expect, test } from 'bun:test'
import { type Address, type Hex, encodeAbiParameters, encodeEventTopics, parseAbi, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { resolvePortfolioOperationStatus } from './securityPoolPortfolioStatus.js'

const coordinator: Address = '0x0000000000000000000000000000000000000001'
const vault: Address = '0x0000000000000000000000000000000000000002'
const abi = parseAbi(['event ExecutedStagedOperation(uint256 indexed operationId,uint8 operation,bool success,string errorMessage)'])
const activeOperation = { operationId: 7n, operationType: 3n, operator: vault, receiverVault: vault, targetVault: vault, queuedAt: 100n, validForSeconds: 30n }
const blockHash: Hex = `0x${'11'.repeat(32)}`
const replacementHash: Hex = `0x${'22'.repeat(32)}`
const observation = { blockHash, vault, operation: activeOperation }
const parameters = { coordinator, vault, observation, canonicalObservationBlockHash: blockHash, operationId: 7n, operationType: 3n, timestamp: 190n, settlementTime: 60n, logs: [] }
function terminal(success: boolean, operationId = 7n, operationType = 3n) {
	const topics = encodeEventTopics({ abi, eventName: 'ExecutedStagedOperation', args: { operationId } })
	if (!topics.every((topic): topic is Hex => typeof topic === 'string')) throw new Error('Expected concrete event topics.')
	return { address: coordinator, topics, data: encodeAbiParameters([{ type: 'uint8' }, { type: 'bool' }, { type: 'string' }], [operationType, success, success ? '' : 'Expired']) }
}

describe('portfolio operation status evidence', () => {
	test('requires a native terminal event rather than treating deleted entries or outer receipts as success', () => {
		expect(resolvePortfolioOperationStatus(parameters)).toEqual({ status: 'unknown' })
		expect(resolvePortfolioOperationStatus({ ...parameters, activeOperation: { ...activeOperation, operator: zeroAddress } })).toEqual({ status: 'unknown' })
		expect(resolvePortfolioOperationStatus({ ...parameters, logs: [terminal(false)] })).toEqual({ status: 'failed', errorMessage: 'Expired' })
		expect(resolvePortfolioOperationStatus({ ...parameters, logs: [terminal(true)] })).toEqual({ status: 'succeeded', errorMessage: '' })
	})

	test('does not attribute a reused operation id on a replacement chain to the original vault', () => {
		expect(resolvePortfolioOperationStatus({ ...parameters, canonicalObservationBlockHash: replacementHash, logs: [terminal(true)] })).toEqual({ status: 'unknown' })
		expect(resolvePortfolioOperationStatus({ ...parameters, observation: { ...observation, operation: { ...activeOperation, operator: coordinator, receiverVault: coordinator, targetVault: coordinator } }, logs: [terminal(true)] })).toEqual({ status: 'unknown' })
		expect(resolvePortfolioOperationStatus({ ...parameters, activeOperation: { ...activeOperation, operator: coordinator, receiverVault: coordinator, targetVault: coordinator } })).toEqual({ status: 'unknown' })
	})

	test('requires a canonical, vault-bound observation before accepting terminal evidence', () => {
		const unobserved = { coordinator, vault, operationId: 7n, operationType: 3n, timestamp: 190n, settlementTime: 60n, logs: [terminal(true)] }
		expect(resolvePortfolioOperationStatus({ ...unobserved, canonicalObservationBlockHash: blockHash })).toEqual({ status: 'unknown' })
		expect(resolvePortfolioOperationStatus({ ...unobserved, observation })).toEqual({ status: 'unknown' })
		expect(resolvePortfolioOperationStatus({ ...parameters, observation: { ...observation, vault: coordinator }, logs: [terminal(true)] })).toEqual({ status: 'unknown' })
		expect(resolvePortfolioOperationStatus({ ...parameters, observation: { ...observation, operation: { ...activeOperation, operationId: 8n } }, logs: [terminal(true)] })).toEqual({ status: 'unknown' })
	})

	test('checks every observed identity field against an active counter reuse', () => {
		for (const changed of [{ operationId: 8n }, { operationType: 1n }, { operator: coordinator }, { receiverVault: coordinator }, { targetVault: coordinator }, { queuedAt: 101n }, { validForSeconds: 31n }]) {
			expect(resolvePortfolioOperationStatus({ ...parameters, activeOperation: { ...activeOperation, ...changed } })).toEqual({ status: 'unknown' })
		}
	})

	test('matches coordinator, id and operation type against unrelated logs', () => {
		expect(resolvePortfolioOperationStatus({ ...parameters, logs: [{ ...terminal(true), address: vault }, terminal(true, 8n), terminal(true, 7n, 1n), { address: coordinator, topics: [], data: '0x' }] })).toEqual({ status: 'unknown' })
	})

	test('retains expired queue conflicts until consumed and respects exact native expiry boundary', () => {
		expect(resolvePortfolioOperationStatus({ ...parameters, activeOperation })).toEqual({ status: 'pending' })
		expect(resolvePortfolioOperationStatus({ ...parameters, timestamp: 191n, activeOperation })).toEqual({ status: 'expired' })
	})

	test('does not merge contradictory state or execution evidence from different chain views', () => {
		expect(resolvePortfolioOperationStatus({ ...parameters, activeOperation, logs: [terminal(true)] })).toEqual({ status: 'unknown' })
		expect(resolvePortfolioOperationStatus({ ...parameters, logs: [terminal(true), terminal(false)] })).toEqual({ status: 'unknown' })
	})
})

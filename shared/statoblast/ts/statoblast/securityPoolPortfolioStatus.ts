import { type Address, type Hex, type TransactionLog, decodeEventLog, parseAbi, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import type { PortfolioQueuedOperation } from './securityPoolPortfolioRead.js'

const executionAbi = parseAbi(['event ExecutedStagedOperation(uint256 indexed operationId,uint8 operation,bool success,string errorMessage)'])
export type PortfolioOperationStatus = { status: 'pending' | 'expired' | 'unknown' } | { status: 'succeeded' | 'failed'; errorMessage: string }
type PortfolioOperationObservation = { blockHash: Hex; vault: Address; operation: PortfolioQueuedOperation }

/**
 * An outer transaction receipt or a deleted queue entry is not proof of native operation success.
 * The caller must revalidate the observation block hash against the canonical chain after loading
 * execution logs, including for previously terminal records. This binds a reusable queue id to the
 * observed vault operation; a missing/reorged anchor or mismatched identity remains unknown.
 * @public Operation tracking API exported by the securityPoolPortfolio package subpath.
 */
export function resolvePortfolioOperationStatus(parameters: {
	coordinator: Address
	vault: Address
	observation?: PortfolioOperationObservation
	canonicalObservationBlockHash?: Hex
	operationId: bigint
	operationType: bigint
	activeOperation?: PortfolioQueuedOperation
	logs: readonly Pick<TransactionLog, 'address' | 'data' | 'topics'>[]
	timestamp: bigint
	settlementTime: bigint
}): PortfolioOperationStatus {
	const { observation, activeOperation: active } = parameters
	if (!observation || observation.blockHash.toLowerCase() !== parameters.canonicalObservationBlockHash?.toLowerCase()) return { status: 'unknown' }
	const observed = observation.operation
	if (observation.vault.toLowerCase() !== parameters.vault.toLowerCase() || observed.operationId !== parameters.operationId || observed.operationType !== parameters.operationType || observed.operator.toLowerCase() === zeroAddress) return { status: 'unknown' }
	if (![observed.operator, observed.receiverVault, observed.targetVault].some(account => account.toLowerCase() === parameters.vault.toLowerCase())) return { status: 'unknown' }
	if (active && !sameOperation(active, observed)) return { status: 'unknown' }
	let terminal: PortfolioOperationStatus | undefined
	for (const log of parameters.logs) {
		if (log.address.toLowerCase() !== parameters.coordinator.toLowerCase()) continue
		let event: ReturnType<typeof decodeEventLog>
		try {
			event = decodeEventLog({ abi: executionAbi, data: log.data, topics: log.topics })
		} catch (error) {
			if (!(error instanceof Error && ['AbiEventSignatureNotFoundError', 'DecodeLogTopicsMismatch', 'DecodeLogDataMismatch'].includes(error.name))) throw error
			continue
		}
		const args = event.args
		if (event.eventName !== 'ExecutedStagedOperation' || args === null || typeof args !== 'object' || !('operationId' in args && 'operation' in args && 'success' in args && 'errorMessage' in args)) continue
		if (args['operationId'] !== parameters.operationId || args['operation'] !== parameters.operationType || typeof args['success'] !== 'boolean' || typeof args['errorMessage'] !== 'string') continue
		const next: PortfolioOperationStatus = { status: args['success'] ? 'succeeded' : 'failed', errorMessage: args['errorMessage'] }
		if (terminal && terminal.status !== next.status) return { status: 'unknown' }
		terminal = next
	}
	if (active) {
		if (terminal) return { status: 'unknown' }
		return { status: parameters.timestamp > active.queuedAt + parameters.settlementTime + active.validForSeconds ? 'expired' : 'pending' }
	}
	return terminal ?? { status: 'unknown' }
}

function sameOperation(left: PortfolioQueuedOperation, right: PortfolioQueuedOperation) {
	return (
		left.operationId === right.operationId &&
		left.operationType === right.operationType &&
		left.operator.toLowerCase() === right.operator.toLowerCase() &&
		left.receiverVault.toLowerCase() === right.receiverVault.toLowerCase() &&
		left.targetVault.toLowerCase() === right.targetVault.toLowerCase() &&
		left.queuedAt === right.queuedAt &&
		left.validForSeconds === right.validForSeconds
	)
}

import { parseAbiItem, type Address, type Hex, type TransactionLog } from '@zoltar/core-shared/evm/ethereum'
import { resolvePortfolioOperationStatus, type PortfolioOperationStatus, type PortfolioPosition, type PortfolioSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { portfolioOperationKey, type TrackedPortfolioOperation } from './preferences.js'

const executionEvent = parseAbiItem('event ExecutedStagedOperation(uint256 indexed operationId,uint8 operation,bool success,string errorMessage)')

type HistoryClient = {
	getBlock(parameters: { blockNumber: bigint }): Promise<{ hash?: Hex | undefined }>
	getLogs(parameters: { address: Address; fromBlock: bigint; toBlock: bigint; event: typeof executionEvent; args: { operationId: bigint } }): Promise<readonly Pick<TransactionLog, 'address' | 'data' | 'topics'>[]>
}

type HistorySnapshot = Pick<PortfolioSnapshot, 'vault' | 'blockNumber' | 'blockHash' | 'timestamp'>
type HistoryPosition = Pick<PortfolioPosition, 'settlementTime' | 'queuedOperations'>

/** A live operation read at the verified snapshot needs no historical RPC to establish pending state. */
export function currentPortfolioOperationStatus(entry: TrackedPortfolioOperation, snapshot: HistorySnapshot, position?: HistoryPosition): PortfolioOperationStatus | undefined {
	const observed = entry.observation
	if (observed === undefined || BigInt(observed.blockNumber) !== snapshot.blockNumber || observed.blockHash.toLowerCase() !== snapshot.blockHash.toLowerCase() || observed.vault.toLowerCase() !== snapshot.vault.toLowerCase()) return undefined
	const active = position?.queuedOperations.find(operation => operation.operationId === BigInt(entry.operationId))
	if (active === undefined || position === undefined) return undefined
	return resolvePortfolioOperationStatus({
		coordinator: entry.coordinator,
		vault: snapshot.vault,
		operationId: BigInt(entry.operationId),
		operationType: BigInt(entry.operation),
		observation: {
			blockHash: observed.blockHash,
			vault: observed.vault,
			operation: { operationId: BigInt(entry.operationId), operationType: BigInt(entry.operation), operator: observed.operator, receiverVault: observed.receiverVault, targetVault: observed.targetVault, queuedAt: BigInt(observed.queuedAt), validForSeconds: BigInt(observed.validForSeconds) },
		},
		canonicalObservationBlockHash: snapshot.blockHash,
		activeOperation: active,
		logs: [],
		timestamp: snapshot.timestamp,
		settlementTime: position.settlementTime,
	})
}

export async function getCanonicalPortfolioObservationKeys(client: Pick<HistoryClient, 'getBlock'>, entries: readonly TrackedPortfolioOperation[]) {
	const keys = await Promise.all(
		entries.map(async entry => {
			if (entry.observation === undefined) return undefined
			try {
				const block = await client.getBlock({ blockNumber: BigInt(entry.observation.blockNumber) })
				return block.hash?.toLowerCase() === entry.observation.blockHash.toLowerCase() ? portfolioOperationKey(entry) : undefined
			} catch (failure) {
				console.warn('Could not verify the portfolio operation observation block.', failure)
				return undefined
			}
		}),
	)
	return new Set(keys.filter(key => key !== undefined))
}

/** Recheck the observation anchor on every refresh, including entries previously shown as terminal. */
export async function loadTrackedPortfolioOperationStatus(client: HistoryClient, entry: TrackedPortfolioOperation, snapshot: HistorySnapshot, position?: HistoryPosition): Promise<PortfolioOperationStatus> {
	const observed = entry.observation
	if (observed === undefined || BigInt(observed.blockNumber) > snapshot.blockNumber || observed.vault.toLowerCase() !== snapshot.vault.toLowerCase()) return { status: 'unknown' }
	const current = currentPortfolioOperationStatus(entry, snapshot, position)
	if (current !== undefined) return current
	try {
		const observationBlockNumber = BigInt(observed.blockNumber)
		const before = await client.getBlock({ blockNumber: observationBlockNumber })
		if (before.hash?.toLowerCase() !== observed.blockHash.toLowerCase()) return { status: 'unknown' }
		const logs = await client.getLogs({ address: entry.coordinator, event: executionEvent, args: { operationId: BigInt(entry.operationId) }, fromBlock: observationBlockNumber, toBlock: snapshot.blockNumber })
		const [after, snapshotBlock] = await Promise.all([client.getBlock({ blockNumber: observationBlockNumber }), client.getBlock({ blockNumber: snapshot.blockNumber })])
		if (after.hash?.toLowerCase() !== observed.blockHash.toLowerCase() || snapshotBlock.hash?.toLowerCase() !== snapshot.blockHash.toLowerCase()) return { status: 'unknown' }
		const activeOperation = position?.queuedOperations.find(operation => operation.operationId === BigInt(entry.operationId))
		return resolvePortfolioOperationStatus({
			coordinator: entry.coordinator,
			vault: snapshot.vault,
			operationId: BigInt(entry.operationId),
			operationType: BigInt(entry.operation),
			observation: {
				blockHash: observed.blockHash,
				vault: observed.vault,
				operation: { operationId: BigInt(entry.operationId), operationType: BigInt(entry.operation), operator: observed.operator, receiverVault: observed.receiverVault, targetVault: observed.targetVault, queuedAt: BigInt(observed.queuedAt), validForSeconds: BigInt(observed.validForSeconds) },
			},
			canonicalObservationBlockHash: after.hash,
			logs,
			timestamp: snapshot.timestamp,
			settlementTime: position?.settlementTime ?? 0n,
			...(activeOperation === undefined ? {} : { activeOperation }),
		})
	} catch (failure) {
		console.warn('Could not verify the portfolio operation outcome.', failure)
		return { status: 'unknown' }
	}
}

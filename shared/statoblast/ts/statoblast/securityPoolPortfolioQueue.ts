import { type AbiEvent, type AbiValue, type Address, type TransactionLog, decodeEventLog, parseAbiItem } from '@zoltar/core-shared/evm/ethereum'
import { fetchLogsWithAdaptiveRanges } from '@zoltar/core-shared/evm/logScan'

export type PortfolioQueueLogReader = (parameters: { address: Address; event: AbiEvent; args: Readonly<Record<string, AbiValue>>; fromBlock: bigint; toBlock: bigint }) => Promise<readonly Pick<TransactionLog, 'address' | 'data' | 'topics'>[]>

function parseEvent(source: string): AbiEvent {
	const event = parseAbiItem(source)
	if (event.type !== 'event') throw new Error('Expected a portfolio queue event.')
	return { ...event, type: 'event' }
}

const queuedEvent = parseEvent(
	'event StagedOperationQueued(uint256 indexed operationId,uint8 operation,address indexed operator,address indexed targetVault,uint256 operationValue,uint256 queuedAt,uint256 validForSeconds,uint256 snapshotTargetBackingUnits,uint256 snapshotTargetUnderwritingLimitAttoEth,uint256 snapshotTargetOpenInterestAttoEth,uint256 snapshotTargetDisputeStakedAttoRep,uint256 snapshotTotalPoolHeldAttoRep,uint256 snapshotTotalRepBackingUnits,bool isPendingSlot)',
)
const liquidationEvent = parseEvent('event LiquidationRouteStaged(uint256 indexed operationId,address indexed operator,address indexed receiverVault,address targetVault,bytes32 approvalId,uint256 requestedDebtAttoEth,uint256 reservedDebtAttoEth)')
// OpenOraclePriceCoordinatorTypes.sol: MAX_OPERATION_VALID_FOR_SECONDS. Native staging rejects larger windows.
const maximumNativeOperationValiditySeconds = 300n

type QueueHistoryBlockReader = (parameters: { blockNumber: bigint }) => Promise<{ number?: bigint | undefined; timestamp: bigint }>

async function firstBlockAtOrAfter(getBlock: QueueHistoryBlockReader, blockNumber: bigint, timestamp: bigint, minimumTimestamp: bigint) {
	if (minimumTimestamp === 0n) return 0n
	let low = 0n
	let high = blockNumber
	while (low < high) {
		const middle = low + (high - low) / 2n
		const block = await getBlock({ blockNumber: middle })
		if (block.number !== middle || block.timestamp < 0n || block.timestamp > timestamp) throw new Error('Invalid block in receiver history lookup.')
		if (block.timestamp >= minimumTimestamp) high = middle
		else low = middle + 1n
	}
	return low
}

/** Only authorized roles affect allocation safety; unsolicited target history is attacker-controlled. */
export async function loadPortfolioVaultOperationIds({ getLogs, getBlock, coordinator, vault, blockNumber, timestamp, settlementTime }: { getLogs: PortfolioQueueLogReader; getBlock: QueueHistoryBlockReader; coordinator: Address; vault: Address; blockNumber: bigint; timestamp: bigint; settlementTime: bigint }) {
	const operationIds = new Set<bigint>()
	const maximumLifetime = settlementTime + maximumNativeOperationValiditySeconds
	const minimumTimestamp = timestamp > maximumLifetime ? timestamp - maximumLifetime : 0n
	// Expiration is strictly greater than queuedAt + settlementTime + validForSeconds, so include the cutoff block.
	const receiverFromBlock = await firstBlockAtOrAfter(getBlock, blockNumber, timestamp, minimumTimestamp)
	const filters = [
		{ event: queuedEvent, role: 'operator', fromBlock: 0n },
		{ event: liquidationEvent, role: 'receiverVault', fromBlock: receiverFromBlock },
	]
	for (const { event, role, fromBlock } of filters) {
		// Owner operations may still need cleanup after expiry. Receiver routes cannot execute after expiry.
		// Provider range limits are split without omitting any potentially executable receiver history.
		const logs = await fetchLogsWithAdaptiveRanges(fromBlock, blockNumber, blockNumber - fromBlock + 1n, range => getLogs({ address: coordinator, event, args: { [role]: vault }, ...range }))
		for (const log of logs) {
			if (log.address.toLowerCase() !== coordinator.toLowerCase()) throw new Error('Vault operation log came from another coordinator.')
			const decoded = decodeEventLog({ abi: [event], data: log.data, topics: log.topics })
			const args = decoded.args
			if (args === null || typeof args !== 'object' || !(role in args) || !('operationId' in args)) throw new Error('Incomplete vault operation log.')
			const account = Reflect.get(args, role)
			if (typeof account !== 'string' || account.toLowerCase() !== vault.toLowerCase()) throw new Error('Vault operation log did not match its account filter.')
			if (typeof args['operationId'] !== 'bigint' || args['operationId'] <= 0n) throw new Error('Invalid vault operation id.')
			operationIds.add(args['operationId'])
		}
	}
	return [...operationIds]
}

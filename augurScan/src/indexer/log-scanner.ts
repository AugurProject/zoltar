import { runtimeConfig } from '../config.ts'
import type { ContractDeploymentObservation } from '../database.ts'
import type { Address, Hash, Log } from '../ethereum.ts'
import {
	ChainContinuityError,
	isPrunedHistoricalStateError,
	isSplittableLogRangeError,
	queryCanonicalLogRange,
	requireLogPosition,
} from '../indexer-runtime.ts'
import { unixSecondsToDate } from '../time.ts'
import type { ContractMetadata } from '../types.ts'
import { uniswapV2V3TokenPairs } from '../uniswap.ts'
import { NetworkIndexerSynchronization } from './network-synchronization.ts'
import {
	chunks,
	type DeploymentAwareLogPlan,
	type LogScanInput,
	mapLimit,
	planDeploymentAwareLogScan,
	queryAdaptiveLogRange,
	type RpcBlockHeader,
	rpcLogQueryGroups,
	uniswapV2PairCreatedEvent,
	uniswapV3PoolCreatedEvent,
	uniswapV4InitializeEvent,
	uniswapV4PoolIds,
	uniswapV4SwapEvent,
} from './planning.ts'

export abstract class NetworkIndexerLogScanner extends NetworkIndexerSynchronization {
	protected async queryLogs(toBlock: bigint, inputs: readonly LogScanInput[], contracts: ReadonlyMap<string, ContractMetadata>): Promise<readonly Log[]> {
		const filteredKinds = new Set(['uniswapV2Factory', 'uniswapV3Factory', 'uniswapV4PoolManager'])
		const inputsOfKind = (kind: string): readonly LogScanInput[] => inputs.filter(({ address }) => contracts.get(address.toLowerCase())?.kind === kind)
		const ordinaryInputs = inputs.filter(({ address }) => !filteredKinds.has(contracts.get(address.toLowerCase())?.kind ?? ''))
		const groups = rpcLogQueryGroups(ordinaryInputs)
		const ordinaryPages = await mapLimit(groups, 3, (group) => this.logClient.getLogs({ address: group.addresses, fromBlock: group.fromBlock, toBlock }))
		const tokenPairs = uniswapV2V3TokenPairs(contracts.values())
		const v2Queries = inputsOfKind('uniswapV2Factory').flatMap((input) => tokenPairs.map((tokens) => ({ input, ...tokens })))
		const v2Pages = await mapLimit(v2Queries, 3, ({ input, token0, token1 }) =>
			this.logClient.getLogs({ address: input.address, event: uniswapV2PairCreatedEvent, args: { token0, token1 }, fromBlock: input.fromBlock, toBlock }),
		)
		const v3Queries = inputsOfKind('uniswapV3Factory').flatMap((input) => tokenPairs.map((tokens) => ({ input, ...tokens })))
		const v3Pages = await mapLimit(v3Queries, 3, ({ input, token0, token1 }) =>
			this.logClient.getLogs({ address: input.address, event: uniswapV3PoolCreatedEvent, args: { token0, token1 }, fromBlock: input.fromBlock, toBlock }),
		)
		const poolIdGroups = chunks(uniswapV4PoolIds(contracts), 25)
		const v4Queries = inputsOfKind('uniswapV4PoolManager').flatMap((input) => poolIdGroups.map((ids) => ({ input, ids })))
		const initializePages = await mapLimit(v4Queries, 3, ({ input, ids }) =>
			this.logClient.getLogs({ address: input.address, event: uniswapV4InitializeEvent, args: { id: ids }, fromBlock: input.fromBlock, toBlock }),
		)
		const swapPages = await mapLimit(v4Queries, 3, ({ input, ids }) =>
			this.logClient.getLogs({ address: input.address, event: uniswapV4SwapEvent, args: { id: ids }, fromBlock: input.fromBlock, toBlock }),
		)
		const unique = new Map<string, Log>()
		for (const log of [...ordinaryPages.flat(), ...v2Pages.flat(), ...v3Pages.flat(), ...initializePages.flat(), ...swapPages.flat()]) {
			const position = requireLogPosition(log)
			const input = inputs.find(({ address }) => address.toLowerCase() === log.address.toLowerCase())
			if (input === undefined || position.blockNumber < input.fromBlock || position.blockNumber > toBlock)
				throw new ChainContinuityError(`RPC returned a log outside its requested deployment-aware range through ${toBlock}`)
			unique.set(`${position.transactionHash}:${position.logIndex}`, log)
		}
		return [...unique.values()].sort((left, right) => {
			const a = requireLogPosition(left)
			const b = requireLogPosition(right)
			return a.transactionIndex - b.transactionIndex || a.logIndex - b.logIndex
		})
	}

	protected async getLogsForInputs(
		toBlock: bigint,
		inputs: readonly LogScanInput[],
		contracts: ReadonlyMap<string, ContractMetadata>,
	): Promise<{ readonly logs: readonly Log[]; readonly endBlockHash: Hash }> {
		const range = await queryCanonicalLogRange(
			toBlock,
			async () => (await this.getBlockHeader(toBlock)).hash,
			() => this.queryLogs(toBlock, inputs, contracts),
		)
		return { logs: range.items, endBlockHash: range.endBlockHash }
	}

	protected async getLogs(
		fromBlock: bigint,
		toBlock: bigint,
		addresses: readonly Address[],
		contracts: ReadonlyMap<string, ContractMetadata>,
	): Promise<{ readonly logs: readonly Log[]; readonly endBlockHash: Hash }> {
		return await this.getLogsForInputs(
			toBlock,
			addresses.map((address) => ({ address, fromBlock, startBlock: fromBlock })),
			contracts,
		)
	}

	protected async planDeploymentAwareLogScan(contracts: readonly ContractMetadata[], fromBlock: bigint, toBlock: bigint): Promise<DeploymentAwareLogPlan> {
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				return await planDeploymentAwareLogScan(
					contracts,
					fromBlock,
					toBlock,
					this.network.startBlock,
					(address, blockNumber) => this.client.getBytecode({ address, blockNumber }),
					async (blockNumber) => unixSecondsToDate((await this.getBlockHeader(blockNumber)).timestamp, 'Deployment scan block timestamp'),
					(contract, error) => this.rememberHistoricalCodeUnavailable(contract.address, error),
					this.historicalCodeUnavailable(),
					this.stateStartBlock,
				)
			} catch (error) {
				if (!isPrunedHistoricalStateError(error) || attempt > 0) throw error
				await this.discoverStateStartBlock(await this.client.getBlockNumber(), this.stateStartBlock, true)
			}
		}
		throw new Error('Deployment-aware log planning state boundary retry was exhausted')
	}

	protected async getNextLogSegment(
		fromBlock: bigint,
		maximumToBlock: bigint,
		contracts: readonly ContractMetadata[],
	): Promise<{
		readonly toBlock: bigint
		readonly logs: readonly Log[]
		readonly endBlockHash?: Hash
		readonly endBlockHeader?: RpcBlockHeader
		readonly scanInputs: readonly LogScanInput[]
		readonly deploymentObservations: readonly ContractDeploymentObservation[]
	}> {
		if (contracts.length === 0) {
			const maximum = fromBlock + BigInt(runtimeConfig.logScanRangeSize - 1)
			return { toBlock: maximum < maximumToBlock ? maximum : maximumToBlock, logs: [], scanInputs: [], deploymentObservations: [] }
		}
		let endBlockHash: Hash | undefined
		let endBlockHeader: RpcBlockHeader | undefined
		let successfulPlan: DeploymentAwareLogPlan | undefined
		const segment = await queryAdaptiveLogRange(
			fromBlock,
			maximumToBlock,
			runtimeConfig.logScanRangeSize,
			async (rangeStart, rangeEnd) => {
				let plan: DeploymentAwareLogPlan | undefined
				let rangeEndHeader: RpcBlockHeader | undefined
				const contractMap = new Map(contracts.map((contract) => [contract.address.toLowerCase(), contract]))
				const range = await queryCanonicalLogRange(
					rangeEnd,
					async () => {
						rangeEndHeader = await this.getBlockHeader(rangeEnd)
						return rangeEndHeader.hash
					},
					async () => {
						plan = await this.planDeploymentAwareLogScan(contracts, rangeStart, rangeEnd)
						return await this.queryLogs(rangeEnd, plan.inputs, contractMap)
					},
				)
				endBlockHash = range.endBlockHash
				endBlockHeader = rangeEndHeader
				if (plan === undefined) throw new Error(`RPC did not plan log range through block ${rangeEnd}`)
				successfulPlan = plan
				return range.items
			},
			(failedFrom, failedTo, retryTo, error) =>
				console.warn(
					`[${this.network.id}] RPC log range #${failedFrom}-#${failedTo} failed (${this.rpcFailureReason(error)}); retrying #${failedFrom}-#${retryTo}`,
				),
			isSplittableLogRangeError,
		)
		if (endBlockHash === undefined) throw new Error(`RPC did not anchor log range through block ${segment.toBlock}`)
		if (successfulPlan === undefined) throw new Error(`RPC did not plan log range through block ${segment.toBlock}`)
		return {
			toBlock: segment.toBlock,
			logs: segment.items,
			endBlockHash,
			...(endBlockHeader === undefined ? {} : { endBlockHeader }),
			scanInputs: successfulPlan.inputs,
			deploymentObservations: successfulPlan.observations,
		}
	}

	protected async getAllLogs(
		fromBlock: bigint,
		toBlock: bigint,
		addresses: readonly Address[],
		contracts: ReadonlyMap<string, ContractMetadata>,
		expectedBlockHash: (blockNumber: bigint) => Promise<Hash>,
	): Promise<readonly Log[]> {
		const logs: Log[] = []
		let cursor = fromBlock
		while (cursor <= toBlock) {
			const segment = await queryAdaptiveLogRange(
				cursor,
				toBlock,
				runtimeConfig.logScanRangeSize,
				async (rangeStart, rangeEnd) => {
					const range = await this.getLogs(rangeStart, rangeEnd, addresses, contracts)
					if (range.endBlockHash !== (await expectedBlockHash(rangeEnd)))
						throw new ChainContinuityError(`Canonical chain changed after querying logs through block ${rangeEnd}`)
					return range.logs
				},
				(failedFrom, failedTo, retryTo, error) =>
					console.warn(
						`[${this.network.id}] RPC log range #${failedFrom}-#${failedTo} failed (${this.rpcFailureReason(error)}); retrying #${failedFrom}-#${retryTo}`,
					),
				isSplittableLogRangeError,
			)
			logs.push(...segment.items)
			cursor = segment.toBlock + 1n
		}
		return logs
	}

	protected mergeLogs(target: Map<bigint, Log[]>, logs: readonly Log[]): void {
		for (const log of logs) {
			const position = requireLogPosition(log)
			const existing = target.get(position.blockNumber) ?? []
			if (
				!existing.some((candidate) => {
					const candidatePosition = requireLogPosition(candidate)
					return candidatePosition.transactionHash === position.transactionHash && candidatePosition.logIndex === position.logIndex
				})
			) {
				existing.push(log)
				existing.sort((left, right) => {
					const a = requireLogPosition(left)
					const b = requireLogPosition(right)
					return a.transactionIndex - b.transactionIndex || a.logIndex - b.logIndex
				})
				target.set(position.blockNumber, existing)
			}
		}
	}

	protected async getKnownLogs(
		blockNumber: bigint,
		addresses: readonly Address[],
		contracts: ReadonlyMap<string, ContractMetadata>,
		blockHash: Hash,
	): Promise<Log[]> {
		const range = await this.getLogs(blockNumber, blockNumber, addresses, contracts)
		if (range.endBlockHash !== blockHash) throw new ChainContinuityError(`RPC log response changed while indexing block ${blockNumber}`)
		for (const log of range.logs) {
			if (requireLogPosition(log).blockHash !== blockHash) throw new ChainContinuityError(`RPC log response changed while indexing block ${blockNumber}`)
		}
		return [...range.logs]
	}
}

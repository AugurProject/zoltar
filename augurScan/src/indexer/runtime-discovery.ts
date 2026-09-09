import type { Address, Hash, Log, TransactionReceipt } from '../ethereum.ts'
import type { ContractMetadata } from '../types.ts'
import { ChainContinuityError, requireLogPosition } from './runtime-rpc.ts'

export const isProtocolActivitySource = (contract: ContractMetadata | undefined): boolean => contract !== undefined && contract.kind !== 'weth' && contract.kind !== 'usdc' && contract.kind !== 'reputationToken' && contract.kind !== 'multicall3' && contract.kind !== 'proxyDeployer' && contract.kind !== 'scalarOutcomes'

export const indexerLogSources = (contracts: readonly ContractMetadata[]): readonly ContractMetadata[] => contracts.filter(contract => isProtocolActivitySource(contract) || contract.kind === 'reputationToken')

export const discoveryLogAddresses = (discoveredAddresses: readonly Address[], contracts: ReadonlyMap<string, ContractMetadata>): readonly Address[] => {
	const sources = discoveredAddresses.filter(address => {
		const contract = contracts.get(address.toLowerCase())
		return isProtocolActivitySource(contract) || contract?.kind === 'reputationToken'
	})
	if (!sources.some(address => contracts.get(address.toLowerCase())?.kind === 'reputationToken')) return sources
	const addresses = [...sources, ...[...contracts.values()].filter(({ kind }) => kind === 'uniswapV2Factory' || kind === 'uniswapV3Factory' || kind === 'uniswapV4PoolManager').map(({ address }) => address)]
	return [...new Map(addresses.map(address => [address.toLowerCase(), address])).values()]
}

export const scanDiscoveredLogCoverage = async (
	blockNumber: bigint,
	segmentEnd: bigint,
	discoveredAddresses: readonly Address[],
	contracts: ReadonlyMap<string, ContractMetadata>,
	getCurrentBlockLogs: (addresses: readonly Address[]) => Promise<readonly Log[]>,
	getRemainingLogs: (fromBlock: bigint, toBlock: bigint, addresses: readonly Address[]) => Promise<readonly Log[]>,
): Promise<{ readonly currentBlockLogs: readonly Log[]; readonly remainingLogs: readonly Log[] }> => {
	const addresses = discoveryLogAddresses(discoveredAddresses, contracts)
	if (addresses.length === 0) return { currentBlockLogs: [], remainingLogs: [] }
	const currentBlockLogs = await getCurrentBlockLogs(addresses)
	const remainingLogs = blockNumber < segmentEnd ? await getRemainingLogs(blockNumber + 1n, segmentEnd, addresses) : []
	return { currentBlockLogs, remainingLogs }
}

export const requiresManifestHistoryCoverage = (contract: ContractMetadata | undefined): boolean => isProtocolActivitySource(contract) || contract?.kind === 'reputationToken' || contract?.kind === 'weth' || contract?.kind === 'usdc'

export const isProtocolEvidenceEmitter = (contract: ContractMetadata | undefined): contract is ContractMetadata => contract !== undefined

export const requireReceiptPosition = (receipt: TransactionReceipt, blockHash: Hash, blockNumber: bigint): void => {
	if (receipt.blockHash !== blockHash || receipt.blockNumber !== blockNumber) {
		throw new ChainContinuityError(`Receipt ${receipt.transactionHash} no longer belongs to block ${blockNumber}`)
	}
	for (const log of receipt.logs) {
		const position = requireLogPosition(log)
		if (position.blockHash !== blockHash || position.blockNumber !== blockNumber) {
			throw new ChainContinuityError(`Log ${position.transactionHash}:${position.logIndex} no longer belongs to block ${blockNumber}`)
		}
	}
}

import type { IndexedBlock, RichListBalance, StoredTransaction } from '../database.ts'
import { readRichListBalance } from '../direct-observations.ts'
import { type Address, getAddress, type Hash, type Log, type Transaction, type TransactionReceipt, zeroAddress } from '../ethereum.ts'
import {
	addressActivityFrom,
	ChainContinuityError,
	commitCanonicalRead,
	confirmCanonicalBlock,
	isProtocolEvidenceEmitter,
	isPrunedHistoricalStateError,
	jsonEvidence,
	labelsFrom,
	readWithPrunedStateFallback,
	requireLogPosition,
	requireReceiptPosition,
} from '../indexer-runtime.ts'
import { decodeAction, decodeLogRecord, discoveriesFrom, tokenAddressesFrom } from '../metadata.ts'
import { sampleEntityState } from '../snapshots.ts'
import { bigintToSafeNumber, unixSecondsToDate } from '../time.ts'
import type { ContractMetadata, StoredLog, TokenMetadata } from '../types.ts'
import { NetworkIndexerLogScanner } from './log-scanner.ts'
import {
	erc20BalanceAbi,
	erc20MetadataAbi,
	mapLimit,
	priceCoordinatorDependenciesAbi,
	prunedTokenMetadataError,
	type RpcBlockHeader,
	readTokenMetadata,
	tokenMetadataNeedsRead,
} from './planning.ts'

export class NetworkIndexer extends NetworkIndexerLogScanner {
	protected async indexBlock(
		number: bigint,
		observedHead: bigint,
		currentContracts: ReadonlyMap<string, ContractMetadata>,
		currentTokenMetadata: ReadonlyMap<string, TokenMetadata>,
		expectedParentHash: Hash | undefined,
		block: RpcBlockHeader,
		prefetchedLogs: readonly Log[],
		getDiscoveredLogs: (addresses: readonly Address[], contracts: ReadonlyMap<string, ContractMetadata>) => Promise<readonly Log[]>,
	): Promise<{ block: IndexedBlock; contracts: Map<string, ContractMetadata>; tokenMetadata: Map<string, TokenMetadata> }> {
		if (expectedParentHash !== undefined && block.parentHash !== expectedParentHash) {
			throw new ChainContinuityError(`Block ${number} does not extend the indexed canonical chain`)
		}
		const contracts = new Map(currentContracts)
		const knownLogs = [...prefetchedLogs]
		for (const log of knownLogs) {
			const position = requireLogPosition(log)
			if (position.blockHash !== block.hash || position.blockNumber !== number)
				throw new ChainContinuityError(`RPC log response changed while indexing block ${number}`)
		}
		const relevantHashes = new Set<Hash>(knownLogs.map((log) => requireLogPosition(log).transactionHash))
		const transactionByHash = new Map<Hash, { transaction: Transaction; index: number }>()

		const receipts: TransactionReceipt[] = []
		const receiptByHash = new Map<Hash, TransactionReceipt>()
		const fetchMissingEvidence = async (): Promise<void> => {
			const missing = [...relevantHashes].filter((hash) => !receiptByHash.has(hash))
			for (const { receipt, transaction } of await mapLimit(missing, 8, async (hash) => {
				const [receipt, transaction] = await Promise.all([this.client.getTransactionReceipt({ hash }), this.client.getTransaction({ hash })])
				return { receipt, transaction }
			})) {
				requireReceiptPosition(receipt, block.hash, number)
				if (receipt.status !== 'success') throw new ChainContinuityError(`Log-selected transaction ${transaction.hash} did not succeed`)
				if (transaction.blockHash !== block.hash || transaction.blockNumber !== number || transaction.transactionIndex === undefined)
					throw new ChainContinuityError(`Transaction ${transaction.hash} no longer belongs to block ${number}`)
				const transactionIndex = bigintToSafeNumber(transaction.transactionIndex, `Transaction ${transaction.hash} index`)
				receipts.push(receipt)
				receiptByHash.set(receipt.transactionHash, receipt)
				transactionByHash.set(transaction.hash, { transaction, index: transactionIndex })
			}
		}
		await fetchMissingEvidence()
		const discovered: ContractMetadata[] = []
		while (true) {
			const discoveredAddresses: Address[] = []
			const labels = labelsFrom(contracts)
			for (const receipt of receipts) {
				for (const log of receipt.logs) {
					const emitter = log.address.toLowerCase()
					const contract = contracts.get(emitter)
					if (contract === undefined) continue
					const decoded = decodeLogRecord(contract.kind, log.topics, log.data, labels)
					for (const candidate of discoveriesFrom(decoded, contracts)) {
						const key = candidate.address.toLowerCase()
						if (contracts.has(key)) continue
						const metadata: ContractMetadata = {
							...candidate,
							provenance: `${contract.label}.${decoded.name ?? 'event'}`,
							discoveryBlock: number,
							discoveryTxHash: receipt.transactionHash,
						}
						contracts.set(key, metadata)
						discovered.push(metadata)
						discoveredAddresses.push(metadata.address)
					}
				}
			}
			for (const coordinator of discovered.filter((contract) => contract.kind === 'priceCoordinator')) {
				const requestedStateBlock = number < this.stateStartBlock ? observedHead : number
				const registryRead = await readWithPrunedStateFallback(
					requestedStateBlock,
					observedHead,
					async (blockNumber) =>
						await this.client.readContract({
							address: coordinator.address,
							abi: priceCoordinatorDependenciesAbi,
							functionName: 'liquidationApprovalRegistry',
							blockNumber,
						}),
					async (prunedBlock) => this.discoverStateStartBlock(observedHead, prunedBlock, true),
				)
				if (registryRead.blockNumber !== number)
					console.warn(
						`[${this.network.id}] historical state unavailable at block #${number} while discovering ${coordinator.label} dependencies; used observed head #${registryRead.blockNumber} instead`,
					)
				const registryResult = registryRead.value
				if (typeof registryResult !== 'string') throw new Error(`${coordinator.label}.liquidationApprovalRegistry returned an invalid address`)
				const registry = getAddress(registryResult)
				if (!contracts.has(registry.toLowerCase())) {
					const metadata: ContractMetadata = {
						address: registry,
						kind: 'liquidationApprovalRegistry',
						label: 'Liquidation Approval Registry',
						provenance: `${coordinator.label}.liquidationApprovalRegistry`,
						discoveryBlock: number,
						discoveryTxHash: coordinator.discoveryTxHash,
					}
					contracts.set(registry.toLowerCase(), metadata)
					discovered.push(metadata)
					discoveredAddresses.push(registry)
				}
			}
			if (discoveredAddresses.length === 0) break
			for (const log of await getDiscoveredLogs(discoveredAddresses, contracts)) {
				relevantHashes.add(requireLogPosition(log).transactionHash)
			}
			await fetchMissingEvidence()
		}

		const labels = labelsFrom(contracts)
		const tokenMetadata = new Map(currentTokenMetadata)
		const tokenCandidates = new Set<Address>()
		for (const metadata of tokenMetadata.values()) if (metadata.decimals === undefined) tokenCandidates.add(metadata.address)
		for (const contract of contracts.values()) {
			if (contract.kind === 'reputationToken' || contract.kind === 'shareToken' || contract.kind === 'weth' || contract.kind === 'usdc')
				tokenCandidates.add(contract.address)
		}
		for (const receipt of receipts) {
			for (const item of receipt.logs) {
				const contract = contracts.get(item.address.toLowerCase())
				if (contract === undefined) continue
				const decoded = decodeLogRecord(contract.kind, item.topics, item.data, labels)
				for (const candidate of tokenAddressesFrom(contract.kind, decoded, contract.address)) tokenCandidates.add(candidate)
			}
		}
		for (const hash of relevantHashes) {
			const pair = transactionByHash.get(hash)
			if (pair?.transaction.to === null || pair?.transaction.to === undefined) continue
			const contract = contracts.get(pair.transaction.to.toLowerCase())
			if (contract === undefined) continue
			const decoded = decodeAction(contract, pair.transaction.input, labels)
			for (const candidate of tokenAddressesFrom(contract.kind, decoded, contract.address)) tokenCandidates.add(candidate)
		}
		const readTokenMetadata = await mapLimit(
			[...tokenCandidates].filter((candidate) => tokenMetadataNeedsRead(tokenMetadata.get(candidate.toLowerCase()), number, this.stateStartBlock)),
			4,
			(candidate) => this.readTokenMetadata(candidate, number),
		)
		if (readTokenMetadata.some((metadata) => metadata.readError === prunedTokenMetadataError)) await this.discoverStateStartBlock(observedHead, number, true)
		for (const metadata of readTokenMetadata) tokenMetadata.set(metadata.address.toLowerCase(), metadata)
		const displayLabels = new Map(labels)
		const contractKinds = new Map([...contracts].map(([address, contract]) => [address, contract.kind] as const))
		const displayContext = { nativeSymbol: this.network.nativeSymbol }
		for (const metadata of tokenMetadata.values()) {
			const label = metadata.name ?? metadata.symbol
			if (label !== undefined) displayLabels.set(metadata.address.toLowerCase(), metadata.symbol === undefined ? label : `${label} (${metadata.symbol})`)
		}
		const storedLogs: StoredLog[] = []
		for (const receipt of receipts) {
			for (const log of receipt.logs) {
				const contract = contracts.get(log.address.toLowerCase())
				if (!isProtocolEvidenceEmitter(contract)) continue
				const position = requireLogPosition(log)
				storedLogs.push({
					...position,
					address: getAddress(log.address),
					contractKind: contract.kind,
					topics: log.topics,
					data: log.data,
					decoded: decodeLogRecord(contract.kind, log.topics, log.data, displayLabels, tokenMetadata, contract.address, contractKinds, displayContext),
				})
			}
		}

		const storedTransactions: StoredTransaction[] = []
		for (const hash of relevantHashes) {
			const pair = transactionByHash.get(hash)
			const receipt = receiptByHash.get(hash)
			if (pair === undefined || receipt === undefined) throw new Error(`Block ${number} did not contain relevant transaction ${hash}`)
			if (receipt.status !== 'success') throw new ChainContinuityError(`Log-selected transaction ${hash} did not succeed`)
			const to = pair.transaction.to === null || pair.transaction.to === undefined ? null : getAddress(pair.transaction.to)
			storedTransactions.push({
				hash,
				transactionIndex: pair.index,
				from: getAddress(pair.transaction.from),
				to,
				value: pair.transaction.value,
				input: pair.transaction.input,
				status: receipt.status,
				gasUsed: receipt.gasUsed,
				receipt: jsonEvidence(receipt),
				decoded: decodeAction(
					to === null ? undefined : contracts.get(to.toLowerCase()),
					pair.transaction.input,
					displayLabels,
					tokenMetadata,
					contractKinds,
					displayContext,
				),
			})
		}

		const finalizedThrough = observedHead > this.network.confirmationDepth ? observedHead - this.network.confirmationDepth : 0n
		await confirmCanonicalBlock(number, block.hash, async (blockNumber) => (await this.getBlockHeader(blockNumber)).hash)
		return {
			contracts,
			tokenMetadata,
			block: {
				number,
				hash: block.hash,
				parentHash: block.parentHash,
				timestamp: unixSecondsToDate(block.timestamp, 'Block timestamp'),
				observedHead,
				finalizedThrough,
				contracts: discovered,
				tokenMetadata: readTokenMetadata,
				transactions: storedTransactions,
				logs: storedLogs,
				addressActivity: addressActivityFrom(storedTransactions, storedLogs, contracts),
				contractDeploymentObservations: [],
				logScanCursors: [],
			},
		}
	}

	protected async refreshRichListBalances(blockNumber: bigint, blockHash: Hash): Promise<void> {
		if (blockNumber < this.stateStartBlock) return
		const targets = await this.database.richListBalanceTargets(this.network.chainId, 10, this.requireLease())
		if (targets.addresses.length === 0) return
		try {
			await commitCanonicalRead(
				blockNumber,
				blockHash,
				async () => {
					const balances: RichListBalance[] = []
					const nativeBalances = await mapLimit(targets.addresses, 8, async (owner) =>
						readRichListBalance(
							{ owner, assetAddress: zeroAddress, assetKind: 'native' },
							() => this.client.getBalance({ address: owner, blockNumber }),
							(error) => {
								if (isPrunedHistoricalStateError(error)) throw error
							},
						),
					)
					balances.push(...nativeBalances)
					const tokenRequests = targets.addresses.flatMap((owner) => targets.assets.map((asset) => ({ owner, asset })))
					balances.push(
						...(await mapLimit(tokenRequests, 8, async ({ owner, asset }) =>
							readRichListBalance(
								{ owner, assetAddress: asset.address, assetKind: asset.kind },
								async () =>
									await this.client.readContract({
										address: asset.address,
										abi: erc20BalanceAbi,
										functionName: 'balanceOf',
										args: [owner],
										blockNumber,
									}),
								(error) => {
									if (isPrunedHistoricalStateError(error)) throw error
								},
							),
						)),
					)
					return balances
				},
				async (number) => (await this.getBlockHeader(number)).hash,
				async (balances) => {
					await this.assertLease()
					await this.database.storeRichListBalances(this.network.chainId, blockNumber, blockHash, balances, this.requireLease(), this.provenance)
				},
			)
		} catch (error) {
			if (!isPrunedHistoricalStateError(error)) throw error
			await this.discoverStateStartBlock(await this.client.getBlockNumber(), this.stateStartBlock, true)
		}
	}

	protected async refreshEntityStateSnapshots(blockNumber: bigint, blockHash: Hash): Promise<void> {
		if (blockNumber < this.stateStartBlock) return
		const targets = await this.database.stateSnapshotTargets(this.network.chainId, blockNumber, 25, this.requireLease())
		if (targets.length === 0) return
		try {
			await commitCanonicalRead(
				blockNumber,
				blockHash,
				async () => {
					const header = await this.getBlockHeader(blockNumber)
					if (header.hash !== blockHash) throw new ChainContinuityError(`Canonical chain changed while sampling block ${blockNumber}`)
					const snapshots = await mapLimit(targets, 4, (target) =>
						sampleEntityState(this.client, target, blockNumber, (error) => {
							if (isPrunedHistoricalStateError(error)) throw error
						}),
					)
					return { snapshots, timestamp: unixSecondsToDate(header.timestamp, 'State snapshot block timestamp') }
				},
				async (number) => (await this.getBlockHeader(number)).hash,
				async ({ snapshots, timestamp }) => {
					await this.assertLease()
					await this.database.storeEntityStateSnapshots(
						this.network.chainId,
						blockNumber,
						blockHash,
						timestamp,
						snapshots,
						this.requireLease(),
						this.provenance,
					)
				},
			)
		} catch (error) {
			if (!isPrunedHistoricalStateError(error)) throw error
			await this.discoverStateStartBlock(await this.client.getBlockNumber(), this.stateStartBlock, true)
		}
	}

	protected async readTokenMetadata(address: Address, blockNumber: bigint): Promise<TokenMetadata> {
		return await readTokenMetadata(address, blockNumber, {
			decimals: async () => {
				const result = await this.client.readContract({ address, abi: erc20MetadataAbi, functionName: 'decimals', blockNumber })
				if (typeof result !== 'bigint' || result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('ERC-20 decimals returned an invalid value')
				return Number(result)
			},
			name: async () => {
				const result = await this.client.readContract({ address, abi: erc20MetadataAbi, functionName: 'name', blockNumber })
				if (typeof result !== 'string') throw new Error('ERC-20 name returned an invalid value')
				return result
			},
			symbol: async () => {
				const result = await this.client.readContract({ address, abi: erc20MetadataAbi, functionName: 'symbol', blockNumber })
				if (typeof result !== 'string') throw new Error('ERC-20 symbol returned an invalid value')
				return result
			},
		})
	}
}

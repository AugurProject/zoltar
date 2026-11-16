// A discovered Sepolia indexer and the block-10 header and log position that the single-receipt
// discovery replays index. The database is never connected; callers close it when they finish.
import { ScannerDatabase } from '../../src/database.ts'
import { toHex } from '../../src/ethereum.ts'
import { createNetworkIndexer } from '../../src/indexer/network-state.ts'

export const discoveredReceiptReplay = () => {
	const database = new ScannerDatabase('postgres://unused')
	const indexer = createNetworkIndexer({ id: 'sepolia', name: 'Sepolia', chainId: 11_155_111, rpcUrls: ['http://unused.invalid'], startBlock: 10n, confirmationDepth: 12n, explorerBaseUrl: '', nativeSymbol: 'ETH', contracts: [] }, database, new AbortController().signal, { traceSelectedTransactions: false })
	indexer.stateBoundary.discovered = true
	const hash = toHex(10n, { size: 32 })
	const tx = toHex(20n, { size: 32 })
	const header = { hash, parentHash: toHex(9n, { size: 32 }), timestamp: 1_700_000_000n }
	const position = { blockNumber: 10n, blockHash: hash, transactionHash: tx, transactionIndex: 0n }
	return { database, indexer, hash, tx, header, position }
}

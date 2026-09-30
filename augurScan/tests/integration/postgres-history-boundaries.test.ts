import { expect } from 'bun:test'
import { handleApi } from '../../src/api.ts'
import { type IndexedBlock, ScannerDatabase } from '../../src/database.ts'
import { initializeSchema } from '../../src/schema.ts'
import type { ContractMetadata, NetworkConfig } from '../../src/types.ts'
import { address, blockHash, chainId, decodedLog, discoveredAddress, indexedBlock, log, orphanOnlyAddress, postgresTest, promotedAddress, rediscoveredAddress, requirePostgresUrl, transaction, transactionHash } from '../support/postgres-fixtures.ts'

postgresTest('advances the canonical coverage floor when RPC log history is pruned', async () => {
	const postgresUrl = requirePostgresUrl()
	const database = new ScannerDatabase(postgresUrl)
	const boundaryChainId = chainId + 10 + process.pid
	const network: NetworkConfig = {
		id: `pruned-log-boundary-${boundaryChainId}`,
		name: 'Pruned log boundary',
		chainId: boundaryChainId,
		rpcUrls: ['http://127.0.0.1:8545'],
		startBlock: 1n,
		explorerBaseUrl: 'https://example.invalid',
		nativeSymbol: 'ETH',
		confirmationDepth: 0n,
		contracts: [[address, 'OpenOracle', 'openOracle']],
	}
	try {
		await initializeSchema(database.sql)
		await database.seedNetwork(network)
		const lease = await database.tryAcquireIndexerLock(boundaryChainId)
		if (lease === undefined) throw new Error('pruned-log boundary writer did not acquire its lock')
		try {
			const dynamicContract = {
				address: discoveredAddress,
				label: 'Previously discovered pool',
				kind: 'securityPool',
				provenance: 'Factory.DeploySecurityPool',
				discoveryBlock: 1n,
				discoveryTxHash: transactionHash,
			} satisfies ContractMetadata
			const replayableContract = {
				address: rediscoveredAddress,
				label: 'Discovery at retrievable floor',
				kind: 'truthAuction',
				provenance: 'Factory.DeployTruthAuction',
				discoveryBlock: 2n,
				discoveryTxHash: transactionHash,
			} satisfies ContractMetadata
			const orphanedContract = {
				address: orphanOnlyAddress,
				label: 'Orphaned pre-floor discovery',
				kind: 'securityPool',
				provenance: 'Factory.DeploySecurityPool',
				discoveryBlock: 1n,
				discoveryTxHash: transactionHash,
			} satisfies ContractMetadata
			await database.storeBlock(boundaryChainId, indexedBlock('block-one', blockHash('genesis'), [dynamicContract, orphanedContract]), lease)
			await database.rewind(boundaryChainId, -1n, undefined, lease)
			await database.storeBlock(boundaryChainId, indexedBlock('block-one-replacement', blockHash('genesis'), [dynamicContract]), lease)
			await database.storeBlock(boundaryChainId, indexedBlock('block-two', blockHash('block-one-replacement'), [replayableContract]), lease)
			expect(await database.advanceNetworkStartBlock(boundaryChainId, 2n, lease)).toBe(true)
			const boundaryEvents = await database.sql`
				SELECT event, payload FROM live_events WHERE (payload->>'chainId')::integer = ${boundaryChainId} ORDER BY id DESC LIMIT 1
			`
			expect(boundaryEvents[0]).toMatchObject({
				event: 'reorg',
				payload: { ancestor: '-1', depth: '2', startBlock: '2', reason: 'start-boundary-advanced' },
			})
			const boundaryExportResponse = await handleApi(new Request(`http://localhost/api/v1/export?chainId=${boundaryChainId}&dataset=reorgs&fromBlock=100&toBlock=200`), database.sql)
			const boundaryExport = (await boundaryExportResponse?.text())?.trim().split('\n').filter(Boolean) ?? []
			expect(boundaryExport).toHaveLength(1)
			expect(JSON.parse(boundaryExport[0] ?? '{}')).toMatchObject({
				chain_id: boundaryChainId.toString(),
				previous_block: '2',
				ancestor_block: '-1',
				reason: 'start-boundary-advanced',
			})
			expect(await database.networkStartBlock(boundaryChainId)).toBe(2n)
			expect(await database.checkpoint(boundaryChainId)).toBeUndefined()
			const retainedContracts = await database.contracts(boundaryChainId, lease)
			expect(retainedContracts.get(discoveredAddress.toLowerCase())).toMatchObject(dynamicContract)
			expect(retainedContracts.has(rediscoveredAddress.toLowerCase())).toBe(false)
			expect(retainedContracts.has(orphanOnlyAddress.toLowerCase())).toBe(false)
			const canonicalRows = await database.sql`SELECT count(*)::integer AS count FROM blocks WHERE chain_id = ${boundaryChainId} AND canonical`
			expect(canonicalRows[0]?.['count']).toBe(0)
			const retrievableBlock = (name: string, timestamp: Date): IndexedBlock => {
				const hash = blockHash(name)
				const forwardLog = { ...log(hash, 'post-boundary activity'), blockHash: hash, blockNumber: 2n }
				return {
					...indexedBlock('block-two', blockHash(`${name}-parent`)),
					number: 2n,
					hash,
					parentHash: blockHash(`${name}-parent`),
					timestamp,
					observedHead: 2n,
					transactions: [
						{
							...transaction(),
							receipt: {
								transactionHash,
								blockHash: hash,
								blockNumber: '2',
								status: 'success',
								logs: [{ ...forwardLog, blockNumber: '2' }],
							},
						},
					],
					logs: [forwardLog],
					logScanCursors: [{ contractAddress: discoveredAddress, startBlock: 2n, lastRetrievedBlock: 2n }],
				}
			}
			const forwardBlock = retrievableBlock('retrievable-boundary', new Date('2026-02-11T00:00:00Z'))
			await database.storeBlock(boundaryChainId, forwardBlock, lease)
			await database.rewind(boundaryChainId, -1n, undefined, lease)
			expect((await database.contracts(boundaryChainId, lease)).get(discoveredAddress.toLowerCase())).toMatchObject(dynamicContract)
			expect((await database.contracts(boundaryChainId, lease)).has(orphanOnlyAddress.toLowerCase())).toBe(false)
			await database.storeBlock(boundaryChainId, retrievableBlock('retrievable-replacement', new Date('2026-02-12T00:00:00Z')), lease)
			expect(
				await database.seedNetwork(
					{
						...network,
						startBlock: 2n,
						contracts: [...network.contracts, [promotedAddress, 'Additional manifest source', 'openOracle']],
					},
					{ lease, resetCanonicalHistoryOnManifestChange: true, preserveStoredStart: true },
				),
			).toBe(true)
			const contractsAfterReseed = await database.contracts(boundaryChainId, lease)
			expect(contractsAfterReseed.get(discoveredAddress.toLowerCase())).toMatchObject(dynamicContract)
			expect(contractsAfterReseed.has(orphanOnlyAddress.toLowerCase())).toBe(false)
			const finalBlock = retrievableBlock('retrievable-after-manifest-reset', new Date('2026-02-13T00:00:00Z'))
			await database.storeBlock(boundaryChainId, finalBlock, lease)
			const promotedNetwork = {
				...network,
				startBlock: 2n,
				contracts: [...network.contracts, [discoveredAddress, 'Promoted retained pool', 'securityPool'], [orphanOnlyAddress, 'Promoted orphan', 'securityPool']],
			} satisfies NetworkConfig
			expect(await database.seedNetwork(promotedNetwork, { lease, resetCanonicalHistoryOnManifestChange: true, preserveStoredStart: true })).toBe(true)
			expect((await database.contracts(boundaryChainId, lease)).get(discoveredAddress.toLowerCase())).toMatchObject({
				discoveryBlock: 1n,
				provenance: 'manifest',
			})
			expect(await database.seedNetwork(promotedNetwork, { lease, resetCanonicalHistoryOnManifestChange: true, preserveStoredStart: true })).toBe(false)
			expect((await database.contracts(boundaryChainId, lease)).get(discoveredAddress.toLowerCase())).toMatchObject({
				discoveryBlock: 1n,
				provenance: 'manifest',
			})
			await database.storeBlock(boundaryChainId, retrievableBlock('retrievable-during-promotion', new Date('2026-02-14T00:00:00Z')), lease)
			expect(await database.seedNetwork({ ...network, startBlock: 2n }, { lease, resetCanonicalHistoryOnManifestChange: true, preserveStoredStart: true })).toBe(true)
			const contractsAfterPromotionRemoval = await database.contracts(boundaryChainId, lease)
			expect(contractsAfterPromotionRemoval.get(discoveredAddress.toLowerCase())).toMatchObject(dynamicContract)
			expect(contractsAfterPromotionRemoval.has(orphanOnlyAddress.toLowerCase())).toBe(false)
			await database.storeBlock(boundaryChainId, retrievableBlock('retrievable-after-promotion-removal', new Date('2026-02-15T00:00:00Z')), lease)
			const retainedLogs = await database.sql`
				SELECT block_number FROM logs WHERE chain_id = ${boundaryChainId} AND emitter_address = ${discoveredAddress.toLowerCase()} AND canonical
			`
			expect(retainedLogs).toEqual([{ block_number: '2' }])
			expect((await database.logScanCursors(boundaryChainId, lease)).get(discoveredAddress.toLowerCase())).toEqual({
				contractAddress: discoveredAddress,
				startBlock: 2n,
				lastRetrievedBlock: 2n,
			})
			const statusRows = await database.sql`
				SELECT phase, consecutive_failures, next_retry_at, last_error FROM networks WHERE chain_id = ${boundaryChainId}
			`
			expect(statusRows[0]).toMatchObject({ phase: 'live', consecutive_failures: 0, next_retry_at: null, last_error: null })
		} finally {
			await lease.release()
		}
	} finally {
		await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
		await database.close()
	}
})

postgresTest(
	'clears stale derived rows before replaying a manifest-reset occurrence',
	async () => {
		const postgresUrl = requirePostgresUrl()
		const database = new ScannerDatabase(postgresUrl)
		const manifestChainId = chainId + 200_000 + (process.pid % 100_000)
		const evidenceBlockHash = blockHash(`manifest-replay-block-${manifestChainId}`)
		const evidenceTxHash = blockHash(`manifest-replay-transaction-${manifestChainId}`)
		const network: NetworkConfig = {
			id: `manifest-replay-${manifestChainId}`,
			name: 'Manifest replay fixture',
			chainId: manifestChainId,
			rpcUrls: ['https://example.invalid'],
			startBlock: 1n,
			explorerBaseUrl: 'https://example.invalid',
			nativeSymbol: 'ETH',
			confirmationDepth: 0n,
			contracts: [[discoveredAddress, 'Original OpenOracle', 'openOracle']],
		}
		const evidenceBlock = (eventName: 'ReportSubmitted' | 'ReportDisputed', numReports: string): IndexedBlock => ({
			number: 1n,
			hash: evidenceBlockHash,
			parentHash: blockHash(`manifest-replay-parent-${manifestChainId}`),
			timestamp: new Date('2026-04-02T00:00:00Z'),
			observedHead: 1n,
			finalizedThrough: 1n,
			contracts: [],
			tokenMetadata: [],
			addressActivity: [],
			contractDeploymentObservations: [],
			logScanCursors: [],
			transactions: [
				{
					hash: evidenceTxHash,
					transactionIndex: 0,
					from: address,
					to: discoveredAddress,
					value: 0n,
					input: '0x',
					status: 'success',
					gasUsed: 21_000n,
					receipt: { transactionHash: evidenceTxHash, blockHash: evidenceBlockHash, status: 'success', logs: [] },
					decoded: { status: 'unknown', summary: 'Manifest replay fixture' },
				},
			],
			logs: [
				{
					...decodedLog(evidenceBlockHash, 0, discoveredAddress, eventName, {
						reportId: '7',
						numReports,
						marker: eventName,
					}),
					blockNumber: 1n,
					transactionHash: evidenceTxHash,
				},
			],
		})
		try {
			await initializeSchema(database.sql)
			await database.seedNetwork(network)
			const firstLease = await database.tryAcquireIndexerLock(manifestChainId)
			if (firstLease === undefined) throw new Error('manifest replay writer did not acquire its first lock')
			await database.storeBlock(manifestChainId, evidenceBlock('ReportSubmitted', '1'), firstLease)
			await firstLease.release()
			const submittedEvents = await database.sql`SELECT event_name, round_number::text, report_data, canonical FROM open_oracle_report_events WHERE chain_id = ${manifestChainId}`
			expect(submittedEvents).toEqual([{ event_name: 'ReportSubmitted', round_number: '1', report_data: { marker: 'ReportSubmitted', numReports: '1', reportId: '7' }, canonical: true }])

			const resetLease = await database.tryAcquireIndexerLock(manifestChainId)
			if (resetLease === undefined) throw new Error('manifest replay writer did not acquire its reset lock')
			expect(await database.seedNetwork({ ...network, contracts: [[discoveredAddress, 'Reclassified contract', 'zoltar']] }, { lease: resetLease, resetCanonicalHistoryOnManifestChange: true })).toBeTrue()
			await resetLease.release()
			const manifestResetEvents = await database.sql`
				SELECT payload FROM live_events
				WHERE (payload->>'chainId')::integer = ${manifestChainId} AND event = 'reorg'
				ORDER BY id DESC LIMIT 1
			`
			expect(manifestResetEvents[0]?.['payload']).toMatchObject({ reason: 'manifest-reset' })
			expect(Number((await database.sql`SELECT count(*) AS count FROM open_oracle_report_events WHERE chain_id = ${manifestChainId}`)[0]?.['count'])).toBe(0)

			const replayLease = await database.tryAcquireIndexerLock(manifestChainId)
			if (replayLease === undefined) throw new Error('manifest replay writer did not acquire its replay lock')
			await database.storeBlock(manifestChainId, evidenceBlock('ReportDisputed', '2'), replayLease)
			await replayLease.release()
			const disputedEvents = await database.sql`SELECT event_name, round_number::text, report_data, canonical FROM open_oracle_report_events WHERE chain_id = ${manifestChainId}`
			expect(disputedEvents).toEqual([{ event_name: 'ReportDisputed', round_number: '2', report_data: { marker: 'ReportDisputed', numReports: '2', reportId: '7' }, canonical: true }])
		} finally {
			await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
			void database.close(0)
		}
	},
	30_000,
)

postgresTest(
	'labels an earlier manifest deployment backfill and replays its first missing block',
	async () => {
		const postgresUrl = requirePostgresUrl()
		const database = new ScannerDatabase(postgresUrl)
		const manifestChainId = chainId + 210_000 + (process.pid % 100_000)
		const firstHash = blockHash(`manifest-boundary-first-${manifestChainId}`)
		const secondHash = blockHash(`manifest-boundary-second-${manifestChainId}`)
		const network: NetworkConfig = {
			id: `manifest-boundary-${manifestChainId}`,
			name: 'Manifest boundary fixture',
			chainId: manifestChainId,
			rpcUrls: ['https://example.invalid'],
			startBlock: 1n,
			explorerBaseUrl: 'https://example.invalid',
			nativeSymbol: 'ETH',
			confirmationDepth: 0n,
			contracts: [[discoveredAddress, 'OpenOracle', 'openOracle', 2n]],
		}
		const block = (number: 1n | 2n, hash: ReturnType<typeof blockHash>, parentHash: ReturnType<typeof blockHash>, includeEvidence: boolean): IndexedBlock => ({
			number,
			hash,
			parentHash,
			timestamp: new Date(`2026-04-0${number}T00:00:00Z`),
			observedHead: 2n,
			finalizedThrough: 2n,
			contracts: [],
			tokenMetadata: [],
			addressActivity: [],
			contractDeploymentObservations: [],
			logScanCursors: includeEvidence ? [{ contractAddress: discoveredAddress, startBlock: number, lastRetrievedBlock: number }] : [],
			transactions: includeEvidence ? [{ ...transaction(), receipt: { transactionHash, blockHash: hash, status: 'success', logs: [] } }] : [],
			logs: includeEvidence ? [{ ...log(hash, `manifest boundary evidence at ${number}`), blockNumber: number }] : [],
		})
		try {
			await initializeSchema(database.sql)
			await database.seedNetwork(network)
			const lease = await database.tryAcquireIndexerLock(manifestChainId)
			if (lease === undefined) throw new Error('manifest boundary writer did not acquire its lock')
			try {
				await database.storeBlock(manifestChainId, block(1n, firstHash, blockHash(`manifest-boundary-parent-${manifestChainId}`), false), lease)
				await database.storeBlock(manifestChainId, block(2n, secondHash, firstHash, true), lease)
				const earlierBoundaryNetwork = {
					...network,
					contracts: [[discoveredAddress, 'OpenOracle', 'openOracle', 1n]],
				} satisfies NetworkConfig
				expect(await database.seedNetwork(earlierBoundaryNetwork, { lease, resetCanonicalHistoryOnManifestChange: true, preserveStoredStart: true })).toBe(true)
				expect(await database.seedNetwork(earlierBoundaryNetwork, { lease, resetCanonicalHistoryOnManifestChange: true, preserveStoredStart: true })).toBe(false)

				const invalidation = await database.sql`
					SELECT id::text, reason FROM chain_reorganizations WHERE chain_id = ${manifestChainId} ORDER BY id DESC LIMIT 1
				`
				expect(invalidation[0]?.['reason']).toBe('manifest-reset')
				const invalidationId = String(invalidation[0]?.['id'])
				const occurrences = await database.sql`
					SELECT occurrence_kind, block_hash, occurrence_id, sub_index
					FROM history_invalidation_occurrences WHERE invalidation_id = ${invalidationId}
					ORDER BY occurrence_kind, block_hash
				`
				expect(occurrences).toContainEqual({
					occurrence_kind: 'log',
					block_hash: secondHash,
					occurrence_id: transactionHash,
					sub_index: 0,
				})

				await database.storeBlock(manifestChainId, block(1n, firstHash, blockHash(`manifest-boundary-parent-${manifestChainId}`), true), lease)
				const replayed = await database.sql`
					SELECT block_number::text, block_hash, tx_hash, log_index, canonical
					FROM logs WHERE chain_id = ${manifestChainId} AND block_hash = ${firstHash}
				`
				expect(replayed).toEqual([{ block_number: '1', block_hash: firstHash, tx_hash: transactionHash, log_index: 0, canonical: true }])
			} finally {
				await lease.release()
			}
		} finally {
			await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
			void database.close(0)
		}
	},
	30_000,
)

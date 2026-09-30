// Account-level stages of the canonical lifecycle integration test: address interactions, actions,
// address transaction snapshots, and rich-list rankings over the stored chain.
import { expect } from 'bun:test'
import { isAccountTransactionValue, isRecord } from '../../browser/api-validation.ts'
import { handleApi } from '../../src/api.ts'
import { decodeOpaqueCursor } from '../../src/cursor-codec.ts'
import { type Address, getAddress } from '../../src/ethereum.ts'
import type { LifecycleChain, LifecycleContext } from './canonical-lifecycle-chain.ts'
import { address, blockHash, chainId, discoveredAddress, orphanOnlyAddress, referencedOnlyAddress, rediscoveredAddress, secondWethAddress, transactionHash, wethAddress } from './postgres-fixtures.ts'

const referencedOnlyTransactionHash = blockHash('calldata-only-address-reference')

// Adds bulk sender transactions plus referenced-only and sender-only activity for a second address.
export const seedAddressActivity = async ({ database }: LifecycleContext, { replacement, third }: LifecycleChain): Promise<void> => {
	await database.sql`
			INSERT INTO transactions (chain_id, hash, block_hash, block_number, transaction_index, from_address, to_address, value, input, status, gas_used, receipt, canonical)
			SELECT ${chainId}, '0x' || lpad(to_hex(sequence), 64, '0'), ${third.hash}, 3, sequence, ${address.toLowerCase()},
				${discoveredAddress.toLowerCase()}, 0, '0x', 'success', 21000, '{}'::jsonb, true
			FROM generate_series(1, 60) sequence
		`
	await database.sql`
			INSERT INTO transactions (chain_id, hash, block_hash, block_number, transaction_index, from_address, to_address, value, input, status, gas_used, receipt, canonical)
			VALUES (${chainId}, ${referencedOnlyTransactionHash}, ${third.hash}, 3, 61, ${discoveredAddress.toLowerCase()},
				${address.toLowerCase()}, 0, '0x1234', 'success', 42000, '{}'::jsonb, true)
		`
	await database.sql`
			INSERT INTO actions (chain_id, block_hash, tx_hash, contract_address, function_name, function_signature, arguments, display_arguments, argument_schema, decode_status, summary)
			VALUES (${chainId}, ${third.hash}, ${referencedOnlyTransactionHash}, ${address.toLowerCase()}, 'reportFor', 'reportFor(address)',
				${JSON.stringify({ participant: referencedOnlyAddress.toLowerCase() })}::jsonb,
				${JSON.stringify({ participant: referencedOnlyAddress.toLowerCase() })}::jsonb,
				${JSON.stringify([{ index: 0, name: 'participant', type: 'address' }])}::jsonb, 'decoded', 'reportFor')
		`
	await database.sql`
			INSERT INTO address_activity (chain_id, block_hash, block_number, tx_hash, address, pool_address, role, canonical)
			VALUES (${chainId}, ${third.hash}, 3, ${referencedOnlyTransactionHash}, ${referencedOnlyAddress.toLowerCase()},
				'0x0000000000000000000000000000000000000000', 'referenced', true)
		`
	const newerSenderTransactionHash = blockHash('newer-sender-only-address-activity')
	await database.sql`
			INSERT INTO transactions (chain_id, hash, block_hash, block_number, transaction_index, from_address, to_address, value, input, status, gas_used, receipt, canonical)
			VALUES (${chainId}, ${newerSenderTransactionHash}, ${third.hash}, 3, 62, ${referencedOnlyAddress.toLowerCase()},
				${address.toLowerCase()}, 0, '0x', 'success', 21000, '{}'::jsonb, true)
		`
	await database.sql`
			INSERT INTO address_activity (chain_id, block_hash, block_number, tx_hash, address, pool_address, role, canonical)
			VALUES (${chainId}, ${third.hash}, 3, ${newerSenderTransactionHash}, ${referencedOnlyAddress.toLowerCase()},
				'0x0000000000000000000000000000000000000000', 'sender', true)
		`
	await database.sql`
			INSERT INTO address_activity (chain_id, block_hash, block_number, tx_hash, address, pool_address, role, canonical)
			VALUES (${chainId}, ${replacement.hash}, 2, ${transactionHash}, ${referencedOnlyAddress.toLowerCase()},
				'0x0000000000000000000000000000000000000000', 'referenced', true)
		`
}

export const expectAddressInteractionsAndActions = async ({ database }: LifecycleContext): Promise<void> => {
	const interactionsResponse = await handleApi(new Request(`http://localhost/api/v1/address-interactions?chainId=${chainId}&address=${referencedOnlyAddress}&limit=1`), database.sql)
	if (interactionsResponse === undefined) throw new Error('address interactions API did not return a response')
	if (!interactionsResponse.ok) throw new Error(`address interactions API failed: ${await interactionsResponse.text()}`)
	const interactionsPayload: unknown = await interactionsResponse.json()
	expect(interactionsPayload).toMatchObject({
		items: [
			{
				tx_hash: referencedOnlyTransactionHash,
				roles: ['referenced'],
				pool_addresses: null,
				function_name: 'reportFor',
				action_arguments: { participant: referencedOnlyAddress.toLowerCase() },
			},
		],
		total: 2,
		limit: 1,
	})
	if (!isRecord(interactionsPayload) || !Array.isArray(interactionsPayload['items'])) throw new Error('address interactions API returned malformed items')
	expect(interactionsPayload['items'].every(isAccountTransactionValue)).toBeTrue()
	const interactionCursor = interactionsPayload['nextCursor']
	if (typeof interactionCursor !== 'string') throw new Error('address interactions API omitted its continuation')
	const olderInteractionsResponse = await handleApi(new Request(`http://localhost/api/v1/address-interactions?chainId=${chainId}&address=${referencedOnlyAddress}&limit=1&cursor=${encodeURIComponent(interactionCursor)}`), database.sql)
	expect(await olderInteractionsResponse?.json()).toMatchObject({
		items: [expect.objectContaining({ tx_hash: transactionHash })],
		total: 2,
	})
	const firstActionsResponse = await handleApi(new Request(`http://localhost/api/v1/actions?chainId=${chainId}&limit=1`), database.sql)
	const firstActions = (await firstActionsResponse?.json()) as { items: Array<{ tx_hash: string }>; nextCursor?: string }
	expect(firstActions.items).toHaveLength(1)
	expect(firstActions.nextCursor).toBeString()
	const mismatchedActionChainResponse = await handleApi(new Request(`http://localhost/api/v1/actions?chainId=${chainId + 1}&limit=1&cursor=${encodeURIComponent(firstActions.nextCursor ?? '')}`), database.sql)
	expect(mismatchedActionChainResponse?.status).toBe(400)
	const secondActionsResponse = await handleApi(new Request(`http://localhost/api/v1/actions?chainId=${chainId}&limit=1&cursor=${encodeURIComponent(firstActions.nextCursor ?? '')}`), database.sql)
	const secondActions = (await secondActionsResponse?.json()) as { items: Array<{ tx_hash: string }> }
	expect(secondActions.items).toHaveLength(1)
	expect(secondActions.items[0]?.tx_hash).not.toBe(firstActions.items[0]?.tx_hash)
	const originalProjectionSource = await database.sql`SELECT applied_projection_source_hash FROM networks WHERE chain_id = ${chainId}`
	await database.sql`UPDATE networks SET applied_projection_source_hash = 'changed-projection-source' WHERE chain_id = ${chainId}`
	const staleActionsResponse = await handleApi(new Request(`http://localhost/api/v1/actions?chainId=${chainId}&limit=1&cursor=${encodeURIComponent(firstActions.nextCursor ?? '')}`), database.sql)
	expect(staleActionsResponse?.status).toBe(409)
	await database.sql`
				UPDATE networks SET applied_projection_source_hash = ${originalProjectionSource[0]?.['applied_projection_source_hash']}
				WHERE chain_id = ${chainId}
			`
}

// Address transaction pages keep their snapshot when newer canonical transactions arrive.
export const expectAddressTransactionSnapshots = async ({ database }: LifecycleContext, { replacement, third }: LifecycleChain): Promise<void> => {
	const transactionsResponse = await handleApi(new Request(`http://localhost/api/v1/address-transactions?chainId=${chainId}&address=${address}&limit=50`), database.sql)
	if (transactionsResponse === undefined) throw new Error('address transactions API did not return a response')
	const transactions = (await transactionsResponse.json()) as {
		items: Array<Record<string, unknown>>
		nextCursor: string
		snapshotBlock: string
		total: number
	}
	expect(transactions).toMatchObject({ total: 62, snapshotBlock: '3' })
	expect(transactions.items).toHaveLength(50)
	await database.sql`UPDATE blocks SET canonical = false WHERE chain_id = ${chainId} AND hash = ${third.hash}`
	const staleCursorResponse = await handleApi(new Request(`http://localhost/api/v1/address-transactions?chainId=${chainId}&address=${address}&limit=50&cursor=${encodeURIComponent(transactions.nextCursor)}`), database.sql)
	expect(staleCursorResponse?.status).toBe(409)
	expect(await staleCursorResponse?.json()).toEqual({ error: 'Transaction history changed; restart pagination' })
	const canonicalOnlyTransactionsResponse = await handleApi(new Request(`http://localhost/api/v1/address-transactions?chainId=${chainId}&address=${address}&limit=50`), database.sql)
	if (canonicalOnlyTransactionsResponse === undefined) throw new Error('canonical-only address transaction page did not return a response')
	expect(await canonicalOnlyTransactionsResponse.json()).toMatchObject({ total: 1, snapshotBlock: '2' })
	await database.sql`UPDATE blocks SET canonical = true WHERE chain_id = ${chainId} AND hash = ${third.hash}`
	const alteredCursorParts = decodeOpaqueCursor(transactions.nextCursor) as unknown[]
	alteredCursorParts[10] = Number(alteredCursorParts[10]) + 1
	const alteredTotalResponse = await handleApi(new Request(`http://localhost/api/v1/address-transactions?chainId=${chainId}&address=${address}&limit=50&cursor=${encodeURIComponent(btoa(JSON.stringify(alteredCursorParts)))}`), database.sql)
	expect(alteredTotalResponse?.status).toBe(409)
	expect(await alteredTotalResponse?.json()).toEqual({ error: 'Transaction history changed; restart pagination' })
	const fourthHash = blockHash('block-four-direct')
	await database.sql`INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, canonical) VALUES (${chainId}, 4, ${fourthHash}, ${third.hash}, '2026-01-04T00:00:00Z', true)`
	await database.sql`
			INSERT INTO transactions (chain_id, hash, block_hash, block_number, transaction_index, from_address, to_address, value, input, status, gas_used, receipt, canonical)
			VALUES (${chainId}, ${blockHash('newer-address-transaction')}, ${fourthHash}, 4, 0, ${address.toLowerCase()}, ${discoveredAddress.toLowerCase()}, 0, '0x', 'success', 21000, '{}'::jsonb, true)
		`
	const secondPageResponse = await handleApi(new Request(`http://localhost/api/v1/address-transactions?chainId=${chainId}&address=${address}&limit=50&cursor=${encodeURIComponent(transactions.nextCursor)}`), database.sql)
	if (secondPageResponse === undefined) throw new Error('second address transaction page did not return a response')
	const secondPage = (await secondPageResponse.json()) as { items: Array<Record<string, unknown>>; nextCursor?: string; total: number }
	const snapshotItems = [...transactions.items, ...secondPage.items]
	expect(secondPage).toMatchObject({ total: 62 })
	expect(secondPage.nextCursor).toBeUndefined()
	expect(snapshotItems).toHaveLength(62)
	expect(new Set(snapshotItems.map(item => item['tx_hash'])).size).toBe(62)
	expect(snapshotItems).toContainEqual(
		expect.objectContaining({
			tx_hash: transactionHash,
			from_address: address.toLowerCase(),
			block_hash: replacement.hash,
			action_summary: 'Unknown call',
		}),
	)
	expect(snapshotItems.some(item => item['block_hash'] === fourthHash)).toBe(false)
	const currentTransactionsResponse = await handleApi(new Request(`http://localhost/api/v1/address-transactions?chainId=${chainId}&address=${address}&limit=1`), database.sql)
	if (currentTransactionsResponse === undefined) throw new Error('current address transaction page did not return a response')
	expect(await currentTransactionsResponse.json()).toMatchObject({ total: 63, snapshotBlock: '4' })
}

export const expectRichListProfiles = async ({ database }: LifecycleContext): Promise<string> => {
	const richListResponse = await handleApi(new Request(`http://localhost/api/v1/richlist?chainId=${chainId}`), database.sql)
	if (richListResponse === undefined) throw new Error('rich-list API did not return a response')
	const richList = (await richListResponse.json()) as {
		items: Array<
			Record<string, unknown> & {
				rep_balances: Array<Record<string, unknown>>
				pool_associations: Array<Record<string, unknown>>
				vault_positions: Array<Record<string, unknown>>
				weth_balances: Array<Record<string, unknown>>
				native_balance_detail: Record<string, unknown>
			}
		>
		total: number
	}
	expect(richList.total).toBe(2)
	const otherRichListAddress = richList.items.find(item => item['address'] !== address.toLowerCase())?.['address']
	if (typeof otherRichListAddress !== 'string') throw new Error('Expected another ranked address')
	const addressRichList = richList.items.find(item => item['address'] === address.toLowerCase())
	expect(addressRichList).toMatchObject({
		address: address.toLowerCase(),
		transaction_count: '1',
		interaction_count: '1',
		pool_count: '1',
		native_balance: '2000000000456789123',
		weth_balance: '1456790112345679011',
		weth_token_count: '2',
		sampled_weth_token_count: '2',
		rep_token_count: '2',
		sampled_rep_token_count: '1',
	})
	const addressProfileResponse = await handleApi(new Request(`http://localhost/api/v1/richlist?chainId=${chainId}&address=${address}`), database.sql)
	if (addressProfileResponse === undefined) throw new Error('address profile query did not return a response')
	expect(await addressProfileResponse.json()).toMatchObject({
		total: 1,
		items: [expect.objectContaining({ address: address.toLowerCase(), pool_count: '1', vault_count: '1' })],
	})
	const addressIdentityResponse = await handleApi(new Request(`http://localhost/api/v1/address-identity?chainId=${chainId}&address=${discoveredAddress}`), database.sql)
	if (addressIdentityResponse === undefined) throw new Error('address identity query did not return a response')
	expect(await addressIdentityResponse.json()).toMatchObject({
		address: discoveredAddress.toLowerCase(),
		label: 'Discovered pool',
		kind: 'securityPool',
	})
	expect(addressRichList?.rep_balances).toEqual([
		expect.objectContaining({
			address: rediscoveredAddress.toLowerCase(),
			balance: '3000000000000000000',
			symbol: 'OLD',
			contractLabel: 'Original discovery',
		}),
	])
	expect(addressRichList?.weth_balances).toEqual([expect.objectContaining({ address: wethAddress.toLowerCase(), balance: '1234567890123456789', symbol: 'WETH' }), expect.objectContaining({ address: secondWethAddress.toLowerCase(), balance: '222222222222222222', symbol: 'WETH2' })])
	expect(addressRichList?.native_balance_detail).toEqual({ balance: '2000000000456789123', blockNumber: '2' })
	expect(addressRichList?.pool_associations).toEqual([expect.objectContaining({ address: discoveredAddress.toLowerCase() })])
	expect(addressRichList?.vault_positions).toEqual([
		expect.objectContaining({
			poolAddress: discoveredAddress.toLowerCase(),
			repBackingUnits: '120000000000000000000',
			underwritingLimitAttoEth: 85_000_000_000_000_000_000n.toString(),
			claimableFeesAttoEth: 30_000_000_000_000_000n.toString(),
			blockNumber: '2',
		}),
	])
	const beyondEndResponse = await handleApi(new Request(`http://localhost/api/v1/richlist?chainId=${chainId}&offset=2`), database.sql)
	if (beyondEndResponse === undefined) throw new Error('offset rich-list API did not return a response')
	const beyondEnd = (await beyondEndResponse.json()) as { items: unknown[]; total: number }
	expect(beyondEnd).toMatchObject({ items: [], total: 2 })
	return otherRichListAddress
}

// REP ranking uses refreshed balances and token decimals rather than raw balances.
export const expectRepRankingWithRefreshedBalances = async ({ database }: LifecycleContext, { third }: LifecycleChain, otherRichListAddress: string): Promise<void> => {
	const balanceLease = await database.tryAcquireIndexerLock(chainId)
	if (balanceLease === undefined) throw new Error('balance refresher did not acquire its lock')
	await database.storeRichListBalances(
		chainId,
		3n,
		third.hash,
		[
			{ owner: address, assetAddress: getAddress('0x0000000000000000000000000000000000000000'), assetKind: 'native', balance: 2_000_000_000_000_000_000n },
			{ owner: address, assetAddress: rediscoveredAddress, assetKind: 'rep', balance: 3_000_000_000_000_000_000n },
			{ owner: address, assetAddress: orphanOnlyAddress, assetKind: 'rep', balance: 4_000_000_000_000_000_000n },
			{ owner: getAddress(otherRichListAddress), assetAddress: orphanOnlyAddress, assetKind: 'rep', balance: 10_000_000_000_000_000_000n },
		],
		balanceLease,
	)
	await balanceLease.release()
	const beforeMetadataResponse = await handleApi(new Request(`http://localhost/api/v1/richlist?chainId=${chainId}&sort=rep`), database.sql)
	if (beforeMetadataResponse === undefined) throw new Error('Pre-metadata REP ranking did not return a response')
	const beforeMetadata = (await beforeMetadataResponse.json()) as { items: Array<Record<string, unknown>> }
	expect(beforeMetadata.items[0]).toMatchObject({ address: otherRichListAddress, largest_rep_decimals: 18 })
	await database.sql`INSERT INTO token_metadata (chain_id, address, block_hash, name, symbol, decimals, read_block, canonical)
				VALUES (${chainId}, ${orphanOnlyAddress.toLowerCase()}, ${third.hash}, 'Fork REP', 'FREP', 19, 3, true)`
	const refreshedResponse = await handleApi(new Request(`http://localhost/api/v1/richlist?chainId=${chainId}&address=${address}`), database.sql)
	if (refreshedResponse === undefined) throw new Error('refreshed rich-list API did not return a response')
	const refreshed = (await refreshedResponse.json()) as { items: Array<Record<string, unknown>> }
	expect(refreshed.items[0]).toMatchObject({
		rep_token_count: '2',
		sampled_rep_token_count: '2',
		largest_rep_token_address: rediscoveredAddress.toLowerCase(),
		largest_rep_balance: '3000000000000000000',
		largest_rep_decimals: 18,
	})
	expect(refreshed.items[0]).not.toHaveProperty('rep_balance')
	const repSortedResponse = await handleApi(new Request(`http://localhost/api/v1/richlist?chainId=${chainId}&sort=rep`), database.sql)
	if (repSortedResponse === undefined) throw new Error('REP-sorted rich list did not return a response')
	const repSorted = (await repSortedResponse.json()) as { items: Array<Record<string, unknown>> }
	expect(repSorted.items.map(item => item['address'])).toEqual([address.toLowerCase(), otherRichListAddress])
	expect(repSorted.items[1]).toMatchObject({ largest_rep_balance: '10000000000000000000', largest_rep_decimals: 19 })
}

// Caps an address's returned REP balances at 100 of its sampled tokens.
export const expectCappedRepBalances = async ({ database, network }: LifecycleContext, { third }: LifecycleChain): Promise<readonly Address[]> => {
	const extraRepTokens = Array.from({ length: 101 }, (_, index) => getAddress(`0x${(0x7000000000000000000000000000000000000000n + BigInt(index)).toString(16)}`))
	await database.seedNetwork({
		...network,
		contracts: extraRepTokens.map((token, index) => [token, `Extra REP ${index + 1}`, 'reputationToken']),
	})
	const assetLimitLease = await database.tryAcquireIndexerLock(chainId)
	if (assetLimitLease === undefined) throw new Error('asset-limit writer did not acquire its lock')
	await database.storeRichListBalances(
		chainId,
		3n,
		third.hash,
		extraRepTokens.map((token, index) => ({ owner: address, assetAddress: token, assetKind: 'rep' as const, balance: BigInt(index + 1) })),
		assetLimitLease,
	)
	await assetLimitLease.release()
	const cappedResponse = await handleApi(new Request(`http://localhost/api/v1/richlist?chainId=${chainId}&address=${address}`), database.sql)
	if (cappedResponse === undefined) throw new Error('capped rich-list API did not return a response')
	const capped = (await cappedResponse.json()) as { items: Array<Record<string, unknown> & { rep_balances: Array<{ address: string }> }> }
	expect(capped.items[0]).toMatchObject({ sampled_rep_token_count: '102', returned_rep_token_count: '100', rep_balances_truncated: true })
	expect(capped.items[0]?.rep_balances).toHaveLength(100)
	expect(capped.items[0]?.rep_balances.map(balance => balance.address)).toEqual(
		[rediscoveredAddress, ...extraRepTokens]
			.map(token => token.toLowerCase())
			.toSorted()
			.slice(0, 100),
	)
	return extraRepTokens
}

export const expectLargeRichListSnapshotPages = async ({ database }: LifecycleContext, { replacement }: LifecycleChain): Promise<void> => {
	await database.sql`
			INSERT INTO address_activity (chain_id, block_hash, block_number, tx_hash, address, pool_address, role, canonical)
			SELECT ${chainId}, ${replacement.hash}, 2, ${transactionHash},
				'0x' || lpad(to_hex(participant), 40, '0'),
				'0x0000000000000000000000000000000000000000', 'referenced', true
			FROM generate_series(1, 5000) participant
			ON CONFLICT DO NOTHING
		`
	const largePageResponse = await database.read(sql => handleApi(new Request(`http://localhost/api/v1/richlist?chainId=${chainId}&limit=10`), sql), 8_000)
	if (largePageResponse === undefined) throw new Error('large rich-list page did not return a response')
	const largePage = (await largePageResponse.json()) as { items: Array<{ address: string }>; total: number; snapshotCursor: string; snapshotBlock: string }
	expect(largePage.snapshotCursor).toBeString()
	expect(largePage.snapshotBlock).toBe('3')
	expect(largePage).toMatchObject({ total: 5002 })
	expect(largePage.items).toHaveLength(10)
	const secondLargePageResponse = await database.read(sql => handleApi(new Request(`http://localhost/api/v1/richlist?chainId=${chainId}&limit=10&offset=10&snapshot=${encodeURIComponent(largePage.snapshotCursor)}`), sql), 8_000)
	if (secondLargePageResponse === undefined) throw new Error('second large rich-list page did not return a response')
	const secondLargePage = (await secondLargePageResponse.json()) as { items: Array<{ address: string }>; total: number; offset: number }
	expect(secondLargePage).toMatchObject({ total: 5002, offset: 10 })
	expect(secondLargePage.items).toHaveLength(10)
	expect(new Set([...largePage.items.map(item => item.address), ...secondLargePage.items.map(item => item.address)]).size).toBe(20)
	const largeBeyondEndResponse = await database.read(sql => handleApi(new Request(`http://localhost/api/v1/richlist?chainId=${chainId}&limit=10&offset=100000`), sql), 8_000)
	if (largeBeyondEndResponse === undefined) throw new Error('large beyond-end rich-list page did not return a response')
	const largeBeyondEnd = (await largeBeyondEndResponse.json()) as { items: unknown[]; total: number }
	expect(largeBeyondEnd).toMatchObject({ items: [], total: 5002 })
}

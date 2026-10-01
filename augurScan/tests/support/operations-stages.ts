// Paginated catalog stages of the operations snapshot integration test. Each stage reads the seeded
// operations chain and proves continuation cursors are filter-, scope-, and generation-bound.
import { expect } from 'bun:test'
import { handleApi } from '../../src/api.ts'
import { decodeOpaqueCursor } from '../../src/cursor-codec.ts'
import type { OperationsContext } from './operations-fixtures.ts'
import { address, transactionHash } from './postgres-fixtures.ts'

// Audit twins sharing one log paginate with a Unicode query bound to the cursor.
export const expectTimelinePagination = async ({ database, operationsChainId, oracle, hash }: OperationsContext): Promise<void> => {
	await database.sql`
				INSERT INTO protocol_timeline_entries
					(chain_id, block_hash, tx_hash, log_index, block_number, entity_type, entity_identity,
						semantic_event_kind, summary_data, related_entities, source_contract, source_event, canonical)
				VALUES
					(${operationsChainId}, ${hash}, ${transactionHash}, 0, 1, 'audit-link', 'a', 'AuditTwin', '{"side":"a","query":"🔮"}'::jsonb,
						'[]'::jsonb, ${oracle.toLowerCase()}, 'ReportSubmitted', true),
					(${operationsChainId}, ${hash}, ${transactionHash}, 0, 1, 'audit-link', 'b', 'AuditTwin', '{"side":"b","query":"🔮"}'::jsonb,
						'[]'::jsonb, ${oracle.toLowerCase()}, 'ReportSubmitted', true)
			`
	const firstTimelinePageResponse = await handleApi(new Request(`http://localhost/api/v1/state/timeline?chainId=${operationsChainId}&event=AuditTwin&q=${encodeURIComponent('🔮')}&limit=1`), database.sql)
	const firstTimelinePage = (await firstTimelinePageResponse?.json()) as {
		data: { items: Array<{ entity_identity: string }>; total: string; hasMore: boolean; nextCursor?: string }
	}
	expect(firstTimelinePage.data).toMatchObject({ items: [expect.objectContaining({ entity_identity: 'b' })], total: '2', hasMore: true })
	const timelineCursor = firstTimelinePage.data.nextCursor
	if (typeof timelineCursor !== 'string') throw new Error('global timeline omitted its continuation')
	const mismatchedTimelineFilterResponse = await handleApi(new Request(`http://localhost/api/v1/state/timeline?chainId=${operationsChainId}&event=AuditTwin&q=${encodeURIComponent('🪐')}&limit=1&cursor=${encodeURIComponent(timelineCursor)}`), database.sql)
	expect(mismatchedTimelineFilterResponse?.status).toBe(400)
	const secondTimelinePageResponse = await handleApi(new Request(`http://localhost/api/v1/state/timeline?chainId=${operationsChainId}&event=AuditTwin&q=${encodeURIComponent('🔮')}&limit=1&cursor=${encodeURIComponent(timelineCursor)}`), database.sql)
	expect(await secondTimelinePageResponse?.json()).toMatchObject({
		data: { items: [expect.objectContaining({ entity_identity: 'a' })], total: '2', hasMore: false },
	})
}

export const expectUnicodeTradingPagination = async ({ database, operationsChainId }: OperationsContext): Promise<void> => {
	const unicodeTradingQuery = encodeURIComponent('🔮')
	const firstUnicodeTradingPageResponse = await handleApi(new Request(`http://localhost/api/v1/state/trading?chainId=${operationsChainId}&q=${unicodeTradingQuery}&limit=1`), database.sql)
	const firstUnicodeTradingPage = (await firstUnicodeTradingPageResponse?.json()) as {
		data: { items: Array<{ question_title: string }>; total: number; hasMore: boolean; nextCursor?: string }
	}
	expect(firstUnicodeTradingPage.data).toMatchObject({
		items: [expect.objectContaining({ question_title: 'Will the 🔮 forecast resolve?' })],
		total: 102,
		hasMore: true,
	})
	const unicodeTradingCursor = firstUnicodeTradingPage.data.nextCursor
	if (typeof unicodeTradingCursor !== 'string') throw new Error('Unicode trading catalog omitted its continuation')
	const mismatchedUnicodeTradingFilterResponse = await handleApi(new Request(`http://localhost/api/v1/state/trading?chainId=${operationsChainId}&q=${encodeURIComponent('🪐')}&limit=1&cursor=${encodeURIComponent(unicodeTradingCursor)}`), database.sql)
	expect(mismatchedUnicodeTradingFilterResponse?.status).toBe(400)
	const secondUnicodeTradingPageResponse = await handleApi(new Request(`http://localhost/api/v1/state/trading?chainId=${operationsChainId}&q=${unicodeTradingQuery}&limit=1&cursor=${encodeURIComponent(unicodeTradingCursor)}`), database.sql)
	expect(await secondUnicodeTradingPageResponse?.json()).toMatchObject({
		data: {
			items: [expect.objectContaining({ question_title: 'Will the 🔮 forecast resolve?' })],
			total: 102,
			offset: 1,
			hasMore: true,
		},
	})
}

// Report rounds and coordinator decisions paginate independently; decisions are bound to the application source.
export const expectReportDetailPagination = async ({ database, operationsChainId, oracle }: OperationsContext): Promise<void> => {
	const firstResponse = await handleApi(new Request(`http://localhost/api/v1/state/reports/${operationsChainId}/${oracle.toLowerCase()}/7?limit=1&decisionLimit=1`), database.sql)
	if (firstResponse === undefined) throw new Error('report detail endpoint did not return a response')
	const first = (await firstResponse.json()) as {
		data: {
			rounds: { items: Array<Record<string, unknown>>; hasMore: boolean; nextCursor: string }
			coordinatorDecisions: { items: Array<Record<string, unknown>>; hasMore: boolean; nextCursor: string }
		}
	}
	expect(first.data.rounds).toMatchObject({ hasMore: true })
	expect(first.data.rounds.items).toHaveLength(1)
	expect(first.data.rounds.items[0]?.['comparison']).toMatchObject({
		state: 'compared',
		changes: expect.arrayContaining([expect.objectContaining({ field: 'currentAmount1', kind: 'removed', before: '100' })]),
	})
	expect(first.data.coordinatorDecisions).toMatchObject({ hasMore: true })
	expect(first.data.coordinatorDecisions.items).toHaveLength(1)
	const decisionItems = [...first.data.coordinatorDecisions.items]
	let decisionCursor: string | undefined = first.data.coordinatorDecisions.nextCursor
	while (decisionCursor !== undefined) {
		const decisionResponse = await handleApi(new Request(`http://localhost/api/v1/state/reports/${operationsChainId}/${oracle.toLowerCase()}/7?limit=1&decisionLimit=1&decisionCursor=${encodeURIComponent(decisionCursor)}`), database.sql)
		if (decisionResponse === undefined) throw new Error('coordinator decision continuation did not return a response')
		const decisionPage = (await decisionResponse.json()) as {
			data: { coordinatorDecisions: { items: Array<Record<string, unknown>>; hasMore: boolean; nextCursor?: string } }
		}
		decisionItems.push(...decisionPage.data.coordinatorDecisions.items)
		decisionCursor = decisionPage.data.coordinatorDecisions.nextCursor
	}
	expect(decisionItems).toHaveLength(3)
	expect(new Set(decisionItems.map(item => `${String(item['tx_hash'])}:${String(item['log_index'])}`)).size).toBe(3)
	await database.sql`
				UPDATE networks SET applied_application_source_hash = 'changed-during-decision-pagination'
				WHERE chain_id = ${operationsChainId}
			`
	const staleDecisionResponse = await handleApi(new Request(`http://localhost/api/v1/state/reports/${operationsChainId}/${oracle.toLowerCase()}/7?decisionLimit=1&decisionCursor=${encodeURIComponent(first.data.coordinatorDecisions.nextCursor)}`), database.sql)
	expect(staleDecisionResponse?.status).toBe(409)
	await database.sql`
				UPDATE networks SET applied_application_source_hash = NULL WHERE chain_id = ${operationsChainId}
			`
	const secondResponse = await handleApi(new Request(`http://localhost/api/v1/state/reports/${operationsChainId}/${oracle.toLowerCase()}/7?limit=1&cursor=${encodeURIComponent(first.data.rounds.nextCursor)}`), database.sql)
	if (secondResponse === undefined) throw new Error('report detail continuation did not return a response')
	const second = (await secondResponse.json()) as { data: { rounds: { items: unknown[]; hasMore: boolean; nextCursor: string } } }
	expect(second.data.rounds).toMatchObject({ hasMore: true })
	expect(second.data.rounds.items).toHaveLength(1)
	const thirdResponse = await handleApi(new Request(`http://localhost/api/v1/state/reports/${operationsChainId}/${oracle.toLowerCase()}/7?limit=1&cursor=${encodeURIComponent(second.data.rounds.nextCursor)}`), database.sql)
	if (thirdResponse === undefined) throw new Error('report detail final continuation did not return a response')
	const third = (await thirdResponse.json()) as { data: { rounds: { items: unknown[]; hasMore: boolean } } }
	expect(third.data.rounds).toMatchObject({ hasMore: false })
	expect(third.data.rounds.items).toHaveLength(1)
}

// The report catalog orders by latest evidence and rejects a cursor after a same-head projection generation.
export const expectReportCatalogGenerations = async ({ database, operationsChainId, oracle, hash }: OperationsContext): Promise<void> => {
	await database.sql`
			INSERT INTO transactions (
				chain_id, hash, block_hash, block_number, transaction_index, from_address, to_address,
				value, input, status, gas_used, receipt, canonical
			) VALUES
			(${operationsChainId}, ${`0x${'e'.repeat(64)}`}, ${hash}, 1, 2, ${address.toLowerCase()}, ${oracle.toLowerCase()}, 0, '0x', 'success', 21000, '{}'::jsonb, true),
			(${operationsChainId}, ${`0x${'f'.repeat(64)}`}, ${hash}, 1, 1, ${address.toLowerCase()}, ${oracle.toLowerCase()}, 0, '0x', 'success', 21000, '{}'::jsonb, true)
		`
	await database.sql`
			INSERT INTO logs (
				chain_id, tx_hash, block_hash, block_number, transaction_index, log_index, emitter_address,
				topics, data, event_name, arguments, argument_schema, decode_status, summary, canonical, finalized
			) VALUES
			(${operationsChainId}, ${`0x${'e'.repeat(64)}`}, ${hash}, 1, 2, 2, ${oracle.toLowerCase()}, '[]'::jsonb,
				'0x', 'ReportSettled', jsonb_build_object('reportId', '7'), '[]'::jsonb, 'decoded', 'Report 7 settled', true, true),
			(${operationsChainId}, ${`0x${'f'.repeat(64)}`}, ${hash}, 1, 1, 1, ${oracle.toLowerCase()}, '[]'::jsonb,
				'0x', 'ReportSubmitted', jsonb_build_object('reportId', '8'), '[]'::jsonb, 'decoded', 'Report 8', true, true)
		`
	await database.sql`
			INSERT INTO open_oracle_report_events (
				chain_id, block_hash, tx_hash, log_index, block_number, open_oracle_address,
				report_id, event_name, round_number, report_data, canonical
			) VALUES
			(${operationsChainId}, ${hash}, ${`0x${'e'.repeat(64)}`}, 2, 1, ${oracle.toLowerCase()}, 7,
				'ReportSettled', 2, jsonb_build_object('reportId', '7'), true),
			(${operationsChainId}, ${hash}, ${`0x${'f'.repeat(64)}`}, 1, 1, ${oracle.toLowerCase()}, 8,
				'ReportSubmitted', 1, jsonb_build_object('reportId', '8'), true)
		`
	const firstCatalogResponse = await handleApi(new Request(`http://localhost/api/v1/state/reports?chainId=${operationsChainId}&limit=1`), database.sql)
	if (firstCatalogResponse === undefined) throw new Error('report catalog did not return a response')
	const firstCatalog = (await firstCatalogResponse.json()) as {
		data: { items: Array<{ report_id: string; tx_hash: string }>; nextCursor: string }
	}
	expect(firstCatalog.data.items).toHaveLength(1)
	expect(firstCatalog.data.items[0]).toMatchObject({ report_id: '103', tx_hash: `0x${(20103).toString(16).padStart(64, '0')}` })
	const secondCatalogResponse = await handleApi(new Request(`http://localhost/api/v1/state/reports?chainId=${operationsChainId}&limit=1&cursor=${encodeURIComponent(firstCatalog.data.nextCursor)}`), database.sql)
	if (secondCatalogResponse === undefined) throw new Error('report catalog continuation did not return a response')
	const secondCatalog = (await secondCatalogResponse.json()) as { data: { items: Array<{ report_id: string }> } }
	expect(secondCatalog.data.items.map(item => item.report_id)).toEqual(['102'])
	const generationRows = await database.sql`
					INSERT INTO chain_reorganizations
						(chain_id, previous_block, previous_hash, ancestor_block, ancestor_hash, depth, reason)
					VALUES (${operationsChainId}, 1, ${hash}, 1, ${hash}, 0, 'projection-rebuild')
					RETURNING id::text
				`
	const generationId = generationRows[0]?.['id']
	if (typeof generationId !== 'string') throw new Error('same-head projection generation was not recorded')
	const staleCatalogResponse = await handleApi(new Request(`http://localhost/api/v1/state/reports?chainId=${operationsChainId}&limit=1&cursor=${encodeURIComponent(firstCatalog.data.nextCursor)}`), database.sql)
	expect(staleCatalogResponse?.status).toBe(409)
	await database.sql`DELETE FROM chain_reorganizations WHERE id = ${generationId}`
}

export const expectTradingAndPortfolioPagination = async ({ database, operationsChainId, oracle }: OperationsContext): Promise<void> => {
	const tradingResponse = await handleApi(new Request(`http://localhost/api/v1/state/trading/${operationsChainId}/${oracle.toLowerCase()}`), database.sql)
	if (tradingResponse === undefined) throw new Error('trading endpoint did not return a response')
	const trading = (await tradingResponse.json()) as {
		data: {
			summary: { swaps_7d: number; input_volume_7d: string; fees_7d: string }
			twap7d: { state: string }
			observationsTruncated: boolean
			observationRange: { firstTimestamp: string; lastTimestamp: string; count: number }
		}
	}
	expect(trading.data).toMatchObject({
		summary: { swaps_7d: 10002, input_volume_7d: '10002', fees_7d: '10002' },
		twap7d: { state: 'Partial coverage' },
		observationsTruncated: true,
		observationRange: { firstTimestamp: '1767225624', lastTimestamp: '1767235623', count: 10000 },
	})

	const selfTransferMarket = `0x${(1000002).toString(16).padStart(40, '0')}`
	const selfTransferResponse = await handleApi(new Request(`http://localhost/api/v1/state/trading/${operationsChainId}/${selfTransferMarket}`), database.sql)
	if (selfTransferResponse === undefined) throw new Error('self-transfer trading endpoint did not return a response')
	const selfTransfer = (await selfTransferResponse.json()) as {
		data: { lpPositions: Array<{ address: string; received_liquidity: string; sent_liquidity: string; balance: string }> }
	}
	expect(selfTransfer.data.lpPositions).toContainEqual({
		address: address.toLowerCase(),
		received_liquidity: '1001',
		sent_liquidity: '999',
		balance: '2',
	})

	const portfolioResponse = await handleApi(new Request(`http://localhost/api/v1/state/address-portfolio?chainId=${operationsChainId}&address=${address.toLowerCase()}`), database.sql)
	if (portfolioResponse === undefined) throw new Error('portfolio endpoint did not return a response')
	const portfolio = (await portfolioResponse.json()) as {
		data: {
			lp_positions: Array<{ market_address: string; balance: string }>
			fork_participation: Array<{ universe_identity: string }>
			report_participation: Array<{ report_id: string }>
			portfolioPagination: Record<'lp' | 'forks' | 'reports', { total: number; hasMore: boolean; nextCursor: string }>
		}
	}
	expect(portfolio.data.lp_positions).toHaveLength(100)
	expect(portfolio.data.fork_participation).toHaveLength(100)
	expect(portfolio.data.report_participation).toHaveLength(100)
	for (const kind of ['lp', 'forks', 'reports'] as const) expect(portfolio.data.portfolioPagination[kind]).toMatchObject({ total: 102, hasMore: true })

	const portfolioContinuationUrl = new URL('http://localhost/api/v1/state/address-portfolio')
	portfolioContinuationUrl.search = new URLSearchParams({
		chainId: String(operationsChainId),
		address: address.toLowerCase(),
		lpCursor: portfolio.data.portfolioPagination.lp.nextCursor,
		forkCursor: portfolio.data.portfolioPagination.forks.nextCursor,
		reportCursor: portfolio.data.portfolioPagination.reports.nextCursor,
	}).toString()
	const portfolioContinuationResponse = await handleApi(new Request(portfolioContinuationUrl), database.sql)
	if (portfolioContinuationResponse === undefined) throw new Error('portfolio continuation did not return a response')
	const portfolioContinuation = (await portfolioContinuationResponse.json()) as typeof portfolio
	expect(portfolioContinuation.data.lp_positions).toHaveLength(2)
	expect(portfolioContinuation.data.fork_participation).toHaveLength(2)
	expect(portfolioContinuation.data.report_participation).toHaveLength(2)
	for (const kind of ['lp', 'forks', 'reports'] as const) expect(portfolioContinuation.data.portfolioPagination[kind]).toMatchObject({ total: 102, hasMore: false })
	expect(new Set([...portfolio.data.lp_positions, ...portfolioContinuation.data.lp_positions].map(item => item.market_address)).size).toBe(102)
	expect(portfolioContinuation.data.lp_positions.find(item => item.market_address === selfTransferMarket)).toMatchObject({ balance: '2' })

	const changedPortfolioCursor = decodeOpaqueCursor(portfolio.data.portfolioPagination.lp.nextCursor) as unknown[]
	changedPortfolioCursor[9] = 103
	const changedPortfolioResponse = await handleApi(new Request(`http://localhost/api/v1/state/address-portfolio?chainId=${operationsChainId}&address=${address.toLowerCase()}&lpCursor=${encodeURIComponent(btoa(JSON.stringify(changedPortfolioCursor)))}`), database.sql)
	expect(changedPortfolioResponse?.status).toBe(409)
}

export const expectRiskAndForkCatalogs = async ({ database, operationsChainId }: OperationsContext): Promise<void> => {
	const riskCatalogResponse = await handleApi(new Request(`http://localhost/api/v1/state/risk?chainId=${operationsChainId}&limit=250`), database.sql)
	if (riskCatalogResponse === undefined) throw new Error('risk catalog did not return a response')
	const riskCatalog = (await riskCatalogResponse.json()) as {
		data: {
			pools: unknown[]
			vaults: unknown[]
			pagination: {
				poolTotal: number
				poolHasMore: boolean
				poolNextCursor: string
				vaultTotal: number
				vaultHasMore: boolean
				vaultNextCursor: string
			}
		}
	}
	expect(riskCatalog.data.pools).toHaveLength(250)
	expect(riskCatalog.data.vaults).toHaveLength(250)
	expect(riskCatalog.data.pagination).toMatchObject({
		poolTotal: 261,
		poolHasMore: true,
		vaultTotal: 261,
		vaultHasMore: true,
	})
	const riskContinuationResponse = await handleApi(new Request(`http://localhost/api/v1/state/risk?chainId=${operationsChainId}&limit=250&poolCursor=${encodeURIComponent(riskCatalog.data.pagination.poolNextCursor)}&vaultCursor=${encodeURIComponent(riskCatalog.data.pagination.vaultNextCursor)}`), database.sql)
	if (riskContinuationResponse === undefined) throw new Error('risk catalog continuation did not return a response')
	const riskContinuation = (await riskContinuationResponse.json()) as typeof riskCatalog
	expect(riskContinuation.data.pools).toHaveLength(11)
	expect(riskContinuation.data.vaults).toHaveLength(11)
	expect(riskContinuation.data.pagination).toMatchObject({
		poolTotal: 261,
		poolHasMore: false,
		vaultTotal: 261,
		vaultHasMore: false,
	})

	const forkCatalogResponse = await handleApi(new Request(`http://localhost/api/v1/state/forks?chainId=${operationsChainId}&limit=250`), database.sql)
	if (forkCatalogResponse === undefined) throw new Error('fork catalog did not return a response')
	const forkCatalog = (await forkCatalogResponse.json()) as {
		data: { items: Array<{ universe_identity: string }>; total: number; hasMore: boolean; nextCursor: string }
	}
	expect(forkCatalog.data).toMatchObject({ total: 260, hasMore: true })
	expect(forkCatalog.data.items).toHaveLength(250)
	const forkContinuationResponse = await handleApi(new Request(`http://localhost/api/v1/state/forks?chainId=${operationsChainId}&limit=250&cursor=${encodeURIComponent(forkCatalog.data.nextCursor)}`), database.sql)
	if (forkContinuationResponse === undefined) throw new Error('fork catalog continuation did not return a response')
	const forkContinuation = (await forkContinuationResponse.json()) as typeof forkCatalog
	expect(forkContinuation.data).toMatchObject({ total: 260, hasMore: false })
	expect(forkContinuation.data.items).toHaveLength(10)
	expect(new Set([...forkCatalog.data.items, ...forkContinuation.data.items].map(item => item.universe_identity)).size).toBe(260)
}

// Question history pages through same-block pools and rejects range-mismatched or stale-generation cursors.
export const expectQuestionHistoryCursors = async ({ database, operationsChainId, oracle }: OperationsContext): Promise<void> => {
	const sameBlockPool = `0x${(4000002).toString(16).padStart(40, '0')}`
	await database.sql`
				INSERT INTO pools (
					chain_id, block_hash, tx_hash, log_index, block_number, pool_address, parent_address,
					universe_id, question_id, truth_auction_address, coordinator_address, share_token_address,
					security_multiplier_bps, initial_priority_fee_atto_eth_per_gas,
					initial_retention_rate, initial_settlement_collateral_atto_eth, canonical
				) VALUES (
					${operationsChainId}, ${`0x${(2).toString(16).padStart(64, '0')}`}, ${`0x${(20002).toString(16).padStart(64, '0')}`},
					6, 2, ${sameBlockPool}, ${address.toLowerCase()}, 1, 1, ${address.toLowerCase()},
					${oracle.toLowerCase()}, ${address.toLowerCase()}, 15000, 0, 0, 0, true
				)
			`
	const firstQuestionHistoryResponse = await handleApi(new Request(`http://localhost/api/v1/state/questions/${operationsChainId}/1?fromBlock=2&toBlock=2&limit=1`), database.sql)
	if (firstQuestionHistoryResponse === undefined) throw new Error('question history did not return a response')
	const firstQuestionHistory = (await firstQuestionHistoryResponse.json()) as {
		pools: Array<{ pool_address: string }>
		coverage: { nextCursor: string }
	}
	expect(firstQuestionHistory.pools).toHaveLength(1)
	expect(firstQuestionHistory.coverage.nextCursor).toBeString()
	const secondQuestionHistoryResponse = await handleApi(new Request(`http://localhost/api/v1/state/questions/${operationsChainId}/1?fromBlock=2&toBlock=2&limit=1&cursor=${encodeURIComponent(firstQuestionHistory.coverage.nextCursor)}`), database.sql)
	if (secondQuestionHistoryResponse === undefined) throw new Error('question history continuation did not return a response')
	const secondQuestionHistory = (await secondQuestionHistoryResponse.json()) as { pools: Array<{ pool_address: string }> }
	expect(secondQuestionHistory.pools).toHaveLength(1)
	expect(secondQuestionHistory.pools[0]?.pool_address).not.toBe(firstQuestionHistory.pools[0]?.pool_address)
	const mismatchedQuestionHistoryResponse = await handleApi(new Request(`http://localhost/api/v1/state/questions/${operationsChainId}/1?fromBlock=1&toBlock=2&limit=1&cursor=${encodeURIComponent(firstQuestionHistory.coverage.nextCursor)}`), database.sql)
	expect(mismatchedQuestionHistoryResponse?.status).toBe(400)
	const stateHistoryGeneration = await database.sql`
				INSERT INTO chain_reorganizations
					(chain_id, previous_block, previous_hash, ancestor_block, ancestor_hash, depth, reason)
				VALUES (${operationsChainId}, 10003, ${`0x${(10003).toString(16).padStart(64, '0')}`}, 10003,
					${`0x${(10003).toString(16).padStart(64, '0')}`}, 0, 'projection-rebuild')
				RETURNING id::text
			`
	const staleQuestionHistoryResponse = await handleApi(new Request(`http://localhost/api/v1/state/questions/${operationsChainId}/1?fromBlock=2&toBlock=2&limit=1&cursor=${encodeURIComponent(firstQuestionHistory.coverage.nextCursor)}`), database.sql)
	expect(staleQuestionHistoryResponse?.status).toBe(409)
	await database.sql`DELETE FROM chain_reorganizations WHERE id = ${stateHistoryGeneration[0]?.['id']}`
}

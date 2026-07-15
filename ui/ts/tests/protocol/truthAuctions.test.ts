/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/shared/ethereum'
import { loadTruthAuctionActiveTickPage, loadTruthAuctionBidderBidPage, loadTruthAuctionTickBidPage, loadTruthAuctionTickPage, loadTruthAuctionTickSummary } from '../../protocol/index.js'
import { createMockReadClient } from './testSupport.js'

const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000a1')
const truthAuctionAddress = getAddress('0x00000000000000000000000000000000000000f6')

describe('truthAuctions protocol client', () => {
	test('truth auction page loaders validate page inputs before reading', async () => {
		const client = createMockReadClient(async () => {
			throw new Error('readContract should not be called for invalid pagination')
		})

		await expect(loadTruthAuctionTickPage(client, truthAuctionAddress, -1, 10)).rejects.toThrow('Page index must be a non-negative integer')
		await expect(loadTruthAuctionActiveTickPage(client, truthAuctionAddress, -1, 10)).rejects.toThrow('Page index must be a non-negative integer')
		await expect(loadTruthAuctionTickPage(client, truthAuctionAddress, 0, 0)).rejects.toThrow('Page size must be a positive integer')
		await expect(loadTruthAuctionTickBidPage(client, truthAuctionAddress, 1n, 0, 0)).rejects.toThrow('Page size must be a positive integer')
		await expect(loadTruthAuctionBidderBidPage(client, truthAuctionAddress, securityPoolAddress, -1, 10)).rejects.toThrow('Page index must be a non-negative integer')
	})

	test('truth auction page loaders allow large requested page sizes', async () => {
		const readCalls: Array<{ functionName: string; args: unknown[] | undefined }> = []
		const client = createMockReadClient(async request => {
			readCalls.push({
				functionName: String(request.functionName),
				args: Array.isArray(request.args) ? [...request.args] : undefined,
			})
			if (request.functionName === 'getTickCount') return 1n
			if (request.functionName === 'getTickPage') return []
			throw new Error(`Unexpected readContract function: ${request.functionName}`)
		})

		await expect(loadTruthAuctionTickPage(client, truthAuctionAddress, 0, 500)).resolves.toEqual({
			pageIndex: 0,
			pageSize: 500,
			tickCount: 1n,
			ticks: [],
		})
		expect(readCalls).toEqual([
			{ functionName: 'getTickCount', args: [] },
			{ functionName: 'getTickPage', args: [0n, 500n] },
		])
	})

	test('loadTruthAuctionTickPage maps tuple responses and converts page indexes to offsets', async () => {
		const readCalls: Array<{ functionName: string; args: unknown[] | undefined }> = []
		const client = createMockReadClient(async request => {
			readCalls.push({
				functionName: String(request.functionName),
				args: Array.isArray(request.args) ? [...request.args] : undefined,
			})
			if (request.functionName === 'getTickCount') return 3n
			if (request.functionName === 'getTickPage')
				return [
					{ tick: 1n, price: 2n, currentTotalEth: 3n, submissionCount: 4n, active: true },
					{ tick: 5n, price: 6n, currentTotalEth: 7n, submissionCount: 8n, active: false },
				]
			throw new Error(`Unexpected readContract function: ${request.functionName}`)
		})

		const page = await loadTruthAuctionTickPage(client, truthAuctionAddress, 2, 5)

		expect(readCalls).toEqual([
			{ functionName: 'getTickCount', args: [] },
			{ functionName: 'getTickPage', args: [10n, 5n] },
		])
		expect(page).toEqual({
			pageIndex: 2,
			pageSize: 5,
			tickCount: 3n,
			ticks: [
				{ tick: 1n, price: 2n, currentTotalEth: 3n, submissionCount: 4n, active: true },
				{ tick: 5n, price: 6n, currentTotalEth: 7n, submissionCount: 8n, active: false },
			],
		})
	})

	test('loadTruthAuctionTickSummary maps a direct tick summary read', async () => {
		const client = createMockReadClient(async request => {
			if (request.functionName === 'getTickSummary') return { tick: 9n, price: 10n, currentTotalEth: 11n, submissionCount: 12n, active: false }
			throw new Error(`Unexpected readContract function: ${request.functionName}`)
		})

		await expect(loadTruthAuctionTickSummary(client, truthAuctionAddress, 9n)).resolves.toEqual({
			tick: 9n,
			price: 10n,
			currentTotalEth: 11n,
			submissionCount: 12n,
			active: false,
		})
	})

	test('loadTruthAuctionTickPage rejects malformed tick summary pages instead of trusting ABI shapes', async () => {
		const client = createMockReadClient(async request => {
			if (request.functionName === 'getTickCount') return 1n
			if (request.functionName === 'getTickPage') return [{ tick: 1n, price: 2n, currentTotalEth: 3n, submissionCount: 'bad-count', active: true }]
			throw new Error(`Unexpected readContract function: ${request.functionName}`)
		})

		await expect(loadTruthAuctionTickPage(client, truthAuctionAddress, 0, 10)).rejects.toThrow('Unexpected truth auction tick page submission count response')
	})

	test('loadTruthAuctionActiveTickPage maps active ladder pages and converts page indexes to offsets', async () => {
		const readCalls: Array<{ functionName: string; args: unknown[] | undefined }> = []
		const client = createMockReadClient(async request => {
			readCalls.push({
				functionName: String(request.functionName),
				args: Array.isArray(request.args) ? [...request.args] : undefined,
			})
			if (request.functionName === 'activeTickCount') return 4n
			if (request.functionName === 'getActiveTickPage')
				return [
					{ tick: 12n, price: 7n, currentTotalEth: 6n, submissionCount: 2n, active: true },
					{ tick: 10n, price: 5n, currentTotalEth: 4n, submissionCount: 1n, active: true },
				]
			throw new Error(`Unexpected readContract function: ${request.functionName}`)
		})

		const page = await loadTruthAuctionActiveTickPage(client, truthAuctionAddress, 1, 2)

		expect(readCalls).toEqual([
			{ functionName: 'activeTickCount', args: [] },
			{ functionName: 'getActiveTickPage', args: [2n, 2n] },
		])
		expect(page).toEqual({
			pageIndex: 1,
			pageSize: 2,
			tickCount: 4n,
			ticks: [
				{ tick: 12n, price: 7n, currentTotalEth: 6n, submissionCount: 2n, active: true },
				{ tick: 10n, price: 5n, currentTotalEth: 4n, submissionCount: 1n, active: true },
			],
		})
	})

	test('loadTruthAuctionTickBidPage maps per-tick bid tuples and preserves empty pages', async () => {
		const readCalls: Array<{ functionName: string; args: unknown[] | undefined }> = []
		const client = createMockReadClient(async request => {
			readCalls.push({
				functionName: String(request.functionName),
				args: Array.isArray(request.args) ? [...request.args] : undefined,
			})
			if (request.functionName === 'getBidCountAtTick') return 2n
			if (request.functionName === 'getBidPageAtTick') return []
			throw new Error(`Unexpected readContract function: ${request.functionName}`)
		})

		const page = await loadTruthAuctionTickBidPage(client, truthAuctionAddress, 11n, 1, 10)

		expect(readCalls).toEqual([
			{ functionName: 'getBidCountAtTick', args: [11n] },
			{ functionName: 'getBidPageAtTick', args: [11n, 10n, 10n] },
		])
		expect(page).toEqual({
			tick: 11n,
			pageIndex: 1,
			pageSize: 10,
			bidCount: 2n,
			bids: [],
		})
	})

	test('loadTruthAuctionTickBidPage rejects malformed per-tick bid pages instead of trusting ABI shapes', async () => {
		const client = createMockReadClient(async request => {
			if (request.functionName === 'getBidCountAtTick') return 1n
			if (request.functionName === 'getBidPageAtTick') return [{ tick: 11n, bidIndex: 0n, bidder: securityPoolAddress, ethAmount: 3n, cumulativeEth: 3n, activeCumulativeEthBeforeBid: 0n, claimed: false, refunded: 'bad-refund-flag' }]
			throw new Error(`Unexpected readContract function: ${request.functionName}`)
		})

		await expect(loadTruthAuctionTickBidPage(client, truthAuctionAddress, 11n, 0, 10)).rejects.toThrow('Unexpected truth auction tick bid page refunded flag response')
	})

	test('loadTruthAuctionBidderBidPage rejects malformed bid pages instead of trusting ABI shapes', async () => {
		const client = createMockReadClient(async request => {
			if (request.functionName === 'getBidderBidCount') return 1n
			if (request.functionName === 'getBidderBidPage') return [{ tick: 10n, bidIndex: 0n, bidder: 'not-an-address', ethAmount: 3n, cumulativeEth: 3n, activeCumulativeEthBeforeBid: 0n, claimed: false, refunded: false }]
			throw new Error(`Unexpected readContract function: ${request.functionName}`)
		})

		await expect(loadTruthAuctionBidderBidPage(client, truthAuctionAddress, securityPoolAddress, 0, 10)).rejects.toThrow('Unexpected truth auction bidder bid page bidder response')
	})

	test('loadTruthAuctionBidderBidPage maps bidder bid tuples and converts bidder pages to offsets', async () => {
		const readCalls: Array<{ functionName: string; args: unknown[] | undefined }> = []
		const bidder = getAddress('0x00000000000000000000000000000000000000a7')
		const client = createMockReadClient(async request => {
			readCalls.push({
				functionName: String(request.functionName),
				args: Array.isArray(request.args) ? [...request.args] : undefined,
			})
			if (request.functionName === 'getBidderBidCount') return 4n
			if (request.functionName === 'getBidderBidPage')
				return [
					{ tick: 10n, bidIndex: 0n, bidder, ethAmount: 3n, cumulativeEth: 3n, activeCumulativeEthBeforeBid: 0n, claimed: false, refunded: false },
					{ tick: 11n, bidIndex: 1n, bidder, ethAmount: 5n, cumulativeEth: 8n, activeCumulativeEthBeforeBid: 3n, claimed: true, refunded: true },
				]
			throw new Error(`Unexpected readContract function: ${request.functionName}`)
		})

		const page = await loadTruthAuctionBidderBidPage(client, truthAuctionAddress, bidder, 1, 2)

		expect(readCalls).toEqual([
			{ functionName: 'getBidderBidCount', args: [bidder] },
			{ functionName: 'getBidderBidPage', args: [bidder, 2n, 2n] },
		])
		expect(page).toEqual({
			bidder,
			pageIndex: 1,
			pageSize: 2,
			bidCount: 4n,
			bids: [
				{ tick: 10n, bidIndex: 0n, bidder, ethAmount: 3n, cumulativeEth: 3n, activeCumulativeEthBeforeBid: 0n, claimed: false, refunded: false },
				{ tick: 11n, bidIndex: 1n, bidder, ethAmount: 5n, cumulativeEth: 8n, activeCumulativeEthBeforeBid: 3n, claimed: true, refunded: true },
			],
		})
	})
})

import { expect, test } from 'bun:test'
import { reportIndexPage } from '#monitoring/report-index'

test('cold discovery eventually visits all historical reports while new bursts arrive', () => {
	let next = 1001n
	let page = reportIndexPage(next)
	const seen = new Set(page.ids)
	for (let poll = 0; poll < 20; poll++) {
		if (poll === 1) next += 500n
		page = reportIndexPage(next, page.cursor)
		expect(page.ids.length).toBeLessThanOrEqual(384)
		for (const id of page.ids) seen.add(id)
	}
	expect([...seen].sort((a, b) => (a < b ? -1 : 1))).toEqual(Array.from({ length: 1500 }, (_, i) => BigInt(i + 1)))
	expect(page.cursor).toEqual({ historicalEnd: 1n, nextNewId: next })
})

test('counter rollback restarts historical discovery and empty oracle has no reports', () => {
	expect(reportIndexPage(1n).ids).toEqual([])
	const previous = reportIndexPage(1001n).cursor
	expect(reportIndexPage(3n, previous).ids).toEqual([1n, 2n])
	expect(() => reportIndexPage(0n)).toThrow('Invalid OpenOracle report counter')
})

import { discoverStoredReports } from '#monitoring/report-index'
import { networkConfiguration } from '#config/network'
import { parseOperatorSettings } from '#config/settings-store'
import { openOracleAbi } from '#contracts/abi'
import { createPublicClient, decodeFunctionData, encodeAbiParameters, getAddress, zeroAddress, type Hex } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { multicallProvider } from '../helpers/multicall-provider.ts'
import example from '../../config/operator.example.json'

test('stored discovery includes every active creator, filters settled and unstored reports, and checks the block', async () => {
	const network = networkConfiguration('mainnet')
	const settings = parseOperatorSettings(example)
	const hash: Hex = `0x${'ab'.repeat(32)}`
	const creator = getAddress('0x0000000000000000000000000000000000000011')
	let replaced = false
	const provider = multicallProvider(
		network.multicall3,
		({ data, blockTag }) => {
			expect(blockTag).toBe('0xa')
			const call = decodeFunctionData({ abi: openOracleAbi, data })
			if (call.functionName === 'nextReportId') return encodeAbiParameters([{ type: 'uint256' }], [5n])
			const fn = openOracleAbi.find(item => item.type === 'function' && item.name === call.functionName)
			if (fn === undefined || fn.type !== 'function' || call.args === undefined) throw new Error('Unexpected indexed report read')
			const id = call.args[0]
			const values = fn.outputs.map((output, index) => {
				if (output.type === 'address') return id === 4n ? zeroAddress : creator
				return call.functionName === 'storedGame' && index === 4 && id === 3n ? 50n : 0n
			})
			return encodeAbiParameters(fn.outputs, values)
		},
		({ method }) => {
			if (method === 'eth_getBlockByNumber') return { number: '0xa', hash: replaced ? `0x${'cd'.repeat(32)}` : hash, timestamp: '0x64', transactions: [] }
			throw new Error(`Unexpected RPC ${method}`)
		},
	)
	const client = createPublicClient({ chain: network.chain, transport: custom(provider) })
	const config = { network, openOracle: settings.deployment.openOracle, execute: false, connectivity: settings.connectivity, quorumRpcUrls: [], rpcQuorum: 1 as const }
	const discovered = await discoverStoredReports([client], config, 10n, hash)
	expect(discovered.reports).toEqual([
		{ reportId: 1n, creator },
		{ reportId: 2n, creator },
	])
	const retained = await discoverStoredReports([client], config, 10n, hash, discovered.cursor, [3n])
	expect(retained.reports.map(report => report.reportId)).toContain(3n)
	replaced = true
	await expect(discoverStoredReports([client], config, 10n, hash)).rejects.toThrow('canonical head')
})

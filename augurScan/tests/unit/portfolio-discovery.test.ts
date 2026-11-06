import { expect, test } from 'bun:test'
import { discoverPortfolioEventDependencies } from '../../src/indexer/portfolio-discovery.ts'
import { encodeFunctionData, getAddress, zeroAddress, type Address } from '../../src/ethereum.ts'
import type { StateRead } from '../../src/snapshots.ts'

const factory = getAddress('0x1111111111111111111111111111111111111111')
const pool = getAddress('0x2222222222222222222222222222222222222222')
const portfolio = getAddress('0x3333333333333333333333333333333333333333')
const controller = getAddress('0x4444444444444444444444444444444444444444')
const emitter = { address: factory, kind: 'securityPoolFactory', label: 'Question factory', provenance: 'test' }
const event = { name: 'DeploySecurityPool', status: 'decoded' as const, arguments: { securityPool: pool }, summary: 'Question created' }
const reader =
	(overrides: Readonly<Record<string, unknown>> = {}): StateRead =>
	async (address, abi, name, args = []) => {
		encodeFunctionData({ abi, functionName: name, args })
		const values: Readonly<Record<string, unknown>> = { getSecurityPoolPortfolio: portfolio, factory, forkController: controller, portfolio, ...overrides }
		if (name === 'getSecurityPoolPortfolio') {
			expect(address).toBe(factory)
			expect(args).toEqual([pool])
		} else expect(address).toBe(name === 'portfolio' ? controller : portfolio)
		if (!(name in values)) throw new Error(`Unexpected discovery read ${name}`)
		return values[name]
	}

test('question factory deployment discovers authenticated portfolio and shared fork controller', async () => {
	expect(await discoverPortfolioEventDependencies(emitter, event, reader())).toEqual([
		{ address: portfolio, kind: 'securityPoolPortfolio', label: 'Security Portfolio' },
		{ address: controller, kind: 'securityPoolPortfolioForkCoordinator', label: 'Portfolio Fork Coordinator' },
	])
})

for (const [name, value, error] of [
	['getSecurityPoolPortfolio', zeroAddress, 'portfolio binding'],
	['factory', pool, 'factory binding'],
	['forkController', zeroAddress, 'controller binding'],
	['portfolio', pool, 'controller binding'],
] as const) {
	test(`rejects an unauthenticated ${name} custody edge`, async () => {
		await expect(discoverPortfolioEventDependencies(emitter, event, reader({ [name]: value }))).rejects.toThrow(error)
	})
}

test('non-auction branches stop after the bounded auction address lookup', async () => {
	let reads = 0
	const result = await discoverPortfolioEventDependencies({ ...emitter, address: controller, kind: 'securityPoolPortfolioForkCoordinator' }, { ...event, name: 'BranchStarted', arguments: { universeId: '2' } }, async (address, abi, name, args = []) => {
		encodeFunctionData({ abi, functionName: name, args })
		expect(address).toBe(controller)
		expect(name).toBe('auctions')
		expect(args).toEqual([2n])
		reads++
		return zeroAddress
	})
	expect(result).toEqual([])
	expect(reads).toBe(1)
})

test('untrusted emitters and failed decodes cannot trigger dependency reads', async () => {
	const unexpected: StateRead = async () => {
		throw new Error('Unexpected read')
	}
	expect(await discoverPortfolioEventDependencies({ ...emitter, kind: 'shareToken' }, event, unexpected)).toEqual([])
	expect(await discoverPortfolioEventDependencies(emitter, { ...event, status: 'failed' }, unexpected)).toEqual([])
})

for (const [name, value, error] of [
	['forkAuthority', pool, 'authority mismatch'],
	['engine', zeroAddress, 'engine binding mismatch'],
	['controller', pool, 'engine binding mismatch'],
] as const) {
	test(`rejects an unauthenticated auction ${name} edge`, async () => {
		const auction = getAddress('0x5555555555555555555555555555555555555555')
		const engine = getAddress('0x6666666666666666666666666666666666666666')
		const values: Readonly<Record<string, unknown>> = { auctions: auction, forkAuthority: controller, engine, controller: auction, [name]: value }
		const read: StateRead = async (address, abi, functionName, args = []) => {
			encodeFunctionData({ abi, functionName, args })
			const targets: Readonly<Record<string, Address>> = { auctions: controller, forkAuthority: auction, engine: auction, controller: engine }
			const target = targets[functionName]
			if (target === undefined) throw new Error(`Unexpected discovery target ${functionName}`)
			expect(address).toBe(target)
			if (!(functionName in values)) throw new Error(`Unexpected discovery read ${functionName}`)
			return values[functionName]
		}
		await expect(discoverPortfolioEventDependencies({ ...emitter, address: controller, kind: 'securityPoolPortfolioForkCoordinator' }, { ...event, name: 'BranchStarted', arguments: { universeId: '2' } }, read)).rejects.toThrow(error)
	})
}

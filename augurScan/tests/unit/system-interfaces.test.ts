import { expect, test } from 'bun:test'
import { abiForKind } from '../../src/abi-catalog.ts'
import { concatHex, encodeFunctionData, getAddress, type Hex, isHex, parseAbi, toEventSelector, toHex, zeroHash } from '../../src/ethereum.ts'
import { decodeAction, decodeLogRecord, discoveriesFrom } from '../../src/metadata.ts'
import { supportedWrappers, systemInterfaces } from '../../src/system-interfaces.ts'
import transaction from './delegation-transaction.json'
import eventFixtures from './system-interface-fixtures.json'
import dependencyAbis from '../../config/dependency-abis.json'

const hex = (value: string): Hex => {
	if (!isHex(value)) throw new Error('Invalid hex fixture')
	return `0x${value.slice(2)}`
}

test('every supported system interface workflow has decoding fixtures', () => {
	const fixtureKinds = new Set([...eventFixtures.map(fixture => fixture.kind), 'delegationManager'])
	const declaredKinds = new Set(Object.entries(systemInterfaces).flatMap(([kind, definition]) => (definition.type === 'interface' ? [kind] : [])))
	expect(fixtureKinds).toEqual(declaredKinds)
	expect(new Set(Object.keys(dependencyAbis))).toEqual(declaredKinds)
	const declaredMembers = Object.entries(systemInterfaces).flatMap(([kind, definition]) => (definition.type === 'interface' ? definition.members.map(name => `${kind}.${name}`) : []))
	expect(new Set([...eventFixtures.map(fixture => `${fixture.kind}.${fixture.name}`), 'delegationManager.redeemDelegations'])).toEqual(new Set(declaredMembers))
})

for (const fixture of eventFixtures) {
	test(`decodes fixed ${fixture.kind}.${fixture.name} topics and data`, () => {
		const decoded = decodeLogRecord(fixture.kind, fixture.topics.map(hex), hex(fixture.data), new Map())
		expect(decoded.status).toBe('decoded')
		expect(decoded.name).toBe(fixture.name)
		expect(decoded.arguments).toEqual(fixture.expected)
		// The declared interface itself must contain this event; the catalog's
		// global event fallback must not conceal a missing routed ABI member.
		expect(abiForKind(fixture.kind)?.some(item => item.type === 'event' && toEventSelector(item) === fixture.topics[0])).toBe(true)
		if (fixture.kind === 'uniswapV2Factory') {
			// Its fourth input is unnamed upstream. Named inputs must survive
			// positional decoding so REP quote-pair discovery still works.
			const token0 = getAddress('0x1111111111111111111111111111111111111111')
			const token1 = getAddress('0x2222222222222222222222222222222222222222')
			const pair = getAddress('0x3333333333333333333333333333333333333333')
			const contracts = new Map([
				[token0, { address: token0, kind: 'reputationToken', label: 'REP', provenance: 'test' }],
				[token1, { address: token1, kind: 'usdc', label: 'USDC', provenance: 'test' }],
			])
			expect(decoded.referencedAddresses).toEqual([token0, token1, pair])
			expect(discoveriesFrom(decoded, contracts)).toEqual([{ address: pair, kind: 'uniswapV2Pair', label: 'Uniswap V2 REP / USDC Pair' }])
		}
	})
}

test('each registered wrapper format is exercised by its actual decoder', () => {
	const fixtures = {
		proxyDeployer: () => {
			const contract = { address: getAddress('0x1111111111111111111111111111111111111111'), kind: 'proxyDeployer', label: 'Proxy', provenance: 'test' }
			expect(decodeAction(contract, '0x60006000f3', new Map())).toMatchObject({ name: 'deploy', status: 'decoded' })
		},
		delegationManager: () => {
			expect(decodeAction(undefined, hex(transaction.input), new Map())).toMatchObject({ name: 'redeemDelegations', status: 'decoded' })
			const modes = { single: zeroHash, singleAllowFailure: hex(`0x0001${'00'.repeat(30)}`) }
			expect(Object.keys(modes).sort()).toEqual(Object.keys(supportedWrappers.delegationManager.modes).sort())
			for (const [name, mode] of Object.entries(modes)) {
				const input = encodeFunctionData({ abi: parseAbi(['function redeemDelegations(bytes[] _permissionContexts,bytes32[] _modes,bytes[] _executionCallDatas)']), functionName: 'redeemDelegations', args: [['0x'], [mode], [concatHex([hex(transaction.target), toHex(1n, { size: 32 })])]] })
				const decoded = decodeAction(undefined, input, new Map())
				expect(decoded.summary).toContain('Native transfer')
				expect(decoded.summary.includes('allow failure')).toBe(name === 'singleAllowFailure')
			}
		},
	} satisfies Record<keyof typeof supportedWrappers, () => void>
	for (const fixture of Object.values(fixtures)) fixture()
})

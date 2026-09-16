import { expect, test } from 'bun:test'
import dependencyAbis from '../../config/dependency-abis.json'
import catalog from '../../config/abis.json'
import { generatedSystemInterfaces } from '../../config/system-contracts.generated.ts'
import { verifyDependencyAbis } from '../../scripts/dependency-abis.ts'
import { serializeSystemContracts, systemContractMappings } from '../../scripts/project-system-contracts.ts'
import { abiForKind } from '../../src/abi-catalog.ts'
import { encodeFunctionData, getAddress, parseAbi } from '../../src/ethereum.ts'
import { decodeAction } from '../../src/metadata.ts'

test('generates routes for new compiled contracts and deployment IDs without a registry edit', () => {
	const mappings = systemContractMappings(['FutureFactory', 'WETH9', 'UniformPriceDualCapBatchAuctionFactory'], ['futureFactory', 'weth', 'uniformPriceDualCapBatchAuctionFactory', 'proxyDeployer'])
	expect(mappings.interfaces['futureFactory']).toEqual({ type: 'artifact', name: 'FutureFactory' })
	expect(mappings.deploymentKinds).toEqual({ futureFactory: 'futureFactory', proxyDeployer: 'proxyDeployer', uniformPriceDualCapBatchAuctionFactory: 'truthAuctionFactory', weth: 'weth' })
})

test('every compiled ABI has a generated route and generation is deterministic', () => {
	const generatedNames: string[] = Object.values(generatedSystemInterfaces).map(({ name }) => name)
	expect(generatedNames.sort()).toEqual(Object.keys(catalog.contracts).sort())
	const names = ['WETH9', 'FutureFactory']
	const ids = ['weth', 'futureFactory']
	expect(serializeSystemContracts(systemContractMappings(names, ids))).toBe(serializeSystemContracts(systemContractMappings(names.toReversed(), ids.toReversed())))
})

test('rejects missing or ambiguous deployment ABI matches', () => {
	expect(() => systemContractMappings(['KnownFactory'], ['futureFactory'])).toThrow('futureFactory')
	expect(() => systemContractMappings(['Thing', 'thing'], ['thing'])).toThrow('kind')
	expect(() => systemContractMappings(['THING', 'Thing'], ['thing'])).toThrow('Ambiguous')
	expect(() => systemContractMappings(['DelegationManager'], [])).toThrow('conflicts')
})

test('verifies dependency ABI pins and rejects edited or missing artifacts', () => {
	expect(() => verifyDependencyAbis(dependencyAbis)).not.toThrow()
	expect(() => verifyDependencyAbis({ ...dependencyAbis, delegationManager: [] })).toThrow('delegationManager')
	expect(() => verifyDependencyAbis({})).toThrow('kinds')
})

test('routes the complete pinned dependency ABIs rather than selected signatures', () => {
	for (const [kind, abi] of Object.entries(dependencyAbis)) expect(abiForKind(kind)).toEqual(abi)
})

test('decodes another delegation manager method from the upstream ABI', () => {
	const address = getAddress('0x1111111111111111111111111111111111111111')
	const input = encodeFunctionData({ abi: parseAbi(['function transferOwnership(address newOwner)']), functionName: 'transferOwnership', args: [address] })
	expect(decodeAction({ address, kind: 'delegationManager', label: 'Delegation Manager', provenance: 'test' }, input, new Map())).toMatchObject({ status: 'decoded', name: 'transferOwnership', arguments: { newOwner: address } })
})

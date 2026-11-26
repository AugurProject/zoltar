import { encodeFunctionData, decodeFunctionResult, keccak256, parseAbi, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { isObjectRecord } from '@zoltar/core-shared/validation/guards'
import { statoblast_factories_SecurityPoolFactory_SecurityPoolFactory, statoblast_SecurityPool_SecurityPool } from '../../types/contractArtifact'
import { verifyRuntimeIdentity } from '../../../../bots/shared/src/monitoring/runtime-identity'
import { requireAddress } from './manifest'

const abi = parseAbi(['function zoltar() view returns (address)', 'function securityPoolCreationCodeHash() view returns (bytes32)'])

/** Authenticate compiler runtime and the factory's protocol generation before deploying Trading. */
export async function requireCoreFactoryRuntime(manifest: unknown, code: unknown, factory: string, rpc: (method: string, params: readonly unknown[]) => Promise<unknown>) {
	if (typeof code !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code)) throw new Error('SecurityPoolFactory runtime is missing')
	const runtime = statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.evm.deployedBytecode
	const references: Record<string, { start: number; length: number }[]> = {}
	if (!isObjectRecord(runtime.immutableReferences)) throw new Error('Factory compiler immutable references are missing')
	for (const [id, entries] of Object.entries(runtime.immutableReferences)) {
		if (!Array.isArray(entries)) throw new Error('Invalid factory immutable references')
		references[id] = entries.map(entry => {
			if (!isObjectRecord(entry) || typeof entry['start'] !== 'number' || typeof entry['length'] !== 'number') throw new Error('Invalid factory immutable reference')
			return { start: entry['start'], length: entry['length'] }
		})
	}
	verifyRuntimeIdentity(code as Hex, { runtimeCodeHash: keccak256(`0x${runtime.object}`), runtimeCodeLength: runtime.object.length / 2, immutableReferences: references }, 'SecurityPoolFactory')
	if (!isObjectRecord(manifest)) throw new Error('Core manifest is missing')
	const steps = manifest['deploymentSteps']
	const step = Array.isArray(steps) ? steps.find(item => isObjectRecord(item) && item['id'] === 'zoltar') : undefined
	const contracts = manifest['contracts']
	const contract = isObjectRecord(contracts) ? (contracts['Zoltar'] ?? contracts['zoltar']) : undefined
	let protocolAddress = isObjectRecord(contract) ? contract['address'] : (contract ?? manifest['zoltar'])
	if (isObjectRecord(step)) protocolAddress = step['address']
	const protocol = requireAddress(protocolAddress, 'Core manifest Zoltar')
	for (const functionName of ['zoltar', 'securityPoolCreationCodeHash'] as const) {
		const value = await rpc('eth_call', [{ to: factory, data: encodeFunctionData({ abi, functionName }) }, 'latest'])
		if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) throw new Error('Invalid factory generation response')
		const actual = decodeFunctionResult({ abi, functionName, data: value as Hex })
		const expected = functionName === 'zoltar' ? protocol : keccak256(`0x${statoblast_SecurityPool_SecurityPool.evm.bytecode.object}`)
		if (typeof actual !== 'string' || actual.toLowerCase() !== expected.toLowerCase()) throw new Error('SecurityPoolFactory belongs to another protocol generation')
	}
}

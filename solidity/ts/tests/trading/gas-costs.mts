import { promises as fs } from 'node:fs'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dir, '../../..')
const artifact = JSON.parse(await fs.readFile(path.join(projectRoot, 'artifacts/Contracts.json'), 'utf8')) as { contracts: Record<string, Record<string, { evm: { bytecode: { object: string }; deployedBytecode: { object: string } } }>> }
console.log('Trading contract bytecode sizes (bytes)')
for (const contracts of Object.values(artifact.contracts)) {
	for (const [name, contract] of Object.entries(contracts)) {
		if (!['TwoWayConstantProductFactory', 'TwoWayConstantProductPair', 'TwoWayConstantProductRouter'].includes(name)) continue
		console.log(`${name}: deploy=${contract.evm.bytecode.object.length / 2}, runtime=${contract.evm.deployedBytecode.object.length / 2}`)
	}
}
console.log('Operation gas is reported above by the funded isolated-Anvil benchmark fixture.')

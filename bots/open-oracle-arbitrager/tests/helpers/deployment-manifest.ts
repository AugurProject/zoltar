import { keccak256, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import { parseDeploymentManifest, type DeploymentManifest, type DeploymentRole } from '#config/deployment-auth'

// Test-only bytecode fixtures; production identities are never learned from RPC.
export async function createDeploymentManifest(network: DeploymentManifest['network'], chainId: number, contracts: readonly { address: Address; role: DeploymentRole }[], readCode: (address: Address) => Promise<Hex | undefined>): Promise<DeploymentManifest> {
	if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('Deployment manifest chainId must be a positive integer')
	if (contracts.length === 0) throw new Error('Deployment manifest must contain contracts')
	const entries = await Promise.all(
		contracts.map(async contract => {
			const code = await readCode(contract.address)
			if (code === undefined || code === '0x') throw new Error(`Cannot generate manifest: ${contract.role} ${contract.address} has no runtime bytecode`)
			return { ...contract, runtimeCodeHash: keccak256(code) }
		}),
	)
	return parseDeploymentManifest({ chainId, contracts: entries, network, version: 1 })
}

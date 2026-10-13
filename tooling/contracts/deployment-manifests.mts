import type { GenesisOutcome } from '../../shared/zoltar/ts/deployment/genesisUniverses.ts'

export const deploymentManifestIds = ['mainnet', 'mainnet-no', 'sepolia', 'sepolia-no'] as const
type DeploymentManifestId = (typeof deploymentManifestIds)[number]

export function getDeploymentManifestId(networkId: 'mainnet' | 'sepolia', genesisOutcome: GenesisOutcome): DeploymentManifestId {
	return genesisOutcome === 'no' ? `${networkId}-no` : networkId
}

export function getDeploymentManifestFileName(manifestId: DeploymentManifestId) {
	return `${manifestId}-deployment-addresses.json`
}

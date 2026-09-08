import { getAddress } from '../ethereum.ts'

type DeploymentManifest = {
	deploymentSteps: readonly { id: string; address: string }[]
	derivedContracts: readonly { id: string; address: string }[]
	network: { wethAddress: string }
}

export function canonicalCoreDeployment(manifest: DeploymentManifest) {
	const address = (id: string) => {
		const step = [...manifest.deploymentSteps, ...manifest.derivedContracts].find(step => step.id === id)
		if (step === undefined) throw new Error(`Canonical CREATE2 manifest is missing ${id}`)
		return getAddress(step.address)
	}
	return {
		zoltar: address('zoltar'),
		questionData: address('zoltarQuestionData'),
		openOracle: address('openOracle'),
		securityPoolFactory: address('securityPoolFactory'),
		securityPoolForker: address('securityPoolForker'),
		weth: getAddress(manifest.network.wethAddress),
	}
}

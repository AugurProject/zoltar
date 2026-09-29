import type { DeploymentConfiguration } from '../../protocol/config.js'

/** A local-chain Trading deployment; tests override only the chain fields or addresses they depend on. */
export function deploymentConfigurationFixture(overrides: Partial<DeploymentConfiguration> = {}): DeploymentConfiguration {
	return {
		chainId: 31_337,
		chainName: 'Local',
		rpcUrl: 'http://127.0.0.1:8545',
		securityPoolFactory: `0x${'77'.repeat(20)}`,
		zoltar: `0x${'5a'.repeat(20)}`,
		factory: `0x${'55'.repeat(20)}`,
		router: `0x${'66'.repeat(20)}`,
		feeBps: 30,
		...overrides,
	}
}

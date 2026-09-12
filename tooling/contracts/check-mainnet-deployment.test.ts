import { describe, expect, test } from 'bun:test'
import { assertDeploymentManifestCurrent, deploymentRuntimeTypeScriptProjects, ensureDeploymentRuntimeDependencies, readDeploymentSteps } from './check-mainnet-deployment.mts'

describe('deployment manifest freshness', () => {
	test('builds shared libraries in dependency order without compiling an application leaf', () => {
		expect(deploymentRuntimeTypeScriptProjects).toEqual(['ui/coreShared/tsconfig.json', 'ui/zoltarShared/tsconfig.json', 'ui/statoblastShared/tsconfig.json'])
	})

	test('builds missing UI runtime dependencies before loading deployment sources', async () => {
		let checks = 0
		let builds = 0
		await ensureDeploymentRuntimeDependencies(
			async () => {
				checks += 1
				return checks > 1
			},
			async () => {
				builds += 1
			},
		)
		expect(builds).toBe(1)
	})

	test('does not rebuild available UI runtime dependencies', async () => {
		let builds = 0
		await ensureDeploymentRuntimeDependencies(
			async () => true,
			async () => {
				builds += 1
			},
		)
		expect(builds).toBe(0)
	})

	test('records constructor arguments per step and skips only the raw proxy deployer', () => {
		const steps = [
			{ address: '0x1', id: 'proxyDeployer', label: 'Proxy Deployer' },
			{ address: '0x2', id: 'zoltar', label: 'Zoltar' },
		]
		expect(readDeploymentSteps(steps, new Map([['zoltar', 'abcd']]))).toEqual([
			{ address: '0x1', id: 'proxyDeployer', label: 'Proxy Deployer' },
			{ address: '0x2', constructorArguments: 'abcd', id: 'zoltar', label: 'Zoltar' },
		])
	})

	test('fails manifest generation when a new step has no computed constructor arguments', () => {
		const steps = [{ address: '0x3', id: 'newProtocolModule', label: 'New Protocol Module' }]
		expect(() => readDeploymentSteps(steps, new Map())).toThrow('Extend getDeploymentStepConstructorArguments')
	})

	test('accepts a manifest that matches current deterministic deployment output', () => {
		expect(() => assertDeploymentManifestCurrent('sepolia', 'current manifest\n', 'current manifest\n')).not.toThrow()
	})

	test('rejects a stale manifest instead of only warning', () => {
		expect(() => assertDeploymentManifestCurrent('sepolia', 'tracked manifest\n', 'current manifest\n')).toThrow('Sepolia deployment manifest is stale. Run bun ./tooling/contracts/check-mainnet-deployment.mts --write after confirming the new values.')
	})
})

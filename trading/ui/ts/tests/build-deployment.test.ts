import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import { resolveDeploymentSource } from '../../build/deployment.mts'

describe('trading UI build deployment', () => {
	test('uses browser wallet setup when the deployment environment variable is empty', () => {
		expect(resolveDeploymentSource(undefined)).toBeUndefined()
		expect(resolveDeploymentSource('')).toBeUndefined()
		expect(resolveDeploymentSource('  ')).toBeUndefined()
	})

	test('resolves a configured deployment path', () => {
		expect(resolveDeploymentSource('deployments/local.json')).toBe(path.resolve('deployments/local.json'))
	})
})

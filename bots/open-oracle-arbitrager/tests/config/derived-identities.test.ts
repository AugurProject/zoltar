import { expect, test } from 'bun:test'
import { validateDeploymentSettings } from '#config/deployment-settings'
import { executorDeploymentPlan } from '#execution/executor-deployment-primitives'
import { parseOperatorSettings, serializeOperatorSettings } from '#config/settings-store'
import example from '../../config/operator.example.json'

const salt = `0x${'00'.repeat(32)}`

test('derives the executor and ignores manually supplied executor and coordinator addresses', () => {
	const settings = validateDeploymentSettings({ ...example.deployment, executor: '0x0000000000000000000000000000000000000001', coordinatorAddresses: ['0x0000000000000000000000000000000000000002'] })
	expect(settings.executor).toBe(executorDeploymentPlan(salt).address)
	expect(settings.coordinatorAddresses).toEqual([])
	const stored = serializeOperatorSettings(parseOperatorSettings({ ...example, deployment: settings }))
	expect(stored.deployment).not.toHaveProperty('executor')
	expect(stored.deployment).not.toHaveProperty('coordinatorAddresses')
})

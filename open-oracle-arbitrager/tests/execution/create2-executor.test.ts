import { expect, test } from 'bun:test'
import { deterministicDeploymentProxy, executorDeploymentPlan } from '#execution/create2-executor'
import type { Hex } from '#ethereum'

test('derives a stable executor address and canonical proxy calldata from a bytes32 salt', () => {
	const salt = `0x${'00'.repeat(32)}` as Hex
	const plan = executorDeploymentPlan(salt)
	expect(deterministicDeploymentProxy).toBe('0x4e59b44847b379578588920cA78FbF26c0B4956C')
	expect(plan.address).toBe('0xAe773F5F20A0cE58c313eeEe2C5e17F0e6c4A5ae')
	expect(plan.salt).toBe(salt)
	expect(plan.calldata).toBe(`${salt}${plan.bytecode.slice(2)}` as Hex)
})

test('rejects salts that cannot make CREATE2 deployment deterministic', () => {
	expect(() => executorDeploymentPlan('hello')).toThrow('32-byte')
	expect(() => executorDeploymentPlan(`0x${'00'.repeat(31)}`)).toThrow('32-byte')
})

import { expect, test } from 'bun:test'
import { createSignerOperationGate } from '#execution/signer-operation-gate'
import { runConfigurationSignerOperation } from '../../src/runtime/operator-control-plane.ts'

test('serializes dashboard deployment with scan and lifecycle signer work', () => {
	const gate = createSignerOperationGate()
	expect(gate.acquire('scan')).toBe(true)
	expect(gate.acquire('deployment')).toBe(false)
	gate.release('scan')
	expect(gate.acquire('deployment')).toBe(true)
	expect(gate.acquire('scan')).toBe(false)
	gate.release('deployment')
	expect(gate.acquire('scan')).toBe(true)
})

test('rejects releasing a signer operation that does not own the gate', () => {
	const gate = createSignerOperationGate()
	expect(() => gate.release('deployment')).toThrow('owned by none')
})

test('serializes configuration persistence with an active scan', () => {
	const gate = createSignerOperationGate()
	expect(gate.acquire('scan')).toBe(true)
	expect(gate.acquire('configuration')).toBe(false)
	gate.release('scan')
	expect(gate.acquire('configuration')).toBe(true)
	expect(gate.acquire('scan')).toBe(false)
	gate.release('configuration')
})

test('does not begin profile persistence until an active scan releases the signer-operation gate', async () => {
	const gate = createSignerOperationGate()
	expect(gate.acquire('scan')).toBe(true)
	let profilePersisted = false
	const persistence = runConfigurationSignerOperation(gate, async () => {
		profilePersisted = true
	})
	await Bun.sleep(25)
	expect(profilePersisted).toBe(false)
	gate.release('scan')
	await persistence
	expect(profilePersisted).toBe(true)
	expect(gate.acquire('scan')).toBe(true)
})

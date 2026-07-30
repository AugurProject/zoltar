import { expect, test } from 'bun:test'
import { createSignerOperationGate } from '#execution/signer-operation-gate'

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

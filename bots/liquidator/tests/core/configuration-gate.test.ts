import { describe, expect, test } from 'bun:test'
import { createConfigurationMutationGate } from '../../src/core/configuration-gate.ts'

describe('configuration mutation gate', () => {
	test('serializes configuration updates against active scans and other mutations', async () => {
		let scanning = true
		const gate = createConfigurationMutationGate(() => scanning)
		await expect(gate.run(async () => 'changed')).rejects.toThrow('Wait for the active scan')

		scanning = false
		let release: (() => void) | undefined
		const active = gate.run(
			async () =>
				await new Promise<string>(resolve => {
					release = () => resolve('saved')
				}),
		)
		expect(gate.isActive()).toBe(true)
		await expect(gate.run(async () => 'overlap')).rejects.toThrow('Wait for the active scan')
		if (release === undefined) throw new Error('Configuration mutation did not start')
		release()
		expect(await active).toBe('saved')
		expect(gate.isActive()).toBe(false)
	})
})

import { describe, expect, test } from 'bun:test'
import { createConfigurationMutationGate } from '../../src/core/configuration-gate.ts'

describe('configuration mutation gate', () => {
	test('serializes configuration updates against active scans and other mutations', async () => {
		let scanning = true
		const gate = createConfigurationMutationGate(() => scanning)
		const afterScan = gate.run(async () => 'changed')
		await Bun.sleep(20)
		expect(gate.isActive()).toBe(false)
		scanning = false
		expect(await afterScan).toBe('changed')
		let release: (() => void) | undefined
		const active = gate.run(
			async () =>
				await new Promise<string>(resolve => {
					release = () => resolve('saved')
				}),
		)
		await Bun.sleep(0)
		expect(gate.isActive()).toBe(true)
		const overlap = gate.run(async () => 'overlap')
		if (release === undefined) throw new Error('Configuration mutation did not start')
		release()
		expect(await active).toBe('saved')
		expect(await overlap).toBe('overlap')
		expect(gate.isActive()).toBe(false)
	})
})

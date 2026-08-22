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

	test('rejects queued mutations after a chain profile switch becomes active', async () => {
		let switching = false
		let release: (() => void) | undefined
		const gate = createConfigurationMutationGate(
			() => false,
			() => switching,
		)
		const profileSwitch = gate.run(async () => {
			switching = true
			await new Promise<void>(resolve => {
				release = resolve
			})
		})
		await Bun.sleep(0)
		const queuedMutation = gate.run(async () => 'must not run')
		if (release === undefined) throw new Error('Profile switch did not start')
		release()
		await profileSwitch
		await expect(queuedMutation).rejects.toThrow('Chain profile switching is in progress')
	})

	test('serializes emergency-pause persistence before a queued profile switch', async () => {
		let releasePause: () => void = () => undefined
		let profileSwitchRequested = false
		const writes: string[] = []
		const gate = createConfigurationMutationGate(
			() => false,
			() => profileSwitchRequested,
		)
		const pause = gate.run(async () => {
			await new Promise<void>(resolve => (releasePause = resolve))
			writes.push('paused-current-profile')
		})
		await Bun.sleep(1)
		const profileSwitch = gate.run(async () => {
			profileSwitchRequested = true
			writes.push('target-profile')
		})
		releasePause()
		await Promise.all([pause, profileSwitch])
		expect(writes).toEqual(['paused-current-profile', 'target-profile'])
	})
})

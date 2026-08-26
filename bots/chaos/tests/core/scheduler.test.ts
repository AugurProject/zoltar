import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { createChaosScheduler } from '../../src/core/scheduler.ts'
import { initialDurableState, loadDurableState, saveDurableState } from '../../src/state/operator-state.ts'

const directories: string[] = []

afterEach(async () => {
	await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

async function statePath() {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-chaos-scheduler-'))
	directories.push(directory)
	return join(directory, 'state.json')
}

const settings = { maximumDelaySeconds: 3_600, minimumDelaySeconds: 60 }

describe('durable chaos scheduler', () => {
	test('persists a fresh random wait and selects a different wait after completion', async () => {
		const state = initialDurableState(1, false)
		let now = Date.parse('2026-08-24T00:00:00.000Z')
		const persisted: string[] = []
		const scheduler = createChaosScheduler({
			clock: () => now,
			persist: async candidate => {
				persisted.push(candidate.nextRunAt ?? '')
			},
			random: minimum => minimum,
			settings,
			state: state.scheduler,
		})
		await scheduler.ensureScheduled()
		expect(state.scheduler.lastDelaySeconds).toBe(60)
		expect(state.scheduler.nextRunAt).toBe('2026-08-24T00:01:00.000Z')
		now += 60_000
		await scheduler.markDue()
		await scheduler.begin('open-oracle.dust')
		await scheduler.complete()
		expect(state.scheduler.lastDelaySeconds).toBe(61)
		expect(state.scheduler.nextRunAt).toBe('2026-08-24T00:02:01.000Z')
		expect(persisted).toHaveLength(4)
	})

	test('restores nextRunAt without resetting the countdown after restart', async () => {
		const path = await statePath()
		const state = initialDurableState(1, false)
		const now = Date.parse('2026-08-24T00:00:00.000Z')
		const scheduler = createChaosScheduler({
			clock: () => now,
			persist: async candidate => {
				await saveDurableState(path, { ...state, scheduler: candidate })
			},
			random: () => 120,
			settings,
			state: state.scheduler,
		})
		await scheduler.ensureScheduled()
		const restored = await loadDurableState(path, 1)
		let randomCalls = 0
		const restarted = createChaosScheduler({
			clock: () => now + 30_000,
			persist: async candidate => {
				await saveDurableState(path, { ...restored, scheduler: candidate })
			},
			random: () => {
				randomCalls += 1
				return 121
			},
			settings,
			state: restored.scheduler,
		})
		await restarted.ensureScheduled()
		expect(restored.scheduler.nextRunAt).toBe('2026-08-24T00:02:00.000Z')
		expect(restarted.waitMilliseconds()).toBe(90_000)
		expect(randomCalls).toBe(0)
	})

	test('does not mutate in-memory scheduling when durable persistence fails', async () => {
		const state = initialDurableState(1, false)
		const scheduler = createChaosScheduler({
			clock: () => Date.parse('2026-08-24T00:00:00.000Z'),
			persist: async () => {
				throw new Error('disk full')
			},
			random: minimum => minimum,
			settings,
			state: state.scheduler,
		})
		await expect(scheduler.ensureScheduled()).rejects.toThrow('disk full')
		expect(state.scheduler).toEqual({
			lastDelaySeconds: undefined,
			lastRunAt: undefined,
			nextRunAt: undefined,
			selectedOperationId: undefined,
			status: 'idle',
		})
	})
})

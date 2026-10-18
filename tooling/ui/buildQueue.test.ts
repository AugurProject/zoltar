import { describe, expect, test } from 'bun:test'
import { createBuildQueue } from './buildQueue.mts'

describe('UI build queue', () => {
	test('coalesces queued inputs and prioritizes prerequisites before downstream builds', async () => {
		const calls: string[] = []
		const idle: string[] = []
		let releaseFirst: () => void = () => undefined
		const firstBuild = new Promise<void>(resolve => {
			releaseFirst = resolve
		})
		let started: () => void = () => undefined
		const firstStarted = new Promise<void>(resolve => {
			started = resolve
		})
		const queue = createBuildQueue({
			priority: ['vendor', 'worker'],
			isStopped: () => false,
			onIdle: reason => {
				idle.push(reason)
			},
			run: async (job, reason) => {
				calls.push(`${job}:${reason}`)
				if (calls.length === 1) {
					started()
					await firstBuild
				}
				return true
			},
		})
		const completion = queue.enqueue('vendor', 'first')
		await firstStarted
		void queue.enqueue('worker', 'worker input')
		void queue.enqueue('vendor', 'older input')
		void queue.enqueue('vendor', 'latest input')
		releaseFirst()
		await completion
		expect(calls).toEqual(['vendor:first', 'vendor:latest input', 'worker:worker input'])
		expect(idle).toEqual(['worker input'])
	})

	test('drains follow-up jobs requested by a build before notifying the browser', async () => {
		const calls: string[] = []
		const queue = createBuildQueue({
			priority: ['shared', 'worker'],
			isStopped: () => false,
			onIdle: () => {
				calls.push('reload')
			},
			run: async job => {
				calls.push(job)
				if (job === 'shared') void queue.enqueue('worker', 'shared output')
				return true
			},
		})
		await queue.enqueue('shared', 'source')
		expect(calls).toEqual(['shared', 'worker', 'reload'])
	})

	test('clears failed work without reloading and permits a fresh retry', async () => {
		const calls: string[] = []
		let succeeds = false
		const queue = createBuildQueue({
			priority: ['vendor', 'worker'],
			isStopped: () => false,
			onIdle: () => {
				calls.push('reload')
			},
			run: async job => {
				calls.push(job)
				return succeeds
			},
		})
		const failed = queue.enqueue('vendor', 'source')
		void queue.enqueue('worker', 'downstream')
		await failed
		expect(calls).toEqual(['vendor'])
		succeeds = true
		await queue.enqueue('vendor', 'retry')
		expect(calls).toEqual(['vendor', 'vendor', 'reload'])
	})

	test('stops before downstream jobs and does not enqueue after shutdown', async () => {
		const calls: string[] = []
		let stopped = false
		const queue = createBuildQueue({
			priority: ['vendor', 'worker'],
			isStopped: () => stopped,
			onIdle: () => {
				calls.push('reload')
			},
			run: async job => {
				calls.push(job)
				stopped = true
				return true
			},
		})
		const completion = queue.enqueue('vendor', 'source')
		void queue.enqueue('worker', 'downstream')
		await completion
		await queue.enqueue('vendor', 'after shutdown')
		expect(calls).toEqual(['vendor'])
	})

	test('releases the queue after an unexpected build failure', async () => {
		let fails = true
		const queue = createBuildQueue({
			priority: ['worker'],
			isStopped: () => false,
			onIdle: () => undefined,
			run: async () => {
				if (fails) throw new Error('Failed to spawn')
				return true
			},
		})
		await expect(queue.enqueue('worker', 'source')).rejects.toThrow('Failed to spawn')
		fails = false
		await queue.enqueue('worker', 'retry')
	})
})

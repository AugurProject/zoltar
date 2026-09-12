import { expect, test } from 'bun:test'
import { renameAndSyncDirectory } from '../../src/config/durable-replacement.ts'

for (const { failure, expectedEvents } of [
	{ failure: undefined, expectedEvents: ['rename', 'open', 'sync', 'close'] },
	{ failure: 'rename', expectedEvents: ['rename'] },
	{ failure: 'open', expectedEvents: ['rename', 'open'] },
	{ failure: 'sync', expectedEvents: ['rename', 'open', 'sync', 'close'] },
	{ failure: 'close', expectedEvents: ['rename', 'open', 'sync', 'close'] },
]) {
	test(`durable replacement propagates ${failure ?? 'no'} failure with correct ordering`, async () => {
		const events: string[] = []
		const error = new Error(`${failure} failed`)
		let destination = 'previous settings'
		const operation = async (name: string) => {
			events.push(name)
			if (failure === name) throw error
		}
		const result = renameAndSyncDirectory('/state/settings.tmp', '/state/settings.json', {
			rename: async (source, target) => {
				expect([source, target]).toEqual(['/state/settings.tmp', '/state/settings.json'])
				await operation('rename')
				destination = 'new settings'
			},
			open: async (path, flags) => {
				expect([path, flags]).toEqual(['/state', 'r'])
				await operation('open')
				return { sync: () => operation('sync'), close: () => operation('close') }
			},
		})
		if (failure === undefined) await result
		else await expect(result).rejects.toBe(error)
		expect(destination).toBe(failure === 'rename' ? 'previous settings' : 'new settings')
		expect(events).toEqual(expectedEvents)
	})
}

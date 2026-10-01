/// <reference types='bun-types' />

import { useRefreshOnEnable } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { describe, expect, test } from 'bun:test'
import { renderHookWithProps } from '../support/renderHook.js'

describe('useRefreshOnEnable', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('refreshes when a view becomes active again, not on its first render or while it stays active', async () => {
		let refreshes = 0
		const hook = await renderHookWithProps(({ enabled }: { enabled: boolean }) => useRefreshOnEnable(() => (refreshes += 1), enabled), { enabled: true })
		cleanupRenderedComponent = hook.cleanup
		expect(refreshes).toBe(0)

		await hook.setProps({ enabled: true })
		expect(refreshes).toBe(0)

		// Another route was open, for example settling an oracle report, and then the pool view returns.
		await hook.setProps({ enabled: false })
		await hook.setProps({ enabled: true })
		expect(refreshes).toBe(1)

		await hook.setProps({ enabled: false })
		await hook.setProps({ enabled: true })
		expect(refreshes).toBe(2)
	})
})

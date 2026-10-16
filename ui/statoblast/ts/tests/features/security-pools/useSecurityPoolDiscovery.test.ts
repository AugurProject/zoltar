/// <reference types='bun-types' />

import { describe, expect, mock, test } from 'bun:test'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { installDomTestLifecycle, requireHookState } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { useSecurityPoolDiscovery, type UseSecurityPoolDiscoveryDependencies } from '@zoltar/ui-statoblast-shared/features/security-pools/hooks/useSecurityPoolDiscovery.js'
import type { SecurityPoolRegistryPage } from '@zoltar/ui-statoblast-shared/types/contracts.js'

type HarnessProps = { enabled?: boolean; environmentRefreshKey?: number }

describe('useSecurityPoolDiscovery', () => {
	const { trackRendered } = installDomTestLifecycle()

	const renderDiscovery = async (loadSecurityPoolPage: UseSecurityPoolDiscoveryDependencies['loadSecurityPoolPage'], initialProps: HarnessProps = {}) => {
		let state: ReturnType<typeof useSecurityPoolDiscovery> | undefined
		const dependencies: UseSecurityPoolDiscoveryDependencies = { loadSecurityPoolPage, waitForSecurityPoolReadBackend: async () => undefined }
		function Harness({ enabled = true, environmentRefreshKey = 0 }: HarnessProps) {
			state = useSecurityPoolDiscovery({ enabled, environmentRefreshKey }, dependencies)
			return h('div', {})
		}
		const rendered = trackRendered(await renderIntoDocument(h(Harness, initialProps)))
		return {
			rerender: async (props: HarnessProps) => {
				await act(() => {
					render(h(Harness, props), rendered.container)
				})
			},
			state: () => requireHookState(state),
		}
	}

	const createPage = (pageIndex: number): SecurityPoolRegistryPage => ({ pageIndex, pageSize: 10, poolCount: 12n, pools: [] })

	test('tags each loaded page with the discovery request that asked for it', async () => {
		const loadSecurityPoolPage = mock(async (pageIndex: number) => createPage(pageIndex))
		const { state } = await renderDiscovery(loadSecurityPoolPage)
		await act(async () => {
			await state().loadSecurityPoolPage(1, 10, 'request-1')
		})
		expect(loadSecurityPoolPage.mock.calls[0]?.slice(0, 2)).toEqual([1, 10])
		expect(state().securityPoolPage).toEqual({ ...createPage(1), requestKey: 'request-1' })
		expect(state().loadingSecurityPoolPage).toBe(false)
	})

	test('rejects a failed read so discovery offers a retry, and keeps its reason', async () => {
		const { state } = await renderDiscovery(async () => {
			throw new Error('Registry read failed')
		})
		let rejection: unknown
		await act(async () => {
			await state()
				.loadSecurityPoolPage(0, 10, 'request-0')
				.catch((error: unknown) => {
					rejection = error
				})
		})
		expect(rejection).toBeInstanceOf(Error)
		expect(state().securityPoolPageError).toContain('Registry read failed')
		expect(state().securityPoolPage).toBeUndefined()
	})

	test('drops a page read for a previous environment and skips reads until the chain is readable', async () => {
		const staleRead = createDeferred<SecurityPoolRegistryPage>()
		const loadSecurityPoolPage = mock(async () => await staleRead.promise)
		const { rerender, state } = await renderDiscovery(loadSecurityPoolPage)
		let pendingRead: Promise<void> | undefined
		await act(() => {
			pendingRead = state().loadSecurityPoolPage(0, 10, 'request-0')
		})
		await waitFor(() => expect(loadSecurityPoolPage).toHaveBeenCalledTimes(1))
		await rerender({ environmentRefreshKey: 1 })
		await act(async () => {
			staleRead.resolve(createPage(0))
			await pendingRead
		})
		expect(state().securityPoolPage).toBeUndefined()

		await rerender({ enabled: false, environmentRefreshKey: 1 })
		await act(async () => {
			await state().loadSecurityPoolPage(0, 10, 'request-1')
		})
		expect(loadSecurityPoolPage).toHaveBeenCalledTimes(1)
	})
})

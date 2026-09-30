/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { useSettledPoolOracleManagerRefresh } from '../../app/hooks/useSettledPoolOracleManagerRefresh.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'

const MANAGER_A: Address = '0x00000000000000000000000000000000000000a1'
const MANAGER_B: Address = '0x00000000000000000000000000000000000000b2'

describe('useSettledPoolOracleManagerRefresh', () => {
	let cleanupDom: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		cleanupDom = installDomEnvironment().cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		cleanupDom?.()
		cleanupDom = undefined
	})

	test('refreshes the manager open when settlement resolves, not the one open when it started', async () => {
		const loadedManagers: Address[] = []
		const loadPoolOracleManager = async (managerAddress: Address) => {
			loadedManagers.push(managerAddress)
		}
		const callbacksByRender: Array<() => Promise<void>> = []
		function Harness({ managerAddress }: { managerAddress: Address | undefined }) {
			callbacksByRender.push(useSettledPoolOracleManagerRefresh(managerAddress, loadPoolOracleManager))
			return <div />
		}
		const rendered = await renderIntoDocument(<Harness managerAddress={MANAGER_A} />)
		cleanupRenderedComponent = rendered.cleanup
		const onReportSettledAtStart = callbacksByRender.at(-1)
		if (onReportSettledAtStart === undefined) throw new Error('Expected the settled callback from the first render')
		// The operations hook keeps the callback from the render that started the settle and calls it after the wallet round trip.
		const walletRoundTrip = createDeferred<undefined>()
		const settlement = (async () => {
			await walletRoundTrip.promise
			await onReportSettledAtStart()
		})()
		await act(() => {
			render(<Harness managerAddress={MANAGER_B} />, rendered.container)
		})
		walletRoundTrip.resolve(undefined)
		await settlement
		expect(loadedManagers).toEqual([MANAGER_B])
	})

	test('skips the refresh when no manager is open by the time settlement resolves', async () => {
		const loadedManagers: Address[] = []
		const callbacksByRender: Array<() => Promise<void>> = []
		function Harness({ managerAddress }: { managerAddress: Address | undefined }) {
			callbacksByRender.push(
				useSettledPoolOracleManagerRefresh(managerAddress, async address => {
					loadedManagers.push(address)
				}),
			)
			return <div />
		}
		const rendered = await renderIntoDocument(<Harness managerAddress={MANAGER_A} />)
		cleanupRenderedComponent = rendered.cleanup
		const onReportSettledAtStart = callbacksByRender.at(-1)
		if (onReportSettledAtStart === undefined) throw new Error('Expected the settled callback from the first render')
		await act(() => {
			render(<Harness managerAddress={undefined} />, rendered.container)
		})
		await onReportSettledAtStart()
		expect(loadedManagers).toEqual([])
	})
})

/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { useAppRouteEffects } from '../hooks/useAppRouteEffects.js'
import { useUrlState } from '../hooks/useUrlState.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

type RouteEffectsProps = Parameters<typeof useAppRouteEffects>[0]

function createDefaultProps(overrides: Partial<RouteEffectsProps> = {}): RouteEffectsProps {
	return {
		augurPlaceHolderDeploymentMissing: false,
		environmentReady: true,
		loadOracleReport: async () => undefined,
		loadSecurityPools: async () => undefined,
		navigate: () => undefined,
		openOracleFormReportId: '',
		openOracleReportDetailsReportId: undefined,
		route: 'zoltar',
		securityPoolAddress: '',
		securityPoolResultHash: undefined,
		selectedPoolSecurityPoolAddress: undefined,
		setForkAuctionFormSecurityPoolAddress: () => undefined,
		setOpenOracleReport: () => undefined,
		setReportingFormSecurityPoolAddress: () => undefined,
		setSecurityVaultFormSecurityPoolAddress: () => undefined,
		setTradingFormSecurityPoolAddress: () => undefined,
		tradingResultHash: undefined,
		urlOpenOracleReportId: '',
		walletBootstrapComplete: true,
		...overrides,
	}
}

function RouteEffectsHarness(props: RouteEffectsProps) {
	useAppRouteEffects(props)
	return null
}

function RouteEffectsWithUrlStateHarness(props: Omit<RouteEffectsProps, 'setOpenOracleReport'>) {
	const { setOpenOracleReport } = useUrlState()
	useAppRouteEffects({
		...props,
		setOpenOracleReport,
	})
	return null
}

describe('app route effects integration', () => {
	test('does not repeatedly reload the same unresolved open oracle report across rerenders', async () => {
		const dom = installDomEnvironment()
		const calls: string[] = []
		const initialProps = createDefaultProps({
			loadOracleReport: async reportId => {
				calls.push(reportId)
			},
			route: 'open-oracle',
			urlOpenOracleReportId: '1',
		})

		const { cleanup, container } = await renderIntoDocument(<RouteEffectsHarness {...initialProps} />)
		expect(calls).toEqual(['1'])

		await act(() => {
			render(
				<RouteEffectsHarness
					{...initialProps}
					loadOracleReport={async reportId => {
						calls.push(`rerender:${reportId}`)
					}}
				/>,
				container,
			)
		})

		expect(calls).toEqual(['1'])
		await cleanup()
		dom.cleanup()
	})

	test('does not repeatedly reload the same unresolved security pool across rerenders', async () => {
		const dom = installDomEnvironment('http://localhost/#/security-pools')
		const calls: string[] = []
		const initialProps = createDefaultProps({
			loadSecurityPools: async securityPoolAddress => {
				calls.push(securityPoolAddress ?? '')
			},
			route: 'security-pools',
			securityPoolAddress: '0x84834d4Dccea071b363e53952BD300F7bf56a009',
		})

		const { cleanup, container } = await renderIntoDocument(<RouteEffectsHarness {...initialProps} />)
		expect(calls).toEqual(['0x84834d4Dccea071b363e53952BD300F7bf56a009'])

		await act(() => {
			render(
				<RouteEffectsHarness
					{...initialProps}
					loadSecurityPools={async securityPoolAddress => {
						calls.push(`rerender:${securityPoolAddress ?? ''}`)
					}}
				/>,
				container,
			)
		})

		expect(calls).toEqual(['0x84834d4Dccea071b363e53952BD300F7bf56a009'])
		await cleanup()
		dom.cleanup()
	})

	test('does not repeatedly rewrite the open-oracle report query param across rerenders when using the real URL state hook', async () => {
		const dom = installDomEnvironment('http://localhost/#/open-oracle')
		const replaceStateCalls: string[] = []
		const originalReplaceState = window.history.replaceState.bind(window.history)
		window.history.replaceState = ((data, unused, url) => {
			replaceStateCalls.push(String(url ?? ''))
			return originalReplaceState(data, unused, url)
		}) as History['replaceState']

		const initialProps = createDefaultProps({
			openOracleFormReportId: '42',
			route: 'open-oracle',
		})

		const { cleanup, container } = await renderIntoDocument(<RouteEffectsWithUrlStateHarness {...initialProps} />)
		expect(replaceStateCalls.length).toBe(1)

		await act(() => {
			render(<RouteEffectsWithUrlStateHarness {...initialProps} />, container)
		})

		expect(replaceStateCalls.length).toBe(1)

		window.history.replaceState = originalReplaceState
		await cleanup()
		dom.cleanup()
	})
})

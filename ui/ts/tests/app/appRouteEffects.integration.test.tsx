/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { fireEvent, within } from '../testUtils/queries'
import { render } from 'preact'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { useAppRouteEffects } from '../../app/hooks/useAppRouteEffects.js'
import { useUrlState } from '../../app/hooks/useUrlState.js'
import { installDomEnvironment } from '../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'

type RouteEffectsProps = Parameters<typeof useAppRouteEffects>[0]

function createDefaultProps(overrides: Partial<RouteEffectsProps> = {}): RouteEffectsProps {
	return {
		accountAddress: undefined,
		activeZoltarView: 'questions',
		activeEnvironmentNonce: 0,
		augurStatoblastDeploymentMissing: false,
		environmentReady: true,
		loadOracleReport: async () => undefined,
		loadSecurityPools: async () => undefined,
		navigate: () => undefined,
		resetSecurityPoolCreation: () => undefined,
		route: 'zoltar',
		securityPoolAddress: '',
		securityPoolQuestionId: '',
		securityPoolResultHash: undefined,
		selectedPoolSecurityPoolAddress: undefined,
		setForkAuctionFormSecurityPoolAddress: () => undefined,
		setOpenOracleFormReportId: () => undefined,
		setReportingFormSecurityPoolAddress: () => undefined,
		setSecurityVaultFormSelectedVaultAddress: () => undefined,
		setSecurityVaultFormSecurityPoolAddress: () => undefined,
		setSecurityPoolFormMarketId: () => undefined,
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

function SecurityPoolQuestionRouteHarness() {
	const { securityPoolQuestionId } = useUrlState()
	const [hasCreationResult, setHasCreationResult] = useState(true)
	const [marketId, setMarketId] = useState('stale-question')
	useAppRouteEffects(
		createDefaultProps({
			resetSecurityPoolCreation: () => setHasCreationResult(false),
			route: 'security-pools',
			securityPoolQuestionId,
			setSecurityPoolFormMarketId: setMarketId,
		}),
	)
	return hasCreationResult ? <div id='creation-result'>Previous pool created</div> : <div id='market-id'>{marketId}</div>
}

function OpenOracleReportRouteHarness() {
	const { openOracleReportId } = useUrlState()
	const [reportId, setReportId] = useState('stale-report')
	useAppRouteEffects(
		createDefaultProps({
			route: 'open-oracle',
			setOpenOracleFormReportId: setReportId,
			urlOpenOracleReportId: openOracleReportId,
		}),
	)
	return <div id='selected-report-id'>{reportId}</div>
}

function UrlStateHarness() {
	const { openOracleReportId, securityPoolAddress, setOpenOracleReport, setSecurityPoolAddress } = useUrlState()

	return (
		<div>
			<div id='report-id'>{openOracleReportId}</div>
			<div id='security-pool'>{securityPoolAddress}</div>
			<button type='button' onClick={() => setOpenOracleReport('42')}>
				Set Report
			</button>
			<button type='button' onClick={() => setSecurityPoolAddress('0x84834d4Dccea071b363e53952BD300F7bf56a009')}>
				Set Pool
			</button>
		</div>
	)
}

describe('app route effects integration', () => {
	test('loads linked security pools once while browsing market questions', async () => {
		const dom = installDomEnvironment('http://localhost/#/zoltar')
		const calls: Array<string | undefined> = []
		const initialProps = createDefaultProps({
			loadSecurityPools: async securityPoolAddress => {
				calls.push(securityPoolAddress)
			},
		})

		const { cleanup, container } = await renderIntoDocument(<RouteEffectsHarness {...initialProps} />)
		expect(calls).toEqual([undefined])

		await act(() => {
			render(
				<RouteEffectsHarness
					{...initialProps}
					loadSecurityPools={async securityPoolAddress => {
						calls.push(securityPoolAddress)
					}}
				/>,
				container,
			)
		})

		expect(calls).toEqual([undefined])
		await cleanup()
		dom.cleanup()
	})

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

	test('preserves a route-selected open oracle report while its details are loading', async () => {
		const dom = installDomEnvironment('http://localhost/#/open-oracle?openOracleView=selected-report&openOracleReportId=2')
		const initialProps = createDefaultProps({
			loadOracleReport: async () => undefined,
			route: 'open-oracle',
			urlOpenOracleReportId: '2',
		})

		const { cleanup } = await renderIntoDocument(<RouteEffectsHarness {...initialProps} />)
		expect(window.location.hash).toContain('openOracleReportId=2')

		await cleanup()
		dom.cleanup()
	})

	test('keeps a changed route-selected oracle report authoritative over stale loaded details', async () => {
		const dom = installDomEnvironment('http://localhost/#/open-oracle?openOracleView=selected-report&openOracleReportId=2')
		const calls: string[] = []
		const initialProps = createDefaultProps({
			loadOracleReport: async reportId => {
				calls.push(reportId)
			},
			route: 'open-oracle',
			urlOpenOracleReportId: '2',
		})

		const { cleanup } = await renderIntoDocument(<RouteEffectsHarness {...initialProps} />)
		expect(calls).toEqual(['2'])
		expect(window.location.hash).toContain('openOracleReportId=2')
		expect(window.location.hash).not.toContain('openOracleReportId=1')

		await cleanup()
		dom.cleanup()
	})

	test('hydrates and clears the internal oracle report selection across history events', async () => {
		const dom = installDomEnvironment('http://localhost/#/open-oracle?openOracleView=selected-report&openOracleReportId=2')
		const { cleanup, container } = await renderIntoDocument(<OpenOracleReportRouteHarness />)
		expect(container.querySelector('#selected-report-id')?.textContent).toBe('2')

		await act(() => {
			window.history.pushState({}, '', '#/open-oracle')
			window.dispatchEvent(new Event('popstate'))
		})
		expect(container.querySelector('#selected-report-id')?.textContent).toBe('')

		await cleanup()
		dom.cleanup()
	})

	test('restores and clears the route-backed security pool question across history events', async () => {
		const dom = installDomEnvironment('http://localhost/#/security-pools?securityPoolsView=create&questionId=question-1')
		const { cleanup, container } = await renderIntoDocument(<SecurityPoolQuestionRouteHarness />)
		expect(container.querySelector('#creation-result')).toBeNull()
		expect(container.querySelector('#market-id')?.textContent).toBe('question-1')

		await act(() => {
			window.history.pushState({}, '', '#/security-pools?securityPoolsView=create')
			window.dispatchEvent(new Event('popstate'))
		})
		expect(container.querySelector('#market-id')?.textContent).toBe('')

		await act(() => {
			window.history.pushState({}, '', '#/security-pools?securityPoolsView=create&questionId=question-2')
			window.dispatchEvent(new Event('popstate'))
		})
		expect(container.querySelector('#market-id')?.textContent).toBe('question-2')

		await cleanup()
		dom.cleanup()
	})

	test('reloads route data after the active environment nonce changes', async () => {
		const dom = installDomEnvironment()
		const securityPoolCalls: string[] = []
		const initialProps = createDefaultProps({
			environmentReady: true,
			loadSecurityPools: async securityPoolAddress => {
				securityPoolCalls.push(securityPoolAddress ?? '')
			},
			route: 'security-pools',
			securityPoolAddress: '0x84834d4Dccea071b363e53952BD300F7bf56a009',
			selectedPoolSecurityPoolAddress: undefined,
			walletBootstrapComplete: true,
		})

		try {
			const rendered = await renderIntoDocument(<RouteEffectsHarness {...initialProps} />)
			await act(() => Promise.resolve())
			expect(securityPoolCalls).toEqual(['0x84834d4Dccea071b363e53952BD300F7bf56a009'])

			await act(() => {
				render(<RouteEffectsHarness {...initialProps} activeEnvironmentNonce={1} />, rendered.container)
			})
			await act(() => Promise.resolve())
			expect(securityPoolCalls).toEqual(['0x84834d4Dccea071b363e53952BD300F7bf56a009', '0x84834d4Dccea071b363e53952BD300F7bf56a009'])

			await rendered.cleanup()
		} finally {
			dom.cleanup()
		}
	})

	test('reloads a selected security pool after the active environment nonce changes', async () => {
		const dom = installDomEnvironment()
		const securityPoolCalls: string[] = []
		const securityPoolAddress = '0x84834d4Dccea071b363e53952BD300F7bf56a009'
		const initialProps = createDefaultProps({
			environmentReady: true,
			loadSecurityPools: async nextSecurityPoolAddress => {
				securityPoolCalls.push(nextSecurityPoolAddress ?? '')
			},
			route: 'security-pools',
			securityPoolAddress,
			selectedPoolSecurityPoolAddress: securityPoolAddress,
			walletBootstrapComplete: true,
		})

		try {
			const rendered = await renderIntoDocument(<RouteEffectsHarness {...initialProps} />)
			await act(() => Promise.resolve())
			expect(securityPoolCalls).toEqual([])

			await act(() => {
				render(<RouteEffectsHarness {...initialProps} activeEnvironmentNonce={1} />, rendered.container)
			})
			await act(() => Promise.resolve())
			expect(securityPoolCalls).toEqual([securityPoolAddress])

			await rendered.cleanup()
		} finally {
			dom.cleanup()
		}
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

	test('pushes new URL state so browser back navigation restores the previous deep link', async () => {
		const dom = installDomEnvironment('http://localhost/#/open-oracle')
		const { cleanup } = await renderIntoDocument(<UrlStateHarness />)

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Set Report' }))
		})
		expect(window.location.hash).toContain('openOracleReportId=42')
		expect(document.getElementById('report-id')?.textContent).toBe('42')

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Set Pool' }))
		})
		expect(window.location.hash).toContain('securityPool=0x84834d4Dccea071b363e53952BD300F7bf56a009')

		await act(() => {
			window.history.back()
			window.dispatchEvent(new Event('popstate'))
		})

		expect(window.location.hash).toContain('openOracleReportId=42')
		expect(window.location.hash).not.toContain('securityPool=')
		expect(document.getElementById('report-id')?.textContent).toBe('42')
		expect(document.getElementById('security-pool')?.textContent).toBe('')

		await cleanup()
		dom.cleanup()
	})

	test('refreshes the selected pool with its route address after pool creation succeeds', async () => {
		const dom = installDomEnvironment('http://localhost/#/security-pools')
		const calls: Array<string | undefined> = []
		const securityPoolAddress = '0x84834d4Dccea071b363e53952BD300F7bf56a009'
		const props = createDefaultProps({
			route: 'security-pools',
			securityPoolAddress,
			securityPoolResultHash: '0xabc',
			loadSecurityPools: async nextSecurityPoolAddress => {
				calls.push(nextSecurityPoolAddress)
			},
		})

		const { cleanup } = await renderIntoDocument(<RouteEffectsHarness {...props} />)

		expect(calls).toContain(securityPoolAddress)
		expect(calls).not.toContain(undefined)

		await cleanup()
		dom.cleanup()
	})

	test('clears route-backed pool forms when the selected pool address is cleared', async () => {
		const dom = installDomEnvironment('http://localhost/#/security-pools')
		const securityVaultUpdates: string[] = []
		const selectedVaultUpdates: string[] = []
		const tradingUpdates: string[] = []
		const forkUpdates: string[] = []
		const reportingUpdates: string[] = []

		const { cleanup } = await renderIntoDocument(
			<RouteEffectsHarness
				{...createDefaultProps({
					route: 'security-pools',
					securityPoolAddress: '',
					setForkAuctionFormSecurityPoolAddress: value => {
						forkUpdates.push(value)
					},
					setReportingFormSecurityPoolAddress: value => {
						reportingUpdates.push(value)
					},
					setSecurityVaultFormSelectedVaultAddress: value => {
						selectedVaultUpdates.push(value)
					},
					setSecurityVaultFormSecurityPoolAddress: value => {
						securityVaultUpdates.push(value)
					},
					setTradingFormSecurityPoolAddress: value => {
						tradingUpdates.push(value)
					},
				})}
			/>,
		)

		expect(securityVaultUpdates).toEqual([''])
		expect(selectedVaultUpdates).toEqual([''])
		expect(tradingUpdates).toEqual([''])
		expect(forkUpdates).toEqual([''])
		expect(reportingUpdates).toEqual([''])

		await cleanup()
		dom.cleanup()
	})

	test('resets the selected vault when the selected pool changes, but not on same-pool rerenders', async () => {
		const dom = installDomEnvironment('http://localhost/#/security-pools')
		const selectedVaultUpdates: string[] = []
		const initialProps = createDefaultProps({
			accountAddress: '0x84834d4Dccea071b363e53952BD300F7bf56a009',
			route: 'security-pools',
			securityPoolAddress: '0x1111111111111111111111111111111111111111',
			setSecurityVaultFormSelectedVaultAddress: value => {
				selectedVaultUpdates.push(value)
			},
		})

		const { cleanup, container } = await renderIntoDocument(<RouteEffectsHarness {...initialProps} />)
		expect(selectedVaultUpdates).toEqual(['0x84834d4Dccea071b363e53952BD300F7bf56a009'])

		await act(() => {
			render(<RouteEffectsHarness {...initialProps} />, container)
		})
		expect(selectedVaultUpdates).toEqual(['0x84834d4Dccea071b363e53952BD300F7bf56a009'])

		await act(() => {
			render(<RouteEffectsHarness {...initialProps} securityPoolAddress='0x2222222222222222222222222222222222222222' />, container)
		})
		expect(selectedVaultUpdates).toEqual(['0x84834d4Dccea071b363e53952BD300F7bf56a009', '0x84834d4Dccea071b363e53952BD300F7bf56a009'])

		await act(() => {
			render(<RouteEffectsHarness {...initialProps} securityPoolAddress='' />, container)
		})
		expect(selectedVaultUpdates).toEqual(['0x84834d4Dccea071b363e53952BD300F7bf56a009', '0x84834d4Dccea071b363e53952BD300F7bf56a009', ''])

		await cleanup()
		dom.cleanup()
	})
})

/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { zeroHash } from '@zoltar/core-shared/evm/ethereum'
import { useStatoblastUrlState } from '../../app/hooks/useStatoblastUrlState.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { resetRoutingForTesting } from '@zoltar/ui-core-shared/navigation/routing.js'
import { getLocalEntityScope } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { resetLocalEntityStoreForTesting, setEntityFavorite } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import type { ListedSecurityPool } from '@zoltar/ui-core-shared/types/contracts.js'
import { installStatoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { SecurityPoolsSection } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolsSection.js'
import { securityPoolDownloadStore, toCachedSecurityPool } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/poolBrowse.js'
import type { SecurityPoolRouteContentProps, SecurityPoolsOverviewRouteContentProps } from '@zoltar/ui-statoblast-shared/features/types.js'
import { createAccountState, createSecurityPoolWorkflowProps, createSelectedPool } from '../features/security-pools/workflow/builders.js'

const POOL_ADDRESS = '0x0000000000000000000000000000000000000101'

function createCreatePoolProps(): SecurityPoolRouteContentProps {
	return {
		accountState: createAccountState(),
		checkingDuplicateOriginPool: false,
		duplicateOriginPoolExists: false,
		loadingMarketDetails: false,
		marketDetails: undefined,
		onCreateSecurityPool: () => undefined,
		onResetSecurityPoolCreation: () => undefined,
		onSecurityPoolFormChange: () => undefined,
		poolCreationMarketDetails: undefined,
		repPerEthPrice: undefined,
		repPerEthSource: undefined,
		repPerEthSourceUrl: undefined,
		securityPools: [],
		securityPoolCreating: false,
		securityPoolError: undefined,
		securityPoolForm: { initialReportPriorityFeeNanoEth: '10', marketId: '', statoblastSecurityMultiplierBps: '' },
		securityPoolResult: undefined,
		zoltarUniverseHasForked: false,
	}
}

function createOverviewProps(activeUniverseId: bigint): SecurityPoolsOverviewRouteContentProps {
	return {
		accountState: createAccountState(),
		activeUniverseId,
		environmentRefreshKey: 0,
		loadingSecurityPoolPage: false,
		onLoadSecurityPoolPage: () => undefined,
		securityPoolOverviewError: undefined,
		securityPoolPage: undefined,
		securityPools: [],
	}
}

/** Browse reads the local cache, so the pool row comes from a downloaded, favorited pool. */
function seedDownloadedPool(pool: ListedSecurityPool) {
	const scope = getLocalEntityScope('statoblast', 'pool')
	securityPoolDownloadStore.record(scope, [{ data: toCachedSecurityPool(pool), id: pool.securityPoolAddress }])
	setEntityFavorite(scope, pool.securityPoolAddress, true)
}

describe('opening a pool from Browse pools', () => {
	let cleanupDom: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let restorePushState: (() => void) | undefined

	beforeEach(() => {
		installStatoblastRouting()
		resetLocalEntityStoreForTesting()
	})

	afterEach(async () => {
		restorePushState?.()
		restorePushState = undefined
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		resetLocalEntityStoreForTesting()
		cleanupDom?.()
		cleanupDom = undefined
		resetRoutingForTesting()
	})

	/** Renders the pools route wired to the real URL state and counts history pushes and component-triggered pool loads after the first render. */
	async function renderPools(url: string, pool: ListedSecurityPool | undefined, createPool = createCreatePoolProps()) {
		cleanupDom = installDomEnvironment(url).cleanup
		if (pool !== undefined) seedDownloadedPool(pool)
		const selectedPoolLoads: Array<string | undefined> = []
		function Harness() {
			const urlState = useStatoblastUrlState()
			return (
				<SecurityPoolsSection
					activeView={urlState.securityPoolsView}
					createPool={createPool}
					onActiveViewChange={urlState.setSecurityPoolsView}
					onOpenSecurityPool={(securityPoolAddress, universeId) => urlState.openSecurityPoolInUniverse(universeId, securityPoolAddress)}
					overview={createOverviewProps(urlState.activeUniverseId)}
					securityPools={[]}
					workflow={createSecurityPoolWorkflowProps({
						onRefreshSelectedPoolData: securityPoolAddress => {
							selectedPoolLoads.push(securityPoolAddress)
						},
						onSecurityPoolAddressChange: urlState.setSecurityPoolAddress,
						securityPoolAddress: urlState.securityPoolAddress,
					})}
					zoltarUniverse={undefined}
				/>
			)
		}
		cleanupRenderedComponent = (await renderIntoDocument(<Harness />)).cleanup
		const originalPushState = window.history.pushState.bind(window.history)
		const history = { pushes: 0, selectedPoolLoads }
		window.history.pushState = (...parameters: Parameters<History['pushState']>) => {
			history.pushes += 1
			return originalPushState(...parameters)
		}
		restorePushState = () => {
			window.history.pushState = originalPushState
		}
		return history
	}

	test('opens a listed pool with one history entry and leaves the single pool load to the route', async () => {
		const counts = await renderPools('http://localhost/#/pools?universe=11', createSelectedPool({ hasLoadedVaults: false, securityPoolAddress: POOL_ADDRESS, universeId: 11n }))
		await act(() => {
			fireEvent.click(within(document.body).getByRole('link', { name: new RegExp(`^Open pool: .*${POOL_ADDRESS}`) }))
		})
		expect(counts.pushes).toBe(1)
		expect(window.location.hash).toBe(`#/pools/${POOL_ADDRESS}?universe=11`)
		expect(counts.selectedPoolLoads).toEqual([])
	})

	test('opens a pasted pool from another universe with one history entry that Back undoes', async () => {
		const counts = await renderPools('http://localhost/#/pools?universe=1', createSelectedPool({ hasLoadedVaults: false, securityPoolAddress: POOL_ADDRESS, universeId: 11n }))
		const search = within(document.body).getByLabelText('Search downloaded pools')
		if (!(search instanceof window.HTMLInputElement)) throw new Error('Expected the pool search input')
		search.value = POOL_ADDRESS
		await act(() => {
			search.dispatchEvent(new window.Event('input', { bubbles: true }))
		})
		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Open pool at this address' }))
		})
		expect(counts.pushes).toBe(1)
		expect(window.location.hash).toBe(`#/pools/${POOL_ADDRESS}?universe=11`)
		expect(counts.selectedPoolLoads).toEqual([])
		await act(() => {
			window.history.back()
			window.dispatchEvent(new Event('popstate'))
		})
		expect(window.location.hash).toBe('#/pools?universe=1')
	})

	test('opens a newly created pool from another universe with one history entry and leaves the pool load to the route', async () => {
		const createPool: SecurityPoolRouteContentProps = {
			...createCreatePoolProps(),
			securityPoolResult: {
				deployPoolHash: zeroHash,
				initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
				questionId: '0x01',
				securityPoolAddress: POOL_ADDRESS,
				statoblastSecurityMultiplierBps: 20_000n,
				universeId: 11n,
			},
		}
		const counts = await renderPools('http://localhost/#/pools/create?universe=1', undefined, createPool)
		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: /^Open pool:/ }))
		})
		expect(counts.pushes).toBe(1)
		expect(window.location.hash).toBe(`#/pools/${POOL_ADDRESS}?universe=11`)
		expect(counts.selectedPoolLoads).toEqual([])
	})
})

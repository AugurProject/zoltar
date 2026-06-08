/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '@testing-library/dom'
import { SecurityPoolsOverviewSection } from '../components/SecurityPoolsOverviewSection.js'
import { deriveHasForkActivity } from '../lib/forkAuction.js'
import type { AccountState } from '../types/app.js'
import type { ListedSecurityPool, MarketDetails } from '../types/contracts.js'
import type { SecurityPoolsOverviewSectionProps } from '../types/components.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { act } from 'preact/test-utils'
import { zeroAddress } from 'viem'

function createAccountState(overrides: Partial<AccountState> = {}): AccountState {
	return {
		address: zeroAddress,
		chainId: '0x1',
		ethBalance: 0n,
		wethBalance: 0n,
		...overrides,
	}
}

function createMarketDetails(overrides: Partial<MarketDetails> = {}): MarketDetails {
	return {
		answerUnit: '',
		createdAt: 1n,
		description: 'Question description',
		displayValueMax: 100n,
		displayValueMin: 0n,
		endTime: 2n,
		exists: true,
		marketType: 'binary',
		numTicks: 2n,
		outcomeLabels: ['Yes', 'No'],
		questionId: '0x01',
		startTime: 1n,
		title: 'Will this resolve?',
		...overrides,
	}
}

function createSecurityPool(overrides: Partial<ListedSecurityPool> = {}): ListedSecurityPool {
	const securityPool: ListedSecurityPool = {
		completeSetCollateralAmount: 0n,
		currentRetentionRate: 10n,
		hasForkActivity: false,
		forkOutcome: 'none',
		forkOwnSecurityPool: false,
		lastOraclePrice: undefined,
		lastOracleSettlementTimestamp: 0n,
		managerAddress: zeroAddress,
		marketDetails: createMarketDetails(),
		migratedRep: 0n,
		parent: zeroAddress,
		questionOutcome: 'none',
		questionId: '0x01',
		securityMultiplier: 2n,
		securityPoolAddress: zeroAddress,
		systemState: 'operational',
		totalRepDeposit: 0n,
		totalSecurityBondAllowance: 5n * 10n ** 18n,
		truthAuctionAddress: zeroAddress,
		truthAuctionStartedAt: 0n,
		universeHasForked: false,
		universeId: 1n,
		hasLoadedVaults: true,
		vaultCount: 0n,
		vaults: [],
		...overrides,
	}
	return {
		...securityPool,
		hasForkActivity: overrides.hasForkActivity ?? deriveHasForkActivity(securityPool),
	}
}

function createProps(overrides: Partial<SecurityPoolsOverviewSectionProps> = {}): SecurityPoolsOverviewSectionProps {
	return {
		accountState: createAccountState(),
		checkedSecurityPoolAddress: undefined,
		closeLiquidationModal: () => undefined,
		hasLoadedSecurityPools: true,
		liquidationAmount: '',
		liquidationMaxAmount: undefined,
		liquidationManagerAddress: undefined,
		liquidationModalOpen: false,
		liquidationSecurityPoolAddress: undefined,
		liquidationTargetVault: '',
		loadingPoolOracleManager: false,
		loadingSecurityPools: false,
		onLiquidationAmountChange: () => undefined,
		onLoadPoolOracleManager: () => undefined,
		onLoadSecurityPools: () => undefined,
		onOpenLiquidationModal: () => undefined,
		onQueueLiquidation: () => undefined,
		onSelectSecurityPool: () => undefined,
		poolOracleManagerDetails: undefined,
		repPerEthPrice: undefined,
		repPerEthSource: undefined,
		repPerEthSourceUrl: undefined,
		securityPoolOverviewActiveAction: undefined,
		securityPoolOverviewError: undefined,
		securityPoolOverviewResult: undefined,
		securityPools: [createSecurityPool()],
		...overrides,
	}
}

describe('SecurityPoolsOverviewSection', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('does not render a local liquidation transaction notice', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPoolOverviewResult: {
						action: 'queueLiquidation',
						hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
						securityPoolAddress: zeroAddress,
					},
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('heading', { name: 'Liquidation Submitted' })).toBeNull()
		expect(documentQueries.queryByText('Check State')).toBeNull()
		expect(documentQueries.queryByText('0x1234000000000000000000000000000000000000000000000000000000000000')).toBeNull()
	})

	test('shows Finalized as Yes for resolved operational pools', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPools: [
						createSecurityPool({
							questionOutcome: 'yes',
						}),
					],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const badgeTexts = Array.from(document.body.querySelectorAll('.entity-card .badge')).map(element => element.textContent?.trim() ?? '')
		expect(badgeTexts).toContain('Finalized as Yes')
	})

	test('shows Fork Migration for parent pools with child pools even when the loaded parent outcome is resolved', async () => {
		const parentPool = createSecurityPool({
			hasForkActivity: false,
			marketDetails: createMarketDetails({ title: 'Parent pool' }),
			questionOutcome: 'yes',
			securityPoolAddress: '0x0000000000000000000000000000000000000100',
			universeHasForked: true,
		})
		const childPool = createSecurityPool({
			marketDetails: createMarketDetails({ title: 'Child pool' }),
			parent: parentPool.securityPoolAddress,
			questionOutcome: 'yes',
			securityPoolAddress: '0x0000000000000000000000000000000000000101',
		})
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPools: [parentPool, childPool],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const parentCard = documentQueries.getByRole('heading', { name: 'Parent pool' }).closest('.entity-card')
		if (!(parentCard instanceof HTMLElement)) throw new Error('Expected parent pool card')
		const parentCardQueries = within(parentCard)
		expect(parentCardQueries.getByText('Fork Migration')).not.toBeNull()
		expect(parentCardQueries.queryByText('Finalized as Yes')).toBeNull()
	})

	test('shows Fork Migration for pools already in fork migration flow', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPools: [
						createSecurityPool({
							forkOutcome: 'yes',
							migratedRep: 1n,
							systemState: 'poolForked',
						}),
					],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const badgeTexts = Array.from(document.body.querySelectorAll('.entity-card .badge')).map(element => element.textContent?.trim() ?? '')
		expect(badgeTexts).toContain('Fork Migration')
	})

	test('shows Fork Finalized for child pools with completed fork history', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPools: [
						createSecurityPool({
							forkOutcome: 'yes',
							hasForkActivity: true,
							migratedRep: 1n,
							parent: '0x0000000000000000000000000000000000000100',
							systemState: 'operational',
							truthAuctionAddress: '0x0000000000000000000000000000000000000001',
							truthAuctionStartedAt: 10n,
							universeHasForked: true,
						}),
					],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const badgeTexts = Array.from(document.body.querySelectorAll('.entity-card .badge')).map(element => element.textContent?.trim() ?? '')
		expect(badgeTexts).toContain('Fork Finalized')
	})

	test('shows Fork Migration instead of Operational for root-universe pools after Zoltar has forked', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPools: [
						createSecurityPool({
							hasForkActivity: false,
							marketDetails: createMarketDetails({ title: 'Forked root-universe pool' }),
							questionOutcome: 'none',
							systemState: 'operational',
							universeHasForked: true,
						}),
					],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const poolCard = documentQueries.getByRole('heading', { name: 'Forked root-universe pool' }).closest('.entity-card')
		if (!(poolCard instanceof HTMLElement)) throw new Error('Expected forked root-universe pool card')
		const poolCardQueries = within(poolCard)
		expect(poolCardQueries.getByText('Fork Migration')).not.toBeNull()
		expect(poolCardQueries.queryByText('Operational')).toBeNull()
	})

	test('does not duplicate refresh guidance when the registry is empty', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					hasLoadedSecurityPools: true,
					securityPools: [],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('button', { name: 'Refresh pools' })).not.toBeNull()
		expect(documentQueries.queryByText('Refresh pools to check again.')).toBeNull()
	})

	test('filters the registry by the derived Ended state', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPools: [
						createSecurityPool({
							marketDetails: createMarketDetails({ title: 'Operational pool' }),
							questionOutcome: 'none',
							securityPoolAddress: '0x0000000000000000000000000000000000000001',
						}),
						createSecurityPool({
							marketDetails: createMarketDetails({ title: 'Ended pool' }),
							questionOutcome: 'yes',
							securityPoolAddress: '0x0000000000000000000000000000000000000002',
						}),
					],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const systemStateSelect = documentQueries.getByLabelText('System State')
		if (!(systemStateSelect instanceof window.HTMLSelectElement)) throw new Error('Expected system state filter')
		systemStateSelect.value = 'ended'
		await act(() => {
			systemStateSelect.dispatchEvent(new window.Event('change', { bubbles: true }))
		})

		expect(documentQueries.queryByText('Operational pool')).toBeNull()
		expect(documentQueries.getAllByText('Ended pool').length).toBeGreaterThan(0)
	})

	test('shows a deferred vault placeholder when browse mode has not loaded vault details yet', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPools: [
						createSecurityPool({
							hasLoadedVaults: false,
							marketDetails: createMarketDetails({ title: 'Deferred vault pool' }),
							securityPoolAddress: '0x0000000000000000000000000000000000000200',
							vaultCount: 2n,
							vaults: [],
						}),
					],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const poolCard = documentQueries.getByRole('heading', { name: 'Deferred vault pool' }).closest('.entity-card')
		if (!(poolCard instanceof HTMLElement)) throw new Error('Expected deferred vault pool card')
		const poolCardQueries = within(poolCard)
		expect(poolCardQueries.getByText('Open this pool to load 2 vaults.')).not.toBeNull()
		expect(poolCardQueries.queryByText('No vaults in this pool yet.')).toBeNull()
	})
})

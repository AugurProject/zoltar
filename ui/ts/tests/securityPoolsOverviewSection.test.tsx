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

	test('renders liquidation transaction status outside the section action row', async () => {
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
		expect(documentQueries.getByRole('heading', { name: 'Liquidation Submitted' })).not.toBeNull()
		expect(documentQueries.getByText('Check State')).not.toBeNull()
		expect(documentQueries.getByText('0x1234000000000000000000000000000000000000000000000000000000000000')).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Liquidation Submitted' }).closest('.actions')).toBeNull()
	})

	test('shows Ended for resolved operational pools', async () => {
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
		expect(badgeTexts).toContain('Ended')
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
})

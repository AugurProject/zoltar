/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '@testing-library/dom'
import { h } from 'preact'
import { getAddress, zeroAddress, zeroHash } from 'viem'
import { SecurityPoolSection } from '../components/SecurityPoolSection.js'
import type { AccountState } from '../types/app.js'
import type { MarketDetails } from '../types/contracts.js'
import type { SecurityPoolSectionProps } from '../types/components.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from './testUtils/transactionActionButton.js'

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

function createProps(overrides: Partial<SecurityPoolSectionProps> = {}): SecurityPoolSectionProps {
	return {
		accountState: createAccountState(),
		checkingDuplicateOriginPool: false,
		duplicateOriginPoolExists: false,
		loadingMarketDetails: false,
		marketDetails: createMarketDetails(),
		onCreateSecurityPool: () => undefined,
		onLoadMarket: () => undefined,
		onLoadMarketById: async () => undefined,
		onOpenCreatedPool: () => undefined,
		onResetSecurityPoolCreation: () => undefined,
		onReturnToBrowse: () => undefined,
		onSecurityPoolFormChange: () => undefined,
		poolCreationMarketDetails: undefined,
		repPerEthPrice: undefined,
		repPerEthSource: undefined,
		repPerEthSourceUrl: undefined,
		securityPools: [],
		securityPoolCreating: false,
		securityPoolError: undefined,
		securityPoolForm: {
			currentRetentionRate: '10',
			marketId: '0x01',
			securityMultiplier: '2',
		},
		securityPoolResult: undefined,
		showHeader: false,
		zoltarUniverseHasForked: false,
		...overrides,
	}
}

describe('SecurityPoolSection', () => {
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

	test('disables pool creation when the wallet is disconnected', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				SecurityPoolSection,
				createProps({
					accountState: createAccountState({ address: undefined }),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Create Pool', 'Connect a wallet before creating a security pool.')
	})

	test('disables pool creation for non-binary markets and enables it for valid binary questions', async () => {
		const blockedRender = await renderIntoDocument(
			h(
				SecurityPoolSection,
				createProps({
					marketDetails: createMarketDetails({ marketType: 'categorical' }),
				}),
			),
		)
		cleanupRenderedComponent = blockedRender.cleanup
		expectTransactionButtonDisabled(document.body, 'Create Pool', 'Security pools can only be created for binary markets.')
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined

		const enabledRender = await renderIntoDocument(h(SecurityPoolSection, createProps()))
		cleanupRenderedComponent = enabledRender.cleanup
		expectTransactionButtonEnabled(document.body, 'Create Pool')
	})

	test('renders only the create pool section in create mode', async () => {
		const renderedComponent = await renderIntoDocument(h(SecurityPoolSection, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const headings = Array.from(document.querySelectorAll('h3')).map(heading => heading.textContent?.trim())

		expect(headings).toContain('Create Pool')
		expect(headings).not.toContain('Question Context')
		expect(headings).not.toContain('Requirements')
		expect(headings).not.toContain('Existing Pools')
	})

	test('renders the created pool banner detail with the shared address value component', async () => {
		const poolAddress = getAddress('0x00000000000000000000000000000000000000a1')
		const renderedComponent = await renderIntoDocument(
			h(
				SecurityPoolSection,
				createProps({
					securityPoolResult: {
						deployPoolHash: zeroHash,
						questionId: '0x01',
						securityPoolAddress: poolAddress,
						securityMultiplier: 2n,
						universeId: 1n,
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Security pool created' })).not.toBeNull()
		expect(documentQueries.getAllByRole('button', { name: `Copy address ${poolAddress}` }).length).toBeGreaterThanOrEqual(2)
	})
})

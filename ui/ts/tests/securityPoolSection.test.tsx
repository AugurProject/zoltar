/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, test } from 'bun:test'
import { h } from 'preact'
import { zeroAddress } from 'viem'
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
})

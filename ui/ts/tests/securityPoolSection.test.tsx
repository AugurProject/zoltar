/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from './testUtils/queries'
import { h } from 'preact'
import { getAddress, zeroAddress, zeroHash } from '@zoltar/shared/ethereum'
import { SecurityPoolSection } from '../components/SecurityPoolSection.js'
import { formatOpenInterestFeePerYearPercent, ORIGIN_POOL_INITIAL_RETENTION_RATE } from '../lib/retentionRate.js'
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

	test('keeps pool creation disabled off mainnet without showing a switch-network message', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				SecurityPoolSection,
				createProps({
					accountState: createAccountState({ chainId: '0xaa36a7' }),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Create Pool')
		expect(document.body.textContent?.includes('Switch to Ethereum mainnet')).toBe(false)
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
		expectTransactionButtonDisabled(document.body, 'Create Pool', 'Security pools can only be created for exact binary Yes / No questions.')
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined

		const enabledRender = await renderIntoDocument(h(SecurityPoolSection, createProps()))
		cleanupRenderedComponent = enabledRender.cleanup
		expectTransactionButtonEnabled(document.body, 'Create Pool')
	})

	test('renders only the create pool section in create mode', async () => {
		const renderedComponent = await renderIntoDocument(h(SecurityPoolSection, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const headings = Array.from(document.querySelectorAll('h3')).map(heading => heading.textContent?.trim())

		expect(headings).toContain('Create Pool')
		expect(headings).not.toContain('Question Context')
		expect(headings).not.toContain('Requirements')
		expect(headings).not.toContain('Existing Pools')
		expect(documentQueries.getByText('Initial Open Interest Fee / Year')).not.toBeNull()
		expect(documentQueries.getByText(formatOpenInterestFeePerYearPercent(ORIGIN_POOL_INITIAL_RETENTION_RATE))).not.toBeNull()
		expect(documentQueries.queryByRole('textbox', { name: 'Open Interest Fee / Year (%)' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Before You Deploy' })).toBeNull()
		expect(document.body.textContent?.includes('Pool creation turns a binary question into a collateralized trading surface.')).toBe(false)
		expect(document.body.textContent?.includes('Enter the question, choose how much REP coverage the pool should require, then deploy the pool for vaults, reporting, and trading.')).toBe(false)
	})

	test('keeps the security multiplier field label concise while associating helper text', async () => {
		const renderedComponent = await renderIntoDocument(h(SecurityPoolSection, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const securityMultiplierInput = documentQueries.getByRole('textbox', { name: 'Security Multiplier' })
		expect(securityMultiplierInput.getAttribute('aria-describedby')).toBe('security-pool-security-multiplier-help')
		expect(documentQueries.getByText('Security Multiplier sets the REP collateral target relative to open interest. Higher values require more REP backing and create a thicker safety buffer.')).not.toBeNull()
	})

	test('previews the pasted question before pool creation without a manual load action', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				SecurityPoolSection,
				createProps({
					marketDetails: createMarketDetails({
						description: 'Previewed binary question',
						title: 'Question ready for a pool',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Paste an exact binary Yes / No Zoltar question ID.')).not.toBeNull()
		expect(documentQueries.getByText('Question ready for a pool')).not.toBeNull()
		expect(documentQueries.getByText('Previewed binary question')).not.toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Load Question' })).toBeNull()
	})

	test('omits missing-context helper copy when a loaded question lacks description details', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				SecurityPoolSection,
				createProps({
					marketDetails: createMarketDetails({
						description: '',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('No resolution notes or supporting context provided.')).toBeNull()
		expect(documentQueries.queryByText('Add resolution notes, evidence sources, and edge-case handling before users rely on this question.')).toBeNull()
		expect(documentQueries.queryByText('This question needs more context before users can trust a pool built on top of it. Add resolution notes or recreate it with a stronger description.')).toBeNull()
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
		expect(documentQueries.getByRole('heading', { name: 'Pool Created' })).not.toBeNull()
		expect(document.body.querySelector('.workflow-transaction-status')).toBeNull()
		expect(documentQueries.getByRole('button', { name: `Copy address ${poolAddress}` })).not.toBeNull()
	})

	test('renders loading create labels and reasons while pool duplicate checks run', async () => {
		const duplicateCheckRender = await renderIntoDocument(
			h(
				SecurityPoolSection,
				createProps({
					checkingDuplicateOriginPool: true,
				}),
			),
		)
		cleanupRenderedComponent = duplicateCheckRender.cleanup
		expectTransactionButtonDisabled(document.body, 'Checking Duplicate...', 'Checking whether a pool already exists for this question and security multiplier.')
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined

		const creatingRender = await renderIntoDocument(
			h(
				SecurityPoolSection,
				createProps({
					securityPoolCreating: true,
				}),
			),
		)
		cleanupRenderedComponent = creatingRender.cleanup
		expectTransactionButtonDisabled(document.body, 'Creating Pool...', 'Security pool creation is already in progress.')
	})

	test('renders duplicate and forked branch messaging and button labels', async () => {
		const duplicateRender = await renderIntoDocument(
			h(
				SecurityPoolSection,
				createProps({
					duplicateOriginPoolExists: true,
				}),
			),
		)
		cleanupRenderedComponent = duplicateRender.cleanup
		expectTransactionButtonDisabled(document.body, 'Pool Already Exists', 'A pool for this question and security multiplier already exists.')
		expect(within(document.body).getByText('A pool for this question and security multiplier already exists. Origin pool deployment is deterministic for that pair, so change the security multiplier to create a different pool.')).not.toBeNull()
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined

		const forkedRender = await renderIntoDocument(
			h(
				SecurityPoolSection,
				createProps({
					zoltarUniverseHasForked: true,
				}),
			),
		)
		cleanupRenderedComponent = forkedRender.cleanup
		expectTransactionButtonDisabled(document.body, 'Pool Creation Locked', 'Security pools cannot be created after Zoltar has forked.')
		expect(within(document.body).getByText('Security pools cannot be created after Zoltar has forked.')).not.toBeNull()
	})

	test('wires created pool action buttons to callbacks', async () => {
		const poolAddress = getAddress('0x00000000000000000000000000000000000000a2')
		let openedAddress: string | undefined
		let returnedToBrowse = false
		let resetCount = 0

		const resultPool = {
			deployPoolHash: zeroHash,
			questionId: '0x01',
			securityPoolAddress: poolAddress,
			securityMultiplier: 2n,
			universeId: 1n,
		}

		const renderedComponent = await renderIntoDocument(
			h(
				SecurityPoolSection,
				createProps({
					securityPoolResult: resultPool,
					onOpenCreatedPool: securityPoolAddress => {
						openedAddress = securityPoolAddress
					},
					onReturnToBrowse: () => {
						returnedToBrowse = true
					},
					onResetSecurityPoolCreation: () => {
						resetCount += 1
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		fireEvent.click(documentQueries.getByRole('button', { name: 'Open Pool' }))
		expect(openedAddress).toBe(poolAddress)
		fireEvent.click(documentQueries.getByRole('button', { name: 'Return to Browse' }))
		expect(returnedToBrowse).toBe(true)
		fireEvent.click(documentQueries.getByRole('button', { name: 'Create Another Pool' }))
		expect(resetCount).toBe(1)
	})

	test('uses carried market details when created market does not match loaded market details', async () => {
		const resultPool = {
			deployPoolHash: zeroHash,
			questionId: '0x99',
			securityPoolAddress: getAddress('0x00000000000000000000000000000000000000a3'),
			securityMultiplier: 2n,
			universeId: 1n,
		}

		const renderedComponent = await renderIntoDocument(
			h(
				SecurityPoolSection,
				createProps({
					marketDetails: createMarketDetails({
						questionId: '0x01',
						title: 'Loaded question',
						description: 'Loaded description',
					}),
					poolCreationMarketDetails: createMarketDetails({
						questionId: '0x99',
						title: 'Fallback question',
						description: 'Fallback description',
					}),
					securityPoolResult: resultPool,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Pool Created')).not.toBeNull()
		expect(documentQueries.getByText('Fallback question')).not.toBeNull()
		expect(documentQueries.getByText('Fallback description')).not.toBeNull()
		expect(documentQueries.queryByText('Loaded question')).toBeNull()
	})
})

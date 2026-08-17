/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, waitFor, within } from '@zoltar/ui-core-shared/tests/testUtils/queries'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress, zeroHash } from '@zoltar/shared/ethereum'
import { SecurityPoolSection } from '../../../features/security-pools/components/SecurityPoolSection.js'
import { formatOpenInterestFeePerYearPercent, ORIGIN_POOL_INITIAL_RETENTION_RATE } from '../../../features/security-pools/lib/retentionRate.js'
import type { AccountState } from '@zoltar/ui-zoltar/types/app.js'
import type { MarketDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import type { SecurityPoolSectionProps } from '@zoltar/ui-zoltar/features/types.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'

function createAccountState(overrides: Partial<AccountState> = {}): AccountState {
	return {
		address: zeroAddress,
		chainId: '0x1',
		ethBalanceAttoEth: 0n,
		wethBalanceAttoEth: 0n,
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
		availableQuestionsContextKey: 'environment-1:universe-0',
		availableQuestions: [createMarketDetails(), createMarketDetails({ marketType: 'categorical', questionId: '0x02', title: 'Categorical question' })],
		checkingDuplicateOriginPool: false,
		duplicateOriginPoolExists: false,
		hasLoadedAvailableQuestions: true,
		loadingAvailableQuestions: false,
		loadingMarketDetails: false,
		marketDetails: createMarketDetails(),
		onCreateSecurityPool: () => undefined,
		onLoadAvailableQuestions: async () => undefined,
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
			initialReportPriorityFeeGwei: '10',
			marketId: '0x01',
			statoblastSecurityMultiplierBps: '2',
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

		expectTransactionButtonDisabled(document.body, 'Create pool', 'Connect a wallet before creating a security pool.')
	})

	test('keeps pool creation disabled off mainnet and shows switch-network recovery', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				SecurityPoolSection,
				createProps({
					accountState: createAccountState({ chainId: '0xaa36a7' }),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Create pool')
		expect(document.body.textContent?.includes('Switch to Ethereum mainnet')).toBe(true)
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
		expectTransactionButtonDisabled(document.body, 'Create pool', 'Security pools can only be created for exact binary Yes / No questions.')
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined

		const enabledRender = await renderIntoDocument(h(SecurityPoolSection, createProps()))
		cleanupRenderedComponent = enabledRender.cleanup
		expectTransactionButtonEnabled(document.body, 'Create pool')
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
		expect(documentQueries.getByText('A Security Pool is the tradeable Market for one existing binary Zoltar Question. Select its Question ID here; the Question remains the reusable resolution definition.')).not.toBeNull()
		expect(documentQueries.getByText('Starting Annual Fee')).not.toBeNull()
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
		const statoblastSecurityMultiplierBpsInput = documentQueries.getByRole('textbox', { name: 'Statoblast Security Multiplier' })
		expect(statoblastSecurityMultiplierBpsInput.getAttribute('aria-describedby')).toBe('security-pool-security-multiplier-help')
		expect(documentQueries.getByText('Multiplier target in x, with up to four decimal places; higher values require more REP.')).not.toBeNull()
		const priorityFeeInput = documentQueries.getByRole('textbox', { name: 'Initial Report Priority Fee' })
		expect(priorityFeeInput.getAttribute('aria-describedby')).toBe('security-pool-initial-report-priority-fee-help')
		expect((priorityFeeInput as HTMLInputElement).value).toBe('10')
		expect(documentQueries.getByText('Fixed gas-price premium added to Open Oracle report security. Enter gwei.')).not.toBeNull()
	})

	test('associates invalid priority-fee guidance and disables creation', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				SecurityPoolSection,
				createProps({
					securityPoolForm: {
						initialReportPriorityFeeGwei: '0',
						marketId: '0x01',
						statoblastSecurityMultiplierBps: '2',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const priorityFeeInput = within(document.body).getByRole('textbox', { name: 'Initial Report Priority Fee' })
		expect(priorityFeeInput.getAttribute('aria-invalid')).toBe('true')
		expect(priorityFeeInput.getAttribute('aria-describedby')).toBe('security-pool-initial-report-priority-fee-help security-pool-initial-report-priority-fee-error')
		expect(within(document.body).getByText('Initial-report priority fee must be greater than 0 gwei.')).not.toBeNull()
		expectTransactionButtonDisabled(document.body, 'Create pool', 'Initial-report priority fee must be greater than 0 gwei.')
	})

	test('associates invalid multiplier guidance and disables creation', async () => {
		for (const [value, message] of [
			['', 'Enter a Statoblast security multiplier of at least 1.0002x.'],
			['1', 'Statoblast security multiplier must be at least 1.0002x.'],
			['1.0001', 'Statoblast security multiplier must be at least 1.0002x.'],
			['bad', 'Enter a multiplier in x with at most 4 decimal places.'],
			['2.00001', 'Enter a multiplier in x with at most 4 decimal places.'],
		] as const) {
			const renderedComponent = await renderIntoDocument(
				h(
					SecurityPoolSection,
					createProps({
						securityPoolForm: {
							initialReportPriorityFeeGwei: '10',
							marketId: '0x01',
							statoblastSecurityMultiplierBps: value,
						},
					}),
				),
			)
			cleanupRenderedComponent = renderedComponent.cleanup

			const multiplierInput = within(document.body).getByRole('textbox', { name: 'Statoblast Security Multiplier' })
			expect(multiplierInput.getAttribute('aria-invalid')).toBe('true')
			expect(multiplierInput.getAttribute('aria-describedby')).toBe('security-pool-security-multiplier-help security-pool-security-multiplier-error')
			expect(within(document.body).getByText(message)).not.toBeNull()
			expectTransactionButtonDisabled(document.body, 'Create pool', message)
			const createButton = within(document.body).getByRole('button', { name: 'Create pool' })
			expect(createButton.getAttribute('aria-describedby')).toBe('security-pool-security-multiplier-error')
			expect(document.body.querySelectorAll('.disabled-reason')).toHaveLength(0)
			expect(document.body.textContent?.split(message).length).toBe(2)

			await cleanupRenderedComponent()
			cleanupRenderedComponent = undefined
		}
	})

	test('accepts a Statoblast security multiplier with four decimal places', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				SecurityPoolSection,
				createProps({
					securityPoolForm: {
						initialReportPriorityFeeGwei: '10',
						marketId: '0x01',
						statoblastSecurityMultiplierBps: '2.0001',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const multiplierInput = within(document.body).getByRole('textbox', { name: 'Statoblast Security Multiplier' })
		expect(multiplierInput.getAttribute('aria-invalid')).toBeNull()
		expect(multiplierInput.getAttribute('aria-describedby')).toBe('security-pool-security-multiplier-help')
		expectTransactionButtonEnabled(document.body, 'Create pool')
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
		expect(documentQueries.getByText('Enter an exact binary Yes / No Zoltar question ID when it is not listed above.')).not.toBeNull()
		expect(documentQueries.getByText('Question ready for a pool')).not.toBeNull()
		expect(documentQueries.getByText('Previewed binary question')).not.toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Load Question' })).toBeNull()
		expect(document.body.querySelector('.loaded-question-preview')).not.toBeNull()
		expect(document.body.querySelector('.section-block.surface .record-card:not(.flat)')).toBeNull()
	})

	test('lets users choose an eligible question without copying its identifier', async () => {
		const formChanges: Array<Partial<SecurityPoolSectionProps['securityPoolForm']>> = []
		const renderedComponent = await renderIntoDocument(
			h(
				SecurityPoolSection,
				createProps({
					onSecurityPoolFormChange: update => formChanges.push(update),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const picker = within(document.body).getByRole('combobox', { name: 'Choose an available question' })
		expect(within(picker).getByRole('option', { name: 'Will this resolve?' })).not.toBeNull()
		expect(within(picker).queryByRole('option', { name: 'Categorical question' })).toBeNull()
		fireEvent.change(picker, { target: { value: '0x01' } })
		expect(formChanges).toEqual([{ marketId: '0x01' }])
	})

	test('loads available questions when creation is opened directly', async () => {
		let loadCalls = 0
		const renderedComponent = await renderIntoDocument(
			h(
				SecurityPoolSection,
				createProps({
					availableQuestions: [],
					hasLoadedAvailableQuestions: false,
					onLoadAvailableQuestions: async () => {
						loadCalls += 1
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(loadCalls).toBe(1)
	})

	test('stops after an automatic question-load failure and offers a bounded retry', async () => {
		let loadCalls = 0
		const renderedComponent = await renderIntoDocument(
			h(
				SecurityPoolSection,
				createProps({
					availableQuestions: [],
					hasLoadedAvailableQuestions: false,
					onLoadAvailableQuestions: async () => {
						loadCalls += 1
						if (loadCalls === 1) throw new Error('Question read failed')
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => expect(documentQueries.getByText('Available questions could not be loaded. Retry, or enter an exact question ID below.')).not.toBeNull())
		expect(loadCalls).toBe(1)
		fireEvent.click(documentQueries.getByRole('button', { name: 'Retry questions' }))
		await waitFor(() => expect(loadCalls).toBe(2))
		expect(documentQueries.queryByRole('button', { name: 'Retry questions' })).toBeNull()
	})

	test('starts one fresh question load when context changes during an in-flight request', async () => {
		let resolveFirstLoad: (() => void) | undefined
		let loadCalls = 0
		const onLoadAvailableQuestions = async () => {
			loadCalls += 1
			if (loadCalls === 1)
				await new Promise<void>(resolve => {
					resolveFirstLoad = resolve
				})
		}
		const initialProps = createProps({
			availableQuestions: [],
			hasLoadedAvailableQuestions: false,
			onLoadAvailableQuestions,
		})
		const renderedComponent = await renderIntoDocument(h(SecurityPoolSection, initialProps))
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(loadCalls).toBe(1)

		await act(() => {
			render(h(SecurityPoolSection, { ...initialProps, availableQuestionsContextKey: 'environment-2:universe-1', loadingAvailableQuestions: true }), renderedComponent.container)
		})
		resolveFirstLoad?.()
		await act(async () => await Promise.resolve())
		await act(() => {
			render(h(SecurityPoolSection, { ...initialProps, availableQuestionsContextKey: 'environment-2:universe-1' }), renderedComponent.container)
		})

		await waitFor(() => expect(loadCalls).toBe(2))
	})

	test('uses loading-aware create guidance while available questions are loading', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				SecurityPoolSection,
				createProps({
					availableQuestions: [],
					hasLoadedAvailableQuestions: false,
					loadingAvailableQuestions: true,
					marketDetails: undefined,
					securityPoolForm: {
						initialReportPriorityFeeGwei: '10',
						marketId: '',
						statoblastSecurityMultiplierBps: '2',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Create pool', 'Wait for available questions to finish loading, or enter an exact question ID.')
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
						initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
						questionId: '0x01',
						securityPoolAddress: poolAddress,
						statoblastSecurityMultiplierBps: 20_000n,
						universeId: 1n,
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Pool Created' })).not.toBeNull()
		expect(document.body.querySelector('.workflow-transaction-status')).toBeNull()
		expect(document.body.querySelector('.section-block.surface .entity-card.flat')).not.toBeNull()
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
		expectTransactionButtonDisabled(document.body, 'Checking duplicate…', 'Checking whether a pool already exists for this question, Statoblast security multiplier, and priority fee.')
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
		expectTransactionButtonDisabled(document.body, 'Creating pool…', 'Security pool creation is already in progress.')
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
		expectTransactionButtonDisabled(document.body, 'Pool Already Exists', 'A pool for this question, Statoblast security multiplier, and priority fee already exists.')
		expect(within(document.body).getByText('Change the priority fee or Statoblast security multiplier to create a different origin pool.')).not.toBeNull()
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
		expectTransactionButtonDisabled(document.body, 'Pool Creation Locked', 'Security pools cannot be created after this universe has forked.')
		expect(within(document.body).getByText('Security pools cannot be created after this universe has forked.')).not.toBeNull()
	})

	test('wires created pool action buttons to callbacks', async () => {
		const poolAddress = getAddress('0x00000000000000000000000000000000000000a2')
		let openedAddress: string | undefined
		let returnedToBrowse = false
		let resetCount = 0

		const resultPool = {
			deployPoolHash: zeroHash,
			initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
			questionId: '0x01',
			securityPoolAddress: poolAddress,
			statoblastSecurityMultiplierBps: 20_000n,
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
		fireEvent.click(documentQueries.getByRole('button', { name: /^Open pool:/ }))
		expect(openedAddress).toBe(poolAddress)
		fireEvent.click(documentQueries.getByRole('button', { name: 'Return to browse' }))
		expect(returnedToBrowse).toBe(true)
		fireEvent.click(documentQueries.getByRole('button', { name: 'Create another pool' }))
		expect(resetCount).toBe(1)
	})

	test('uses carried market details when created market does not match loaded market details', async () => {
		const resultPool = {
			deployPoolHash: zeroHash,
			initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
			questionId: '0x99',
			securityPoolAddress: getAddress('0x00000000000000000000000000000000000000a3'),
			statoblastSecurityMultiplierBps: 20_000n,
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

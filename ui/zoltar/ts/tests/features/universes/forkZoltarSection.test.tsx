/// <reference types="bun-types" />

import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { formatRelativeTimestamp, formatTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { getTransactionButtonState } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import type { MarketDetails, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { ChainTimestampContext } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import { ForkZoltarSection } from '@zoltar/ui-zoltar-shared/features/universes/components/ForkZoltarSection.js'
import { describe, expect, mock, test } from 'bun:test'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { createUniverseSummary } from '@zoltar/ui-core-shared/tests/testUtils/universeFixtures.js'

const ATTO_REP = 10n ** 18n
const ZOLTAR_ADDRESS = '0x00000000000000000000000000000000000000a1' as const

function createQuestion(): MarketDetails {
	return {
		answerUnit: '',
		createdAt: 1n,
		description: 'Fork question',
		displayValueMax: 2n,
		displayValueMin: 0n,
		endTime: 2n,
		exists: true,
		marketType: 'binary',
		numTicks: 2n,
		outcomeLabels: ['Yes', 'No'],
		questionId: '0x01',
		startTime: 1n,
		title: 'Fork question title',
	}
}

function createUniverse(overrides: Partial<ZoltarUniverseSummary> = {}): ZoltarUniverseSummary {
	return createUniverseSummary({
		forkThresholdAttoRep: 100n,
		totalTheoreticalSupplyAttoRep: 1000n,
		...overrides,
	})
}

type ForkZoltarSectionProps = Parameters<typeof ForkZoltarSection>[0]

/** A ready, approved, funded fork of question 0x01 at a chain time after it ended. */
function createProps(overrides: Partial<ForkZoltarSectionProps> = {}): ForkZoltarSectionProps {
	return {
		accountAddress: zeroAddress,
		currentTimestamp: 2n,
		hasLoadedZoltarQuestions: true,
		isOnActiveAppChain: true,
		loadingZoltarForkAccess: false,
		loadingZoltarQuestions: false,
		onApproveZoltarForkRep: () => undefined,
		onForkZoltar: () => undefined,
		onZoltarForkQuestionIdChange: () => undefined,
		zoltarForkActiveAction: undefined,
		zoltarForkApproval: { error: undefined, loading: false, value: 100n * ATTO_REP },
		zoltarForkError: undefined,
		zoltarForkPending: false,
		zoltarForkQuestionId: '0x01',
		zoltarForkRepBalanceAttoRep: 1000n * ATTO_REP,
		zoltarQuestions: [createQuestion()],
		zoltarUniverse: createUniverse({ forkBurnDivisor: 5n, forkThresholdAttoRep: 100n * ATTO_REP, zoltarAddress: ZOLTAR_ADDRESS }),
		zoltarUniverseState: 'ready',
		...overrides,
	}
}

function findApproveButton(container: HTMLElement) {
	const approveButton = within(container)
		.getAllByRole('button')
		.find(button => button.textContent?.startsWith('Approve ') === true)
	if (approveButton === undefined) throw new Error('Expected approval button')
	return approveButton
}

const isForkButtonDisabled = () => within(document.body).getByRole('button', { name: 'Fork universe' }).hasAttribute('disabled')
const FORK_CONFIRMATION = /^I understand forking permanently burns .*REP and cannot be undone\.$/
const confirmFork = () => fireEvent.click(within(document.body).getByRole('checkbox', { name: FORK_CONFIRMATION }))
function isForkConfirmed() {
	const confirmation = within(document.body).getByRole('checkbox', { name: FORK_CONFIRMATION })
	if (!(confirmation instanceof HTMLInputElement)) throw new Error('Expected the fork acknowledgment checkbox')
	return confirmation.checked
}

describe('ForkZoltarSection', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	async function renderSection(props: ForkZoltarSectionProps) {
		const rendered = await renderIntoDocument(<ForkZoltarSection {...props} />)
		cleanupRenderedComponent = rendered.cleanup
		return rendered
	}

	for (const phase of ['idle', 'loading', 'failed'] as const)
		test(`distinguishes an unknown REP balance from insufficient REP (${phase})`, async () => {
			const retry = mock(() => undefined)
			const props = createProps({
				currentTimestamp: 3n,
				loadingZoltarForkAccess: phase === 'loading',
				hasLoadedZoltarForkAccess: phase === 'failed',
				onRetryZoltarForkAccess: retry,
				zoltarForkApproval: { error: undefined, loading: false, value: 100n },
				zoltarForkRepBalanceAttoRep: undefined,
				zoltarUniverse: createUniverse({ forkBurnDivisor: 5n, zoltarAddress: ZOLTAR_ADDRESS }),
			})
			const rendered = await renderSection(props)
			expect(document.body.textContent).not.toContain('Insufficient REP')
			expect(document.body.textContent).toContain('Wallet REP')
			if (phase !== 'failed') {
				expect(document.body.textContent).toContain('Loading REP balance')
				expect(document.querySelector('[role="alert"]')).toBeNull()
				expect(within(document.body).queryByRole('button', { name: 'Retry' })).toBeNull()
			} else {
				expect(document.querySelector('[role="alert"]')?.textContent).toContain('REP balance')
				fireEvent.click(within(document.body).getByRole('button', { name: 'Retry' }))
				expect(retry).toHaveBeenCalledTimes(1)
				expect(document.body.textContent?.split('Your REP balance could not be loaded.').length).toBe(2)
				render(<ForkZoltarSection {...props} loadingZoltarForkAccess={true} />, rendered.container)
				expect(document.querySelector('[role="alert"]')).toBeNull()
				render(<ForkZoltarSection {...props} zoltarForkRepBalanceAttoRep={0n} />, rendered.container)
				expect(document.querySelector('[role="alert"]')).toBeNull()
				expect(document.body.textContent).toContain('Insufficient REP')
				render(<ForkZoltarSection {...props} zoltarForkRepBalanceAttoRep={100n} zoltarForkApproval={{ error: undefined, loading: false, value: 0n }} />, rendered.container)
				expect(
					within(document.body)
						.getByRole('button', { name: /Approve/ })
						.hasAttribute('disabled'),
				).toBe(false)
				expect(isForkButtonDisabled()).toBe(true)
				render(<ForkZoltarSection {...props} zoltarForkRepBalanceAttoRep={100n} />, rendered.container)
				expect(getTransactionButtonState(document.body, 'Fork universe').reason).toBe('Confirm that forking is permanent to continue.')
				confirmFork()
				expect(isForkButtonDisabled()).toBe(false)
			}
		})

	test('keeps REP approval disabled off Sepolia and explains recovery', async () => {
		await renderSection(createProps({ isOnActiveAppChain: false, zoltarForkApproval: { error: undefined, loading: false, value: 0n }, zoltarForkRepBalanceAttoRep: 1000n, zoltarUniverse: createUniverse() }))

		expect(findApproveButton(document.body).hasAttribute('disabled')).toBe(true)
		expect(document.body.textContent?.match(/Switch to Sepolia/g)?.length).toBe(1)
		expect(document.body.querySelectorAll('.tx-action-group .tx-action-notice').length).toBe(1)
	})

	test('describes automatically loading fork data without asking for a manual refresh', async () => {
		await renderSection(
			createProps({
				currentTimestamp: undefined,
				hasLoadedZoltarQuestions: false,
				loadingZoltarForkAccess: true,
				zoltarForkApproval: { error: undefined, loading: false, value: undefined },
				zoltarForkQuestionId: '',
				zoltarForkRepBalanceAttoRep: undefined,
				zoltarQuestions: [],
				zoltarUniverse: undefined,
				zoltarUniverseState: 'loading',
			}),
		)

		expect(isForkButtonDisabled()).toBe(true)
		expect(document.body.textContent).toContain('Loading universe details…')
		expect(document.body.textContent).not.toContain('Refresh universe data')
	})

	test('requires a valid fork question before REP approval', async () => {
		const unapprovedProps = (zoltarForkQuestionId: string) => createProps({ zoltarForkApproval: { error: undefined, loading: false, value: 0n }, zoltarForkQuestionId, zoltarForkRepBalanceAttoRep: 1000n, zoltarUniverse: createUniverse() })

		for (const questionId of ['', '0x02']) {
			const renderedComponent = await renderIntoDocument(h(ForkZoltarSection, unapprovedProps(questionId)))
			expect(findApproveButton(renderedComponent.container).hasAttribute('disabled')).toBe(true)
			expect(renderedComponent.container.textContent).toContain('Select a valid fork question to continue.')
			await renderedComponent.cleanup()
		}

		const renderedComponent = await renderSection(unapprovedProps('0x01'))
		expect(findApproveButton(renderedComponent.container).hasAttribute('disabled')).toBe(false)
	})

	test('shows only the required and permanently burned REP amounts before submission', async () => {
		await renderSection(createProps())

		expect(document.body.textContent).toContain('Fork threshold100.00 REP')
		expect(document.body.textContent).toContain('Permanent REP burn20.00 REP')
		expect(document.body.textContent).not.toContain('Migration Custody Credit')
		expect(document.body.textContent).not.toContain('Resulting REP Balance')
		expect(document.body.textContent).not.toContain('Technical Details')
		expect(document.body.textContent).not.toContain('Protocol feeNone')
	})

	for (const questionId of ['0x01', `0x${'a'.repeat(63)}`, '0x1a'])
		test(`allows direct fork submission after resolving ${questionId}`, async () => {
			const onForkZoltar = mock(() => undefined)
			const props = createProps({ onForkZoltar, zoltarForkQuestionId: questionId, zoltarQuestions: [{ ...createQuestion(), questionId }] })
			const renderedComponent = await renderSection({ ...props, hasLoadedZoltarQuestions: false, loadingZoltarQuestion: true, zoltarQuestions: [] })

			expect(document.body.textContent).toContain('Loading…')
			expect(isForkButtonDisabled()).toBe(true)
			render(<ForkZoltarSection {...props} />, renderedComponent.container)
			expect(document.body.textContent).not.toContain('Loading…')
			expect(document.body.textContent).toContain('Fork question title')
			const questionInput = within(document.body).getByRole('textbox', { name: 'Fork question ID' })
			if (!(questionInput instanceof HTMLInputElement)) throw new Error('Expected the question ID field')
			expect(questionInput.value).toBe(questionId)
			expect(document.querySelector('.question-summary .identifier-value')).toBeNull()
			confirmFork()
			const forkButton = within(document.body).getByRole('button', { name: 'Fork universe' })
			expect(forkButton.hasAttribute('disabled')).toBe(false)
			fireEvent.click(forkButton)
			expect(onForkZoltar).toHaveBeenCalledTimes(1)
		})

	test('child REP forks without requesting token approval', async () => {
		await renderSection(
			createProps({
				zoltarForkApproval: { error: undefined, loading: false, value: 0n },
				zoltarForkRepBalanceAttoRep: 1000n,
				zoltarUniverse: createUniverse({ forkBurnDivisor: 5n, reputationTokenKind: 'child', reputationTokenSymbol: 'REP7', zoltarAddress: ZOLTAR_ADDRESS }),
			}),
		)
		expect(within(document.body).queryByRole('button', { name: /Approve/ })).toBeNull()
		confirmFork()
		expect(isForkButtonDisabled()).toBe(false)
	})

	test('asks again for the burn acknowledgment when the selected fork question changes', async () => {
		const questionProps = (zoltarForkQuestionId: string) =>
			createProps({
				zoltarForkQuestionId,
				zoltarQuestions: [
					createQuestion(),
					{
						...createQuestion(),
						questionId: '0x02',
						title: 'Second fork question title',
					},
				],
			})
		const renderedComponent = await renderSection(questionProps('0x01'))
		const componentQueries = within(renderedComponent.container)
		confirmFork()
		expect(componentQueries.getByRole('button', { name: 'Fork universe' }).hasAttribute('disabled')).toBe(false)

		render(h(ForkZoltarSection, questionProps('0x02')), renderedComponent.container)

		// The acknowledgment named the previous question, so the new one is unconfirmed until it is checked again.
		expect(isForkConfirmed()).toBe(false)
		expect(componentQueries.getByRole('button', { name: 'Fork universe' }).hasAttribute('disabled')).toBe(true)
		confirmFork()
		expect(componentQueries.getByRole('button', { name: 'Fork universe' }).hasAttribute('disabled')).toBe(false)
	})

	test('gives direct recovery when the fork question ID is missing', async () => {
		await renderSection(
			createProps({
				currentTimestamp: undefined,
				zoltarForkApproval: { error: undefined, loading: false, value: 0n },
				zoltarForkQuestionId: '0x02',
				zoltarQuestionLookupId: '0x2',
				zoltarForkRepBalanceAttoRep: 1000n,
				zoltarUniverse: createUniverse(),
			}),
		)

		const questionIdInput = within(document.body).getByLabelText('Fork question ID')
		const questionError = document.getElementById('fork-zoltar-question-state')
		if (questionError === null) throw new Error('Expected question ID error notice')
		expect(questionError.textContent).toContain('No question matches this ID. Try another question ID.')
		expect(questionIdInput.getAttribute('aria-invalid')).toBe('true')
		expect(questionIdInput.getAttribute('aria-describedby')).toBe(questionError.id)
		expect(document.body.textContent?.includes('Refresh questions')).toBe(false)
	})

	test('blocks the irreversible fork until the selected question has ended', async () => {
		const onForkZoltar = mock(() => undefined)
		await renderSection(createProps({ currentTimestamp: 1n, onForkZoltar }))

		const forkButton = within(document.body).getByRole('button', { name: 'Fork universe' })
		expect(forkButton.hasAttribute('disabled')).toBe(true)
		expect(getTransactionButtonState(document.body, 'Fork universe').reason).toContain('The selected question must end before the universe can fork.')
		fireEvent.click(forkButton)
		expect(onForkZoltar).not.toHaveBeenCalled()
	})

	test('uses live chain-time updates through the exact fork-question end boundary', async () => {
		const onForkZoltar = mock(() => undefined)
		const props = createProps({ currentTimestamp: undefined, onForkZoltar })
		const atChainTime = (chainTimestamp: bigint | undefined) => (
			<ChainTimestampContext.Provider value={chainTimestamp}>
				<ForkZoltarSection {...props} />
			</ChainTimestampContext.Provider>
		)
		const renderedComponent = await renderIntoDocument(atChainTime(undefined))
		cleanupRenderedComponent = renderedComponent.cleanup
		confirmFork()

		expect(isForkButtonDisabled()).toBe(true)
		expect(getTransactionButtonState(document.body, 'Fork universe').reason).toBe('Loading chain time…')

		render(atChainTime(1n), renderedComponent.container)
		const expectedActiveReason = `The selected question must end before the universe can fork. It ends ${formatTimestamp(2n)} (${formatRelativeTimestamp(2n, 1n)}).`
		expect(isForkButtonDisabled()).toBe(true)
		expect(getTransactionButtonState(document.body, 'Fork universe').reason).toBe(expectedActiveReason)

		render(atChainTime(2n), renderedComponent.container)
		expect(isForkButtonDisabled()).toBe(false)

		render(atChainTime(3n), renderedComponent.container)
		const forkButton = within(document.body).getByRole('button', { name: 'Fork universe' })
		expect(forkButton.hasAttribute('disabled')).toBe(false)
		fireEvent.click(forkButton)
		expect(onForkZoltar).toHaveBeenCalledTimes(1)
	})

	test('blocks approving REP for a fork whose question has not ended, with the same reason as the fork', async () => {
		const onApproveZoltarForkRep = mock(() => undefined)
		await renderSection(createProps({ currentTimestamp: 1n, onApproveZoltarForkRep, zoltarForkApproval: { error: undefined, loading: false, value: 0n } }))

		const activeReason = `The selected question must end before the universe can fork. It ends ${formatTimestamp(2n)} (${formatRelativeTimestamp(2n, 1n)}).`
		const approveButton = findApproveButton(document.body)
		expect(approveButton.hasAttribute('disabled')).toBe(true)
		fireEvent.click(approveButton)
		expect(onApproveZoltarForkRep).not.toHaveBeenCalled()
		expect(getTransactionButtonState(document.body, 'Fork universe').reason).toBe(activeReason)
		// The group names the real blocker instead of asking for an approval that cannot be used yet.
		expect(document.querySelector('.tx-action-group .tx-action-notice')?.textContent).toBe(activeReason)
		expect(document.body.textContent).not.toContain('more REP approved')
	})

	test('keeps the question-timing blocker when the approval amount is also invalid', async () => {
		await renderSection(createProps({ currentTimestamp: 1n, zoltarForkApproval: { error: undefined, loading: false, value: 0n } }))
		const amountInput = document.querySelector<HTMLInputElement>('.approval-amount-field input')
		if (amountInput === null) throw new Error('Approval amount field is missing')
		await act(() => {
			amountInput.value = '-1'
			fireEvent.input(amountInput)
		})

		const notice = document.querySelector('.tx-action-group .tx-action-notice')?.textContent ?? ''
		expect(notice).toContain('The selected question must end before the universe can fork.')
		expect(notice).toContain('Enter a valid non-negative amount.')
		expect(getTransactionButtonState(document.body, 'Fork universe').reason).toContain('The selected question must end before the universe can fork.')
	})

	test('sends the irreversible fork only after its permanent burn is acknowledged', async () => {
		const onForkZoltar = mock(() => undefined)
		await renderSection(createProps({ onForkZoltar }))

		const confirmation = within(document.body).getByRole('checkbox', { name: /^I understand forking permanently burns 20\.00\sREP and cannot be undone\.$/ })
		expect(isForkButtonDisabled()).toBe(true)
		expect(getTransactionButtonState(document.body, 'Fork universe').reason).toBe('Confirm that forking is permanent to continue.')
		fireEvent.click(within(document.body).getByRole('button', { name: 'Fork universe' }))
		expect(onForkZoltar).not.toHaveBeenCalled()

		fireEvent.click(confirmation)
		expect(isForkButtonDisabled()).toBe(false)
		fireEvent.click(within(document.body).getByRole('button', { name: 'Fork universe' }))
		expect(onForkZoltar).toHaveBeenCalledTimes(1)

		fireEvent.click(confirmation)
		expect(isForkButtonDisabled()).toBe(true)
	})
})

/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from './testUtils/queries'
import { act } from 'preact/test-utils'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { ScalarDeploymentSection } from '../components/ScalarDeploymentSection.js'
import { getScalarOutcomeIndex } from '../lib/scalarOutcome.js'
import type { MarketDetails, ZoltarChildUniverseSummary } from '../types/contracts.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from './testUtils/transactionActionButton.js'

function createQuestionDetails(overrides: Partial<MarketDetails> = {}): MarketDetails {
	return {
		answerUnit: 'USD',
		createdAt: 1n,
		description: 'Scalar security prompt',
		displayValueMax: 100n,
		displayValueMin: 0n,
		endTime: 2000n,
		exists: true,
		marketType: 'scalar',
		numTicks: 10n,
		outcomeLabels: ['Invalid'],
		questionId: '0xscalar-question',
		startTime: 1000n,
		title: 'Will ETH hit $1000?',
		...overrides,
	}
}

function createChildUniverse(overrides: Partial<ZoltarChildUniverseSummary> = {}): ZoltarChildUniverseSummary {
	return {
		exists: false,
		forkTime: 0n,
		outcomeIndex: 0n,
		outcomeLabel: 'Below $50',
		parentUniverseId: 0n,
		reputationToken: zeroAddress,
		universeId: 1n,
		...overrides,
	}
}

describe('ScalarDeploymentSection', () => {
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

	test('renders loading placeholder until question details are available', async () => {
		const renderedComponent = await renderIntoDocument(
			<ScalarDeploymentSection
				accountAddress={undefined}
				childUniverses={[]}
				hasForked={false}
				isMainnet={false}
				onCreateChildUniverseForOutcomeIndex={() => {
					throw new Error('Unexpected deployment request without question details')
				}}
				questionDetails={undefined}
				zoltarChildUniverseError={undefined}
				zoltarChildUniversePendingOutcomeIndex={undefined}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Loading scalar range…')).not.toBeNull()
	})

	test('clamps selected ticks before confirming child universe deployment', async () => {
		let createOutcome: bigint | undefined
		const question = createQuestionDetails()
		const renderedComponent = await renderIntoDocument(
			<ScalarDeploymentSection
				accountAddress={zeroAddress}
				childUniverses={[]}
				hasForked={true}
				isMainnet={true}
				onCreateChildUniverseForOutcomeIndex={outcomeIndex => {
					createOutcome = outcomeIndex
				}}
				questionDetails={question}
				zoltarChildUniverseError={undefined}
				zoltarChildUniversePendingOutcomeIndex={undefined}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		expect(documentQueries.getByText('No deployed child universes.')).not.toBeNull()
		expectTransactionButtonEnabled(document.body, 'Create child universe')

		const slider = documentQueries.getByRole('slider') as HTMLInputElement
		await act(() => {
			fireEvent.input(slider, { target: { value: '20' } })
		})
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Create child universe' }))
		})
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Deploy Universe' }))
		})
		expect(createOutcome).toBe(getScalarOutcomeIndex(question, 10n))
	})

	test('blocks deployment when fork prerequisites are not met', async () => {
		const renderedComponent = await renderIntoDocument(
			<ScalarDeploymentSection
				accountAddress={zeroAddress}
				childUniverses={[]}
				hasForked={false}
				isMainnet={true}
				onCreateChildUniverseForOutcomeIndex={() => {
					throw new Error('Unexpected deployment request before fork')
				}}
				questionDetails={createQuestionDetails()}
				zoltarChildUniverseError={undefined}
				zoltarChildUniversePendingOutcomeIndex={undefined}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		expectTransactionButtonDisabled(document.body, 'Create child universe', 'Child universes are unavailable because this universe has not forked.')
		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Create child universe' }))
		})
	})

	test('shows deployed state when an existing child outcome is selected', async () => {
		const question = createQuestionDetails()
		const deployedOutcome = getScalarOutcomeIndex(question, 0n)
		const renderedComponent = await renderIntoDocument(
			<ScalarDeploymentSection
				accountAddress={zeroAddress}
				childUniverses={[createChildUniverse({ outcomeIndex: deployedOutcome, outcomeLabel: 'Below $50', exists: true })]}
				hasForked={true}
				isMainnet={true}
				onCreateChildUniverseForOutcomeIndex={() => {
					throw new Error('Should not deploy an already deployed outcome')
				}}
				questionDetails={question}
				zoltarChildUniverseError={undefined}
				zoltarChildUniversePendingOutcomeIndex={undefined}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		expectTransactionButtonDisabled(document.body, 'Deployed', 'Child universe already deployed.')
		expect(within(document.body).queryByRole('button', { name: 'Deployed' })).not.toBeNull()
	})
})

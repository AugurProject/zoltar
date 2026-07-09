/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { h } from 'preact'
import { within } from './testUtils/queries'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { ForkZoltarSection } from '../components/ForkZoltarSection.js'
import type { MarketDetails, ZoltarUniverseSummary } from '../types/contracts.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

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
	return {
		childUniverses: [],
		forkThreshold: 100n,
		forkQuestionDetails: undefined,
		forkTime: 0n,
		forkingOutcomeIndex: 0n,
		hasForked: false,
		parentUniverseId: 0n,
		reputationToken: zeroAddress,
		totalTheoreticalSupply: 1000n,
		universeId: 1n,
		...overrides,
	}
}

describe('ForkZoltarSection', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		restoreDomEnvironment = installDomEnvironment().cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('keeps REP approval silently disabled off mainnet', async () => {
		const renderedComponent = await renderIntoDocument(
			h(ForkZoltarSection, {
				accountAddress: zeroAddress,
				hasLoadedZoltarQuestions: true,
				isMainnet: false,
				loadingZoltarForkAccess: false,
				loadingZoltarQuestions: false,
				onApproveZoltarForkRep: () => undefined,
				onForkZoltar: () => undefined,
				onZoltarForkQuestionIdChange: () => undefined,
				zoltarForkActiveAction: undefined,
				zoltarForkApproval: {
					error: undefined,
					loading: false,
					value: 0n,
				},
				zoltarForkError: undefined,
				zoltarForkPending: false,
				zoltarForkQuestionId: '0x01',
				zoltarForkRepBalance: 1000n,
				zoltarQuestions: [createQuestion()],
				zoltarUniverse: createUniverse(),
				zoltarUniverseState: 'ready',
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const approveButton = within(document.body)
			.getAllByRole('button')
			.find(button => button.textContent?.startsWith('Approve ') === true)
		if (approveButton === undefined) throw new Error('Expected approval button')
		expect(approveButton.hasAttribute('disabled')).toBe(true)
		expect(document.body.textContent?.includes('Switch to Ethereum mainnet')).toBe(false)
	})
})

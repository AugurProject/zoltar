/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '@testing-library/dom'
import { h } from 'preact'
import { zeroAddress } from 'viem'
import { OpenOracleSection } from '../components/OpenOracleSection.js'
import { getDefaultOpenOracleCreateFormState, getDefaultOpenOracleFormState } from '../lib/marketForm.js'
import type { AccountState } from '../types/app.js'
import type { OpenOracleSectionProps } from '../types/components.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

function createAccountState(overrides: Partial<AccountState> = {}): AccountState {
	return {
		address: zeroAddress,
		chainId: '0x1',
		ethBalance: 0n,
		wethBalance: 0n,
		...overrides,
	}
}

function createOpenOracleSectionProps(overrides: Partial<OpenOracleSectionProps> = {}): OpenOracleSectionProps {
	return {
		accountState: createAccountState(),
		initialView: 'create',
		loadingOpenOracleCreate: false,
		loadingOracleReport: false,
		onApproveToken1: () => undefined,
		onApproveToken2: () => undefined,
		onCreateOpenOracleGame: () => undefined,
		onDisputeReport: () => undefined,
		onLoadOracleReport: () => undefined,
		onOpenOracleCreateFormChange: () => undefined,
		onOpenOracleFormChange: () => undefined,
		onRefreshPrice: () => undefined,
		onSettleReport: () => undefined,
		onSubmitInitialReport: () => undefined,
		onWrapWethForInitialReport: () => undefined,
		openOracleActiveAction: undefined,
		openOracleCreateForm: getDefaultOpenOracleCreateFormState(),
		openOracleError: undefined,
		openOracleForm: getDefaultOpenOracleFormState(),
		openOracleInitialReportState: {
			defaultPrice: undefined,
			defaultPriceError: undefined,
			defaultPriceSource: undefined,
			defaultPriceSourceUrl: undefined,
			ethBalance: undefined,
			ethBalanceError: undefined,
			quoteAttemptedSources: undefined,
			quoteFailureKind: undefined,
			quoteFailureReason: undefined,
			quoteLoading: false,
			token1Approval: { error: undefined, loading: false, value: 0n },
			token1Balance: undefined,
			token1BalanceError: undefined,
			token1Decimals: undefined,
			token2Approval: { error: undefined, loading: false, value: 0n },
			token2Balance: undefined,
			token2BalanceError: undefined,
			token2Decimals: undefined,
			tokenAccessLoadingInitial: false,
			tokenAccessRefreshing: false,
		},
		openOracleReportDetails: undefined,
		openOracleResult: undefined,
		...overrides,
	}
}

describe('OpenOracleSection route create view', () => {
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

	test('renders requirements and create-success handoff actions in create view', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					openOracleResult: {
						action: 'createReportInstance',
						hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Resolve these checks before creating a new Open Oracle game.')).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Return to Browse' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Create Another' })).not.toBeNull()
	})
})

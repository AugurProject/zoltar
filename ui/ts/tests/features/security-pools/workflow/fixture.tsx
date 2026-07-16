/// <reference types="bun-types" />

import { fireEvent, waitFor, within } from '../../../testUtils/queries'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress } from '@zoltar/shared/ethereum'
import { pickFixtureProperties } from '@zoltar/shared/testing/pickFixtureProperties'
import { SecurityPoolWorkflowSection } from '../../../../features/security-pools/components/SecurityPoolWorkflowSection.js'
import { ChainTimestampContext } from '../../../../lib/chainTimestamp.js'
import { getReportingLockedUntilMessage } from '../../../../features/reporting/lib/reporting.js'
import { renderIntoDocument } from '../../../testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from '../../../testUtils/transactionActionButton.js'
import {
	createAccountState,
	createForkAuctionDetails,
	createForkAuctionProps,
	createMarketDetails,
	createOracleManagerDetails,
	createReportingProps,
	createSecurityPoolVaultSummary,
	createSecurityPoolWorkflowProps,
	createSecurityVaultDetails,
	createSecurityVaultProps,
	createSelectedPool,
	createTradingProps,
} from './builders.js'
export { useSecurityPoolWorkflowSectionTestDom } from './testDom.js'

function createSecurityPoolWorkflowSectionFixture() {
	return {
		fireEvent,
		waitFor,
		within,
		render,
		act,
		getAddress,
		zeroAddress,
		SecurityPoolWorkflowSection,
		ChainTimestampContext,
		getReportingLockedUntilMessage,
		renderIntoDocument,
		expectTransactionButtonDisabled,
		expectTransactionButtonEnabled,
		createAccountState,
		createTradingProps,
		createReportingProps,
		createSecurityVaultProps,
		createSecurityVaultDetails,
		createOracleManagerDetails,
		createSecurityPoolVaultSummary,
		createForkAuctionProps,
		createForkAuctionDetails,
		createMarketDetails,
		createSelectedPool,
		createSecurityPoolWorkflowProps,
	}
}

export function createForkWorkflowStateFixture() {
	const fixture = createSecurityPoolWorkflowSectionFixture()
	return pickFixtureProperties(fixture, [
		'fireEvent',
		'waitFor',
		'within',
		'render',
		'act',
		'getAddress',
		'zeroAddress',
		'SecurityPoolWorkflowSection',
		'ChainTimestampContext',
		'renderIntoDocument',
		'expectTransactionButtonEnabled',
		'createReportingProps',
		'createForkAuctionProps',
		'createForkAuctionDetails',
		'createMarketDetails',
		'createSelectedPool',
		'createSecurityPoolWorkflowProps',
	] as const)
}

export function createRefreshAutoloadFixture() {
	const fixture = createSecurityPoolWorkflowSectionFixture()
	return pickFixtureProperties(fixture, [
		'render',
		'act',
		'getAddress',
		'zeroAddress',
		'SecurityPoolWorkflowSection',
		'ChainTimestampContext',
		'renderIntoDocument',
		'createAccountState',
		'createReportingProps',
		'createSecurityVaultProps',
		'createSecurityVaultDetails',
		'createForkAuctionProps',
		'createMarketDetails',
		'createSelectedPool',
		'createSecurityPoolWorkflowProps',
	] as const)
}

export function createReportingAndOracleFixture() {
	const fixture = createSecurityPoolWorkflowSectionFixture()
	return pickFixtureProperties(fixture, [
		'fireEvent',
		'within',
		'getAddress',
		'zeroAddress',
		'SecurityPoolWorkflowSection',
		'ChainTimestampContext',
		'getReportingLockedUntilMessage',
		'renderIntoDocument',
		'expectTransactionButtonDisabled',
		'createAccountState',
		'createReportingProps',
		'createOracleManagerDetails',
		'createMarketDetails',
		'createSelectedPool',
		'createSecurityPoolWorkflowProps',
	] as const)
}

export function createSelectedPoolStateFixture() {
	const fixture = createSecurityPoolWorkflowSectionFixture()
	return pickFixtureProperties(fixture, [
		'fireEvent',
		'within',
		'act',
		'getAddress',
		'zeroAddress',
		'SecurityPoolWorkflowSection',
		'renderIntoDocument',
		'expectTransactionButtonDisabled',
		'expectTransactionButtonEnabled',
		'createAccountState',
		'createTradingProps',
		'createSecurityVaultProps',
		'createSecurityVaultDetails',
		'createOracleManagerDetails',
		'createSecurityPoolVaultSummary',
		'createForkAuctionProps',
		'createForkAuctionDetails',
		'createSelectedPool',
		'createSecurityPoolWorkflowProps',
	] as const)
}

export function createStagedOperationsFixture() {
	const fixture = createSecurityPoolWorkflowSectionFixture()
	return pickFixtureProperties(fixture, [
		'fireEvent',
		'within',
		'act',
		'zeroAddress',
		'SecurityPoolWorkflowSection',
		'renderIntoDocument',
		'createAccountState',
		'createReportingProps',
		'createSecurityVaultProps',
		'createSecurityVaultDetails',
		'createOracleManagerDetails',
		'createMarketDetails',
		'createSelectedPool',
		'createSecurityPoolWorkflowProps',
	] as const)
}

export function createVaultControlsFixture() {
	const fixture = createSecurityPoolWorkflowSectionFixture()
	return pickFixtureProperties(fixture, [
		'fireEvent',
		'within',
		'act',
		'zeroAddress',
		'SecurityPoolWorkflowSection',
		'renderIntoDocument',
		'expectTransactionButtonDisabled',
		'expectTransactionButtonEnabled',
		'createAccountState',
		'createSecurityVaultProps',
		'createSecurityVaultDetails',
		'createOracleManagerDetails',
		'createSelectedPool',
		'createSecurityPoolWorkflowProps',
	] as const)
}

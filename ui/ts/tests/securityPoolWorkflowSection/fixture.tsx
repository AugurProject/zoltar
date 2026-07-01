/// <reference types="bun-types" />

import { fireEvent, waitFor, within } from '../testUtils/queries'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress } from '@zoltar/shared/ethereum'
import { SecurityPoolWorkflowSection } from '../../components/SecurityPoolWorkflowSection.js'
import { ChainTimestampContext } from '../../lib/chainTimestamp.js'
import { getReportingLockedUntilMessage } from '../../lib/reporting.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from '../testUtils/transactionActionButton.js'
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
	return {
		fireEvent: fixture.fireEvent,
		waitFor: fixture.waitFor,
		within: fixture.within,
		render: fixture.render,
		act: fixture.act,
		getAddress: fixture.getAddress,
		zeroAddress: fixture.zeroAddress,
		SecurityPoolWorkflowSection: fixture.SecurityPoolWorkflowSection,
		ChainTimestampContext: fixture.ChainTimestampContext,
		renderIntoDocument: fixture.renderIntoDocument,
		expectTransactionButtonEnabled: fixture.expectTransactionButtonEnabled,
		createReportingProps: fixture.createReportingProps,
		createForkAuctionProps: fixture.createForkAuctionProps,
		createForkAuctionDetails: fixture.createForkAuctionDetails,
		createMarketDetails: fixture.createMarketDetails,
		createSelectedPool: fixture.createSelectedPool,
		createSecurityPoolWorkflowProps: fixture.createSecurityPoolWorkflowProps,
	}
}

export function createRefreshAutoloadFixture() {
	const fixture = createSecurityPoolWorkflowSectionFixture()
	return {
		render: fixture.render,
		act: fixture.act,
		getAddress: fixture.getAddress,
		zeroAddress: fixture.zeroAddress,
		SecurityPoolWorkflowSection: fixture.SecurityPoolWorkflowSection,
		ChainTimestampContext: fixture.ChainTimestampContext,
		renderIntoDocument: fixture.renderIntoDocument,
		createAccountState: fixture.createAccountState,
		createReportingProps: fixture.createReportingProps,
		createSecurityVaultProps: fixture.createSecurityVaultProps,
		createSecurityVaultDetails: fixture.createSecurityVaultDetails,
		createForkAuctionProps: fixture.createForkAuctionProps,
		createMarketDetails: fixture.createMarketDetails,
		createSelectedPool: fixture.createSelectedPool,
		createSecurityPoolWorkflowProps: fixture.createSecurityPoolWorkflowProps,
	}
}

export function createReportingAndOracleFixture() {
	const fixture = createSecurityPoolWorkflowSectionFixture()
	return {
		within: fixture.within,
		getAddress: fixture.getAddress,
		zeroAddress: fixture.zeroAddress,
		SecurityPoolWorkflowSection: fixture.SecurityPoolWorkflowSection,
		ChainTimestampContext: fixture.ChainTimestampContext,
		getReportingLockedUntilMessage: fixture.getReportingLockedUntilMessage,
		renderIntoDocument: fixture.renderIntoDocument,
		expectTransactionButtonDisabled: fixture.expectTransactionButtonDisabled,
		createAccountState: fixture.createAccountState,
		createReportingProps: fixture.createReportingProps,
		createOracleManagerDetails: fixture.createOracleManagerDetails,
		createMarketDetails: fixture.createMarketDetails,
		createSelectedPool: fixture.createSelectedPool,
		createSecurityPoolWorkflowProps: fixture.createSecurityPoolWorkflowProps,
	}
}

export function createSelectedPoolStateFixture() {
	const fixture = createSecurityPoolWorkflowSectionFixture()
	return {
		fireEvent: fixture.fireEvent,
		within: fixture.within,
		act: fixture.act,
		getAddress: fixture.getAddress,
		zeroAddress: fixture.zeroAddress,
		SecurityPoolWorkflowSection: fixture.SecurityPoolWorkflowSection,
		renderIntoDocument: fixture.renderIntoDocument,
		expectTransactionButtonDisabled: fixture.expectTransactionButtonDisabled,
		expectTransactionButtonEnabled: fixture.expectTransactionButtonEnabled,
		createAccountState: fixture.createAccountState,
		createTradingProps: fixture.createTradingProps,
		createSecurityVaultProps: fixture.createSecurityVaultProps,
		createSecurityVaultDetails: fixture.createSecurityVaultDetails,
		createOracleManagerDetails: fixture.createOracleManagerDetails,
		createSecurityPoolVaultSummary: fixture.createSecurityPoolVaultSummary,
		createForkAuctionProps: fixture.createForkAuctionProps,
		createForkAuctionDetails: fixture.createForkAuctionDetails,
		createSelectedPool: fixture.createSelectedPool,
		createSecurityPoolWorkflowProps: fixture.createSecurityPoolWorkflowProps,
	}
}

export function createStagedOperationsFixture() {
	const fixture = createSecurityPoolWorkflowSectionFixture()
	return {
		fireEvent: fixture.fireEvent,
		within: fixture.within,
		act: fixture.act,
		zeroAddress: fixture.zeroAddress,
		SecurityPoolWorkflowSection: fixture.SecurityPoolWorkflowSection,
		renderIntoDocument: fixture.renderIntoDocument,
		createAccountState: fixture.createAccountState,
		createReportingProps: fixture.createReportingProps,
		createSecurityVaultProps: fixture.createSecurityVaultProps,
		createSecurityVaultDetails: fixture.createSecurityVaultDetails,
		createOracleManagerDetails: fixture.createOracleManagerDetails,
		createMarketDetails: fixture.createMarketDetails,
		createSelectedPool: fixture.createSelectedPool,
		createSecurityPoolWorkflowProps: fixture.createSecurityPoolWorkflowProps,
	}
}

export function createVaultControlsFixture() {
	const fixture = createSecurityPoolWorkflowSectionFixture()
	return {
		fireEvent: fixture.fireEvent,
		within: fixture.within,
		act: fixture.act,
		zeroAddress: fixture.zeroAddress,
		SecurityPoolWorkflowSection: fixture.SecurityPoolWorkflowSection,
		renderIntoDocument: fixture.renderIntoDocument,
		expectTransactionButtonDisabled: fixture.expectTransactionButtonDisabled,
		expectTransactionButtonEnabled: fixture.expectTransactionButtonEnabled,
		createAccountState: fixture.createAccountState,
		createSecurityVaultProps: fixture.createSecurityVaultProps,
		createSecurityVaultDetails: fixture.createSecurityVaultDetails,
		createOracleManagerDetails: fixture.createOracleManagerDetails,
		createSelectedPool: fixture.createSelectedPool,
		createSecurityPoolWorkflowProps: fixture.createSecurityPoolWorkflowProps,
	}
}

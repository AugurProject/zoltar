import { describe, expect, test } from 'bun:test'
import { contractStatusPresentation, deploymentActionAvailability } from '../../features/tradingDeploymentPresentation.js'
import * as deploymentCopy from '../../copy/deployment.js'
import * as appCopy from '../../copy/app.js'

const settledInputs = {
	busy: false,
	inputError: false,
	prerequisiteLabel: undefined,
	registryError: false,
	registryLoading: false,
	selectedCoreChainName: 'Sepolia',
	settingsIncomplete: false,
	stepDeployed: false,
	walletConnected: true,
	walletReady: true,
} as const

describe('trading deployment presentation', () => {
	test('a failed or blocked inspection states its result instead of a check that never finishes', () => {
		// A failed read records no inspected revision, so the inspection is not "current" even though it has settled.
		expect(deploymentActionAvailability({ ...settledInputs, inspectionIsCurrent: false, inspectionState: 'error' })).toEqual({ disabled: true, reason: deploymentCopy.configurationUnavailable })
		expect(deploymentActionAvailability({ ...settledInputs, inspectionIsCurrent: true, inspectionState: 'blocked' })).toEqual({ disabled: true, reason: appCopy.securityPoolFactoryNotDeployed })
		expect(deploymentActionAvailability({ ...settledInputs, inspectionIsCurrent: false, inspectionState: 'loading' }).loading).toBe(true)
	})

	test('a contract whose status could not be read says so instead of checking forever', () => {
		expect(contractStatusPresentation(undefined, false, true)).toEqual({ label: deploymentCopy.contractStatusUnavailable, tone: 'muted' })
		expect(contractStatusPresentation(undefined, false)).toEqual({ label: appCopy.checkingContract, tone: 'muted' })
	})
})

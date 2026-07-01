/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, type Hash } from '@zoltar/shared/ethereum'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import { useDeploymentFlow } from '../hooks/useDeploymentFlow.js'
import { createFakeBackend } from './testUtils/fakeBackend.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import type { DeploymentStatus } from '../types/contracts.js'

type UseDeploymentFlowState = ReturnType<typeof useDeploymentFlow>

const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a1')
const NEXT_WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000b2')

function requireHookState(state: UseDeploymentFlowState | undefined) {
	if (state === undefined) throw new Error('Hook state unavailable')

	return state
}

describe('useDeploymentFlow', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let resetEnvironment: (() => void) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: NEXT_WALLET_ADDRESS }))
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		resetEnvironment?.()
		resetEnvironment = undefined
		resetActiveEnvironmentForTesting()
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
		mock.restore()
	})

	test('does not request a deployment transaction when the active wallet account changed', async () => {
		const deploy = mock(async () => `0x${'1'.repeat(64)}` as Hash)
		const onTransactionRequested = mock(() => undefined)
		const onTransactionFailed = mock(() => undefined)
		const deploymentStatuses: DeploymentStatus[] = [
			{
				address: getAddress('0x00000000000000000000000000000000000000d1'),
				dependencies: [],
				deploy,
				deployed: false,
				id: 'zoltar',
				label: 'Zoltar',
			},
		]
		let hookState: UseDeploymentFlowState | undefined
		const Harness = function DeploymentFlowHarness() {
			hookState = useDeploymentFlow({
				accountAddress: WALLET_ADDRESS,
				deploymentStatuses,
				onTransactionFailed,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionPrepared: () => undefined,
				onTransactionRequested,
				onTransactionSubmitted: () => undefined,
				setDeploymentStatuses: () => undefined,
			})

			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).deployStep('zoltar')
		})

		expect(onTransactionRequested).not.toHaveBeenCalled()
		expect(deploy).not.toHaveBeenCalled()
		expect(onTransactionFailed).toHaveBeenCalledWith('Wallet account changed. Review the action with the connected account and try again')
	})
})

/// <reference types='bun-types' />

import { createWalletClient, custom, getAddress, keccak256, publicActions, type Hash, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installFakeEnvironmentLifecycle, requireHookState } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import type { DeploymentStatus } from '@zoltar/ui-core-shared/types/contracts.js'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { useDeploymentFlow } from '@zoltar/ui-zoltar-shared/features/deployment/hooks/useDeploymentFlow.js'
import { describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'

type UseDeploymentFlowState = ReturnType<typeof useDeploymentFlow>

const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a1')
const NEXT_WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000b2')
const DEPLOY_HASH = `0x${'1'.repeat(64)}` as Hash

type DeploymentFlowParameters = Parameters<typeof useDeploymentFlow>[0]

function zoltarDeploymentStatus(deploy: DeploymentStatus['deploy'], expectedRuntimeCodeHash: Hash | undefined = keccak256('0x1234')): DeploymentStatus {
	const status: DeploymentStatus = {
		address: getAddress('0x00000000000000000000000000000000000000d1'),
		dependencies: [],
		deploy,
		deployed: false,
		id: 'zoltar',
		label: 'Zoltar',
	}
	return expectedRuntimeCodeHash === undefined ? status : { ...status, expectedRuntimeCodeHash }
}

function codeReadingWriteClient(readCode: () => Hex) {
	return createWalletClient({
		account: WALLET_ADDRESS,
		chain: MAINNET_NETWORK_PROFILE.chain,
		transport: custom({
			request: async request => {
				if (request.method === 'eth_getCode') return readCode()
				throw new Error(`Unexpected RPC method ${request.method}`)
			},
		}),
	}).extend(publicActions)
}

describe('useDeploymentFlow', () => {
	const { replaceEnvironment, trackCleanup } = installFakeEnvironmentLifecycle({ accountAddress: NEXT_WALLET_ADDRESS, installActiveEnvironment: installActiveEnvironmentForTesting })

	function useWriteClient(readCode: () => Hex) {
		const writeClient = codeReadingWriteClient(readCode)
		replaceEnvironment({
			...createFakeBackend({ accountAddress: WALLET_ADDRESS }),
			createWriteClient: () => writeClient,
		})
	}

	async function deployZoltar(overrides: Partial<DeploymentFlowParameters> & Pick<DeploymentFlowParameters, 'deploymentStatuses'>) {
		let hookState: UseDeploymentFlowState | undefined
		const Harness = function DeploymentFlowHarness() {
			hookState = useDeploymentFlow({
				accountAddress: WALLET_ADDRESS,
				onTransactionFailed: () => undefined,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				setDeploymentStatuses: () => undefined,
				...overrides,
			})

			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		trackCleanup(renderedComponent.cleanup)

		await act(async () => {
			await requireHookState(hookState).deployStep('zoltar')
		})
		return requireHookState(hookState)
	}

	test.each([
		{
			name: 'the active wallet account changed',
			arrange: () => undefined,
			expectedRuntimeCodeHash: keccak256('0x1234'),
			errorMessage: 'Wallet account changed. Review the action with the connected account and try again.',
		},
		{
			name: 'the wallet disconnects after selection',
			arrange: () => replaceEnvironment(createFakeBackend()),
			expectedRuntimeCodeHash: keccak256('0x1234'),
			errorMessage: 'Wallet account is no longer connected. Reconnect your wallet and try again.',
		},
		{
			name: 'the wallet network changed',
			arrange: () =>
				replaceEnvironment({
					...createFakeBackend({ accountAddress: WALLET_ADDRESS }),
					getChainId: async () => '0x5',
				}),
			expectedRuntimeCodeHash: undefined,
			// Nothing was sent, so the wallet check's own instruction is shown.
			errorMessage: 'Wallet network changed. Switch to Ethereum mainnet and try again.',
		},
	])('does not request a deployment transaction when $name', async ({ arrange, expectedRuntimeCodeHash, errorMessage }) => {
		arrange()
		const deploy = mock(async () => DEPLOY_HASH)
		const onTransactionRequested = mock(() => undefined)
		const onTransactionFailed = mock(() => undefined)

		const hookState = await deployZoltar({ deploymentStatuses: [zoltarDeploymentStatus(deploy, expectedRuntimeCodeHash)], onTransactionFailed, onTransactionRequested })

		expect(onTransactionRequested).not.toHaveBeenCalled()
		expect(deploy).not.toHaveBeenCalled()
		expect(onTransactionFailed).not.toHaveBeenCalled()
		expect(hookState.errorMessage).toBe(errorMessage)
	})

	test('does not mark a deployment successful when the target code remains absent', async () => {
		useWriteClient(() => '0x')
		const deploy = mock(async () => DEPLOY_HASH)
		let failedMessage: string | undefined
		const onTransactionFailed = mock((message: string) => {
			failedMessage = message
		})
		const onTransactionPresented = mock(() => undefined)
		const setDeploymentStatuses = mock(() => undefined)

		const hookState = await deployZoltar({
			deploymentStatuses: [zoltarDeploymentStatus(deploy)],
			onTransactionFailed,
			onTransactionPresented,
			rpcStateRetryWait: async () => undefined,
			setDeploymentStatuses,
		})

		expect(deploy).toHaveBeenCalledTimes(1)
		expect(setDeploymentStatuses).not.toHaveBeenCalled()
		expect(onTransactionPresented).not.toHaveBeenCalled()
		expect(onTransactionFailed).toHaveBeenCalledTimes(1)
		expect(failedMessage).toBe('Deployment verification failed: no contract code was found at the expected address. Check the selected network and retry.')
		expect(hookState.errorMessage).toBe(failedMessage)
	})

	test('marks deployment successful when expected code appears after an RPC state retry', async () => {
		let codeReadCount = 0
		useWriteClient(() => {
			codeReadCount += 1
			return codeReadCount < 3 ? '0x' : '0x1234'
		})
		const deploymentStatuses = [zoltarDeploymentStatus(mock(async () => DEPLOY_HASH))]
		const onTransactionFailed = mock(() => undefined)
		const onTransactionPresented = mock(() => undefined)
		const retryDelays: number[] = []
		let deployed = false

		await deployZoltar({
			deploymentStatuses,
			onTransactionFailed,
			onTransactionPresented,
			rpcStateRetryWait: async delayMilliseconds => {
				retryDelays.push(delayMilliseconds)
			},
			setDeploymentStatuses: update => {
				deployed = update(deploymentStatuses)[0]?.deployed ?? false
			},
		})

		expect(deployed).toBe(true)
		expect(retryDelays).toEqual([250])
		expect(onTransactionPresented).toHaveBeenCalledTimes(1)
		expect(onTransactionFailed).not.toHaveBeenCalled()
	})

	test('does not mark a deployment successful when unexpected code is installed', async () => {
		let codeReadCount = 0
		useWriteClient(() => {
			codeReadCount += 1
			return codeReadCount === 1 ? '0x' : '0x1234'
		})
		const deploy = mock(async () => DEPLOY_HASH)
		const onTransactionFailed = mock(() => undefined)
		const setDeploymentStatuses = mock(() => undefined)

		const hookState = await deployZoltar({ deploymentStatuses: [zoltarDeploymentStatus(deploy, keccak256('0x5678'))], onTransactionFailed, setDeploymentStatuses })

		expect(onTransactionFailed).toHaveBeenCalledTimes(1)
		expect(deploy).toHaveBeenCalledTimes(1)
		expect(setDeploymentStatuses).not.toHaveBeenCalled()
		expect(hookState.errorMessage).toContain('Unexpected runtime code for zoltar')
	})
})

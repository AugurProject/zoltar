/// <reference types="bun-types" />

import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { encodeAbiParameters, encodeEventTopics, zeroAddress, type Address } from 'viem'
import { createSecurityPool } from '../contracts.js'
import { createWalletWriteClient } from '../lib/clients.js'
import type { InjectedEthereum } from '../injectedEthereum.js'
import { DAY, TEST_ADDRESSES } from '../../../solidity/ts/testsuite/simulator/utils/constants'
import { addressString } from '../../../solidity/ts/testsuite/simulator/utils/bigint'
import { AnvilWindowEthereum } from '../../../solidity/ts/testsuite/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../../../solidity/ts/testsuite/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient } from '../../../solidity/ts/testsuite/simulator/utils/viem'
import { ensureInfraDeployed, getSecurityPoolAddresses } from '../../../solidity/ts/testsuite/simulator/utils/contracts/deployPeripherals'
import { ensureZoltarDeployed } from '../../../solidity/ts/testsuite/simulator/utils/contracts/zoltar'
import { createQuestion, getQuestionId } from '../../../solidity/ts/testsuite/simulator/utils/contracts/zoltarQuestionData'
import { ensureProxyDeployerDeployed, setupTestAccounts } from '../../../solidity/ts/testsuite/simulator/utils/utilities'
import { peripherals_factories_SecurityPoolFactory_SecurityPoolFactory } from '../../../solidity/ts/types/contractArtifact'

setDefaultTimeout(TEST_TIMEOUT_MS)

function installInjectedEthereum(mockWindow: AnvilWindowEthereum) {
	const globalWindow = globalThis as typeof globalThis & { window?: Window }
	if (globalWindow.window === undefined) globalWindow.window = globalThis as Window & typeof globalThis
	globalWindow.window.ethereum = mockWindow as InjectedEthereum
}

describe('security pool creation helper', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient

	beforeEach(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		installInjectedEthereum(mockWindow)
		await setupTestAccounts(mockWindow)
		await ensureProxyDeployerDeployed(client)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)
	})

	test('returns the deployed security pool address from the deployment receipt', async () => {
		const currentTimestamp = await mockWindow.getTime()
		const questionData = {
			title: 'Test question for security pool creation',
			description: '',
			startTime: 0n,
			endTime: currentTimestamp + 365n * DAY,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = ['Yes', 'No']
		const questionId = getQuestionId(questionData, outcomes)
		await createQuestion(client, questionData, outcomes)

		const result = await createSecurityPool(createWalletWriteClient(addressString(TEST_ADDRESSES[0])), {
			currentRetentionRate: 999_999_996_848_000_000n,
			questionId,
			securityMultiplier: 2n,
		})

		const expectedAddresses = getSecurityPoolAddresses(zeroAddress, 0n, questionId, 2n)

		expect(result.questionId).toBe(`0x${questionId.toString(16).padStart(64, '0')}`)
		expect(result.securityPoolAddress).toBe(expectedAddresses.securityPool)
		expect(result.deployPoolHash.startsWith('0x')).toBe(true)
	})

	test('uses the deployment receipt event instead of the latest global deployment record', async () => {
		const deploySecurityPoolEvent = peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi.find((entry: (typeof peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi)[number]) => entry.type === 'event' && entry.name === 'DeploySecurityPool')
		if (deploySecurityPoolEvent === undefined) throw new Error('DeploySecurityPool event missing from abi')
		const deploySecurityPoolInputs = deploySecurityPoolEvent.inputs.map(input => ({ name: input.name, type: input.type }))

		const expectedSecurityPoolAddress = addressString(TEST_ADDRESSES[6]) as Address
		const fakeClientBase: Pick<WriteClient, 'account' | 'sendTransaction' | 'waitForTransactionReceipt'> = {
			account: {
				address: addressString(TEST_ADDRESSES[0]) as Address,
				type: 'json-rpc',
			},
			sendTransaction: async () => '0x1234',
			waitForTransactionReceipt: async () =>
				({
					status: 'success',
					logs: [
						{
							address: zeroAddress,
							data: encodeAbiParameters(deploySecurityPoolInputs, [expectedSecurityPoolAddress, zeroAddress, zeroAddress, zeroAddress, zeroAddress, 0n, 123n, 2n, 999_999_996_848_000_000n, 0n]),
							topics: encodeEventTopics({
								abi: [deploySecurityPoolEvent],
								eventName: 'DeploySecurityPool',
							}),
						},
					],
				}) as never,
		}
		const fakeClient = fakeClientBase as unknown as Parameters<typeof createSecurityPool>[0]

		const result = await createSecurityPool(fakeClient, {
			currentRetentionRate: 999_999_996_848_000_000n,
			questionId: 123n,
			securityMultiplier: 2n,
		})

		expect(result.securityPoolAddress).toBe(expectedSecurityPoolAddress)
	})
})

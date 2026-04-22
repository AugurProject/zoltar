/// <reference types="bun-types" />

import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { zeroAddress } from 'viem'
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

setDefaultTimeout(TEST_TIMEOUT_MS)

function installInjectedEthereum(mockWindow: AnvilWindowEthereum) {
	const globalWindow = globalThis as typeof globalThis & { window?: Window }
	if (globalWindow.window === undefined) {
		globalWindow.window = globalThis as unknown as Window & typeof globalThis
	}
	globalWindow.window.ethereum = mockWindow as unknown as InjectedEthereum
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
			startingRepEthPrice: 10n,
		})

		const expectedAddresses = getSecurityPoolAddresses(zeroAddress, 0n, questionId, 2n)

		expect(result.questionId).toBe(`0x${questionId.toString(16).padStart(64, '0')}`)
		expect(result.securityPoolAddress).toBe(expectedAddresses.securityPool)
		expect(result.deployPoolHash.startsWith('0x')).toBe(true)
	})
})

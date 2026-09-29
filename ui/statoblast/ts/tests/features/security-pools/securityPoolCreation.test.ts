/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, encodeEventTopics, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { createSecurityPool, getOriginSecurityPoolAddress } from '@zoltar/ui-statoblast-shared/protocol/securityPools.js'
import { createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import type { WriteClient as UiWriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import type { TransactionRequestPreview } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { DAY, TEST_ADDRESSES } from '../../../../../../solidity/ts/testSupport/simulator/utils/constants'
import { addressString } from '../../../../../../solidity/ts/testSupport/simulator/utils/bigint'
import { getInfraContractAddresses, getSecurityPoolAddresses } from '../../../../../../solidity/ts/testSupport/simulator/utils/contracts/deployStatoblast'
import { createQuestion } from '../../../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltarQuestionData'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { ZoltarQuestionData_ZoltarQuestionData } from '@zoltar/ui-core-shared/contractArtifact.js'
import { statoblast_factories_SecurityPoolFactory_SecurityPoolFactory } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { useSepoliaAnvilUiEnvironment } from './testSupport/sepoliaAnvilUi.js'

describe('security pool creation helper', () => {
	const anvil = useSepoliaAnvilUiEnvironment()

	test('creates a binary question and pool with one atomic transaction', async () => {
		const questionData = { title: 'Atomic question', description: '', startTime: 0n, endTime: (await anvil.getMockWindow().getTime()) + DAY, numTicks: 0n, displayValueMin: 0n, displayValueMax: 0n, answerUnit: '' }
		const questionId = getQuestionId(questionData, ['Yes', 'No'])
		expect(await getOriginSecurityPoolAddress(createWalletWriteClient(anvil.walletAddress), questionId, 20_000n, 10_000_000_000n)).toBeUndefined()
		const submittedHashes: string[] = []
		const preparedPreviews: TransactionRequestPreview[] = []
		const result = await createSecurityPool(
			createWalletWriteClient(anvil.walletAddress, { onTransactionPrepared: preview => preparedPreviews.push(preview), onTransactionSubmitted: hash => submittedHashes.push(hash) }),
			{
				initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
				questionId,
				statoblastSecurityMultiplierBps: 20_000n,
			},
			questionData,
			{ description: 'Pool parameters are fixed at deployment.', title: 'Create question and security pool' },
		)
		expect(submittedHashes).toEqual([result.deployPoolHash])
		expect(preparedPreviews.map(preview => preview.functionName)).toEqual(['aggregate3'])
		expect(preparedPreviews[0]?.contractLabel).toBe('Multicall3')
		expect(preparedPreviews[0]?.reviewTitle).toBe('Create question and security pool')
		expect(preparedPreviews[0]?.reviewDescription).toBe('Pool parameters are fixed at deployment.')
		expect(result.questionCreatedAt).toBeGreaterThan(0n)
		expect(result.questionId).toBe(`0x${questionId.toString(16).padStart(64, '0')}`)
		expect(result.securityPoolAddress).toBe(getSecurityPoolAddresses(zeroAddress, 0n, questionId, 20_000n).securityPool)
		expect(await getOriginSecurityPoolAddress(createWalletWriteClient(anvil.walletAddress), questionId, 20_000n, 10_000_000_000n)).toBe(result.securityPoolAddress)
	})

	test('rolls back question creation when the pool deployment fails', async () => {
		const questionData = { title: 'Atomic rollback', description: '', startTime: 0n, endTime: (await anvil.getMockWindow().getTime()) + DAY, numTicks: 0n, displayValueMin: 0n, displayValueMax: 0n, answerUnit: '' }
		const questionId = getQuestionId(questionData, ['Yes', 'No'])
		const walletClient = createWalletWriteClient(anvil.walletAddress)
		await expect(createSecurityPool(walletClient, { initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n, questionId, statoblastSecurityMultiplierBps: 10_000n }, questionData)).rejects.toThrow('Security pool deployment would revert: Multiplier must exceed 10001 BPS')
		const createdAt = await walletClient.readContract({ address: getInfraContractAddresses().zoltarQuestionData, abi: ZoltarQuestionData_ZoltarQuestionData.abi, functionName: 'questionCreatedTimestamp', args: [questionId] })
		expect(createdAt).toBe(0n)
	})

	test('identifies a failing question creation before requesting a wallet transaction', async () => {
		const questionData = { title: 'Already created question', description: '', startTime: 0n, endTime: (await anvil.getMockWindow().getTime()) + DAY, numTicks: 0n, displayValueMin: 0n, displayValueMax: 0n, answerUnit: '' }
		const questionId = getQuestionId(questionData, ['Yes', 'No'])
		await createQuestion(anvil.getClient(), questionData, ['Yes', 'No'])
		const submittedHashes: string[] = []
		const walletClient = createWalletWriteClient(anvil.walletAddress, { onTransactionSubmitted: hash => submittedHashes.push(hash) })
		await expect(createSecurityPool(walletClient, { initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n, questionId, statoblastSecurityMultiplierBps: 20_000n }, questionData)).rejects.toThrow('Question creation would revert: Question already exists and cannot be created twice')
		expect(submittedHashes).toEqual([])
	})

	test('returns the deployed security pool address from the deployment receipt', async () => {
		const currentTimestamp = await anvil.getMockWindow().getTime()
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
		await createQuestion(anvil.getClient(), questionData, outcomes)

		const result = await createSecurityPool(createWalletWriteClient(anvil.walletAddress), {
			initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
			questionId,
			statoblastSecurityMultiplierBps: 20_000n,
		})

		const expectedAddresses = getSecurityPoolAddresses(zeroAddress, 0n, questionId, 20_000n)

		expect(result.questionId).toBe(`0x${questionId.toString(16).padStart(64, '0')}`)
		expect(result.securityPoolAddress).toBe(expectedAddresses.securityPool)
		expect(result.deployPoolHash.startsWith('0x')).toBe(true)
	})

	test('uses the deployment receipt event instead of the latest global deployment record', async () => {
		const deploySecurityPoolEvent = statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi.find((entry: (typeof statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi)[number]) => entry.type === 'event' && entry.name === 'DeploySecurityPool')
		if (deploySecurityPoolEvent === undefined) throw new Error('DeploySecurityPool event missing from abi')
		const deploySecurityPoolDataInputs = deploySecurityPoolEvent.inputs.filter(input => !input.indexed).map(input => ({ name: input.name, type: input.type }))

		const expectedSecurityPoolAddress = addressString(TEST_ADDRESSES[6]) as Address
		const spoofedSecurityPoolAddress = addressString(TEST_ADDRESSES[5]) as Address
		const createDeploymentLog = (emitter: Address, securityPoolAddress: Address) => ({
			address: emitter,
			data: encodeAbiParameters(deploySecurityPoolDataInputs, [zeroAddress, zeroAddress, zeroAddress, 123n, 2n, 10_000_000_000n, 999_999_996_848_000_000n, 0n]),
			topics: encodeEventTopics({
				abi: [deploySecurityPoolEvent],
				eventName: 'DeploySecurityPool',
				args: { securityPool: securityPoolAddress, parent: zeroAddress, universeId: 0n },
			}),
		})
		const preparedPreviews: TransactionRequestPreview[] = []
		const fakeClientBase: Pick<UiWriteClient, 'account' | 'onTransactionPrepared' | 'sendTransaction' | 'waitForTransactionReceipt'> = {
			account: {
				address: anvil.walletAddress,
				type: 'json-rpc',
			},
			onTransactionPrepared: preview => {
				preparedPreviews.push(preview)
			},
			sendTransaction: async () => '0x1234',
			waitForTransactionReceipt: async () =>
				({
					status: 'success',
					logs: [createDeploymentLog(zeroAddress, spoofedSecurityPoolAddress), createDeploymentLog(getInfraContractAddresses().securityPoolFactory, expectedSecurityPoolAddress)],
				}) as never,
		}
		const fakeClient = fakeClientBase as UiWriteClient

		const result = await createSecurityPool(
			fakeClient,
			{
				initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
				questionId: 123n,
				statoblastSecurityMultiplierBps: 20_000n,
			},
			undefined,
			{ description: 'Pool parameters are fixed at deployment.', title: 'Create security pool' },
		)

		expect(result.securityPoolAddress).toBe(expectedSecurityPoolAddress)
		expect(preparedPreviews).toHaveLength(1)
		expect(preparedPreviews[0]?.functionName).toBe('deployOriginSecurityPool')
		expect(preparedPreviews[0]?.contractLabel).toBe('Security Pool Factory')
		expect(preparedPreviews[0]?.reviewTitle).toBe('Create security pool')
		expect(preparedPreviews[0]?.reviewDescription).toBe('Pool parameters are fixed at deployment.')
	})
})

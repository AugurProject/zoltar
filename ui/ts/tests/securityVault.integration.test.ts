/// <reference types="bun-types" />

import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { zeroAddress, type Address } from 'viem'
import { approveErc20, depositRepToSecurityPool, loadErc20Allowance, loadErc20Balance, loadSecurityVaultDetails } from '../contracts.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { DAY, TEST_ADDRESSES } from '../../../solidity/ts/testsuite/simulator/utils/constants'
import { addressString } from '../../../solidity/ts/testsuite/simulator/utils/bigint'
import { ensureProxyDeployerDeployed, setupTestAccounts } from '../../../solidity/ts/testsuite/simulator/utils/utilities'
import { AnvilWindowEthereum } from '../../../solidity/ts/testsuite/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../../../solidity/ts/testsuite/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient } from '../../../solidity/ts/testsuite/simulator/utils/viem'
import { deployOriginSecurityPool, ensureInfraDeployed, getSecurityPoolAddresses } from '../../../solidity/ts/testsuite/simulator/utils/contracts/deployPeripherals'
import { ensureZoltarDeployed } from '../../../solidity/ts/testsuite/simulator/utils/contracts/zoltar'
import { createQuestion, getQuestionId } from '../../../solidity/ts/testsuite/simulator/utils/contracts/zoltarQuestionData'
import { getSecurityVault, getVaultCount, getVaults, poolOwnershipToRep } from '../../../solidity/ts/testsuite/simulator/utils/contracts/securityPool'

setDefaultTimeout(TEST_TIMEOUT_MS)

function installInjectedEthereum(mockWindow: AnvilWindowEthereum) {
	if (!Reflect.has(globalThis, 'window')) {
		Reflect.set(globalThis, 'window', globalThis)
	}
	const windowObject = globalThis.window
	Reflect.set(windowObject, 'ethereum', mockWindow)
}

const genesisUniverse = 0n
const securityMultiplier = 2n
const MAX_RETENTION_RATE = 999_999_996_848_000_000n
const outcomes = ['Yes', 'No']
const depositAmount = 10_000n * 10n ** 18n
const belowMinimumDepositAmount = 9n * 10n ** 18n

describe('Security vault integration', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	let uiReadClient: ReturnType<typeof createConnectedReadClient>
	let uiWriteClient: ReturnType<typeof createWalletWriteClient>
	let securityPoolAddress: Address
	let walletAddress: Address

	beforeEach(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		installInjectedEthereum(mockWindow)
		uiReadClient = createConnectedReadClient()
		walletAddress = addressString(TEST_ADDRESSES[0])
		uiWriteClient = createWalletWriteClient(walletAddress)
		await setupTestAccounts(mockWindow)
		await ensureProxyDeployerDeployed(client)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)

		const currentTimestamp = await mockWindow.getTime()
		const questionData = {
			title: 'Vault deposit regression test',
			description: '',
			startTime: 0n,
			endTime: currentTimestamp + 365n * DAY,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const questionId = getQuestionId(questionData, outcomes)
		await createQuestion(client, questionData, outcomes)
		await deployOriginSecurityPool(client, genesisUniverse, questionId, securityMultiplier, MAX_RETENTION_RATE)
		securityPoolAddress = getSecurityPoolAddresses(zeroAddress, genesisUniverse, questionId, securityMultiplier).securityPool
	})

	test('approves and deposits REP into the selected vault and reports REP units correctly', async () => {
		const initialVaultDetails = await loadSecurityVaultDetails(uiReadClient, securityPoolAddress, walletAddress)
		if (initialVaultDetails === undefined) throw new Error('Expected security vault details to load')
		expect(initialVaultDetails.repDepositShare).toBe(0n)

		const startPoolRepBalance = await loadErc20Balance(uiReadClient, initialVaultDetails.repToken, securityPoolAddress)
		const approvalResult = await approveErc20(uiWriteClient, initialVaultDetails.repToken, securityPoolAddress, depositAmount, 'approveRep')
		expect(approvalResult.action).toBe('approveRep')

		const approvedRep = await loadErc20Allowance(uiReadClient, initialVaultDetails.repToken, walletAddress, securityPoolAddress)
		expect(approvedRep).toBe(depositAmount)

		const depositResult = await depositRepToSecurityPool(uiWriteClient, securityPoolAddress, depositAmount)
		expect(depositResult.action).toBe('depositRep')

		const endPoolRepBalance = await loadErc20Balance(uiReadClient, initialVaultDetails.repToken, securityPoolAddress)
		expect(endPoolRepBalance - startPoolRepBalance).toBe(depositAmount)

		const vaultCount = await getVaultCount(client, securityPoolAddress)
		expect(vaultCount).toBe(1n)
		const vaults = await getVaults(client, securityPoolAddress, 0n, vaultCount)
		expect(vaults).toEqual([walletAddress])

		const vault = await getSecurityVault(client, securityPoolAddress, walletAddress)
		const repFromOwnership = await poolOwnershipToRep(client, securityPoolAddress, vault.repDepositShare)
		expect(repFromOwnership).toBe(depositAmount)

		const updatedVaultDetails = await loadSecurityVaultDetails(uiReadClient, securityPoolAddress, walletAddress)
		if (updatedVaultDetails === undefined) throw new Error('Expected updated security vault details to load')
		expect(updatedVaultDetails.vaultAddress).toBe(walletAddress)
		expect(updatedVaultDetails.securityPoolAddress).toBe(securityPoolAddress)
		expect(updatedVaultDetails.repDepositShare).toBe(depositAmount)
	})

	test('surfaces the real revert reason when the first deposit is below the minimum', async () => {
		const vaultDetails = await loadSecurityVaultDetails(uiReadClient, securityPoolAddress, walletAddress)
		if (vaultDetails === undefined) throw new Error('Expected security vault details to load')

		await approveErc20(uiWriteClient, vaultDetails.repToken, securityPoolAddress, belowMinimumDepositAmount, 'approveRep')

		await expect(depositRepToSecurityPool(uiWriteClient, securityPoolAddress, belowMinimumDepositAmount)).rejects.toThrow('min deposit requirement')
	})
})

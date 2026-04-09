/// <reference types="bun-types" />

import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { getAddress, zeroAddress } from 'viem'
import { createOpenOracleReportInstance, getOpenOracleAddress, loadOpenOracleGames } from '../contracts.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import type { InjectedEthereum } from '../injectedEthereum.js'
import { DAY, GENESIS_REPUTATION_TOKEN, WETH_ADDRESS, TEST_ADDRESSES } from '../../../solidity/ts/testsuite/simulator/utils/constants'
import { addressString } from '../../../solidity/ts/testsuite/simulator/utils/bigint'
import { approveToken, setupTestAccounts, ensureProxyDeployerDeployed } from '../../../solidity/ts/testsuite/simulator/utils/utilities'
import { AnvilWindowEthereum } from '../../../solidity/ts/testsuite/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../../../solidity/ts/testsuite/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient } from '../../../solidity/ts/testsuite/simulator/utils/viem'
import { ensureInfraDeployed } from '../../../solidity/ts/testsuite/simulator/utils/contracts/deployPeripherals'
import { getOpenOracleExtraData, openOracleSettle, openOracleSubmitInitialReport, wrapWeth } from '../../../solidity/ts/testsuite/simulator/utils/contracts/peripherals'

setDefaultTimeout(TEST_TIMEOUT_MS)

function installInjectedEthereum(mockWindow: AnvilWindowEthereum) {
	const globalWindow = globalThis as typeof globalThis & { window?: Window }
	if (globalWindow.window === undefined) {
		globalWindow.window = globalThis as unknown as Window & typeof globalThis
	}
	globalWindow.window.ethereum = mockWindow as unknown as InjectedEthereum
}

describe('Open Oracle helpers', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	let uiReadClient: ReturnType<typeof createConnectedReadClient>
	let uiWriteClient: ReturnType<typeof createWalletWriteClient>
	const token1 = addressString(GENESIS_REPUTATION_TOKEN)
	const token2 = WETH_ADDRESS

	beforeEach(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		installInjectedEthereum(mockWindow)
		uiReadClient = createConnectedReadClient()
		uiWriteClient = createWalletWriteClient(addressString(TEST_ADDRESSES[0]))
		await setupTestAccounts(mockWindow)
		await ensureProxyDeployerDeployed(client)
		await ensureInfraDeployed(client)
	})

	test('loads an empty Open Oracle game list from the fixed deployment address', async () => {
		const list = await loadOpenOracleGames(uiReadClient)

		expect(getOpenOracleAddress()).not.toBe(zeroAddress)
		expect(list.nextReportId).toBe(1n)
		expect(list.games).toHaveLength(0)
	})

	test('creates a report instance and lists it from nextReportId', async () => {
		const created = await createOpenOracleReportInstance(uiWriteClient, {
			callbackContract: zeroAddress,
			callbackGasLimit: 0,
			callbackSelector: '0x00000000',
			disputeDelay: 0,
			escalationHalt: 0n,
			exactToken1Report: 1n,
			feePercentage: 3000,
			feeToken: true,
			keepFee: true,
			multiplier: 110,
			protocolFee: 0,
			protocolFeeRecipient: zeroAddress,
			settlementTime: 60,
			settlerReward: 100n,
			timeType: true,
			token1Address: token1,
			token2Address: token2,
			trackDisputes: false,
			value: 1000n,
		})

		const list = await loadOpenOracleGames(uiReadClient)
		const game = list.games[0]

		expect(created.reportId).toBe(1n)
		expect(list.nextReportId).toBe(2n)
		expect(list.games).toHaveLength(1)
		expect(game).toBeDefined()
		expect(game?.reportId).toBe(1n)
		expect(getAddress(game?.token1 ?? zeroAddress)).toBe(getAddress(token1))
		expect(getAddress(game?.token2 ?? zeroAddress)).toBe(getAddress(token2))
		expect(game?.exactToken1Report).toBe(1n)
		expect(game?.isSubmitted).toBe(false)
		expect(game?.isSettled).toBe(false)
	})

	test('tracks submission and settlement for created Open Oracle games', async () => {
		const created = await createOpenOracleReportInstance(uiWriteClient, {
			callbackContract: zeroAddress,
			callbackGasLimit: 0,
			callbackSelector: '0x00000000',
			disputeDelay: 0,
			escalationHalt: 0n,
			exactToken1Report: 1n,
			feePercentage: 3000,
			feeToken: true,
			keepFee: true,
			multiplier: 110,
			protocolFee: 0,
			protocolFeeRecipient: zeroAddress,
			settlementTime: 60,
			settlerReward: 100n,
			timeType: true,
			token1Address: token1,
			token2Address: token2,
			trackDisputes: false,
			value: 1000n,
		})

		await approveToken(client, token1, getOpenOracleAddress())
		await approveToken(client, token2, getOpenOracleAddress())
		await wrapWeth(client, 2n)
		const stateHash = (await getOpenOracleExtraData(client, created.reportId)).stateHash
		await openOracleSubmitInitialReport(client, created.reportId, 1n, 2n, stateHash)

		let list = await loadOpenOracleGames(uiReadClient)
		let game = list.games[0]

		expect(game?.isSubmitted).toBe(true)
		expect(game?.isSettled).toBe(false)
		expect(game?.currentAmount1).toBe(1n)
		expect(game?.currentAmount2).toBe(2n)

		await mockWindow.advanceTime(DAY)
		await openOracleSettle(client, created.reportId)

		list = await loadOpenOracleGames(uiReadClient)
		game = list.games[0]

		expect(game?.isSubmitted).toBe(true)
		expect(game?.isSettled).toBe(true)
		expect(game?.settlementTimestamp).toBeGreaterThan(0n)
	})
})

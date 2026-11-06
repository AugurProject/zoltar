import { beforeEach, describe, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { createWriteClient, WriteClient } from '../testSupport/simulator/utils/clients'
import { strictEqualTypeSafe } from '../testSupport/simulator/utils/testUtils'
import { statoblast_SecurityPoolUtils_SecurityPoolUtils } from '../types/contractArtifact'

const PRICE_PRECISION = 10n ** 18n

describe('SecurityPoolUtils', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let client: WriteClient
	let securityPoolUtilsAddress: Address
	const utils = () => ({ abi: statoblast_SecurityPoolUtils_SecurityPoolUtils.abi, address: securityPoolUtilsAddress })

	beforeEach(async () => {
		const mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0])
		await setupTestAccounts(mockWindow)
		const hash = await client.sendTransaction({
			data: `0x${statoblast_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object}`,
		})
		const receipt = await client.waitForTransactionReceipt({ hash })
		if (receipt.contractAddress === undefined) throw new Error('SecurityPoolUtils deployment address missing')
		securityPoolUtilsAddress = receipt.contractAddress
	})

	test('initial escalation deposit uses a one-REP floor below the supply fraction', async () => {
		for (const [theoreticalSupplyAttoRep, expectedDepositAttoRep] of [
			[0n, PRICE_PRECISION],
			[9_999_999n * PRICE_PRECISION, PRICE_PRECISION],
			[10_000_000n * PRICE_PRECISION, PRICE_PRECISION],
			[20_000_000n * PRICE_PRECISION, 2n * PRICE_PRECISION],
		] as const) {
			strictEqualTypeSafe(await client.readContract({ ...utils(), functionName: 'calculateInitialEscalationDepositAttoRep', args: [theoreticalSupplyAttoRep] }), expectedDepositAttoRep, `theoretical supply ${theoreticalSupplyAttoRep.toString()}`)
		}
	})

	test('vault REP deposit uses the supply default while honoring exact constructor overrides', async () => {
		const theoreticalSupplyAttoRep = 2_000_000n * PRICE_PRECISION
		for (const [configuredMinimumAttoRep, expectedMinimumAttoRep] of [
			[0n, 20n * PRICE_PRECISION],
			[10n * PRICE_PRECISION, 10n * PRICE_PRECISION],
			[20n * PRICE_PRECISION, 20n * PRICE_PRECISION],
			[30n * PRICE_PRECISION, 30n * PRICE_PRECISION],
		] as const) {
			strictEqualTypeSafe(await client.readContract({ ...utils(), functionName: 'calculateMinimumVaultRepDepositAttoRep', args: [theoreticalSupplyAttoRep, configuredMinimumAttoRep] }), expectedMinimumAttoRep, `configured minimum ${configuredMinimumAttoRep.toString()}`)
		}
	})
})

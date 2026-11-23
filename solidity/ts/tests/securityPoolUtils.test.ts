import { beforeEach, describe, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { createWriteClient, type WriteClient } from '../testSupport/simulator/utils/clients'
import { strictEqualTypeSafe } from '../testSupport/simulator/utils/testUtils'
import { test_statoblast_SecurityPoolUtilsHarness_SecurityPoolUtilsHarness } from '../types/contractArtifact'

const PRICE_PRECISION = 10n ** 18n

describe('SecurityPoolUtils', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let client: WriteClient
	let securityPoolUtilsAddress: Address
	const utils = () => ({ abi: test_statoblast_SecurityPoolUtilsHarness_SecurityPoolUtilsHarness.abi, address: securityPoolUtilsAddress })

	beforeEach(async () => {
		const mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0])
		await setupTestAccounts(mockWindow)
		const hash = await client.sendTransaction({
			data: `0x${test_statoblast_SecurityPoolUtilsHarness_SecurityPoolUtilsHarness.evm.bytecode.object}`,
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
			[20_000_000n * PRICE_PRECISION + 9_999_999n, 2n * PRICE_PRECISION],
			[20_000_000n * PRICE_PRECISION + 10_000_000n, 2n * PRICE_PRECISION + 1n],
		] as const) {
			strictEqualTypeSafe(await client.readContract({ ...utils(), functionName: 'calculateInitialEscalationDepositAttoRep', args: [theoreticalSupplyAttoRep] }), expectedDepositAttoRep, `theoretical supply ${theoreticalSupplyAttoRep.toString()}`)
		}
	})
})

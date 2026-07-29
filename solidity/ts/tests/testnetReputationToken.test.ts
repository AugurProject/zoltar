import { beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/shared/ethereum'
import assert from '../testSupport/simulator/utils/assert'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { TestnetReputationToken_TestnetReputationToken } from '../types/contractArtifact'

setDefaultTimeout(TEST_TIMEOUT_MS)

describe('TestnetReputationToken', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let client: WriteClient
	let tokenAddress: Address

	beforeEach(async () => {
		const mockWindow: AnvilWindowEthereum = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
		const hash = await client.sendTransaction({
			data: encodeDeployData({
				abi: TestnetReputationToken_TestnetReputationToken.abi,
				bytecode: `0x${TestnetReputationToken_TestnetReputationToken.evm.bytecode.object}`,
			}),
		})
		const receipt = await client.waitForTransactionReceipt({ hash })
		if (receipt.contractAddress === undefined || receipt.contractAddress === null) throw new Error('Testnet REP deployment address missing')
		tokenAddress = receipt.contractAddress
	})

	test('mints faucet REP within the per-call and theoretical-supply caps', async () => {
		const faucetAmount = 1_000_000n * 10n ** 18n
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: TestnetReputationToken_TestnetReputationToken.abi,
				address: tokenAddress,
				functionName: 'faucet',
				args: [faucetAmount],
			}),
		)

		assert.strictEqual(
			await client.readContract({
				abi: TestnetReputationToken_TestnetReputationToken.abi,
				address: tokenAddress,
				functionName: 'balanceOf',
				args: [client.account.address],
			}),
			faucetAmount,
			'faucet should mint REP to its caller',
		)
		assert.strictEqual(
			await client.readContract({
				abi: TestnetReputationToken_TestnetReputationToken.abi,
				address: tokenAddress,
				functionName: 'getTotalTheoreticalSupply',
				args: [],
			}),
			11_000_000n * 10n ** 18n,
			'testnet REP should expose a non-zero genesis theoretical supply',
		)
		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: TestnetReputationToken_TestnetReputationToken.abi,
					address: tokenAddress,
					functionName: 'faucet',
					args: [faucetAmount + 1n],
				}),
			),
			/reverted/i,
		)
	})
})

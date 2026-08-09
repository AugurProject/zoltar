import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/shared/ethereum'
import { useIsolatedAnvilNode } from '../../../solidity/ts/testSupport/simulator/useIsolatedAnvilNode.ts'
import { createWriteClient, type WriteClient } from '../../../solidity/ts/testSupport/simulator/utils/clients.ts'
import { TEST_ADDRESSES } from '../../../solidity/ts/testSupport/simulator/utils/constants.ts'
import { compileArtifactsForTests } from './compileArtifactsForTests.ts'
import { quoteExactInput, quoteExactOutput } from '../sdk/math.ts'

type TradingContracts = typeof import('../artifacts/contractArtifact.ts').tradingContracts

describe('Solidity and TypeScript AMM math parity', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let client: WriteClient
	let harness: Address
	let artifact: TradingContracts['trading/contracts/test/TwoWayConstantProductMathHarness.sol']['TwoWayConstantProductMathHarness']

	beforeAll(async () => {
		const contracts = await compileArtifactsForTests()
		artifact = contracts['trading/contracts/test/TwoWayConstantProductMathHarness.sol'].TwoWayConstantProductMathHarness
		const ethereum = getAnvilWindowEthereum()
		const account = `0x${TEST_ADDRESSES[0].toString(16).padStart(40, '0')}`
		await ethereum.impersonateAccount(account)
		await ethereum.setBalance(account, 10n ** 24n)
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
		const hash = await client.sendTransaction({ data: encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` }) })
		const receipt = await client.waitForTransactionReceipt({ hash })
		if (receipt.contractAddress === undefined || receipt.contractAddress === null) throw new Error('Math harness deployment address missing')
		harness = receipt.contractAddress
		await setBaselineSnapshot()
	}, 120_000)

	test('matches floor exact-input and ceil exact-output across large values', async () => {
		for (let index = 1n; index <= 40n; index++) {
			const reserveIn = 2n ** (120n + index) + index * 97n
			const reserveOut = 2n ** (180n - index) + index * 193n
			const amountIn = 2n ** (80n + index / 2n)
			const feeBps = (index * 211n) % 9_999n
			const expectedInput = quoteExactInput(reserveIn, reserveOut, amountIn, feeBps)
			const solidityInput = await client.readContract({ abi: artifact.abi, address: harness, functionName: 'quoteExactInput', args: [reserveIn, reserveOut, amountIn, feeBps] })
			expect(solidityInput[0]).toBe(expectedInput.amountOut)
			expect(solidityInput[1]).toBe(expectedInput.feeAmount)

			const requested = reserveOut / (index + 2n)
			const expectedOutput = quoteExactOutput(reserveIn, reserveOut, requested, feeBps)
			const solidityOutput = await client.readContract({ abi: artifact.abi, address: harness, functionName: 'quoteExactOutput', args: [reserveIn, reserveOut, requested, feeBps] })
			expect(solidityOutput[0]).toBe(expectedOutput.amountIn)
			expect(solidityOutput[1]).toBe(expectedOutput.feeAmount)
			expect(quoteExactInput(reserveIn, reserveOut, solidityOutput[0], feeBps).amountOut).toBeGreaterThanOrEqual(requested)
		}
	})

	test('matches exact-input math when the reserve and net-input sum exceeds uint256', async () => {
		const maximum = (1n << 256n) - 1n
		const reserveIn = maximum - 10n
		const reserveOut = maximum - 123n
		const amountIn = maximum
		const expected = quoteExactInput(reserveIn, reserveOut, amountIn, 30n)
		const actual = await client.readContract({ abi: artifact.abi, address: harness, functionName: 'quoteExactInput', args: [reserveIn, reserveOut, amountIn, 30n] })
		expect(actual[0]).toBe(expected.amountOut)
		expect(actual[1]).toBe(expected.feeAmount)
	})
})

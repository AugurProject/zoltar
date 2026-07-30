import { encodeAbiParameters, encodeDeployData, getAddress, type Address } from '#ethereum'
import { beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../../../../solidity/ts/testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../../../../solidity/ts/testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../../../solidity/ts/testSupport/simulator/utils/constants'
import { ensureDefined } from '../../../../solidity/ts/testSupport/simulator/utils/testUtils'
import { setupTestAccounts } from '../../../../solidity/ts/testSupport/simulator/utils/utilities'
import { executorArtifact, feeTokenArtifact, routerArtifact, targetArtifact, tokenArtifact, v4PoolManagerArtifact, wethArtifact } from '#contracts/artifacts.generated'
import { peripherals_openOracle_OpenOracle_OpenOracle as openOracleArtifact } from '../../../../solidity/ts/types/contractArtifact'

setDefaultTimeout(TEST_TIMEOUT_MS)

describe('OpenOracle arbitrage executor', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let client: WriteClient
	let executor: Address
	let openOracle: Address
	let router: Address
	let target: Address

	const deploy = async (artifact: typeof executorArtifact | typeof openOracleArtifact | typeof targetArtifact | typeof tokenArtifact | typeof feeTokenArtifact | typeof routerArtifact | typeof v4PoolManagerArtifact | typeof wethArtifact, args: readonly unknown[] = []) => {
		const hash = await client.sendTransaction({
			data: encodeDeployData({
				abi: artifact.abi,
				args,
				bytecode: `0x${artifact.evm.bytecode.object}`,
			}),
		})
		const receipt = await client.waitForTransactionReceipt({ hash })
		if (receipt.contractAddress === null || receipt.contractAddress === undefined) throw new Error('deployment address missing')
		return receipt.contractAddress
	}

	const game = (token1: Address, token2: Address) => ({
		callbackContract: getAddress('0x0000000000000000000000000000000000000000'),
		callbackGasLimit: 0,
		currentAmount1: 1_000n,
		currentAmount2: 1_000n,
		currentReporter: getAddress('0x0000000000000000000000000000000000000001'),
		disputeDelay: 0,
		escalationHalt: 10_000n,
		feePercentage: 0,
		flags: 0,
		lastReportOppoTime: 0,
		multiplier: 120,
		numReports: 0,
		protocolFee: 0,
		protocolFeeRecipient: getAddress('0x0000000000000000000000000000000000000000'),
		reportTimestamp: 1,
		settlementTime: 100,
		settlementTimestamp: 0,
		settlerReward: 0n,
		token1,
		token2,
	})

	const helper = () => ({
		blockNumber: 1n,
		blockTimestamp: 1n,
		creator: client.account.address,
		reportId: 1n,
	})

	const timing = {
		blockNumber: 0n,
		blockNumberBound: 0n,
		blockTimestamp: 0n,
		blockTimestampBound: 0n,
	}

	beforeAll(async () => {
		const window = getAnvilWindowEthereum()
		await setupTestAccounts(window)
		client = createWriteClient(window, ensureDefined(TEST_ADDRESSES[0], 'test account missing'), 0)
		executor = await deploy(executorArtifact)
		openOracle = await deploy(openOracleArtifact)
		target = await deploy(targetArtifact)
		router = await deploy(routerArtifact)
		await setBaselineSnapshot()
	})

	beforeEach(() => {
		const window = getAnvilWindowEthereum()
		client = createWriteClient(window, ensureDefined(TEST_ADDRESSES[0], 'test account missing'), 0)
	})

	test('funds a vanilla-token dispute atomically and retains no operation-pulled token or allowance', async () => {
		const token1 = await deploy(tokenArtifact, ['Token 1', 'TK1'])
		const token2 = await deploy(tokenArtifact, ['Token 2', 'TK2'])
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token1, functionName: 'mint', args: [client.account.address, 10_000n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token2, functionName: 'mint', args: [client.account.address, 10_000n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token1, functionName: 'approve', args: [executor, 2_200n] }))
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: executorArtifact.abi,
				address: executor,
				functionName: 'dispute',
				args: [target, 1_200n, 900n, game(token1, token2), helper(), timing],
			}),
		)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token1, functionName: 'balanceOf', args: [executor] })).toBe(0n)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token1, functionName: 'allowance', args: [executor, target] })).toBe(0n)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token1, functionName: 'balanceOf', args: [target] })).toBe(2_200n)
	})

	test('preserves an unsolicited balance that has no withdrawal path', async () => {
		const token1 = await deploy(tokenArtifact, ['Token 1', 'TK1'])
		const token2 = await deploy(tokenArtifact, ['Token 2', 'TK2'])
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token1, functionName: 'mint', args: [client.account.address, 10_100n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token1, functionName: 'transfer', args: [executor, 100n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token1, functionName: 'approve', args: [executor, 2_200n] }))
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: executorArtifact.abi,
				address: executor,
				functionName: 'dispute',
				args: [target, 1_200n, 900n, game(token1, token2), helper(), timing],
			}),
		)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token1, functionName: 'balanceOf', args: [executor] })).toBe(100n)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token1, functionName: 'balanceOf', args: [target] })).toBe(2_200n)
	})

	test('reverts the complete execution when a token charges a transfer fee', async () => {
		const token1 = await deploy(feeTokenArtifact, [100n])
		const token2 = await deploy(tokenArtifact, ['Token 2', 'TK2'])
		await writeContractAndWait(client, () => client.writeContract({ abi: feeTokenArtifact.abi, address: token1, functionName: 'mint', args: [client.account.address, 10_000n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: feeTokenArtifact.abi, address: token1, functionName: 'approve', args: [executor, 2_200n] }))
		await expect(
			client.simulateContract({
				abi: executorArtifact.abi,
				address: executor,
				account: client.account,
				functionName: 'dispute',
				args: [target, 1_200n, 900n, game(token1, token2), helper(), timing],
			}),
		).rejects.toThrow('Token transfer to executor was not exact')
		expect(await client.readContract({ abi: feeTokenArtifact.abi, address: token1, functionName: 'balanceOf', args: [executor] })).toBe(0n)
		expect(await client.readContract({ abi: feeTokenArtifact.abi, address: token1, functionName: 'balanceOf', args: [target] })).toBe(0n)
	})

	test('binds bundled execution to the exact canonical parent block', async () => {
		const parent = await client.getBlock()
		if (parent.number === undefined || parent.hash == null) throw new Error('parent block identity missing')
		const parentBlockHash = parent.hash
		const parentBlockNumber = parent.number
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: executorArtifact.abi,
				address: executor,
				functionName: 'assertParentBlock',
				args: [parentBlockNumber, parentBlockHash],
			}),
		)
		await getAnvilWindowEthereum().request({ method: 'evm_mine', params: [] })
		await expect(
			client.simulateContract({
				abi: executorArtifact.abi,
				address: executor,
				functionName: 'assertParentBlock',
				args: [parentBlockNumber, parentBlockHash],
			}),
		).rejects.toThrow('Execution must target the next block')
		await expect(
			client.simulateContract({
				abi: executorArtifact.abi,
				address: executor,
				functionName: 'assertParentBlock',
				args: [parentBlockNumber + 1n, `0x${'ff'.repeat(32)}`],
			}),
		).rejects.toThrow('canonical parent block changed')
	})

	test('rejects unauthenticated Uniswap V4 unlock callbacks', async () => {
		await expect(
			client.simulateContract({
				abi: executorArtifact.abi,
				address: executor,
				account: client.account,
				functionName: 'unlockCallback',
				args: ['0x'],
			}),
		).rejects.toThrow('Unauthorized Uniswap V4 unlock callback')
	})

	test('binds the Uniswap V4 callback to one exact invocation without exposing unrelated token balances', async () => {
		const weth = await deploy(wethArtifact)
		const token = await deploy(tokenArtifact, ['Token 2', 'TK2'])
		const unrelatedToken = await deploy(tokenArtifact, ['Unrelated Token', 'OTHER'])
		const poolManager = await deploy(v4PoolManagerArtifact)
		await writeContractAndWait(client, () => client.sendTransaction({ to: weth, value: 10_000n }))
		await writeContractAndWait(client, () => client.sendTransaction({ to: poolManager, value: 10_000n }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'mint', args: [client.account.address, 10_000n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: unrelatedToken, functionName: 'mint', args: [executor, 77n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: wethArtifact.abi, address: weth, functionName: 'approve', args: [executor, 2_200n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'approve', args: [executor, 1_000n] }))
		const alteredCallback = encodeAbiParameters(
			[
				{
					type: 'tuple',
					components: [
						{ name: 'token', type: 'address' },
						{ name: 'poolFee', type: 'uint24' },
						{ name: 'buyToken', type: 'bool' },
						{ name: 'amount', type: 'uint256' },
						{ name: 'limit', type: 'uint256' },
					],
				},
			],
			[{ amount: 77n, buyToken: false, limit: 0n, poolFee: 3_000, token: unrelatedToken }],
		)
		await writeContractAndWait(client, () => client.writeContract({ abi: v4PoolManagerArtifact.abi, address: poolManager, functionName: 'setCallbackAttack', args: [alteredCallback, false] }))
		const request = async () => {
			const block = await client.getBlock()
			if (block.number === undefined || block.hash == null) throw new Error('parent block identity missing')
			return {
				args: [
					{
						expectedParentBlockHash: block.hash,
						hedgeWethLimit: 900n,
						newAmount1: 1_200n,
						newAmount2: 900n,
						openOracle: target,
						poolFee: 3_000,
						router: poolManager,
						swapDeadline: block.timestamp + 1_000n,
						venue: 2,
					},
					game(weth, token),
					helper(),
					{ ...timing, blockNumber: block.number },
				] as const,
			}
		}
		await expect(writeContractAndWait(client, async () => client.writeContract({ abi: executorArtifact.abi, address: executor, account: client.account, functionName: 'hedgeAndDispute', ...(await request()) }))).rejects.toThrow('Unauthorized Uniswap V4 callback payload')
		expect(await client.readContract({ abi: tokenArtifact.abi, address: unrelatedToken, functionName: 'balanceOf', args: [executor] })).toBe(77n)

		await writeContractAndWait(client, () => client.writeContract({ abi: v4PoolManagerArtifact.abi, address: poolManager, functionName: 'setCallbackAttack', args: ['0x', true] }))
		await expect(writeContractAndWait(client, async () => client.writeContract({ abi: executorArtifact.abi, address: executor, account: client.account, functionName: 'hedgeAndDispute', ...(await request()) }))).rejects.toThrow('Unauthorized Uniswap V4 unlock callback')
		expect(await client.readContract({ abi: tokenArtifact.abi, address: unrelatedToken, functionName: 'balanceOf', args: [executor] })).toBe(77n)
	})

	test('atomically isolates exact lifecycle proceeds from permissionless dust and another same-token position', async () => {
		const token1 = await deploy(tokenArtifact, ['Token 1', 'TK1'])
		const token2 = await deploy(tokenArtifact, ['Token 2', 'TK2'])
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token1, functionName: 'mint', args: [client.account.address, 3_001n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token2, functionName: 'mint', args: [client.account.address, 5_001n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token1, functionName: 'approve', args: [openOracle, 3_001n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token2, functionName: 'approve', args: [openOracle, 5_001n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: openOracleArtifact.abi, address: openOracle, functionName: 'deposit', args: [token1, 3_000n, client.account.address] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: openOracleArtifact.abi, address: openOracle, functionName: 'deposit', args: [token2, 5_000n, client.account.address] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: openOracleArtifact.abi, address: openOracle, functionName: 'deposit', args: [token1, 1n, client.account.address] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: openOracleArtifact.abi, address: openOracle, functionName: 'deposit', args: [token2, 1n, client.account.address] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: openOracleArtifact.abi, address: openOracle, functionName: 'approveInternal', args: [executor, token1, 2n ** 256n - 1n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: openOracleArtifact.abi, address: openOracle, functionName: 'approveInternal', args: [executor, token2, 2n ** 256n - 1n] }))
		const parent = await client.getBlock()
		if (parent.number === undefined || parent.hash == null) throw new Error('parent block identity missing')
		const parentBlockHash = parent.hash
		const parentBlockNumber = parent.number
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: executorArtifact.abi,
				address: executor,
				functionName: 'settleAndWithdraw',
				args: [
					{
						amount1: 1_000n,
						amount2: 2_000n,
						expectedParentBlockHash: parentBlockHash,
						openOracle,
						parentBlockNumber,
					},
					game(token1, token2),
					helper(),
				],
			}),
		)
		expect(await client.readContract({ abi: openOracleArtifact.abi, address: openOracle, functionName: 'tokenHolder', args: [client.account.address, token1] })).toBe(2_002n)
		expect(await client.readContract({ abi: openOracleArtifact.abi, address: openOracle, functionName: 'tokenHolder', args: [client.account.address, token2] })).toBe(3_002n)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token1, functionName: 'balanceOf', args: [client.account.address] })).toBe(1_000n)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token2, functionName: 'balanceOf', args: [client.account.address] })).toBe(2_000n)
		await getAnvilWindowEthereum().request({ method: 'evm_mine', params: [] })
		await expect(
			client.simulateContract({
				abi: executorArtifact.abi,
				address: executor,
				functionName: 'settleAndWithdraw',
				args: [
					{
						amount1: 1n,
						amount2: 1n,
						expectedParentBlockHash: parentBlockHash,
						openOracle,
						parentBlockNumber,
					},
					game(token1, token2),
					helper(),
				],
			}),
		).rejects.toThrow('Execution must target the next block')
		expect(await client.readContract({ abi: openOracleArtifact.abi, address: openOracle, functionName: 'tokenHolder', args: [client.account.address, token1] })).toBe(2_002n)
		const secondParent = await client.getBlock()
		if (secondParent.number === undefined || secondParent.hash == null) throw new Error('second parent block identity missing')
		const secondParentBlockHash = secondParent.hash
		const secondParentBlockNumber = secondParent.number
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: executorArtifact.abi,
				address: executor,
				functionName: 'settleAndWithdraw',
				args: [
					{
						amount1: 2_000n,
						amount2: 3_000n,
						expectedParentBlockHash: secondParentBlockHash,
						openOracle,
						parentBlockNumber: secondParentBlockNumber,
					},
					game(token1, token2),
					{ ...helper(), reportId: 2n },
				],
			}),
		)
		expect(await client.readContract({ abi: openOracleArtifact.abi, address: openOracle, functionName: 'tokenHolder', args: [client.account.address, token1] })).toBe(2n)
		expect(await client.readContract({ abi: openOracleArtifact.abi, address: openOracle, functionName: 'tokenHolder', args: [client.account.address, token2] })).toBe(2n)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token1, functionName: 'balanceOf', args: [client.account.address] })).toBe(3_000n)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token2, functionName: 'balanceOf', args: [client.account.address] })).toBe(5_000n)
	})

	test.each([0, 1] as const)('atomically sells the report token through venue %d, funds the dispute, and refunds hedge WETH', async venue => {
		const token1 = await deploy(tokenArtifact, ['Token 1', 'TK1'])
		const token2 = await deploy(tokenArtifact, ['Token 2', 'TK2'])
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token1, functionName: 'mint', args: [client.account.address, 10_000n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token2, functionName: 'mint', args: [client.account.address, 10_000n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token1, functionName: 'mint', args: [router, 10_000n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token1, functionName: 'approve', args: [executor, 2_200n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token2, functionName: 'approve', args: [executor, 1_000n] }))
		const block = await client.getBlock()
		if (block.number === undefined || block.hash == null) throw new Error('parent block identity missing')
		const parentBlockHash = block.hash
		const parentBlockNumber = block.number
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: executorArtifact.abi,
				address: executor,
				functionName: 'hedgeAndDispute',
				args: [
					{
						expectedParentBlockHash: parentBlockHash,
						hedgeWethLimit: 900n,
						newAmount1: 1_200n,
						newAmount2: 900n,
						openOracle: target,
						poolFee: 3_000,
						router,
						swapDeadline: block.timestamp + 1_000n,
						venue,
					},
					game(token1, token2),
					helper(),
					{ ...timing, blockNumber: parentBlockNumber },
				],
			}),
		)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token1, functionName: 'balanceOf', args: [client.account.address] })).toBe(8_800n)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token1, functionName: 'balanceOf', args: [target] })).toBe(2_200n)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token2, functionName: 'balanceOf', args: [router] })).toBe(1_000n)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token1, functionName: 'allowance', args: [executor, router] })).toBe(0n)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token2, functionName: 'allowance', args: [executor, router] })).toBe(0n)
	})

	test.each([0, 1] as const)('atomically buys the report token through venue %d with a capped WETH input and funds the dispute', async venue => {
		const token1 = await deploy(tokenArtifact, ['Token 1', 'TK1'])
		const token2 = await deploy(tokenArtifact, ['Token 2', 'TK2'])
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token1, functionName: 'mint', args: [client.account.address, 10_000n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token2, functionName: 'mint', args: [client.account.address, 10_000n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token2, functionName: 'mint', args: [router, 10_000n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token1, functionName: 'approve', args: [executor, 1_300n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token2, functionName: 'approve', args: [executor, 1_300n] }))
		const block = await client.getBlock()
		if (block.number === undefined || block.hash == null) throw new Error('parent block identity missing')
		const parentBlockHash = block.hash
		const parentBlockNumber = block.number
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: executorArtifact.abi,
				address: executor,
				functionName: 'hedgeAndDispute',
				args: [
					{
						expectedParentBlockHash: parentBlockHash,
						hedgeWethLimit: 1_100n,
						newAmount1: 1_200n,
						newAmount2: 1_300n,
						openOracle: target,
						poolFee: 3_000,
						router,
						swapDeadline: block.timestamp + 1_000n,
						venue,
					},
					game(token1, token2),
					helper(),
					{ ...timing, blockNumber: parentBlockNumber },
				],
			}),
		)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token1, functionName: 'balanceOf', args: [client.account.address] })).toBe(8_800n)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token2, functionName: 'balanceOf', args: [client.account.address] })).toBe(8_700n)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token1, functionName: 'balanceOf', args: [target] })).toBe(200n)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token2, functionName: 'balanceOf', args: [target] })).toBe(2_300n)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token1, functionName: 'allowance', args: [executor, router] })).toBe(0n)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token2, functionName: 'allowance', args: [executor, router] })).toBe(0n)
	})

	test('atomically sells the report token through a hookless Uniswap V4 native-ETH pool', async () => {
		const weth = await deploy(wethArtifact)
		const token = await deploy(tokenArtifact, ['Token 2', 'TK2'])
		const poolManager = await deploy(v4PoolManagerArtifact)
		await writeContractAndWait(client, () => client.sendTransaction({ to: weth, value: 10_000n }))
		await writeContractAndWait(client, () => client.sendTransaction({ to: poolManager, value: 10_000n }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'mint', args: [client.account.address, 10_000n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: wethArtifact.abi, address: weth, functionName: 'approve', args: [executor, 2_200n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'approve', args: [executor, 1_000n] }))
		const block = await client.getBlock()
		if (block.number === undefined || block.hash == null) throw new Error('parent block identity missing')
		const parentBlockHash = block.hash
		const parentBlockNumber = block.number
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: executorArtifact.abi,
				address: executor,
				functionName: 'hedgeAndDispute',
				args: [
					{
						expectedParentBlockHash: parentBlockHash,
						hedgeWethLimit: 900n,
						newAmount1: 1_200n,
						newAmount2: 900n,
						openOracle: target,
						poolFee: 3_000,
						router: poolManager,
						swapDeadline: block.timestamp + 1_000n,
						venue: 2,
					},
					game(weth, token),
					helper(),
					{ ...timing, blockNumber: parentBlockNumber },
				],
			}),
		)
		expect(await client.readContract({ abi: wethArtifact.abi, address: weth, functionName: 'balanceOf', args: [client.account.address] })).toBe(8_800n)
		expect(await client.readContract({ abi: wethArtifact.abi, address: weth, functionName: 'balanceOf', args: [target] })).toBe(2_200n)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [poolManager] })).toBe(1_000n)
		expect(await client.getBalance({ address: executor })).toBe(0n)
	})

	test('atomically buys the report token through a hookless Uniswap V4 native-ETH pool', async () => {
		const weth = await deploy(wethArtifact)
		const token = await deploy(tokenArtifact, ['Token 2', 'TK2'])
		const staleSyncedToken = await deploy(tokenArtifact, ['Stale Synced Token', 'STALE'])
		const poolManager = await deploy(v4PoolManagerArtifact)
		await writeContractAndWait(client, () => client.sendTransaction({ to: weth, value: 10_000n }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'mint', args: [client.account.address, 10_000n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'mint', args: [poolManager, 10_000n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: staleSyncedToken, functionName: 'mint', args: [poolManager, 10_000n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: v4PoolManagerArtifact.abi, address: poolManager, functionName: 'seedSyncedCurrency', args: [staleSyncedToken] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: wethArtifact.abi, address: weth, functionName: 'approve', args: [executor, 1_300n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'approve', args: [executor, 1_300n] }))
		const block = await client.getBlock()
		if (block.number === undefined || block.hash == null) throw new Error('parent block identity missing')
		const parentBlockHash = block.hash
		const parentBlockNumber = block.number
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: executorArtifact.abi,
				address: executor,
				functionName: 'hedgeAndDispute',
				args: [
					{
						expectedParentBlockHash: parentBlockHash,
						hedgeWethLimit: 1_100n,
						newAmount1: 1_200n,
						newAmount2: 1_300n,
						openOracle: target,
						poolFee: 3_000,
						router: poolManager,
						swapDeadline: block.timestamp + 1_000n,
						venue: 2,
					},
					game(weth, token),
					helper(),
					{ ...timing, blockNumber: parentBlockNumber },
				],
			}),
		)
		expect(await client.readContract({ abi: wethArtifact.abi, address: weth, functionName: 'balanceOf', args: [client.account.address] })).toBe(8_800n)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [client.account.address] })).toBe(8_700n)
		expect(await client.readContract({ abi: wethArtifact.abi, address: weth, functionName: 'balanceOf', args: [target] })).toBe(200n)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [target] })).toBe(2_300n)
		expect(await client.getBalance({ address: executor })).toBe(0n)
	})

	test('withdraws one exact replacement credit without consuming unrelated holder balances', async () => {
		const replacementAmount = 2n ** 128n + 1n
		const creditedAmount = replacementAmount + 1n
		const token = await deploy(tokenArtifact, ['Replacement Token', 'RPL'])
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'mint', args: [client.account.address, creditedAmount] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'approve', args: [target, creditedAmount] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: targetArtifact.abi, address: target, functionName: 'credit', args: [token, creditedAmount, client.account.address] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: targetArtifact.abi, address: target, functionName: 'approveInternal', args: [executor, token, replacementAmount] }))
		const parent = await client.getBlock()
		if (parent.number === undefined || parent.hash == null) throw new Error('parent block identity missing')
		const parentBlockHash = parent.hash
		const parentBlockNumber = parent.number
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: executorArtifact.abi,
				address: executor,
				functionName: 'withdrawReplacementCredit',
				args: [
					{
						amount: replacementAmount,
						expectedParentBlockHash: parentBlockHash,
						openOracle: target,
						parentBlockNumber,
						token,
					},
					7n,
				],
			}),
		)
		expect(await client.readContract({ abi: targetArtifact.abi, address: target, functionName: 'tokenHolder', args: [client.account.address, token] })).toBe(1n)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [client.account.address] })).toBe(replacementAmount)
	})
})

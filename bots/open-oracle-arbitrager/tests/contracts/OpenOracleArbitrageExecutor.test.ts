import { encodeAbiParameters, encodeDeployData, getAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { useIsolatedAnvilNode } from '../../../../solidity/ts/testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../../../../solidity/ts/testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../../../solidity/ts/testSupport/simulator/utils/constants'
import { ensureDefined } from '../../../../solidity/ts/testSupport/simulator/utils/testUtils'
import { setupTestAccounts } from '../../../../solidity/ts/testSupport/simulator/utils/utilities'
import { executorArtifact } from '#contracts/artifacts.generated'
import { feeTokenArtifact, routerArtifact, targetArtifact, tokenArtifact, v4PoolManagerArtifact, wethArtifact } from './harness-artifacts.generated.ts'
import { statoblast_openOracle_OpenOracle_OpenOracle as openOracleArtifact } from '../../../../solidity/ts/types/contractArtifact'

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
		settlerRewardAttoEth: 0n,
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

	const mintToken = (token: Address, to: Address, amount: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'mint', args: [to, amount] }))
	const approveToken = (token: Address, spender: Address, amount: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'approve', args: [spender, amount] }))
	const tokenBalance = (token: Address, holder: Address) => client.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [holder] })
	const tokenAllowance = (token: Address, owner: Address, spender: Address) => client.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'allowance', args: [owner, spender] })
	const wethBalanceAttoEth = (weth: Address, holder: Address) => client.readContract({ abi: wethArtifact.abi, address: weth, functionName: 'balanceOf', args: [holder] })
	const openOracleHolding = (token: Address) => client.readContract({ abi: openOracleArtifact.abi, address: openOracle, functionName: 'tokenHolder', args: [client.account.address, token] })
	const deployTokenPair = async () => [await deploy(tokenArtifact, ['Token 1', 'TK1']), await deploy(tokenArtifact, ['Token 2', 'TK2'])] as const

	const parentBlock = async () => {
		const block = await client.getBlock()
		if (block.number === undefined || block.hash == null) throw new Error('parent block identity missing')
		return { hash: block.hash, number: block.number, timestamp: block.timestamp }
	}

	/** Hedges report token2 against token1 through `router` in the next block and funds a 1_200 token1 dispute. */
	const hedgeAndDispute = async (route: { hedgeWethLimitAttoEth: bigint; newAmount2: bigint; router: Address; venue: 0 | 1 | 2 }, token1: Address, token2: Address) => {
		const parent = await parentBlock()
		return await writeContractAndWait(client, () =>
			client.writeContract({
				abi: executorArtifact.abi,
				address: executor,
				account: client.account,
				functionName: 'hedgeAndDispute',
				args: [
					{
						expectedParentBlockHash: parent.hash,
						hedgeWethLimitAttoEth: route.hedgeWethLimitAttoEth,
						newAmount1: 1_200n,
						newAmount2: route.newAmount2,
						openOracle: target,
						poolFee: 3_000,
						router: route.router,
						swapDeadline: parent.timestamp + 1_000n,
						venue: route.venue,
					},
					game(token1, token2),
					helper(),
					{ ...timing, blockNumber: parent.number },
				],
			}),
		)
	}

	const settleAndWithdraw = (lifecycle: { amount1: bigint; amount2: bigint; parent: { hash: `0x${string}`; number: bigint } }, token1: Address, token2: Address, reportId = 1n) =>
		({
			abi: executorArtifact.abi,
			address: executor,
			functionName: 'settleAndWithdraw',
			args: [{ amount1: lifecycle.amount1, amount2: lifecycle.amount2, expectedParentBlockHash: lifecycle.parent.hash, openOracle, parentBlockNumber: lifecycle.parent.number }, game(token1, token2), { ...helper(), reportId }],
		}) as const

	beforeAll(async () => {
		const window = getAnvilWindowEthereum()
		await setupTestAccounts(window)
		client = createWriteClient(window, ensureDefined(TEST_ADDRESSES[0], 'test account missing'))
		executor = await deploy(executorArtifact)
		openOracle = await deploy(openOracleArtifact)
		target = await deploy(targetArtifact)
		router = await deploy(routerArtifact)
		await setBaselineSnapshot()
	})

	beforeEach(() => {
		const window = getAnvilWindowEthereum()
		client = createWriteClient(window, ensureDefined(TEST_ADDRESSES[0], 'test account missing'))
	})

	test('funds a vanilla-token dispute atomically and retains no operation-pulled token or allowance', async () => {
		const [token1, token2] = await deployTokenPair()
		await mintToken(token1, client.account.address, 10_000n)
		await mintToken(token2, client.account.address, 10_000n)
		await approveToken(token1, executor, 2_200n)
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: executorArtifact.abi,
				address: executor,
				functionName: 'dispute',
				args: [target, 1_200n, 900n, game(token1, token2), helper(), timing],
			}),
		)
		expect(await tokenBalance(token1, executor)).toBe(0n)
		expect(await tokenAllowance(token1, executor, target)).toBe(0n)
		expect(await tokenBalance(token1, target)).toBe(2_200n)
	})

	test('preserves an unsolicited balance that has no withdrawal path', async () => {
		const [token1, token2] = await deployTokenPair()
		await mintToken(token1, client.account.address, 10_100n)
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token1, functionName: 'transfer', args: [executor, 100n] }))
		await approveToken(token1, executor, 2_200n)
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: executorArtifact.abi,
				address: executor,
				functionName: 'dispute',
				args: [target, 1_200n, 900n, game(token1, token2), helper(), timing],
			}),
		)
		expect(await tokenBalance(token1, executor)).toBe(100n)
		expect(await tokenBalance(token1, target)).toBe(2_200n)
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
		const parent = await parentBlock()
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: executorArtifact.abi,
				address: executor,
				functionName: 'assertParentBlock',
				args: [parent.number, parent.hash],
			}),
		)
		await getAnvilWindowEthereum().request({ method: 'evm_mine', params: [] })
		await expect(
			client.simulateContract({
				abi: executorArtifact.abi,
				address: executor,
				functionName: 'assertParentBlock',
				args: [parent.number, parent.hash],
			}),
		).rejects.toThrow('Execution must target the next block')
		await expect(
			client.simulateContract({
				abi: executorArtifact.abi,
				address: executor,
				functionName: 'assertParentBlock',
				args: [parent.number + 1n, `0x${'ff'.repeat(32)}`],
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
		await mintToken(token, client.account.address, 10_000n)
		await mintToken(unrelatedToken, executor, 77n)
		await writeContractAndWait(client, () => client.writeContract({ abi: wethArtifact.abi, address: weth, functionName: 'approve', args: [executor, 2_200n] }))
		await approveToken(token, executor, 1_000n)
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
		const route = { hedgeWethLimitAttoEth: 900n, newAmount2: 900n, router: poolManager, venue: 2 } as const
		await expect(hedgeAndDispute(route, weth, token)).rejects.toThrow('Unauthorized Uniswap V4 callback payload')
		expect(await tokenBalance(unrelatedToken, executor)).toBe(77n)

		await writeContractAndWait(client, () => client.writeContract({ abi: v4PoolManagerArtifact.abi, address: poolManager, functionName: 'setCallbackAttack', args: ['0x', true] }))
		await expect(hedgeAndDispute(route, weth, token)).rejects.toThrow('Unauthorized Uniswap V4 unlock callback')
		expect(await tokenBalance(unrelatedToken, executor)).toBe(77n)
	})

	test('atomically isolates exact lifecycle proceeds from permissionless dust and another same-token position', async () => {
		const [token1, token2] = await deployTokenPair()
		await mintToken(token1, client.account.address, 3_001n)
		await mintToken(token2, client.account.address, 5_001n)
		await approveToken(token1, openOracle, 3_001n)
		await approveToken(token2, openOracle, 5_001n)
		await writeContractAndWait(client, () => client.writeContract({ abi: openOracleArtifact.abi, address: openOracle, functionName: 'deposit', args: [token1, 3_000n, client.account.address] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: openOracleArtifact.abi, address: openOracle, functionName: 'deposit', args: [token2, 5_000n, client.account.address] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: openOracleArtifact.abi, address: openOracle, functionName: 'deposit', args: [token1, 1n, client.account.address] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: openOracleArtifact.abi, address: openOracle, functionName: 'deposit', args: [token2, 1n, client.account.address] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: openOracleArtifact.abi, address: openOracle, functionName: 'approveInternal', args: [executor, token1, 2n ** 256n - 1n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: openOracleArtifact.abi, address: openOracle, functionName: 'approveInternal', args: [executor, token2, 2n ** 256n - 1n] }))
		const parent = await parentBlock()
		await writeContractAndWait(client, () => client.writeContract(settleAndWithdraw({ amount1: 1_000n, amount2: 2_000n, parent: parent }, token1, token2)))
		expect(await openOracleHolding(token1)).toBe(2_002n)
		expect(await openOracleHolding(token2)).toBe(3_002n)
		expect(await tokenBalance(token1, client.account.address)).toBe(1_000n)
		expect(await tokenBalance(token2, client.account.address)).toBe(2_000n)
		await getAnvilWindowEthereum().request({ method: 'evm_mine', params: [] })
		await expect(client.simulateContract(settleAndWithdraw({ amount1: 1n, amount2: 1n, parent }, token1, token2))).rejects.toThrow('Execution must target the next block')
		expect(await openOracleHolding(token1)).toBe(2_002n)
		const secondParent = await parentBlock()
		await writeContractAndWait(client, () => client.writeContract(settleAndWithdraw({ amount1: 2_000n, amount2: 3_000n, parent: secondParent }, token1, token2, 2n)))
		expect(await openOracleHolding(token1)).toBe(2n)
		expect(await openOracleHolding(token2)).toBe(2n)
		expect(await tokenBalance(token1, client.account.address)).toBe(3_000n)
		expect(await tokenBalance(token2, client.account.address)).toBe(5_000n)
	})

	test.each([0, 1] as const)('atomically sells the report token through venue %d, funds the dispute, and refunds hedge WETH', async venue => {
		const [token1, token2] = await deployTokenPair()
		await mintToken(token1, client.account.address, 10_000n)
		await mintToken(token2, client.account.address, 10_000n)
		await mintToken(token1, router, 10_000n)
		await approveToken(token1, executor, 2_200n)
		await approveToken(token2, executor, 1_000n)
		await hedgeAndDispute({ hedgeWethLimitAttoEth: 900n, newAmount2: 900n, router, venue }, token1, token2)
		expect(await tokenBalance(token1, client.account.address)).toBe(8_800n)
		expect(await tokenBalance(token1, target)).toBe(2_200n)
		expect(await tokenBalance(token2, router)).toBe(1_000n)
		expect(await tokenAllowance(token1, executor, router)).toBe(0n)
		expect(await tokenAllowance(token2, executor, router)).toBe(0n)
	})

	test.each([0, 1] as const)('atomically buys the report token through venue %d with a capped WETH input and funds the dispute', async venue => {
		const [token1, token2] = await deployTokenPair()
		await mintToken(token1, client.account.address, 10_000n)
		await mintToken(token2, client.account.address, 10_000n)
		await mintToken(token2, router, 10_000n)
		await approveToken(token1, executor, 1_300n)
		await approveToken(token2, executor, 1_300n)
		await hedgeAndDispute({ hedgeWethLimitAttoEth: 1_100n, newAmount2: 1_300n, router, venue }, token1, token2)
		expect(await tokenBalance(token1, client.account.address)).toBe(8_800n)
		expect(await tokenBalance(token2, client.account.address)).toBe(8_700n)
		expect(await tokenBalance(token1, target)).toBe(200n)
		expect(await tokenBalance(token2, target)).toBe(2_300n)
		expect(await tokenAllowance(token1, executor, router)).toBe(0n)
		expect(await tokenAllowance(token2, executor, router)).toBe(0n)
	})

	test('atomically sells the report token through a hookless Uniswap V4 native-ETH pool', async () => {
		const weth = await deploy(wethArtifact)
		const token = await deploy(tokenArtifact, ['Token 2', 'TK2'])
		const poolManager = await deploy(v4PoolManagerArtifact)
		await writeContractAndWait(client, () => client.sendTransaction({ to: weth, value: 10_000n }))
		await writeContractAndWait(client, () => client.sendTransaction({ to: poolManager, value: 10_000n }))
		await mintToken(token, client.account.address, 10_000n)
		await writeContractAndWait(client, () => client.writeContract({ abi: wethArtifact.abi, address: weth, functionName: 'approve', args: [executor, 2_200n] }))
		await approveToken(token, executor, 1_000n)
		await hedgeAndDispute({ hedgeWethLimitAttoEth: 900n, newAmount2: 900n, router: poolManager, venue: 2 }, weth, token)
		expect(await wethBalanceAttoEth(weth, client.account.address)).toBe(8_800n)
		expect(await wethBalanceAttoEth(weth, target)).toBe(2_200n)
		expect(await tokenBalance(token, poolManager)).toBe(1_000n)
		expect(await client.getBalance({ address: executor })).toBe(0n)
	})

	test('atomically buys the report token through a hookless Uniswap V4 native-ETH pool', async () => {
		const weth = await deploy(wethArtifact)
		const token = await deploy(tokenArtifact, ['Token 2', 'TK2'])
		const staleSyncedToken = await deploy(tokenArtifact, ['Stale Synced Token', 'STALE'])
		const poolManager = await deploy(v4PoolManagerArtifact)
		await writeContractAndWait(client, () => client.sendTransaction({ to: weth, value: 10_000n }))
		await mintToken(token, client.account.address, 10_000n)
		await mintToken(token, poolManager, 10_000n)
		await mintToken(staleSyncedToken, poolManager, 10_000n)
		await writeContractAndWait(client, () => client.writeContract({ abi: v4PoolManagerArtifact.abi, address: poolManager, functionName: 'seedSyncedCurrency', args: [staleSyncedToken] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: wethArtifact.abi, address: weth, functionName: 'approve', args: [executor, 1_300n] }))
		await approveToken(token, executor, 1_300n)
		await hedgeAndDispute({ hedgeWethLimitAttoEth: 1_100n, newAmount2: 1_300n, router: poolManager, venue: 2 }, weth, token)
		expect(await wethBalanceAttoEth(weth, client.account.address)).toBe(8_800n)
		expect(await tokenBalance(token, client.account.address)).toBe(8_700n)
		expect(await wethBalanceAttoEth(weth, target)).toBe(200n)
		expect(await tokenBalance(token, target)).toBe(2_300n)
		expect(await client.getBalance({ address: executor })).toBe(0n)
	})

	test('withdraws one exact replacement credit without consuming unrelated holder balances', async () => {
		const replacementAmount = 2n ** 128n + 1n
		const creditedAmount = replacementAmount + 1n
		const token = await deploy(tokenArtifact, ['Replacement Token', 'RPL'])
		await mintToken(token, client.account.address, creditedAmount)
		await approveToken(token, target, creditedAmount)
		await writeContractAndWait(client, () => client.writeContract({ abi: targetArtifact.abi, address: target, functionName: 'credit', args: [token, creditedAmount, client.account.address] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: targetArtifact.abi, address: target, functionName: 'approveInternal', args: [executor, token, replacementAmount] }))
		const parent = await parentBlock()
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: executorArtifact.abi,
				address: executor,
				functionName: 'withdrawReplacementCredit',
				args: [
					{
						amount: replacementAmount,
						expectedParentBlockHash: parent.hash,
						openOracle: target,
						parentBlockNumber: parent.number,
						token,
					},
					7n,
				],
			}),
		)
		expect(await client.readContract({ abi: targetArtifact.abi, address: target, functionName: 'tokenHolder', args: [client.account.address, token] })).toBe(1n)
		expect(await tokenBalance(token, client.account.address)).toBe(replacementAmount)
	})
})

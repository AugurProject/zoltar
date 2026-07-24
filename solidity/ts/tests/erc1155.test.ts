import { beforeAll, beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import assert from '../testSupport/simulator/utils/assert'
import { decodeEventLog, encodeDeployData, encodeFunctionData, type Address, type Hex, zeroAddress } from '@zoltar/shared/ethereum'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { ensureInfraDeployed } from '../testSupport/simulator/utils/contracts/deployPeripherals'
import { ensureZoltarDeployed, forkUniverse, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion, getQuestionId } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { approveToken, setupTestAccounts, sortStringArrayByKeccak } from '../testSupport/simulator/utils/utilities'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { peripherals_tokens_ShareToken_ShareToken, test_peripherals_ERC1155ReceiverMock_ERC1155NonReceiver, test_peripherals_ERC1155ReceiverMock_ERC1155ReceiverMock, test_peripherals_ERC1155ReceiverMock_ShareTokenAuthorizationPoolMock } from '../types/contractArtifact'

setDefaultTimeout(TEST_TIMEOUT_MS)

describe('ERC1155 Compliance Test Suite', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	let operatorClient: WriteClient

	const deployContract = async (deploymentData: Hex) => {
		const hash = await client.sendTransaction({ data: deploymentData })
		const receipt = await client.waitForTransactionReceipt({ hash })
		const contractAddress = receipt.contractAddress
		if (contractAddress === undefined || contractAddress === null) throw new Error('deployment address missing')
		return contractAddress
	}

	const deployShareToken = async (questionId = 1n) =>
		await deployContract(
			encodeDeployData({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				bytecode: `0x${peripherals_tokens_ShareToken_ShareToken.evm.bytecode.object}`,
				args: [client.account.address, getZoltarAddress(), questionId],
			}),
		)

	const deployReceiver = async () =>
		await deployContract(
			encodeDeployData({
				abi: test_peripherals_ERC1155ReceiverMock_ERC1155ReceiverMock.abi,
				bytecode: `0x${test_peripherals_ERC1155ReceiverMock_ERC1155ReceiverMock.evm.bytecode.object}`,
			}),
		)

	const deployNonReceiver = async () =>
		await deployContract(
			encodeDeployData({
				abi: test_peripherals_ERC1155ReceiverMock_ERC1155NonReceiver.abi,
				bytecode: `0x${test_peripherals_ERC1155ReceiverMock_ERC1155NonReceiver.evm.bytecode.object}`,
			}),
		)

	const mintCompleteSets = async (shareTokenAddress: Address, account: Address, amount: bigint) =>
		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_tokens_ShareToken_ShareToken.abi,
					address: shareTokenAddress,
					functionName: 'mintCompleteSets',
					args: [0n, account, amount],
				}),
		)

	const readTokenId = async (shareTokenAddress: Address, outcome: 0 | 1 | 2) =>
		await client.readContract({
			abi: peripherals_tokens_ShareToken_ShareToken.abi,
			address: shareTokenAddress,
			functionName: 'getTokenId',
			args: [0n, outcome],
		})

	const transactWithShareToken = async (shareTokenAddress: Address, data: Hex) => await writeContractAndWait(client, async () => await client.sendTransaction({ to: shareTokenAddress, data }))

	beforeAll(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)
		await setBaselineSnapshot()
	})

	beforeEach(() => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		operatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
	})

	test('share token supports ERC165 and ERC1155 interface identifiers', async () => {
		const shareTokenAddress = await deployShareToken()
		assert.strictEqual(
			await client.readContract({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				address: shareTokenAddress,
				functionName: 'supportsInterface',
				args: ['0x01ffc9a7'],
			}),
			true,
			'share token should support ERC165',
		)
		assert.strictEqual(
			await client.readContract({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				address: shareTokenAddress,
				functionName: 'supportsInterface',
				args: ['0xd9b67a26'],
			}),
			true,
			'share token should support ERC1155',
		)
	})

	test('balance queries and operator approval expose every public ERC1155 guard reason', async () => {
		const shareTokenAddress = await deployShareToken()
		const shareTokenAbi = peripherals_tokens_ShareToken_ShareToken.abi

		await assert.rejects(
			client.readContract({
				abi: shareTokenAbi,
				address: shareTokenAddress,
				functionName: 'balanceOf',
				args: [zeroAddress, 1n],
			}),
			/ERC1155: balance query account must not be the zero address/,
		)
		await assert.rejects(
			client.readContract({
				abi: shareTokenAbi,
				address: shareTokenAddress,
				functionName: 'balanceOfBatch',
				args: [[client.account.address], []],
			}),
			/ERC1155: accounts and IDs arrays must have the same length/,
		)
		await assert.rejects(
			client.readContract({
				abi: shareTokenAbi,
				address: shareTokenAddress,
				functionName: 'balanceOfBatch',
				args: [[zeroAddress], [1n]],
			}),
			/ERC1155: batch balance query account must not be the zero address/,
		)
		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: shareTokenAbi,
					address: shareTokenAddress,
					functionName: 'setApprovalForAll',
					args: [client.account.address, true],
				}),
			),
			/ERC1155: account cannot set approval status for itself/,
		)
	})

	test('single and batch transfers expose target, authorization, and array-shape guard reasons', async () => {
		const shareTokenAddress = await deployShareToken()
		const shareTokenAbi = peripherals_tokens_ShareToken_ShareToken.abi
		await mintCompleteSets(shareTokenAddress, client.account.address, 1n)
		const yesTokenId = await readTokenId(shareTokenAddress, 1)

		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: shareTokenAbi,
					address: shareTokenAddress,
					functionName: 'safeTransferFrom',
					args: [client.account.address, zeroAddress, yesTokenId, 1n],
				}),
			),
			/ERC1155: transfer target address must be non-zero/,
		)
		await assert.rejects(
			writeContractAndWait(operatorClient, () =>
				operatorClient.writeContract({
					abi: shareTokenAbi,
					address: shareTokenAddress,
					functionName: 'safeTransferFrom',
					args: [client.account.address, operatorClient.account.address, yesTokenId, 1n],
				}),
			),
			/ERC1155: caller needs operator approval for third-party transfers/,
		)
		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: shareTokenAbi,
					address: shareTokenAddress,
					functionName: 'safeBatchTransferFrom',
					args: [client.account.address, operatorClient.account.address, [yesTokenId], []],
				}),
			),
			/ERC1155: batch transfer IDs and values arrays must have the same length/,
		)
		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: shareTokenAbi,
					address: shareTokenAddress,
					functionName: 'safeBatchTransferFrom',
					args: [client.account.address, zeroAddress, [yesTokenId], [1n]],
				}),
			),
			/ERC1155: batch transfer target address must be non-zero/,
		)
		await assert.rejects(
			writeContractAndWait(operatorClient, () =>
				operatorClient.writeContract({
					abi: shareTokenAbi,
					address: shareTokenAddress,
					functionName: 'safeBatchTransferFrom',
					args: [client.account.address, operatorClient.account.address, [yesTokenId], [1n]],
				}),
			),
			/ERC1155: caller needs operator approval for third-party batch transfers/,
		)
	})

	test('share-token mint and burn entry points expose inherited zero-account guards', async () => {
		const shareTokenAddress = await deployShareToken()

		await assert.rejects(mintCompleteSets(shareTokenAddress, zeroAddress, 1n), /ERC1155: batch mint receiver must not be the zero address/)
		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: peripherals_tokens_ShareToken_ShareToken.abi,
					address: shareTokenAddress,
					functionName: 'burnCompleteSets',
					args: [0n, zeroAddress, 1n],
				}),
			),
			/ERC1155: batch burn account must not be the zero address/,
		)
	})

	test('authorization events identify constructor and chained authorization actors', async () => {
		const deploymentHash = await client.sendTransaction({
			data: encodeDeployData({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				bytecode: `0x${peripherals_tokens_ShareToken_ShareToken.evm.bytecode.object}`,
				args: [client.account.address, getZoltarAddress(), 2n],
			}),
		})
		const deploymentReceipt = await client.waitForTransactionReceipt({
			hash: deploymentHash,
		})
		const shareTokenAddress = deploymentReceipt.contractAddress
		if (shareTokenAddress === undefined || shareTokenAddress === null) throw new Error('share token address missing')
		const constructorLog = deploymentReceipt.logs
			.filter(log => log.address.toLowerCase() === shareTokenAddress.toLowerCase())
			.map(log =>
				decodeEventLog({
					abi: peripherals_tokens_ShareToken_ShareToken.abi,
					data: log.data,
					topics: log.topics,
				}),
			)
			.find(log => log.eventName === 'AuthorizationUpdated')
		if (constructorLog === undefined) throw new Error('constructor authorization log missing')
		assert.strictEqual(constructorLog.args.account, client.account.address)
		assert.strictEqual(constructorLog.args.actor, client.account.address)
		assert.strictEqual(constructorLog.args.authorized, true)

		const firstPool = await deployContract(
			encodeDeployData({
				abi: test_peripherals_ERC1155ReceiverMock_ShareTokenAuthorizationPoolMock.abi,
				bytecode: `0x${test_peripherals_ERC1155ReceiverMock_ShareTokenAuthorizationPoolMock.evm.bytecode.object}`,
				args: [shareTokenAddress, 0n],
			}),
		)
		const chainedPool = await deployContract(
			encodeDeployData({
				abi: test_peripherals_ERC1155ReceiverMock_ShareTokenAuthorizationPoolMock.abi,
				bytecode: `0x${test_peripherals_ERC1155ReceiverMock_ShareTokenAuthorizationPoolMock.evm.bytecode.object}`,
				args: [shareTokenAddress, 1n],
			}),
		)
		const collidingPool = await deployContract(
			encodeDeployData({
				abi: test_peripherals_ERC1155ReceiverMock_ShareTokenAuthorizationPoolMock.abi,
				bytecode: `0x${test_peripherals_ERC1155ReceiverMock_ShareTokenAuthorizationPoolMock.evm.bytecode.object}`,
				args: [shareTokenAddress, 0n],
			}),
		)
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				address: shareTokenAddress,
				functionName: 'authorize',
				args: [firstPool],
			}),
		)
		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: peripherals_tokens_ShareToken_ShareToken.abi,
					address: shareTokenAddress,
					functionName: 'authorize',
					args: [collidingPool],
				}),
			),
			/ShareToken universe already has a canonical pool/,
		)
		assert.strictEqual(
			await client.readContract({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				address: shareTokenAddress,
				functionName: 'canonicalPoolByUniverse',
				args: [0n],
			}),
			firstPool,
		)
		assert.strictEqual(
			await client.readContract({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				address: shareTokenAddress,
				functionName: 'isAuthorized',
				args: [firstPool],
			}),
			true,
		)
		assert.strictEqual(
			await client.readContract({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				address: shareTokenAddress,
				functionName: 'isAuthorized',
				args: [collidingPool],
			}),
			false,
		)
		const chainedHash = await writeContractAndWait(client, () =>
			client.writeContract({
				abi: test_peripherals_ERC1155ReceiverMock_ShareTokenAuthorizationPoolMock.abi,
				address: firstPool,
				functionName: 'authorizePool',
				args: [chainedPool],
			}),
		)
		const chainedReceipt = await client.waitForTransactionReceipt({
			hash: chainedHash,
		})
		const chainedLog = chainedReceipt.logs
			.map(log =>
				decodeEventLog({
					abi: peripherals_tokens_ShareToken_ShareToken.abi,
					data: log.data,
					topics: log.topics,
				}),
			)
			.find(log => log.eventName === 'AuthorizationUpdated')
		if (chainedLog === undefined) throw new Error('chained authorization log missing')
		assert.strictEqual(chainedLog.args.account, chainedPool)
		assert.strictEqual(chainedLog.args.actor, firstPool)
		assert.strictEqual(chainedLog.args.authorized, true)
		assert.strictEqual(
			await client.readContract({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				address: shareTokenAddress,
				functionName: 'isAuthorized',
				args: [chainedPool],
			}),
			true,
		)
	})

	test('share token authorization and privileged supply operations expose every guard reason', async () => {
		const shareTokenAddress = await deployShareToken()
		const otherShareTokenAddress = await deployShareToken(2n)
		const wrongShareTokenPool = await deployContract(
			encodeDeployData({
				abi: test_peripherals_ERC1155ReceiverMock_ShareTokenAuthorizationPoolMock.abi,
				bytecode: `0x${test_peripherals_ERC1155ReceiverMock_ShareTokenAuthorizationPoolMock.evm.bytecode.object}`,
				args: [otherShareTokenAddress, 0n],
			}),
		)
		const tokenAbi = peripherals_tokens_ShareToken_ShareToken.abi
		const tokenId = await readTokenId(shareTokenAddress, 1)

		await assert.rejects(
			writeContractAndWait(operatorClient, () =>
				operatorClient.writeContract({
					abi: tokenAbi,
					address: shareTokenAddress,
					functionName: 'authorize',
					args: [wrongShareTokenPool],
				}),
			),
			/ShareToken caller is not authorized to add another authorized pool/,
		)
		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: tokenAbi,
					address: shareTokenAddress,
					functionName: 'authorize',
					args: [wrongShareTokenPool],
				}),
			),
			/ShareToken candidate must use this share token/,
		)
		assert.strictEqual(
			await client.readContract({
				abi: tokenAbi,
				address: shareTokenAddress,
				functionName: 'isAuthorized',
				args: [wrongShareTokenPool],
			}),
			false,
			'rejected candidates must remain unauthorized',
		)

		await assert.rejects(
			writeContractAndWait(operatorClient, () =>
				operatorClient.writeContract({
					abi: tokenAbi,
					address: shareTokenAddress,
					functionName: 'mintCompleteSets',
					args: [0n, operatorClient.account.address, 1n],
				}),
			),
			/ShareToken caller is not authorized to mint complete sets/,
		)
		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: tokenAbi,
					address: shareTokenAddress,
					functionName: 'mintCompleteSets',
					args: [0n, client.account.address, 0n],
				}),
			),
			/Exchange rate undefined/,
		)
		await assert.rejects(
			writeContractAndWait(operatorClient, () =>
				operatorClient.writeContract({
					abi: tokenAbi,
					address: shareTokenAddress,
					functionName: 'burnCompleteSets',
					args: [0n, client.account.address, 1n],
				}),
			),
			/ShareToken caller is not authorized to burn complete sets/,
		)
		await assert.rejects(
			writeContractAndWait(operatorClient, () =>
				operatorClient.writeContract({
					abi: tokenAbi,
					address: shareTokenAddress,
					functionName: 'burnTokenIdAndGetRemainingSupply',
					args: [tokenId, client.account.address],
				}),
			),
			/ShareToken caller is not authorized to burn this token id/,
		)

		assert.strictEqual(
			await client.readContract({
				abi: tokenAbi,
				address: shareTokenAddress,
				functionName: 'totalSupply',
				args: [tokenId],
			}),
			0n,
			'rejected privileged operations must not change supply',
		)
	})

	test('share migration exposes precondition errors before canonical-pool migration begins', async () => {
		const shareTokenAddress = await deployShareToken()
		const tokenAbi = peripherals_tokens_ShareToken_ShareToken.abi
		const sourceTokenId = await readTokenId(shareTokenAddress, 1)
		const unforkedTokenId = (999n << 8n) | 1n

		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: tokenAbi,
					address: shareTokenAddress,
					functionName: 'migrate',
					args: [unforkedTokenId, [1n]],
				}),
			),
			/ShareToken universe has not forked, so shares cannot migrate/,
		)

		const questionData = {
			title: 'ERC1155 migration guard question',
			description: '',
			startTime: 0n,
			endTime: 0n,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const outcomes = sortStringArrayByKeccak(['Yes', 'No'])
		await createQuestion(client, questionData, outcomes)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(client, 0n, getQuestionId(questionData, outcomes))

		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: tokenAbi,
					address: shareTokenAddress,
					functionName: 'migrate',
					args: [sourceTokenId, []],
				}),
			),
			/ShareToken migration requires at least one target outcome/,
		)
		await assert.rejects(
			writeContractAndWait(operatorClient, () =>
				operatorClient.writeContract({
					abi: tokenAbi,
					address: shareTokenAddress,
					functionName: 'migrate',
					args: [sourceTokenId, [1n]],
				}),
			),
			/ShareToken holder has no balance to migrate from the source token id/,
		)

		await mintCompleteSets(shareTokenAddress, client.account.address, 1n)
		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: tokenAbi,
					address: shareTokenAddress,
					functionName: 'migrate',
					args: [sourceTokenId, [1n]],
				}),
			),
			/ShareToken source universe is missing a canonical pool/,
		)

		const nonMigratableSourcePool = await deployContract(
			encodeDeployData({
				abi: test_peripherals_ERC1155ReceiverMock_ShareTokenAuthorizationPoolMock.abi,
				bytecode: `0x${test_peripherals_ERC1155ReceiverMock_ShareTokenAuthorizationPoolMock.evm.bytecode.object}`,
				args: [shareTokenAddress, 0n],
			}),
		)
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: tokenAbi,
				address: shareTokenAddress,
				functionName: 'authorize',
				args: [nonMigratableSourcePool],
			}),
		)
		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: tokenAbi,
					address: shareTokenAddress,
					functionName: 'migrate',
					args: [sourceTokenId, [1n]],
				}),
			),
			/ShareToken source pool cannot migrate/,
		)
		assert.strictEqual(
			await client.readContract({
				abi: tokenAbi,
				address: shareTokenAddress,
				functionName: 'balanceOf',
				args: [client.account.address, sourceTokenId],
			}),
			1n,
			'rejected migration must retain the source balance',
		)
		const childUniverseId = await client.readContract({
			abi: tokenAbi,
			address: shareTokenAddress,
			functionName: 'getChildUniverseId',
			args: [0n, 1n],
		})
		assert.strictEqual(
			await client.readContract({
				abi: tokenAbi,
				address: shareTokenAddress,
				functionName: 'canonicalPoolByUniverse',
				args: [childUniverseId],
			}),
			zeroAddress,
			'rejected migration must not materialize a child pool',
		)
	})

	test('single and batch transfers reject contract recipients without IERC1155Receiver', async () => {
		const shareTokenAddress = await deployShareToken()
		const nonReceiverAddress = await deployNonReceiver()
		await mintCompleteSets(shareTokenAddress, client.account.address, 1n)
		const invalidTokenId = await readTokenId(shareTokenAddress, 0)
		const yesTokenId = await readTokenId(shareTokenAddress, 1)
		const readBalances = async (account: Address) =>
			await Promise.all(
				[invalidTokenId, yesTokenId].map(
					async tokenId =>
						await client.readContract({
							abi: peripherals_tokens_ShareToken_ShareToken.abi,
							address: shareTokenAddress,
							functionName: 'balanceOf',
							args: [account, tokenId],
						}),
				),
			)

		await assert.rejects(
			writeContractAndWait(
				client,
				async () =>
					await client.writeContract({
						abi: peripherals_tokens_ShareToken_ShareToken.abi,
						address: shareTokenAddress,
						functionName: 'safeTransferFrom',
						args: [client.account.address, nonReceiverAddress, yesTokenId, 1n, '0x1234'],
					}),
			),
			/ERC1155: transfer target does not implement ERC1155Receiver for single transfers/,
		)
		assert.deepStrictEqual(await readBalances(client.account.address), [1n, 1n], 'rejected single transfer must preserve sender balances')
		assert.deepStrictEqual(await readBalances(nonReceiverAddress), [0n, 0n], 'rejected single transfer must not credit the non-receiver')
		await assert.rejects(
			writeContractAndWait(client, () =>
				client.writeContract({
					abi: peripherals_tokens_ShareToken_ShareToken.abi,
					address: shareTokenAddress,
					functionName: 'safeBatchTransferFrom',
					args: [client.account.address, nonReceiverAddress, [invalidTokenId, yesTokenId], [1n, 1n]],
				}),
			),
			/ERC1155: transfer target does not implement ERC1155Receiver for batch transfers/,
		)
		assert.deepStrictEqual(await readBalances(client.account.address), [1n, 1n], 'rejected batch transfer must preserve every sender balance')
		assert.deepStrictEqual(await readBalances(nonReceiverAddress), [0n, 0n], 'rejected batch transfer must not partially credit the non-receiver')
	})

	test('receiver rejection, revert, and panic paths expose canonical single and batch errors', async () => {
		const shareTokenAddress = await deployShareToken()
		const receiverAddress = await deployReceiver()
		const shareTokenAbi = peripherals_tokens_ShareToken_ShareToken.abi
		const receiverAbi = test_peripherals_ERC1155ReceiverMock_ERC1155ReceiverMock.abi
		await mintCompleteSets(shareTokenAddress, client.account.address, 1n)
		const invalidTokenId = await readTokenId(shareTokenAddress, 0)
		const yesTokenId = await readTokenId(shareTokenAddress, 1)
		const readBalances = async (account: Address) =>
			await Promise.all(
				[invalidTokenId, yesTokenId].map(
					async tokenId =>
						await client.readContract({
							abi: shareTokenAbi,
							address: shareTokenAddress,
							functionName: 'balanceOf',
							args: [account, tokenId],
						}),
				),
			)
		const readReceiverObservations = async () => ({
			batchReceiveCount: await client.readContract({ abi: receiverAbi, address: receiverAddress, functionName: 'batchReceiveCount', args: [] }),
			lastData: await client.readContract({ abi: receiverAbi, address: receiverAddress, functionName: 'lastData', args: [] }),
			lastFrom: await client.readContract({ abi: receiverAbi, address: receiverAddress, functionName: 'lastFrom', args: [] }),
			lastId: await client.readContract({ abi: receiverAbi, address: receiverAddress, functionName: 'lastId', args: [] }),
			lastOperator: await client.readContract({ abi: receiverAbi, address: receiverAddress, functionName: 'lastOperator', args: [] }),
			lastValue: await client.readContract({ abi: receiverAbi, address: receiverAddress, functionName: 'lastValue', args: [] }),
			singleReceiveCount: await client.readContract({ abi: receiverAbi, address: receiverAddress, functionName: 'singleReceiveCount', args: [] }),
		})
		const emptyReceiverObservations = {
			batchReceiveCount: 0n,
			lastData: '0x',
			lastFrom: zeroAddress,
			lastId: 0n,
			lastOperator: zeroAddress,
			lastValue: 0n,
			singleReceiveCount: 0n,
		}
		const assertTransferRollback = async (label: string) => {
			assert.deepStrictEqual(await readBalances(client.account.address), [1n, 1n], `${label} must preserve sender balances`)
			assert.deepStrictEqual(await readBalances(receiverAddress), [0n, 0n], `${label} must not credit receiver balances`)
			assert.deepStrictEqual(await readReceiverObservations(), emptyReceiverObservations, `${label} must roll back receiver hook observations`)
		}

		const assertReceiverErrors = async (singleReason: RegExp, batchReason: RegExp) => {
			await assert.rejects(
				writeContractAndWait(client, () =>
					client.writeContract({
						abi: shareTokenAbi,
						address: shareTokenAddress,
						functionName: 'safeTransferFrom',
						args: [client.account.address, receiverAddress, yesTokenId, 1n],
					}),
				),
				singleReason,
			)
			await assertTransferRollback('rejected single receiver hook')
			await assert.rejects(
				writeContractAndWait(client, () =>
					client.writeContract({
						abi: shareTokenAbi,
						address: shareTokenAddress,
						functionName: 'safeBatchTransferFrom',
						args: [client.account.address, receiverAddress, [invalidTokenId, yesTokenId], [1n, 1n]],
					}),
				),
				batchReason,
			)
			await assertTransferRollback('rejected batch receiver hook')
		}

		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: receiverAbi,
				address: receiverAddress,
				functionName: 'setBehavior',
				args: [false, false, false],
			}),
		)
		await assertReceiverErrors(/ERC1155: receiver rejected tokens by returning an unexpected single-transfer selector/, /ERC1155: receiver rejected tokens by returning an unexpected batch-transfer selector/)

		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: receiverAbi,
				address: receiverAddress,
				functionName: 'setBehavior',
				args: [true, true, true],
			}),
		)
		await assertReceiverErrors(/ERC1155: receiver rejected tokens during single-transfer acceptance check/, /ERC1155: receiver rejected tokens during batch-transfer acceptance check/)

		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: receiverAbi,
				address: receiverAddress,
				functionName: 'setBehavior',
				args: [true, true, false],
			}),
		)
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: receiverAbi,
				address: receiverAddress,
				functionName: 'setPanicOnReceive',
				args: [true],
			}),
		)
		await assertReceiverErrors(/ERC1155: receiver panicked during single-transfer acceptance check/, /ERC1155: receiver panicked during batch-transfer acceptance check/)
	})

	test('safeTransferFrom calls the receiver hook and batch minting to a contract uses the batch hook', async () => {
		const shareTokenAddress = await deployShareToken()
		const receiverAddress = await deployReceiver()
		await mintCompleteSets(shareTokenAddress, client.account.address, 2n)
		const yesTokenId = await readTokenId(shareTokenAddress, 1)

		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_tokens_ShareToken_ShareToken.abi,
					address: shareTokenAddress,
					functionName: 'safeTransferFrom',
					args: [client.account.address, receiverAddress, yesTokenId, 1n, '0x1234'],
				}),
		)

		assert.strictEqual(
			await client.readContract({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				address: shareTokenAddress,
				functionName: 'balanceOf',
				args: [receiverAddress, yesTokenId],
			}),
			1n,
			'receiver should hold the transferred share token',
		)
		assert.strictEqual(
			await client.readContract({
				abi: test_peripherals_ERC1155ReceiverMock_ERC1155ReceiverMock.abi,
				address: receiverAddress,
				functionName: 'singleReceiveCount',
				args: [],
			}),
			1n,
			'receiver hook should run for safeTransferFrom',
		)
		assert.strictEqual(
			await client.readContract({
				abi: test_peripherals_ERC1155ReceiverMock_ERC1155ReceiverMock.abi,
				address: receiverAddress,
				functionName: 'lastData',
				args: [],
			}),
			'0x1234',
			'receiver should observe the transfer payload',
		)

		await mintCompleteSets(shareTokenAddress, receiverAddress, 1n)

		assert.strictEqual(
			await client.readContract({
				abi: test_peripherals_ERC1155ReceiverMock_ERC1155ReceiverMock.abi,
				address: receiverAddress,
				functionName: 'batchReceiveCount',
				args: [],
			}),
			1n,
			'batch receiver hook should run when minting complete sets to a contract',
		)
	})

	test('operator approval allows third-party single and batch transfers', async () => {
		const shareTokenAddress = await deployShareToken()
		const receiverAddress = await deployReceiver()
		await mintCompleteSets(shareTokenAddress, client.account.address, 3n)
		const invalidTokenId = await readTokenId(shareTokenAddress, 0)
		const yesTokenId = await readTokenId(shareTokenAddress, 1)
		const noTokenId = await readTokenId(shareTokenAddress, 2)

		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_tokens_ShareToken_ShareToken.abi,
					address: shareTokenAddress,
					functionName: 'setApprovalForAll',
					args: [operatorClient.account.address, true],
				}),
		)

		await writeContractAndWait(
			operatorClient,
			async () =>
				await operatorClient.writeContract({
					abi: peripherals_tokens_ShareToken_ShareToken.abi,
					address: shareTokenAddress,
					functionName: 'safeTransferFrom',
					args: [client.account.address, receiverAddress, yesTokenId, 1n],
				}),
		)

		await writeContractAndWait(
			operatorClient,
			async () =>
				await operatorClient.writeContract({
					abi: peripherals_tokens_ShareToken_ShareToken.abi,
					address: shareTokenAddress,
					functionName: 'safeBatchTransferFrom',
					args: [client.account.address, receiverAddress, [invalidTokenId, noTokenId], [1n, 2n], '0xbeef'],
				}),
		)

		assert.strictEqual(
			await client.readContract({
				abi: test_peripherals_ERC1155ReceiverMock_ERC1155ReceiverMock.abi,
				address: receiverAddress,
				functionName: 'singleReceiveCount',
				args: [],
			}),
			1n,
			'single transfer receiver hook should run',
		)
		assert.strictEqual(
			await client.readContract({
				abi: test_peripherals_ERC1155ReceiverMock_ERC1155ReceiverMock.abi,
				address: receiverAddress,
				functionName: 'batchReceiveCount',
				args: [],
			}),
			1n,
			'batch transfer receiver hook should run',
		)
		assert.strictEqual(
			await client.readContract({
				abi: test_peripherals_ERC1155ReceiverMock_ERC1155ReceiverMock.abi,
				address: receiverAddress,
				functionName: 'lastData',
				args: [],
			}),
			'0xbeef',
			'batch receiver should observe the transfer payload',
		)
	})

	test('complete-set and token-id burns reduce ERC1155 supply', async () => {
		const shareTokenAddress = await deployShareToken()
		await mintCompleteSets(shareTokenAddress, client.account.address, 5n)
		const yesTokenId = await readTokenId(shareTokenAddress, 1)

		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_tokens_ShareToken_ShareToken.abi,
					address: shareTokenAddress,
					functionName: 'burnCompleteSets',
					args: [0n, client.account.address, 2n],
				}),
		)
		assert.strictEqual(
			await client.readContract({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				address: shareTokenAddress,
				functionName: 'totalSupply',
				args: [yesTokenId],
			}),
			3n,
			'batch burn should reduce the token supply',
		)

		await writeContractAndWait(
			client,
			async () =>
				await client.writeContract({
					abi: peripherals_tokens_ShareToken_ShareToken.abi,
					address: shareTokenAddress,
					functionName: 'burnTokenIdAndGetRemainingSupply',
					args: [yesTokenId, client.account.address],
				}),
		)
		assert.strictEqual(
			await client.readContract({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				address: shareTokenAddress,
				functionName: 'totalSupply',
				args: [yesTokenId],
			}),
			0n,
			'single-token burn should clear the remaining supply',
		)
	})

	test('coverage instrumentation traces read-only ERC1155 and share-token helpers through transactions', async () => {
		const shareTokenAddress = await deployShareToken()
		await mintCompleteSets(shareTokenAddress, client.account.address, 1n)
		const invalidTokenId = await readTokenId(shareTokenAddress, 0)
		const yesTokenId = await readTokenId(shareTokenAddress, 1)
		const noTokenId = await readTokenId(shareTokenAddress, 2)

		// Keep direct transaction-backed calls here so the coverage harness still exercises the same helper paths explicitly.
		await transactWithShareToken(
			shareTokenAddress,
			encodeFunctionData({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				functionName: 'supportsInterface',
				args: ['0xd9b67a26'],
			}),
		)
		await transactWithShareToken(
			shareTokenAddress,
			encodeFunctionData({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				functionName: 'balanceOf',
				args: [client.account.address, yesTokenId],
			}),
		)
		await transactWithShareToken(
			shareTokenAddress,
			encodeFunctionData({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				functionName: 'totalSupply',
				args: [yesTokenId],
			}),
		)
		await transactWithShareToken(
			shareTokenAddress,
			encodeFunctionData({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				functionName: 'balanceOfBatch',
				args: [
					[client.account.address, client.account.address, client.account.address],
					[invalidTokenId, yesTokenId, noTokenId],
				],
			}),
		)
		await transactWithShareToken(
			shareTokenAddress,
			encodeFunctionData({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				functionName: 'isApprovedForAll',
				args: [client.account.address, operatorClient.account.address],
			}),
		)
		await transactWithShareToken(
			shareTokenAddress,
			encodeFunctionData({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				functionName: 'getTokenIds',
				args: [0n, [0, 1, 2]],
			}),
		)
		await transactWithShareToken(
			shareTokenAddress,
			encodeFunctionData({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				functionName: 'unpackTokenId',
				args: [yesTokenId],
			}),
		)
		await transactWithShareToken(
			shareTokenAddress,
			encodeFunctionData({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				functionName: 'totalSupplyForOutcome',
				args: [0n, 1],
			}),
		)
		await transactWithShareToken(
			shareTokenAddress,
			encodeFunctionData({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				functionName: 'balanceOfOutcome',
				args: [0n, 1, client.account.address],
			}),
		)
		await transactWithShareToken(
			shareTokenAddress,
			encodeFunctionData({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				functionName: 'balanceOfShares',
				args: [0n, client.account.address],
			}),
		)

		assert.strictEqual(
			await client.readContract({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				address: shareTokenAddress,
				functionName: 'balanceOf',
				args: [client.account.address, yesTokenId],
			}),
			1n,
			'read-only transaction execution should not change token balances',
		)
	})
})

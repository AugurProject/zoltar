import { zeroAddress } from '@zoltar/shared/ethereum'
import type { Hash } from '@zoltar/shared/ethereum'
import { peripherals_openOracle_OpenOracle_OpenOracle, Zoltar_Zoltar } from './types/contractArtifact'
import { createAnvilNodeForConnectionMode, getGasCostsAnvilConnectionMode } from './testSupport/simulator/anvilNode'
import { submitBid, refundLosingBids } from './testSupport/simulator/utils/contracts/auction'
import { deployOriginSecurityPool, ensureInfraDeployed, getInfraContractAddresses, getSecurityPoolAddresses } from './testSupport/simulator/utils/contracts/deployPeripherals'
import { getPendingReportId, getRequestPriceEthCost, migrateShares, openOracleSettle, OperationType, requestPrice, requestPriceIfNeededAndStageOperation, requestPriceIfNeededAndStageOperationWithInitialReportPrice, wrapWeth } from './testSupport/simulator/utils/contracts/peripherals'
import { manipulatePriceOracle, manipulatePriceOracleAndPerformOperation } from './testSupport/simulator/utils/contracts/peripheralsTestUtils'
import { claimAuctionProceeds, claimForkedEscalationDeposits, createChildUniverse, finalizeTruthAuction, forkZoltarWithOwnEscalationGame, getSecurityPoolForkerForkData, initiateSecurityPoolFork, migrateRepToZoltar, migrateVault, startTruthAuction } from './testSupport/simulator/utils/contracts/securityPoolForker'
import { createCompleteSet, depositRep, depositToEscalationGame, getRepToken, redeemCompleteSet, redeemFees, redeemRep, redeemShares, updateVaultFees, withdrawFromEscalationGame } from './testSupport/simulator/utils/contracts/securityPool'
import { ensureZoltarDeployed, forkUniverse, getTotalTheoreticalSupply, getZoltarAddress } from './testSupport/simulator/utils/contracts/zoltar'
import { createQuestion, getQuestionId } from './testSupport/simulator/utils/contracts/zoltarQuestionData'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES, WETH_ADDRESS } from './testSupport/simulator/utils/constants'
import { addressString } from './testSupport/simulator/utils/bigint'
import { approveToken, getChildUniverseId, getERC20Balance, setupTestAccounts, sortStringArrayByKeccak } from './testSupport/simulator/utils/utilities'
import { QuestionOutcome } from './testSupport/simulator/types/types'
import { createWriteClient, WriteClient, writeContractAndWait } from './testSupport/simulator/utils/clients'

const genesisUniverse = 0n
const securityMultiplier = 2n
const repDepositAmount = 1_000n * 10n ** 18n
const securityBondAllowance = repDepositAmount / 4n
const openInterestAmount = 100n * 10n ** 18n
const reportBond = 1n * 10n ** 18n
const questionOutcomes = ['Yes', 'No']
const coordinatorPricePrecision = 10n ** 18n
const defaultSelfOperationValidForSeconds = 5n * 60n

const isHash = (value: string): value is Hash => value.startsWith('0x')

const requireHash = (value: unknown, context: string): Hash => {
	if (typeof value !== 'string' || !isHash(value)) throw new Error(`${context} must be a transaction hash`)
	return value
}

type QuestionData = {
	title: string
	description: string
	startTime: bigint
	endTime: bigint
	numTicks: bigint
	displayValueMin: bigint
	displayValueMax: bigint
	answerUnit: string
}

type PoolContext = {
	questionData: QuestionData
	questionId: bigint
	addresses: ReturnType<typeof getSecurityPoolAddresses>
}

type Scenario = {
	section: string
	label: string
	init?: {
		deployZoltar: boolean
		deployInfra: boolean
	}
	run: () => Promise<bigint>
}

const numberFormatter = new Intl.NumberFormat('en-US')
const ethFormatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 })
const usdFormatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const ethPriceUsd = Number.parseFloat(process.env['ETH_PRICE_USD'] ?? '2170.63')
const priorityFeeGwei = Number.parseFloat(process.env['PRIORITY_FEE_GWEI'] ?? '1')
const baseFeeGwei = Number.parseFloat(process.env['BASE_FEE_GWEI'] ?? '0.035')
const totalGasPriceGwei = baseFeeGwei + priorityFeeGwei

if (!Number.isFinite(ethPriceUsd) || ethPriceUsd <= 0) throw new Error('ETH_PRICE_USD must be a positive number')
if (!Number.isFinite(priorityFeeGwei) || priorityFeeGwei < 0) throw new Error('PRIORITY_FEE_GWEI must be a non-negative number')
if (!Number.isFinite(baseFeeGwei) || baseFeeGwei < 0) throw new Error('BASE_FEE_GWEI must be a non-negative number')
if (totalGasPriceGwei <= 0) throw new Error('BASE_FEE_GWEI + PRIORITY_FEE_GWEI must be greater than zero')

const anvilNode = await createAnvilNodeForConnectionMode(getGasCostsAnvilConnectionMode(), { context: 'gas-costs', startTimestamp: 1n })
const anvil = anvilNode.anvilWindowEthereum
const alice = createWriteClient(anvil, TEST_ADDRESSES[0], 0)
const bob = createWriteClient(anvil, TEST_ADDRESSES[1], 0)
const carol = createWriteClient(anvil, TEST_ADDRESSES[2], 0)
const dave = createWriteClient(anvil, TEST_ADDRESSES[3], 0)

const waitForGas = async (client: WriteClient, txHashPromise: Promise<Hash>) => {
	const hash = await txHashPromise
	const receipt = await client.waitForTransactionReceipt({ hash })
	return receipt.gasUsed
}

const confirmTx = async (client: WriteClient, txHashPromise: Promise<Hash>) => {
	const hash = await txHashPromise
	await client.waitForTransactionReceipt({ hash })
}

const measureActionGas = async (client: WriteClient, action: () => Promise<void>) => {
	const blockBefore = await client.getBlockNumber()
	await action()
	const blockAfter = await client.getBlockNumber()
	let totalGas = 0n
	for (let blockNumber = blockBefore + 1n; blockNumber <= blockAfter; blockNumber++) {
		const block = await client.getBlock({ blockNumber, includeTransactions: true })
		for (const transaction of block.transactions) {
			if (typeof transaction !== 'object' || transaction === null) throw new Error('Expected block transactions to be expanded objects')
			const transactionHash = requireHash(Reflect.get(transaction, 'hash'), 'Expanded block transaction hash')
			const receipt = await client.getTransactionReceipt({ hash: transactionHash })
			totalGas += receipt.gasUsed
		}
	}
	return totalGas
}

const initializeChain = async ({ deployZoltar, deployInfra }: { deployZoltar: boolean; deployInfra: boolean }) => {
	await anvil.resetToCleanState()
	await setupTestAccounts(anvil)
	if (deployZoltar || deployInfra) await ensureZoltarDeployed(alice)
	if (deployInfra) await ensureInfraDeployed(alice)
}

const buildQuestionData = async (title: string): Promise<QuestionData> => {
	const now = await anvil.getTime()
	return {
		title,
		description: '',
		startTime: 0n,
		endTime: now + 365n * DAY,
		numTicks: 0n,
		displayValueMin: 0n,
		displayValueMax: 0n,
		answerUnit: '',
	}
}

const buildCategoricalQuestionData = async (title: string): Promise<QuestionData> => {
	const now = await anvil.getTime()
	return {
		title,
		description: 'categorical benchmark',
		startTime: 0n,
		endTime: now + 365n * DAY,
		numTicks: 0n,
		displayValueMin: 0n,
		displayValueMax: 0n,
		answerUnit: '',
	}
}

const buildScalarQuestionData = async (title: string): Promise<QuestionData> => {
	const now = await anvil.getTime()
	return {
		title,
		description: 'scalar benchmark',
		startTime: 0n,
		endTime: now + 365n * DAY,
		numTicks: 100n,
		displayValueMin: 0n,
		displayValueMax: 100n,
		answerUnit: '%',
	}
}

const setupPool = async (title: string): Promise<PoolContext> => {
	const questionData = await buildQuestionData(title)
	const questionId = getQuestionId(questionData, questionOutcomes)
	await confirmTx(alice, createQuestion(alice, questionData, [...questionOutcomes]))
	await confirmTx(alice, deployOriginSecurityPool(alice, genesisUniverse, questionId, securityMultiplier))
	const addresses = getSecurityPoolAddresses(zeroAddress, genesisUniverse, questionId, securityMultiplier)
	return { questionData, questionId, addresses }
}

const confirmApproveAndDepositRep = async (client: WriteClient, context: PoolContext, amount: bigint = repDepositAmount) => {
	await confirmTx(client, approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), context.addresses.securityPool))
	await confirmTx(client, depositRep(client, context.addresses.securityPool, amount))
}

const prepareEscalationFork = async (context: PoolContext) => {
	const repToken = await getRepToken(alice, context.addresses.securityPool)
	const forkThreshold = (await getTotalTheoreticalSupply(alice, repToken)) / 20n
	await anvil.setTime(context.questionData.endTime + 10_000n)
	await manipulatePriceOracle(alice, anvil, context.addresses.priceOracleManagerAndOperatorQueuer)
	await confirmTx(alice, approveToken(alice, addressString(GENESIS_REPUTATION_TOKEN), context.addresses.securityPool))
	await confirmTx(alice, depositRep(alice, context.addresses.securityPool, 2n * forkThreshold))
	await confirmTx(alice, depositToEscalationGame(alice, context.addresses.securityPool, QuestionOutcome.Yes, forkThreshold))
	await confirmTx(alice, depositToEscalationGame(alice, context.addresses.securityPool, QuestionOutcome.No, forkThreshold))
	return { forkThreshold }
}

const prepareExternalZoltarFork = async (context: PoolContext, titlePrefix: string) => {
	const now = await anvil.getTime()
	const forkQuestionData = {
		...context.questionData,
		title: `${titlePrefix} ${now}`,
		endTime: now + DAY,
	}
	const forkQuestionId = getQuestionId(forkQuestionData, questionOutcomes)
	await confirmTx(alice, createQuestion(alice, forkQuestionData, [...questionOutcomes]))
	await anvil.setTime(forkQuestionData.endTime + 1n)
	await confirmTx(alice, approveToken(alice, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress()))
	await confirmTx(alice, forkUniverse(alice, genesisUniverse, forkQuestionId))
}

const prepareYesChildForAuction = async (migrateOpenInterestShares = false) => {
	const context = await setupPool('Gas auction question')
	await confirmTx(alice, approveToken(alice, addressString(GENESIS_REPUTATION_TOKEN), context.addresses.securityPool))
	await confirmTx(alice, depositRep(alice, context.addresses.securityPool, repDepositAmount))
	await confirmTx(bob, approveToken(bob, addressString(GENESIS_REPUTATION_TOKEN), context.addresses.securityPool))
	await confirmTx(bob, depositRep(bob, context.addresses.securityPool, repDepositAmount))
	await manipulatePriceOracleAndPerformOperation(alice, anvil, context.addresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, alice.account.address, securityBondAllowance)
	await confirmTx(carol, createCompleteSet(carol, context.addresses.securityPool, openInterestAmount))
	await prepareEscalationFork(context)
	await confirmTx(alice, forkZoltarWithOwnEscalationGame(alice, context.addresses.securityPool))
	await confirmTx(alice, migrateRepToZoltar(alice, context.addresses.securityPool, [QuestionOutcome.Yes]))
	await confirmTx(alice, migrateVault(alice, context.addresses.securityPool, QuestionOutcome.Yes))
	await confirmTx(alice, claimForkedEscalationDeposits(alice, context.addresses.securityPool, alice.account.address, QuestionOutcome.Yes, [0n]))
	const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
	const yesPool = getSecurityPoolAddresses(context.addresses.securityPool, yesUniverse, context.questionId, securityMultiplier)
	const forkData = await getSecurityPoolForkerForkData(alice, context.addresses.securityPool)
	const ethRaiseCap = openInterestAmount - (openInterestAmount * forkData.migratedRep) / forkData.auctionableRepAtFork
	if (migrateOpenInterestShares) {
		const winningChildTarget = [QuestionOutcome.Yes]
		await confirmTx(carol, migrateShares(carol, context.addresses.shareToken, genesisUniverse, QuestionOutcome.Invalid, winningChildTarget))
		await confirmTx(carol, migrateShares(carol, context.addresses.shareToken, genesisUniverse, QuestionOutcome.Yes, winningChildTarget))
		await confirmTx(carol, migrateShares(carol, context.addresses.shareToken, genesisUniverse, QuestionOutcome.No, winningChildTarget))
	}
	await anvil.advanceTime(8n * 7n * DAY + DAY)
	return { context, yesPool, ethRaiseCap }
}

const prepareYesChildFinalized = async (migrateOpenInterestShares = false) => {
	const { context, yesPool, ethRaiseCap } = await prepareYesChildForAuction(migrateOpenInterestShares)
	await confirmTx(alice, startTruthAuction(alice, yesPool.securityPool))
	await confirmTx(dave, submitBid(dave, yesPool.truthAuction, 0n, ethRaiseCap))
	await anvil.advanceTime(8n * DAY)
	await confirmTx(alice, finalizeTruthAuction(alice, yesPool.securityPool))
	return { context, yesPool, ethRaiseCap }
}

const prepareDirectOpenOracleInitialReport = async () => {
	const openOracleAddress = getInfraContractAddresses().openOracle
	const reportId: bigint = await alice.readContract({
		address: openOracleAddress,
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'nextReportId',
		args: [],
	})
	const amount1 = reportBond
	const amount2 = reportBond
	await confirmTx(alice, approveToken(alice, addressString(GENESIS_REPUTATION_TOKEN), getInfraContractAddresses().openOracle))
	await confirmTx(alice, approveToken(alice, WETH_ADDRESS, getInfraContractAddresses().openOracle))
	const wethBalanceBefore = await getERC20Balance(alice, WETH_ADDRESS, alice.account.address)
	await confirmTx(alice, wrapWeth(alice, amount2))
	const wethBalanceAfter = await getERC20Balance(alice, WETH_ADDRESS, alice.account.address)
	if (BigInt(wethBalanceAfter) - BigInt(wethBalanceBefore) !== amount2) throw new Error('Failed to wrap the expected amount of WETH')
	const submit = () =>
		writeContractAndWait(alice, () =>
			alice.writeContract({
				address: openOracleAddress,
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				functionName: 'report',
				args: [
					{
						callbackContract: zeroAddress,
						callbackGasLimit: 0,
						currentAmount1: amount1,
						currentAmount2: amount2,
						currentReporter: alice.account.address,
						disputeDelay: 0,
						escalationHalt: reportBond,
						feePercentage: 0,
						flags: 13,
						lastReportOppoTime: 0,
						multiplier: 100,
						numReports: 0,
						protocolFee: 0,
						protocolFeeRecipient: zeroAddress,
						reportTimestamp: 0,
						settlementTime: DAY,
						settlementTimestamp: 0,
						settlerReward: 0n,
						token1: addressString(GENESIS_REPUTATION_TOKEN),
						token2: WETH_ADDRESS,
					},
					false,
					false,
					[0n, 0n, 0n, 0n],
				],
			}),
		)
	return { reportId, submit }
}

const deployChildTx = async (universeId: bigint, outcomeIndex: bigint) =>
	await writeContractAndWait(alice, () =>
		alice.writeContract({
			abi: Zoltar_Zoltar.abi,
			functionName: 'deployChild',
			address: getZoltarAddress(),
			args: [universeId, outcomeIndex],
		}),
	)

const addRepToMigrationBalanceTx = async (universeId: bigint, amount: bigint) =>
	await writeContractAndWait(alice, () =>
		alice.writeContract({
			abi: Zoltar_Zoltar.abi,
			functionName: 'addRepToMigrationBalance',
			address: getZoltarAddress(),
			args: [universeId, amount],
		}),
	)

const splitMigrationRepTx = async (universeId: bigint, amount: bigint, outcomeIndexes: bigint[]) =>
	await writeContractAndWait(alice, () =>
		alice.writeContract({
			abi: Zoltar_Zoltar.abi,
			functionName: 'splitMigrationRep',
			address: getZoltarAddress(),
			args: [universeId, amount, outcomeIndexes],
		}),
	)

const scenarios: Scenario[] = [
	{
		section: '1. Core Deployment',
		label: 'deploy Zoltar core contracts',
		init: { deployZoltar: false, deployInfra: false },
		run: async () =>
			await measureActionGas(alice, async () => {
				await ensureZoltarDeployed(alice)
			}),
	},
	{
		section: '2. Peripheral Deployment',
		label: 'deploy peripheral contracts',
		init: { deployZoltar: true, deployInfra: false },
		run: async () =>
			await measureActionGas(alice, async () => {
				await ensureInfraDeployed(alice)
			}),
	},
	{
		section: '3. Question Creation',
		label: 'create binary question',
		run: async () => {
			const questionData = await buildQuestionData('Gas create binary question')
			return await waitForGas(alice, createQuestion(alice, questionData, [...questionOutcomes]))
		},
	},
	{
		section: '3. Question Creation',
		label: 'create categorical question',
		run: async () => {
			const questionData = await buildCategoricalQuestionData('Gas create categorical question')
			return await waitForGas(alice, createQuestion(alice, questionData, sortStringArrayByKeccak(['Apple', 'Banana', 'Cherry'])))
		},
	},
	{
		section: '3. Question Creation',
		label: 'create scalar question',
		run: async () => {
			const questionData = await buildScalarQuestionData('Gas create scalar question')
			return await waitForGas(alice, createQuestion(alice, questionData, []))
		},
	},
	{
		section: '4. Security Pool Creation',
		label: 'deploy security pool for question',
		run: async () => {
			const questionData = await buildQuestionData('Gas deploy pool')
			const questionId = getQuestionId(questionData, questionOutcomes)
			await confirmTx(alice, createQuestion(alice, questionData, [...questionOutcomes]))
			return await waitForGas(alice, deployOriginSecurityPool(alice, genesisUniverse, questionId, securityMultiplier))
		},
	},
	{
		section: '5. Vault Creation & Funding',
		label: 'vault owner deposits initial REP into vault',
		run: async () => {
			const context = await setupPool('Gas deposit rep')
			await confirmTx(alice, approveToken(alice, addressString(GENESIS_REPUTATION_TOKEN), context.addresses.securityPool))
			return await waitForGas(alice, depositRep(alice, context.addresses.securityPool, repDepositAmount))
		},
	},
	{
		section: '6. Open Oracle Operation',
		label: 'request REP/ETH price from coordinator with atomic initial report',
		run: async () => {
			const context = await setupPool('Gas request price')
			return await waitForGas(alice, requestPrice(alice, context.addresses.priceOracleManagerAndOperatorQueuer))
		},
	},
	{
		section: '6. Open Oracle Operation',
		label: 'submit atomic OpenOracle report',
		run: async () => {
			await setupPool('Gas submit report')
			const initialReport = await prepareDirectOpenOracleInitialReport()
			return await waitForGas(alice, initialReport.submit())
		},
	},
	{
		section: '6. Open Oracle Operation',
		label: 'settle OpenOracle report',
		run: async () => {
			await setupPool('Gas settle report')
			const initialReport = await prepareDirectOpenOracleInitialReport()
			await confirmTx(alice, initialReport.submit())
			await anvil.advanceTime(DAY)
			return await waitForGas(alice, openOracleSettle(alice, initialReport.reportId))
		},
	},
	{
		section: '7. Bond Allowance',
		label: 'queue vault bond allowance change with stale price',
		run: async () => {
			const context = await setupPool('Gas queue allowance')
			await confirmApproveAndDepositRep(alice, context)
			return await waitForGas(alice, requestPriceIfNeededAndStageOperation(alice, context.addresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, alice.account.address, securityBondAllowance))
		},
	},
	{
		section: '7. Bond Allowance',
		label: 'set vault bond allowance with valid price',
		run: async () => {
			const context = await setupPool('Gas set allowance')
			await confirmApproveAndDepositRep(alice, context)
			await manipulatePriceOracle(alice, anvil, context.addresses.priceOracleManagerAndOperatorQueuer)
			return await waitForGas(alice, requestPriceIfNeededAndStageOperation(alice, context.addresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, alice.account.address, securityBondAllowance))
		},
	},
	{
		section: '5. Vault Creation & Funding',
		label: 'vault owner withdraws REP from vault with valid price',
		run: async () => {
			const context = await setupPool('Gas withdraw rep')
			await confirmApproveAndDepositRep(alice, context)
			await manipulatePriceOracle(alice, anvil, context.addresses.priceOracleManagerAndOperatorQueuer)
			return await waitForGas(alice, requestPriceIfNeededAndStageOperation(alice, context.addresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, alice.account.address, repDepositAmount))
		},
	},
	{
		section: '8. Vault Liquidation',
		label: 'queue vault liquidation with stale price',
		run: async () => {
			const context = await setupPool('Gas queue liquidation')
			await confirmApproveAndDepositRep(alice, context)
			await manipulatePriceOracleAndPerformOperation(alice, anvil, context.addresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, alice.account.address, securityBondAllowance)
			await confirmApproveAndDepositRep(bob, context, repDepositAmount * 10n)
			await confirmTx(carol, createCompleteSet(carol, context.addresses.securityPool, openInterestAmount))
			await anvil.advanceTime(2n * DAY)
			return await waitForGas(bob, requestPriceIfNeededAndStageOperation(bob, context.addresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, alice.account.address, securityBondAllowance))
		},
	},
	{
		section: '8. Vault Liquidation',
		label: 'execute queued vault liquidation during oracle settlement',
		run: async () => {
			const context = await setupPool('Gas execute liquidation')
			await confirmApproveAndDepositRep(alice, context)
			await manipulatePriceOracleAndPerformOperation(alice, anvil, context.addresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, alice.account.address, securityBondAllowance)
			await confirmApproveAndDepositRep(bob, context, repDepositAmount * 10n)
			await confirmTx(carol, createCompleteSet(carol, context.addresses.securityPool, openInterestAmount))
			await anvil.advanceTime(2n * DAY)
			const initialReportPrice = (reportBond * coordinatorPricePrecision) / 10n ** 19n
			const ethCost = await getRequestPriceEthCost(bob, context.addresses.priceOracleManagerAndOperatorQueuer)
			await confirmTx(bob, requestPriceIfNeededAndStageOperationWithInitialReportPrice(bob, context.addresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, alice.account.address, securityBondAllowance, defaultSelfOperationValidForSeconds, initialReportPrice, ethCost))
			const pendingReportId = await getPendingReportId(bob, context.addresses.priceOracleManagerAndOperatorQueuer)
			await anvil.advanceTime(DAY)
			return await waitForGas(bob, openOracleSettle(bob, pendingReportId))
		},
	},
	{
		section: '9. Trading Before Resolution',
		label: 'create complete set for question',
		run: async () => {
			const context = await setupPool('Gas create complete set')
			await confirmApproveAndDepositRep(alice, context)
			await manipulatePriceOracleAndPerformOperation(alice, anvil, context.addresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, alice.account.address, securityBondAllowance)
			return await waitForGas(carol, createCompleteSet(carol, context.addresses.securityPool, openInterestAmount))
		},
	},
	{
		section: '9. Trading Before Resolution',
		label: 'redeem complete set before escalation',
		run: async () => {
			const context = await setupPool('Gas redeem complete set')
			await confirmApproveAndDepositRep(alice, context)
			await manipulatePriceOracleAndPerformOperation(alice, anvil, context.addresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, alice.account.address, securityBondAllowance)
			await confirmTx(carol, createCompleteSet(carol, context.addresses.securityPool, openInterestAmount))
			return await waitForGas(carol, redeemCompleteSet(carol, context.addresses.securityPool, openInterestAmount))
		},
	},
	{
		section: '10. Escalation Game Creation',
		label: 'create escalation game with first stake',
		run: async () => {
			const context = await setupPool('Gas escalation deposit')
			await confirmApproveAndDepositRep(alice, context)
			await anvil.setTime(context.questionData.endTime + 10_000n)
			return await waitForGas(alice, depositToEscalationGame(alice, context.addresses.securityPool, QuestionOutcome.Yes, reportBond))
		},
	},
	{
		section: '11. Escalation Game Operation',
		label: 'withdraw winning stake after normal escalation completion',
		run: async () => {
			const context = await setupPool('Gas escalation withdraw')
			await confirmApproveAndDepositRep(alice, context)
			await anvil.setTime(context.questionData.endTime + 10_000n)
			await confirmTx(alice, depositToEscalationGame(alice, context.addresses.securityPool, QuestionOutcome.Yes, reportBond))
			await anvil.advanceTime(10n * DAY)
			return await waitForGas(alice, withdrawFromEscalationGame(alice, context.addresses.securityPool, QuestionOutcome.Yes, [0n]))
		},
	},
	{
		section: '12. Normal Completion & Redemption',
		label: 'redeem vault REP after normal completion',
		run: async () => {
			const context = await setupPool('Gas redeem rep')
			await confirmApproveAndDepositRep(alice, context)
			await anvil.setTime(context.questionData.endTime + 10_000n)
			await confirmTx(alice, depositToEscalationGame(alice, context.addresses.securityPool, QuestionOutcome.Yes, reportBond))
			await anvil.advanceTime(10n * DAY)
			await confirmTx(alice, withdrawFromEscalationGame(alice, context.addresses.securityPool, QuestionOutcome.Yes, [0n]))
			return await waitForGas(alice, redeemRep(alice, context.addresses.securityPool, alice.account.address))
		},
	},
	{
		section: '12. Normal Completion & Redemption',
		label: 'redeem accrued vault fees',
		run: async () => {
			const context = await setupPool('Gas redeem fees')
			await confirmApproveAndDepositRep(alice, context)
			await manipulatePriceOracleAndPerformOperation(alice, anvil, context.addresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, alice.account.address, securityBondAllowance)
			await anvil.setTime((await anvil.getTime()) + 30n * DAY)
			await confirmTx(carol, createCompleteSet(carol, context.addresses.securityPool, openInterestAmount))
			await anvil.setTime(context.questionData.endTime + 10_000n)
			await confirmTx(alice, updateVaultFees(alice, context.addresses.securityPool, alice.account.address))
			return await waitForGas(alice, redeemFees(alice, context.addresses.securityPool, alice.account.address))
		},
	},
	{
		section: '13. Escalation Triggers Fork',
		label: 'fork universe directly in Zoltar',
		run: async () => {
			const questionData = await buildQuestionData('Gas fork universe')
			const questionId = getQuestionId(questionData, questionOutcomes)
			await confirmTx(alice, createQuestion(alice, questionData, [...questionOutcomes]))
			await confirmTx(alice, approveToken(alice, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress()))
			await anvil.setTime(questionData.endTime + 10_000n)
			return await waitForGas(alice, forkUniverse(alice, genesisUniverse, questionId))
		},
	},
	{
		section: '14. Forking',
		label: 'deploy child universe for fork outcome',
		run: async () => {
			const questionData = await buildQuestionData('Gas deploy child')
			const questionId = getQuestionId(questionData, questionOutcomes)
			await confirmTx(alice, createQuestion(alice, questionData, [...questionOutcomes]))
			await confirmTx(alice, approveToken(alice, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress()))
			await anvil.setTime(questionData.endTime + 10_000n)
			await confirmTx(alice, forkUniverse(alice, genesisUniverse, questionId))
			return await waitForGas(alice, deployChildTx(genesisUniverse, BigInt(QuestionOutcome.Yes)))
		},
	},
	{
		section: '14. Forking',
		label: 'add REP to migration balance for fork migration',
		run: async () => {
			const questionData = await buildQuestionData('Gas prepare migration')
			const questionId = getQuestionId(questionData, questionOutcomes)
			await confirmTx(alice, createQuestion(alice, questionData, [...questionOutcomes]))
			await confirmTx(alice, approveToken(alice, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress()))
			await anvil.setTime(questionData.endTime + 10_000n)
			await confirmTx(alice, forkUniverse(alice, genesisUniverse, questionId))
			return await waitForGas(alice, addRepToMigrationBalanceTx(genesisUniverse, repDepositAmount))
		},
	},
	{
		section: '14. Forking',
		label: 'split migration REP across all fork outcomes',
		run: async () => {
			const questionData = await buildQuestionData('Gas migrate internal rep')
			const questionId = getQuestionId(questionData, questionOutcomes)
			await confirmTx(alice, createQuestion(alice, questionData, [...questionOutcomes]))
			await confirmTx(alice, approveToken(alice, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress()))
			await anvil.setTime(questionData.endTime + 10_000n)
			await confirmTx(alice, forkUniverse(alice, genesisUniverse, questionId))
			await confirmTx(alice, addRepToMigrationBalanceTx(genesisUniverse, repDepositAmount))
			return await waitForGas(alice, splitMigrationRepTx(genesisUniverse, repDepositAmount, [0n, 1n, 2n]))
		},
	},
	{
		section: '13. Escalation Triggers Fork',
		label: 'trigger fork from non-decision escalation game',
		run: async () => {
			const context = await setupPool('Gas fork zoltar from pool')
			await confirmApproveAndDepositRep(alice, context)
			await prepareEscalationFork(context)
			return await waitForGas(alice, forkZoltarWithOwnEscalationGame(alice, context.addresses.securityPool))
		},
	},
	{
		section: '14. Forking',
		label: 'initiate security pool fork',
		run: async () => {
			const context = await setupPool('Gas initiate security pool fork')
			await confirmApproveAndDepositRep(alice, context)
			await prepareExternalZoltarFork(context, 'Gas initiate security pool fork source')
			return await waitForGas(alice, initiateSecurityPoolFork(alice, context.addresses.securityPool))
		},
	},
	{
		section: '16. Migration',
		label: 'migrate vault position to child security pool',
		run: async () => {
			const context = await setupPool('Gas migrate vault')
			await confirmApproveAndDepositRep(alice, context)
			await prepareExternalZoltarFork(context, 'Gas migrate vault fork source')
			await confirmTx(alice, initiateSecurityPoolFork(alice, context.addresses.securityPool))
			await confirmTx(alice, migrateRepToZoltar(alice, context.addresses.securityPool, [QuestionOutcome.Yes]))
			return await waitForGas(alice, migrateVault(alice, context.addresses.securityPool, QuestionOutcome.Yes))
		},
	},
	{
		section: '16. Migration',
		label: 'migrate escalation stake to child security pool',
		run: async () => {
			const context = await setupPool('Gas migrate escalation stake')
			await confirmApproveAndDepositRep(alice, context)
			await prepareEscalationFork(context)
			await confirmTx(alice, forkZoltarWithOwnEscalationGame(alice, context.addresses.securityPool))
			await confirmTx(alice, migrateRepToZoltar(alice, context.addresses.securityPool, [QuestionOutcome.Yes]))
			await confirmTx(alice, migrateVault(alice, context.addresses.securityPool, QuestionOutcome.Yes))
			return await waitForGas(alice, claimForkedEscalationDeposits(alice, context.addresses.securityPool, alice.account.address, QuestionOutcome.Yes, [0n]))
		},
	},
	{
		section: '14. Forking',
		label: 'create child security pool for outcome',
		run: async () => {
			const context = await setupPool('Gas create child pool')
			await confirmApproveAndDepositRep(alice, context)
			await prepareExternalZoltarFork(context, 'Gas create child pool fork source')
			await confirmTx(alice, initiateSecurityPoolFork(alice, context.addresses.securityPool))
			await confirmTx(alice, migrateRepToZoltar(alice, context.addresses.securityPool, [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No]))
			return await waitForGas(alice, createChildUniverse(alice, context.addresses.securityPool, QuestionOutcome.Invalid))
		},
	},
	{
		section: '15. Truth Auction',
		label: 'start truth auction',
		run: async () => {
			const prepared = await prepareYesChildForAuction()
			return await waitForGas(alice, startTruthAuction(alice, prepared.yesPool.securityPool))
		},
	},
	{
		section: '15. Truth Auction',
		label: 'submit truth auction bid',
		run: async () => {
			const prepared = await prepareYesChildForAuction()
			await confirmTx(alice, startTruthAuction(alice, prepared.yesPool.securityPool))
			return await waitForGas(dave, submitBid(dave, prepared.yesPool.truthAuction, 0n, prepared.ethRaiseCap))
		},
	},
	{
		section: '15. Truth Auction',
		label: 'refund losing truth auction bid',
		run: async () => {
			const prepared = await prepareYesChildForAuction()
			await confirmTx(alice, startTruthAuction(alice, prepared.yesPool.securityPool))
			await confirmTx(dave, submitBid(dave, prepared.yesPool.truthAuction, 0n, prepared.ethRaiseCap))
			await confirmTx(bob, submitBid(bob, prepared.yesPool.truthAuction, -100n, 1n * 10n ** 18n))
			return await waitForGas(bob, refundLosingBids(bob, prepared.yesPool.truthAuction, [{ tick: -100n, bidIndex: 0n }]))
		},
	},
	{
		section: '15. Truth Auction',
		label: 'finalize truth auction',
		run: async () => {
			const prepared = await prepareYesChildForAuction()
			await confirmTx(alice, startTruthAuction(alice, prepared.yesPool.securityPool))
			await confirmTx(dave, submitBid(dave, prepared.yesPool.truthAuction, 0n, prepared.ethRaiseCap))
			await anvil.advanceTime(8n * DAY)
			return await waitForGas(alice, finalizeTruthAuction(alice, prepared.yesPool.securityPool))
		},
	},
	{
		section: '15. Truth Auction',
		label: 'claim truth auction proceeds',
		run: async () => {
			const prepared = await prepareYesChildFinalized()
			return await waitForGas(alice, claimAuctionProceeds(alice, prepared.yesPool.securityPool, dave.account.address, [{ tick: 0n, bidIndex: 0n }]))
		},
	},
	{
		section: '16. Migration',
		label: 'redeem winning shares after migration to child',
		run: async () => {
			const prepared = await prepareYesChildFinalized(true)
			await confirmTx(alice, claimAuctionProceeds(alice, prepared.yesPool.securityPool, dave.account.address, [{ tick: 0n, bidIndex: 0n }]))
			return await waitForGas(carol, redeemShares(carol, prepared.yesPool.securityPool))
		},
	},
]

try {
	const results: { section: string; label: string; gas: bigint }[] = []

	for (const scenario of scenarios) {
		await initializeChain(scenario.init ?? { deployZoltar: true, deployInfra: true })
		try {
			const gas = await scenario.run()
			results.push({ section: scenario.section, label: scenario.label, gas })
		} catch (error) {
			throw new Error(`Scenario failed: ${scenario.section} / ${scenario.label} - ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	const labelWidth = results.reduce((max, result) => (result.label.length > max ? result.label.length : max), 0)
	const gasCostInEth = (gas: bigint) => (Number(gas) * totalGasPriceGwei) / 1_000_000_000
	const gasCostInUsd = (gas: bigint) => gasCostInEth(gas) * ethPriceUsd

	console.log(`# Pricing Assumptions`)
	console.log(`ETH price: $${usdFormatter.format(ethPriceUsd)}`)
	console.log(`Base fee: ${baseFeeGwei} gwei`)
	console.log(`Priority fee: ${priorityFeeGwei} gwei`)
	console.log(`Total gas price: ${totalGasPriceGwei} gwei`)
	console.log('')

	let currentSection = ''
	for (const result of results) {
		if (result.section !== currentSection) {
			if (currentSection !== '') console.log('')
			currentSection = result.section
			console.log(`# ${currentSection}`)
		}
		const line = `${result.label.padEnd(labelWidth)}  ${numberFormatter.format(result.gas).padStart(10)} gas  ${ethFormatter.format(gasCostInEth(result.gas)).padStart(10)} ETH  $${usdFormatter.format(gasCostInUsd(result.gas)).padStart(8)}`
		console.log(line)
	}
} finally {
	await anvilNode.dispose()
}

import { beforeAll } from 'bun:test'
import { encodeDeployData, encodeFunctionData, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioDeploymentRequest, buildPortfolioExecuteRequest, buildPortfolioVaultOperationsRequest } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import type { VaultOperationsInput } from '@zoltar/statoblast-shared/statoblast/vaultOperations'
import { DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '@zoltar/statoblast-shared/initialReport/oracleInitialReport'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import {
	ReputationToken_ReputationToken as repArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolOpenAdmissionPolicy_SecurityPoolOpenAdmissionPolicy as openAdmissionArtifact,
	statoblast_SecurityPoolPortfolioVault_SecurityPoolPortfolioVault as vaultArtifact,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact,
	statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator as coordinatorArtifact,
	statoblast_WETH9_WETH9 as wethArtifact,
} from '../../types/contractArtifact'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { DAY, TEST_ADDRESSES, WETH_ADDRESS } from '../../testSupport/simulator/utils/constants'
import { applyLibraries, getInfraContractAddresses, getSecurityPoolAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { createQuestion, makeQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { manipulatePriceOracle } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { getRequestPriceCostAttoEth } from '../../testSupport/simulator/utils/contracts/statoblast'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { backingUnitsToAttoRep, depositRepToVault, getSecurityVault } from '../../testSupport/simulator/utils/contracts/securityPool'
import { useStatoblastVaultAccountingFixture } from './fixture'

export const unit = 10n ** 18n
export const maximumQuestionHorizonSeconds = 20n * 365n * DAY
export const portfolioEconomics = { targetHealthFactorBps: 12_000n, purchaseFeeBps: 100n, minimumPurchaseFeeAttoEth: 10n ** 15n, completionRewardAttoEth: 25n * 10n ** 13n, ownershipChangeFeeAttoEth: 0n }
export const emptyOperations = (): VaultOperationsInput => ({ depositAttoRep: 0n, changeCommitment: false, commitmentAttoEth: 0n, liquidations: [], withdrawAttoRep: 0n, minimumReceiverHealthFactorBps: 10_000n, validForSeconds: 300n })

export function useSecurityPoolPortfolioFixture(economicsOverrides: Partial<typeof portfolioEconomics> = {}) {
	const economics = { ...portfolioEconomics, ...economicsOverrides }
	const base = useStatoblastVaultAccountingFixture()
	let portfolio: Address
	let questionAdmissionPolicy: Address
	let vault: Address
	let secondQuestionId: bigint
	let secondEndTime: bigint
	const owner = () => base.client
	const other = () => createWriteClient(base.mockWindow, TEST_ADDRESSES[1])
	const poolFor = (questionId: bigint, universeId = base.genesisUniverse, parent = zeroAddress, namespace = portfolio) => getSecurityPoolAddresses(parent, universeId, questionId, base.statoblastSecurityMultiplierBps, base.genesisUniverse, DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS, namespace)
	const execute = async (target: Address, data: Hex, value = 0n, sender = owner(), vaultAddress = vault) =>
		await writeContractAndWait(sender, () => sender.sendTransaction(buildPortfolioExecuteRequest({ owner: sender.account.address, vault: vaultAddress, vaultAbi: vaultArtifact.abi, call: { target, value, data }, value })))
	const submit = async (questionId: bigint, input: VaultOperationsInput, options: { sender?: WriteClient; vault?: Address; universeId?: bigint; price?: bigint; value?: bigint } = {}) => {
		const sender = options.sender ?? owner()
		const value = options.value ?? 0n
		return await writeContractAndWait(sender, () =>
			sender.sendTransaction(
				buildPortfolioVaultOperationsRequest({ owner: sender.account.address, vault: options.vault ?? vault, vaultAbi: vaultArtifact.abi, questionId, universeId: options.universeId ?? base.genesisUniverse, input, proposedRepPerEthPrice: options.price ?? 0n, requestedInitialAttoWeth: 0n, bountyAttoEth: value, value }),
			),
		)
	}
	const prepareChildDependencies = async (parent: Address, outcome: number) => await writeContractAndWait(other(), () => other().writeContract({ abi: factoryArtifact.abi, address: getInfraContractAddresses().securityPoolFactory, functionName: 'prepareChildPoolDependencies', args: [parent, BigInt(outcome)] }))
	const prepareChild = async (parent: Address, outcome: number) => await writeContractAndWait(other(), () => other().writeContract({ abi: factoryArtifact.abi, address: getInfraContractAddresses().securityPoolFactory, functionName: 'preparePortfolioChildPriceFeed', args: [parent, BigInt(outcome)] }))
	const transferRep = async (recipient: Address, amount: bigint, sender = owner()) => await writeContractAndWait(sender, () => sender.writeContract({ abi: repArtifact.abi, address: getRepTokenAddress(base.genesisUniverse), functionName: 'transfer', args: [recipient, amount] }))
	const refreshPrice = async (questionId: bigint) => await manipulatePriceOracle(owner(), base.mockWindow, poolFor(questionId).openOraclePriceCoordinator)
	const refreshPrices = async (questionIds: readonly bigint[]) => {
		const firstQuestion = questionIds[0]
		if (firstQuestion !== undefined) await refreshPrice(firstQuestion)
	}
	const allocate = async (questionId: bigint, amount = 1_000n * unit, commitment = 100n * unit, sender = owner(), vaultAddress = vault) => {
		await transferRep(vaultAddress, amount, sender)
		const accountPortfolio = await sender.readContract({ abi: vaultArtifact.abi, address: vaultAddress, functionName: 'portfolio' })
		await manipulatePriceOracle(owner(), base.mockWindow, poolFor(questionId, base.genesisUniverse, zeroAddress, accountPortfolio).openOraclePriceCoordinator)
		await submit(questionId, { ...emptyOperations(), depositAttoRep: amount, changeCommitment: true, commitmentAttoEth: commitment }, { sender, vault: vaultAddress })
	}
	const repClaim = async (pool: Address, vaultAddress = vault) => backingUnitsToAttoRep(owner(), pool, (await getSecurityVault(owner(), pool, vaultAddress)).repBackingUnits)
	const createVault = async (sender = owner()) => {
		await writeContractAndWait(sender, () => sender.writeContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'createVault' }))
		return await sender.readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'vaultOf', args: [sender.account.address] })
	}
	const fundVaultOracle = async (questionId: bigint) => {
		const coordinator = poolFor(questionId).openOraclePriceCoordinator
		const amount = 2n * (await owner().readContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'minimumToken1ReportAttoEth' }))
		await transferRep(vault, amount)
		await execute(WETH_ADDRESS, encodeFunctionData({ abi: wethArtifact.abi, functionName: 'deposit' }), amount)
		for (const token of [WETH_ADDRESS, getRepTokenAddress(base.genesisUniverse)] as const) await execute(token, encodeFunctionData({ abi: repArtifact.abi, functionName: 'approve', args: [coordinator, amount] }))
		return { amount, cost: await getRequestPriceCostAttoEth(owner(), coordinator) }
	}
	beforeAll(async () => {
		const policyHash = await owner().sendTransaction({ data: encodeDeployData({ abi: openAdmissionArtifact.abi, bytecode: applyLibraries(openAdmissionArtifact.evm.bytecode.object) }) })
		const policyReceipt = await owner().waitForTransactionReceipt({ hash: policyHash })
		if (!policyReceipt.contractAddress) throw new Error('Question admission policy address missing')
		questionAdmissionPolicy = policyReceipt.contractAddress
		const hash = await owner().sendTransaction(
			buildPortfolioDeploymentRequest({
				owner: owner().account.address,
				factory: getInfraContractAddresses().securityPoolFactory,
				vaultDeployer: getInfraContractAddresses().securityPoolPortfolioVaultDeployer,
				initialOriginPool: base.securityPoolAddresses.securityPool,
				maximumQuestionHorizonSeconds,
				questionAdmissionPolicy,
				economics,
				artifact: { abi: portfolioArtifact.abi, bytecode: applyLibraries(portfolioArtifact.evm.bytecode.object) },
			}),
		)
		const receipt = await owner().waitForTransactionReceipt({ hash })
		if (!receipt.contractAddress) throw new Error('Portfolio deployment address missing')
		portfolio = receipt.contractAddress
		await writeContractAndWait(owner(), () => owner().writeContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'addQuestion', args: [base.questionId] }))
		base.setSecurityPoolAddresses(poolFor(base.questionId))
		await approveToken(owner(), getRepTokenAddress(base.genesisUniverse), base.securityPoolAddresses.securityPool)
		await depositRepToVault(owner(), base.securityPoolAddresses.securityPool, base.repDeposit)
		vault = await createVault()
		secondEndTime = base.questionData.endTime + 365n * DAY
		const secondQuestion = { ...makeQuestion('Portfolio second question', secondEndTime), startTime: base.questionData.endTime + DAY }
		secondQuestionId = getQuestionId(secondQuestion, base.outcomes)
		await createQuestion(owner(), secondQuestion, base.outcomes)
		await writeContractAndWait(owner(), () => owner().writeContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'addQuestion', args: [secondQuestionId] }))
		await base.setBaselineSnapshot()
	})
	return {
		base,
		owner,
		other,
		poolFor,
		execute,
		submit,
		transferRep,
		prepareChild,
		prepareChildDependencies,
		refreshPrice,
		refreshPrices,
		allocate,
		repClaim,
		createVault,
		fundVaultOracle,
		get portfolio() {
			return portfolio
		},
		get questionAdmissionPolicy() {
			return questionAdmissionPolicy
		},
		get vault() {
			return vault
		},
		get secondQuestionId() {
			return secondQuestionId
		},
		get secondEndTime() {
			return secondEndTime
		},
	}
}

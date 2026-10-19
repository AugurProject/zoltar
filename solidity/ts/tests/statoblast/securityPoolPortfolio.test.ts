import { describe, expect, test } from 'bun:test'
import { encodeDeployData, encodeFunctionData, isHex, privateKeyToAccount, zeroAddress, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { signTyped } from 'micro-eth-signer'
import { buildPortfolioBatchRequest } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import {
	ReputationToken_ReputationToken as repArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioVault_SecurityPoolPortfolioVault as vaultArtifact,
	statoblast_SecurityPoolPortfolioVaultDeployer_SecurityPoolPortfolioVaultDeployer as vaultDeployerArtifact,
	statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator as coordinatorArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_LiquidationApprovalRegistry_LiquidationApprovalRegistry as registryArtifact,
} from '../../types/contractArtifact'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { createQuestion, makeQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { applyLibraries, getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { getERC20Balance, getETHBalance } from '../../testSupport/simulator/utils/utilities'
import { createCompleteSet, getSecurityVault, getSettlementCollateralAttoEth, getTotalUnderwritingLimitAttoEth, redeemShares } from '../../testSupport/simulator/utils/contracts/securityPool'
import { balanceOfShares } from '../../testSupport/simulator/utils/contracts/statoblast'
import { handleOracleReporting } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { portfolioEconomics, emptyOperations, unit, maximumQuestionHorizonSeconds, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: independently reserved question portfolios', () => {
	const fixture = useSecurityPoolPortfolioFixture()

	test('one vault factory isolates the same owner across caller namespaces and prevents address squatting', async () => {
		const client = fixture.owner()
		const hash = await client.sendTransaction({ data: encodeDeployData({ abi: vaultDeployerArtifact.abi, bytecode: applyLibraries(vaultDeployerArtifact.evm.bytecode.object), args: [getInfraContractAddresses().securityPoolPortfolioQuoteDeployer] }) })
		const receipt = await client.waitForTransactionReceipt({ hash })
		if (receipt.contractAddress === undefined || receipt.contractAddress === null) throw new Error('Vault factory deployment missing')
		const deployer = receipt.contractAddress
		const owner = fixture.other().account.address
		const predictions = []
		for (const namespace of [fixture.portfolio, fixture.vault]) {
			await fixture.base.mockWindow.impersonateAccount(namespace)
			await fixture.base.mockWindow.setBalance(namespace, unit)
			const sender = createWriteClient(fixture.base.mockWindow, BigInt(namespace))
			const predicted = await sender.readContract({ account: namespace, abi: vaultDeployerArtifact.abi, address: deployer, functionName: 'predictVaultAddress', args: [owner] })
			await writeContractAndWait(sender, () => sender.writeContract({ abi: vaultDeployerArtifact.abi, address: deployer, functionName: 'createVault', args: [owner] }))
			expect(await client.readContract({ abi: vaultArtifact.abi, address: predicted, functionName: 'portfolio' })).toBe(namespace)
			expect(await client.readContract({ abi: vaultArtifact.abi, address: predicted, functionName: 'owner' })).toBe(owner)
			predictions.push(predicted)
		}
		expect(predictions[0]).not.toBe(predictions[1])
		const directPrediction = await client.readContract({ account: client.account, abi: vaultDeployerArtifact.abi, address: deployer, functionName: 'predictVaultAddress', args: [owner] })
		expect(predictions).not.toContain(directPrediction)
		await expect(client.simulateContract({ abi: vaultDeployerArtifact.abi, address: deployer, functionName: 'createVault', args: [owner] })).rejects.toThrow('Portfolio has no code')
	})

	test('portfolio construction rejects addresses without factory or pool code', async () => {
		const { owner, base } = fixture
		const deployment = (factory: Hex, pool: Hex) =>
			encodeDeployData({ abi: portfolioArtifact.abi, bytecode: applyLibraries(portfolioArtifact.evm.bytecode.object), args: [factory, pool, maximumQuestionHorizonSeconds, getInfraContractAddresses().securityPoolPortfolioVaultDeployer, fixture.questionAdmissionPolicy, portfolioEconomics] })
		await expect(owner().call({ data: deployment(owner().account.address, base.securityPoolAddresses.securityPool) })).rejects.toThrow('Factory has no code')
		await expect(owner().call({ data: deployment(getInfraContractAddresses().securityPoolFactory, owner().account.address) })).rejects.toThrow('Pool has no code')
	})

	test('registers distinct dates and canonical shares without committing any owner capital', async () => {
		const { base, owner, portfolio, secondQuestionId, poolFor, vault } = fixture
		expect(await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'questionCount' })).toBe(2n)
		expect(await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'getQuestions', args: [0n, 64n] })).toEqual([base.questionId, secondQuestionId])
		expect(await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'getPool', args: [secondQuestionId, base.genesisUniverse] })).toBe(poolFor(secondQuestionId).securityPool)
		expect(poolFor(secondQuestionId).shareToken).not.toBe(base.securityPoolAddresses.shareToken)
		expect((await getSecurityVault(owner(), poolFor(secondQuestionId).securityPool, vault)).repBackingUnits).toBe(0n)
		await writeContractAndWait(owner(), () => owner().writeContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'addQuestion', args: [secondQuestionId] }))
		expect(await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'questionCount' })).toBe(2n)
		await expect(owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'getPool', args: [123n, 0n] })).rejects.toThrow('Question not registered')
		await expect(owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'getPool', args: [secondQuestionId, 123n] })).rejects.toThrow('Question pool unavailable')
		await expect(owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'getQuestions', args: [0n, 65n] })).rejects.toThrow('Invalid page')
	})

	test('late admission is rejected while ended registered questions remain addressable', async () => {
		const { base, owner, portfolio } = fixture
		const question = makeQuestion('Unregistered expired portfolio question', base.questionData.endTime)
		const questionId = getQuestionId(question, base.outcomes)
		await createQuestion(owner(), question, base.outcomes)
		await base.mockWindow.setTime(question.endTime + 1n)
		await expect(writeContractAndWait(owner(), () => owner().writeContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'addQuestion', args: [questionId] }))).rejects.toThrow('Question has already ended')
		await writeContractAndWait(owner(), () => owner().writeContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'addQuestion', args: [base.questionId] }))
		expect(await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'getPool', args: [base.questionId, base.genesisUniverse] })).toBe(base.securityPoolAddresses.securityPool)
	})

	test('CREATE2 accounts are idempotent and another underwriter cannot operate or withdraw them', async () => {
		const { owner, other, portfolio, vault, base } = fixture
		expect(await fixture.createVault()).toBe(vault)
		expect(await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'predictVaultAddress', args: [owner().account.address] })).toBe(vault)
		const otherVault = await fixture.createVault(other())
		expect(otherVault).not.toBe(vault)
		await fixture.transferRep(vault, 100n * unit)
		await expect(fixture.execute(getRepTokenAddress(base.genesisUniverse), encodeFunctionData({ abi: repArtifact.abi, functionName: 'transfer', args: [other().account.address, unit] }), 0n, other())).rejects.toThrow('Only vault owner')
		await expect(fixture.submit(base.questionId, { ...emptyOperations(), depositAttoRep: unit }, { sender: other() })).rejects.toThrow('Only vault owner')
		await expect(other().simulateContract({ abi: vaultArtifact.abi, address: vault, functionName: 'executeBatch', args: [[{ target: other().account.address, value: 0n, data: '0x' }]] })).rejects.toThrow('Only vault owner')
		expect(await getERC20Balance(owner(), getRepTokenAddress(base.genesisUniverse), vault)).toBe(100n * unit)
	})

	test('REP allocated to A cannot back B and shares keep separate collateral', async () => {
		const { owner, base, poolFor, secondQuestionId, vault } = fixture
		await fixture.allocate(base.questionId)
		await createCompleteSet(owner(), base.securityPoolAddresses.securityPool, 20n * unit)
		await expect(fixture.submit(secondQuestionId, { ...emptyOperations(), depositAttoRep: 1_000n * unit })).rejects.toThrow()
		expect(await fixture.repClaim(base.securityPoolAddresses.securityPool)).toBe(1_000n * unit)
		expect(await fixture.repClaim(poolFor(secondQuestionId).securityPool)).toBe(0n)
		expect(await getTotalUnderwritingLimitAttoEth(owner(), poolFor(secondQuestionId).securityPool)).toBe(0n)
		await fixture.allocate(secondQuestionId, 600n * unit, 60n * unit)
		await createCompleteSet(owner(), poolFor(secondQuestionId).securityPool, 30n * unit)
		expect(await fixture.repClaim(base.securityPoolAddresses.securityPool)).toBe(1_000n * unit)
		expect(await fixture.repClaim(poolFor(secondQuestionId).securityPool)).toBe(600n * unit)
		expect(await getERC20Balance(owner(), getRepTokenAddress(base.genesisUniverse), vault)).toBe(0n)
		expect(await getSettlementCollateralAttoEth(owner(), poolFor(secondQuestionId).securityPool)).toBe(30n * unit)
		expect((await balanceOfShares(owner(), base.securityPoolAddresses.shareToken, base.genesisUniverse, owner().account.address))[1]).toBe(20n * unit)
		expect((await balanceOfShares(owner(), poolFor(secondQuestionId).shareToken, base.genesisUniverse, owner().account.address))[1]).toBe(30n * unit)
	})

	test('a staged withdrawal is not spendable in B until the native oracle executes it', async () => {
		const { owner, base, vault, secondQuestionId, poolFor } = fixture
		await fixture.allocate(base.questionId)
		await base.mockWindow.advanceTime(301n)
		const funding = await fixture.fundVaultOracle(base.questionId)
		const coordinator = base.securityPoolAddresses.openOraclePriceCoordinator
		await fixture.submit(base.questionId, { ...emptyOperations(), changeCommitment: true, commitmentAttoEth: 0n, withdrawAttoRep: 1_000n * unit }, { price: unit, value: funding.cost })
		expect(await fixture.repClaim(base.securityPoolAddresses.securityPool)).toBe(1_000n * unit)
		expect(await owner().readContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'pendingReportSponsor' })).toBe(vault)
		await expect(fixture.submit(secondQuestionId, { ...emptyOperations(), depositAttoRep: 1_000n * unit })).rejects.toThrow()
		expect(await fixture.repClaim(poolFor(secondQuestionId).securityPool)).toBe(0n)
		await handleOracleReporting(owner(), base.mockWindow, coordinator, unit)
		expect(await fixture.repClaim(base.securityPoolAddresses.securityPool)).toBe(0n)
		await fixture.submit(secondQuestionId, { ...emptyOperations(), depositAttoRep: 1_000n * unit })
		expect(await fixture.repClaim(poolFor(secondQuestionId).securityPool)).toBe(1_000n * unit)
	})

	test('ending A does not release backing while A still owes settlement collateral', async () => {
		const { owner, base, secondQuestionId } = fixture
		await fixture.allocate(base.questionId)
		await createCompleteSet(owner(), base.securityPoolAddresses.securityPool, 50n * unit)
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		await fixture.refreshPrice(base.questionId)
		await expect(fixture.submit(base.questionId, { ...emptyOperations(), changeCommitment: true, commitmentAttoEth: 0n, withdrawAttoRep: 1_000n * unit })).rejects.toThrow()
		expect(await fixture.repClaim(base.securityPoolAddresses.securityPool)).toBe(1_000n * unit)
		await fixture.allocate(secondQuestionId)
		expect(await fixture.repClaim(base.securityPoolAddresses.securityPool)).toBe(1_000n * unit)
	})

	test('fees and idle REP can exit only to the owner-selected recipient', async () => {
		const { owner, other, base, vault } = fixture
		await fixture.allocate(base.questionId)
		await createCompleteSet(owner(), base.securityPoolAddresses.securityPool, 50n * unit)
		await base.mockWindow.advanceTime(30n * DAY)
		await writeContractAndWait(other(), () => other().writeContract({ abi: poolArtifact.abi, address: base.securityPoolAddresses.securityPool, functionName: 'redeemFees', args: [vault] }))
		const fees = await getETHBalance(owner(), vault)
		expect(fees).toBeGreaterThan(0n)
		const recipientBefore = await getETHBalance(owner(), other().account.address)
		await writeContractAndWait(owner(), () => owner().writeContract({ abi: vaultArtifact.abi, address: vault, functionName: 'execute', args: [other().account.address, fees, '0x'] }))
		expect(await getETHBalance(owner(), other().account.address)).toBe(recipientBefore + fees)
		await fixture.transferRep(vault, 10n * unit)
		const repBefore = await getERC20Balance(owner(), getRepTokenAddress(base.genesisUniverse), owner().account.address)
		await fixture.execute(getRepTokenAddress(base.genesisUniverse), encodeFunctionData({ abi: repArtifact.abi, functionName: 'transfer', args: [owner().account.address, 10n * unit] }))
		expect(await getERC20Balance(owner(), getRepTokenAddress(base.genesisUniverse), owner().account.address)).toBe(repBefore + 10n * unit)
	})

	test('a failing batch rolls back earlier transfers and rejects unbounded batches', async () => {
		const { owner, other, base, vault } = fixture
		await fixture.transferRep(vault, 10n * unit)
		const rep = getRepTokenAddress(base.genesisUniverse)
		const before = await getERC20Balance(owner(), rep, other().account.address)
		const call = { target: rep, value: 0n, data: encodeFunctionData({ abi: repArtifact.abi, functionName: 'transfer', args: [other().account.address, 10n * unit] }) }
		await expect(writeContractAndWait(owner(), () => owner().sendTransaction(buildPortfolioBatchRequest({ owner: owner().account.address, vault, vaultAbi: vaultArtifact.abi, calls: [call, call] })))).rejects.toThrow()
		expect(await getERC20Balance(owner(), rep, other().account.address)).toBe(before)
		expect(await getERC20Balance(owner(), rep, vault)).toBe(10n * unit)
		await expect(owner().simulateContract({ abi: vaultArtifact.abi, address: vault, functionName: 'executeBatch', args: [[]] })).rejects.toThrow('Choose one to sixteen calls')
		await expect(owner().simulateContract({ abi: vaultArtifact.abi, address: vault, functionName: 'executeBatch', args: [Array.from({ length: 17 }, () => call)] })).rejects.toThrow('Choose one to sixteen calls')
		await expect(owner().simulateContract({ abi: vaultArtifact.abi, address: vault, functionName: 'execute', args: [zeroAddress, 0n, '0x'] })).rejects.toThrow('Call target zero')
	})

	test('the vault receives and redeems its own complete sets through the native ERC1155 path', async () => {
		const { owner, base, vault } = fixture
		await fixture.allocate(base.questionId)
		await fixture.execute(base.securityPoolAddresses.securityPool, encodeFunctionData({ abi: poolArtifact.abi, functionName: 'createCompleteSet' }), 10n * unit)
		expect(await balanceOfShares(owner(), base.securityPoolAddresses.shareToken, base.genesisUniverse, vault)).toEqual([10n * unit, 10n * unit, 10n * unit])
		await fixture.execute(base.securityPoolAddresses.securityPool, encodeFunctionData({ abi: poolArtifact.abi, functionName: 'redeemCompleteSet', args: [10n * unit] }))
		expect(await balanceOfShares(owner(), base.securityPoolAddresses.shareToken, base.genesisUniverse, vault)).toEqual([0n, 0n, 0n])
		expect(await getETHBalance(owner(), vault)).toBeGreaterThan(0n)
	})

	test('native signed liquidation approvals authenticate the immutable owner and bind the receiver account', async () => {
		const { owner, other, base } = fixture
		const signerKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
		const outsiderKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412d99615a5f2f5f0'
		const signer = privateKeyToAccount(signerKey)
		await base.mockWindow.impersonateAccount(signer.address)
		await base.mockWindow.setBalance(signer.address, unit)
		const signerClient = createWriteClient(base.mockWindow, BigInt(signer.address))
		const signedVault = await fixture.createVault(signerClient)
		await fixture.execute(fixture.portfolio, encodeFunctionData({ abi: portfolioArtifact.abi, functionName: 'createVault' }), 0n, signerClient, signedVault)
		const smartOwnedVault = await owner().readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'vaultOf', args: [signedVault] })
		const secondDeploymentHash = await owner().sendTransaction({ data: encodeDeployData({ abi: vaultArtifact.abi, bytecode: applyLibraries(vaultArtifact.evm.bytecode.object), args: [signer.address, fixture.portfolio] }) })
		const secondReceipt = await owner().waitForTransactionReceipt({ hash: secondDeploymentHash })
		const sameOwnerSecondVault = secondReceipt.contractAddress
		if (!sameOwnerSecondVault) throw new Error('Second signer-owned account missing')
		const registry = await owner().readContract({ abi: coordinatorArtifact.abi, address: base.securityPoolAddresses.openOraclePriceCoordinator, functionName: 'liquidationApprovalRegistry' })
		const approval = {
			securityPool: base.securityPoolAddresses.securityPool,
			receiverVault: signedVault,
			operator: other().account.address,
			targetVault: owner().account.address,
			maxCumulativeDebtAttoEth: 10n * unit,
			maxDebtPerLiquidationAttoEth: 5n * unit,
			minPostLiquidationHealthFactorBps: 12_500n,
			validAfter: 0n,
			validUntil: 9_999_999_999n,
			nonce: 0n,
		}
		const digest = await owner().readContract({ abi: registryArtifact.abi, address: registry, functionName: 'liquidationApprovalDigest', args: [approval] })
		const typedData = {
			domain: { chainId: await owner().getChainId(), name: 'Statoblast Liquidation Approvals', version: '1', verifyingContract: registry },
			primaryType: 'LiquidationApproval' as const,
			types: {
				EIP712Domain: [
					{ name: 'name', type: 'string' },
					{ name: 'version', type: 'string' },
					{ name: 'chainId', type: 'uint256' },
					{ name: 'verifyingContract', type: 'address' },
				],
				LiquidationApproval: [
					{ name: 'securityPool', type: 'address' },
					{ name: 'receiverVault', type: 'address' },
					{ name: 'operator', type: 'address' },
					{ name: 'targetVault', type: 'address' },
					{ name: 'maxCumulativeDebtAttoEth', type: 'uint256' },
					{ name: 'maxDebtPerLiquidationAttoEth', type: 'uint256' },
					{ name: 'minPostLiquidationHealthFactorBps', type: 'uint256' },
					{ name: 'validAfter', type: 'uint256' },
					{ name: 'validUntil', type: 'uint256' },
					{ name: 'nonce', type: 'uint256' },
				],
			},
			message: approval,
		}
		const signatureValue = signTyped(typedData, signerKey)
		const invalidSignatureValue = signTyped(typedData, outsiderKey)
		if (!isHex(signatureValue) || !isHex(invalidSignatureValue)) throw new Error('Invalid test signature encoding')
		const signature: Hex = `0x${signatureValue.slice(2)}`
		const invalidSignature: Hex = `0x${invalidSignatureValue.slice(2)}`
		expect(await owner().readContract({ abi: vaultArtifact.abi, address: signedVault, functionName: 'isValidSignature', args: [digest, signature] })).toBe('0x1626ba7e')
		expect(await owner().readContract({ abi: vaultArtifact.abi, address: signedVault, functionName: 'isValidSignature', args: [digest, invalidSignature] })).toBe('0xffffffff')
		expect(await owner().readContract({ abi: vaultArtifact.abi, address: smartOwnedVault, functionName: 'isValidSignature', args: [digest, signature] })).toBe('0x1626ba7e')
		expect(await owner().readContract({ abi: vaultArtifact.abi, address: smartOwnedVault, functionName: 'isValidSignature', args: [digest, invalidSignature] })).toBe('0xffffffff')
		await expect(other().simulateContract({ abi: registryArtifact.abi, address: registry, functionName: 'permitLiquidationApproval', args: [approval, invalidSignature] })).rejects.toThrow('Invalid signature')
		await expect(other().simulateContract({ abi: registryArtifact.abi, address: registry, functionName: 'permitLiquidationApproval', args: [{ ...approval, receiverVault: sameOwnerSecondVault }, signature] })).rejects.toThrow('Invalid signature')
		await writeContractAndWait(other(), () => other().writeContract({ abi: registryArtifact.abi, address: registry, functionName: 'permitLiquidationApproval', args: [approval, signature] }))
	})

	test('B admissions and withdrawals cannot consume A finalized redemption reserve', async () => {
		const { owner, base, secondQuestionId, poolFor } = fixture
		await fixture.allocate(base.questionId)
		await createCompleteSet(owner(), base.securityPoolAddresses.securityPool, 50n * unit)
		await base.finalizeQuestionAsYesWithoutFork()
		const reserve = await getSettlementCollateralAttoEth(owner(), base.securityPoolAddresses.securityPool)
		expect(reserve).toBeGreaterThan(0n)
		await fixture.allocate(secondQuestionId)
		await fixture.submit(secondQuestionId, { ...emptyOperations(), changeCommitment: true, commitmentAttoEth: 0n, withdrawAttoRep: 1_000n * unit })
		expect(await getSettlementCollateralAttoEth(owner(), base.securityPoolAddresses.securityPool)).toBe(reserve)
		expect(await getSettlementCollateralAttoEth(owner(), poolFor(secondQuestionId).securityPool)).toBe(0n)
		await redeemShares(owner(), base.securityPoolAddresses.securityPool)
		expect(await getSettlementCollateralAttoEth(owner(), base.securityPoolAddresses.securityPool)).toBe(0n)
	})
})

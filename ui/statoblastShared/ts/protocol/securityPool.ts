import { deployment as deploymentCopy } from '../copy/securityPoolTransactions.js'
import { registrationForkThresholdTooLow } from '../copy/securityPool.js'
import { poolErrors, contractCodeUnverified, contractSettingsMismatch, contractLinkMismatch } from '../copy/protocolErrors.js'
import { currentStateCheckFailed } from '@zoltar/ui-core-shared/copy/transaction.js'
import { withTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import { getMulticall3Address } from '@zoltar/ui-zoltar-shared/protocol/zoltarDeploymentHelpers.js'
import type { PublicClient } from '@zoltar/core-shared/evm/ethereum'
import { collateralPresentation } from './collateral.js'
import { checksTransactionReview } from './reviewedClient.js'
import { encodeFunctionData, getAddress, parseAbi, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import {
	buildSecurityPoolDeploymentRequest,
	buildSecurityPoolPrepareNextRequest,
	decodeAuctionVaultBindings,
	securityPoolAddressFromDeploymentLogs,
	loadSecurityPoolCapitalSnapshot,
	loadSecurityPoolClaimableEarnings,
	boundCloneImplementation,
	boundCloneRuntimeCode,
	universeCloneBindings,
	verifyBoundCloneCode,
	type SecurityPoolReadClient,
	type SecurityPoolEconomicsConfig,
	type SecurityPoolOriginConfig,
} from '@zoltar/statoblast-shared/statoblast/securityPool'
import type { ReadClient, WriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { Zoltar_Zoltar } from '@zoltar/ui-core-shared/contractArtifact.js'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { waitForSubmittedTransactionReceipt, type SubmittedTransactionReceiptOptions } from '@zoltar/ui-core-shared/transactions/transactionReceipt.js'
import {
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCapitalLifecycleDelegate_SecurityPoolCapitalLifecycleDelegate as lifecycleArtifact,
	statoblast_SecurityPoolCapitalRepairAuctionDelegate_SecurityPoolCapitalRepairAuctionDelegate as auctionDelegateArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_SecurityPoolCapitalFeeStreams_SecurityPoolCapitalFeeStreams as feesArtifact,
	statoblast_SecurityPoolSettlement_SecurityPoolSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	statoblast_SecurityPoolReporterLedger_SecurityPoolReporterLedger as reporterArtifact,
	statoblast_SecurityPoolPurchase_SecurityPoolPurchase as purchaseArtifact,
	statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinator as forkArtifact,
	statoblast_SecurityPoolServices_SecurityPoolServices as servicesArtifact,
	statoblast_SecurityPoolResolutionPremiumBook_SecurityPoolResolutionPremiumBook as premiumArtifact,
} from '../contractArtifact.js'
import { getInfraContractAddresses, getSecurityPoolCreationCode, getSecurityPoolRuntimeCode } from './deploymentHelpers.js'
import { invalidPool, missingPoolContract } from '../copy/watchlist.js'
import { positionNeedsConfirmedBlock, transactionOwnerRequired } from '../copy/securityPool.js'
import { requireAddressValue, requireBigintValue, requireIntegerLikeValue } from './decoders.js'
import { readRequiredMulticall } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { loadSecurityPoolAdmission } from './securityPoolAdmission.js'
import { authenticateSecurityPoolAuctionVault, isCanonicalAuctionVaultImplementation } from './securityPoolRepairAuction.js'

export type SecurityPoolTransaction = {
	account: Address
	to?: Address
	data: Hex
	value?: bigint
	gas?: bigint
	nonce?: bigint
	reviewDescription?: string
	readReviewRows?: (() => readonly { label: string; value: string }[]) | undefined
	validateBeforeSubmit?: () => Promise<void>
	refreshReviewData?: () => Promise<Hex>
}
const linksAbi = parseAbi([
	'function securityPool() view returns (address)',
	'function implementation() view returns (address)',
	'function capitalImplementation() view returns (address)',
	'function capitalLedger() view returns (address)',
	'function zoltar() view returns (address)',
	'function universeId() view returns (uint248)',
	'function ledger() view returns (address)',
	'function feeStreams() view returns (address)',
	'function lifecycleDelegate() view returns (address)',
	'function repairAuctionDelegate() view returns (address)',
	'function repairAuctionDeployer() view returns (address)',
	'function services() view returns (address)',
	'function forkAuthority() view returns (address)',
	'function premiumLedger() view returns (address)',
	'function getRepToken(uint248 universeId) view returns (address)',
	'function getForkTime(uint248 universeId) view returns (uint256)',
	'function setupStage() view returns (uint8)',
	'function prepareNext()',
	'function factory() view returns (address)',
	'function originUniverseId() view returns (uint248)',
	'function isSecurityPool(address securityPool) view returns (bool)',
])
type RuntimeArtifact = { evm: { deployedBytecode: { object: string; immutableReferences: Readonly<Record<string, readonly { start: number; length: number }[]>> } } }

export function verifyRuntimeCode(actual: Hex | undefined, expected: Hex, references: Readonly<Record<string, readonly { start: number; length: number }[]>>, label: string) {
	if (actual === undefined || actual.length !== expected.length) throw new Error(contractCodeUnverified(label))
	for (const entries of Object.values(references)) {
		let immutableValue: string | undefined
		for (const entry of entries) {
			const value = actual.slice(2 + entry.start * 2, 2 + (entry.start + entry.length) * 2).toLowerCase()
			if (immutableValue !== undefined && immutableValue !== value) throw new Error(contractSettingsMismatch(label))
			immutableValue = value
		}
	}
	const mask = (code: string) => {
		let masked = code.toLowerCase()
		for (const entry of Object.values(references).flat()) {
			const start = 2 + entry.start * 2
			const length = entry.length * 2
			if (start < 2 || start + length > code.length) throw new Error(poolErrors.deploymentCode)
			masked = masked.slice(0, start) + '0'.repeat(length) + masked.slice(start + length)
		}
		return masked
	}
	if (mask(actual) !== mask(expected)) throw new Error(contractCodeUnverified(label))
}

async function verifyModule(client: ReadClient, address: Address, artifact: RuntimeArtifact, authority: Address, label: string, blockNumber: bigint, authorityGetter: 'securityPool' | 'implementation' | 'services' = 'securityPool') {
	verifyRuntimeCode(await client.getCode({ address, blockNumber }), `0x${artifact.evm.deployedBytecode.object}`, artifact.evm.deployedBytecode.immutableReferences, label)
	const actualValue = await client.readContract({ address, abi: linksAbi, functionName: authorityGetter, blockNumber })
	const actual = requireAddressValue(actualValue, 'linked contract address')
	if (getAddress(actual) !== getAddress(authority)) throw new Error(contractLinkMismatch(label))
}

export async function verifyCapitalModuleClone(client: ReadClient, address: Address, artifact: RuntimeArtifact, ledger: Address, label: string, blockNumber: bigint) {
	const implementation = boundCloneImplementation(await client.getCode({ address, blockNumber }), ledger, label)
	const [code, authority] = await Promise.all([client.getCode({ address: implementation, blockNumber }), client.readContract({ address, abi: linksAbi, functionName: 'capitalLedger', blockNumber })])
	verifyRuntimeCode(code, `0x${artifact.evm.deployedBytecode.object}`, artifact.evm.deployedBytecode.immutableReferences, label)
	if (getAddress(requireAddressValue(authority, 'capital contract')) !== getAddress(ledger)) throw new Error(contractLinkMismatch(label))
}

export async function verifyCapitalLedgerClone(client: ReadClient, securityPool: Address, ledger: Address, universeId: bigint, repToken: Address, blockNumber: bigint) {
	const implementation = requireAddressValue(await client.readContract({ address: securityPool, abi: linksAbi, functionName: 'capitalImplementation', blockNumber }), 'capital contract template')
	const expected = boundCloneRuntimeCode(implementation, universeCloneBindings(universeId, repToken))
	await Promise.all([verifyModule(client, implementation, capitalArtifact, securityPool, 'capital contract template', blockNumber), client.getCode({ address: ledger, blockNumber }).then(code => verifyBoundCloneCode(code, expected, 'capital contract'))])
}

/**
 * The canonical factory deploys every security pool from its pinned creation code and module deployers and records it.
 * Runtime code alone proves nothing about the constructor arguments, so this record is what authenticates the modules.
 */
async function requireCanonicalSecurityPool(client: Pick<ReadClient, 'readContract'>, securityPool: Address, blockNumber?: bigint, readUnverifiedCode?: ReadClient['getCode']) {
	const recorded = await client.readContract({ address: getInfraContractAddresses().securityPoolFactory, abi: linksAbi, functionName: 'isSecurityPool', args: [securityPool], ...(blockNumber === undefined ? {} : { blockNumber }) })
	if (recorded === true) return
	if (readUnverifiedCode === undefined) throw new Error(poolErrors.poolUnverified)
	const code = await readUnverifiedCode({ address: securityPool, blockNumber })
	throw new Error(code === undefined || code === '0x' ? missingPoolContract : invalidPool)
}

/** A bounded setup status is readable before the custody modules exist. */
export async function loadSecurityPoolSetup(client: ReadClient, securityPool: Address, owner: Address, fromDirectLink = false) {
	const [block, chainId] = await Promise.all([client.getBlock(), client.getChainId()])
	if (block.number === undefined || block.hash === undefined) throw new Error(poolErrors.setupBlock)
	const blockNumber = block.number
	await requireCanonicalSecurityPool(client, securityPool, blockNumber, fromDirectLink ? request => client.getCode(request) : undefined)
	verifyRuntimeCode(await client.getCode({ address: securityPool, blockNumber }), getSecurityPoolRuntimeCode(), securityPoolArtifact.evm.deployedBytecode.immutableReferences, 'securityPool')
	const [stageValue, factoryValue, zoltarValue, originValue, auctionDeployerValue] = await Promise.all([
		client.readContract({ address: securityPool, abi: linksAbi, functionName: 'setupStage', blockNumber }),
		client.readContract({ address: securityPool, abi: linksAbi, functionName: 'factory', blockNumber }),
		client.readContract({ address: securityPool, abi: linksAbi, functionName: 'zoltar', blockNumber }),
		client.readContract({ address: securityPool, abi: linksAbi, functionName: 'originUniverseId', blockNumber }),
		client.readContract({ address: securityPool, abi: linksAbi, functionName: 'repairAuctionDeployer', blockNumber }),
	])
	const infrastructure = getInfraContractAddresses()
	if (getAddress(requireAddressValue(factoryValue, 'security pool factory')) !== getAddress(infrastructure.securityPoolFactory) || getAddress(requireAddressValue(zoltarValue, 'security pool protocol')) !== getAddress(infrastructure.zoltar)) throw new Error(poolErrors.protocolMismatch)
	if (getAddress(requireAddressValue(auctionDeployerValue, 'auction deployer')) !== getAddress(infrastructure.securityPoolRepairAuctionDeployer)) throw new Error(poolErrors.auctionContractMismatch)
	const stage = Number(requireIntegerLikeValue(stageValue, 'setup stage'))
	if (stage < 0 || stage > 4) throw new Error(poolErrors.setupStage)
	const originUniverseId = requireBigintValue(originValue, 'origin universe')
	const originForkTime = requireBigintValue(await client.readContract({ address: infrastructure.zoltar, abi: linksAbi, functionName: 'getForkTime', args: [originUniverseId], blockNumber }), 'origin fork time')
	const [finalBlock, finalChain] = await Promise.all([client.getBlock({ blockNumber }), client.getChainId()])
	if (finalBlock.hash !== block.hash || finalChain !== chainId) throw new Error(poolErrors.setupChanged)
	return { securityPool, owner, stage, originUniverseId, originForkTime, chainId, blockNumber, blockHash: block.hash, timestamp: block.timestamp }
}
export type SecurityPoolSetupSnapshot = Awaited<ReturnType<typeof loadSecurityPoolSetup>>
export function securityPoolPreparationRequest(owner: Address, securityPool: Address): SecurityPoolTransaction {
	return buildSecurityPoolPrepareNextRequest({ caller: owner, securityPool })
}

export async function isUniverseForked(client: Pick<ReadClient, 'readContract'>, universeId: bigint) {
	const address = getInfraContractAddresses().zoltar
	const repToken = requireAddressValue(await client.readContract({ abi: Zoltar_Zoltar.abi, address, functionName: 'getRepToken', args: [universeId] }), 'origin REP token')
	if (repToken === zeroAddress) throw new Error(deploymentCopy.originMissing)
	const forkTime = requireBigintValue(await client.readContract({ abi: linksAbi, address, functionName: 'getForkTime', args: [universeId] }), 'universe fork time')
	if (forkTime !== 0n) return true
	const [thresholdValue, supplyValue] = await Promise.all([client.readContract({ abi: Zoltar_Zoltar.abi, address, functionName: 'getNonDecisionThresholdAttoRep', args: [universeId] }), client.readContract({ abi: Zoltar_Zoltar.abi, address, functionName: 'getUniverseTheoreticalSupplyAttoRep', args: [universeId] })])
	const threshold = requireBigintValue(thresholdValue, 'non-decision threshold')
	const supply = requireBigintValue(supplyValue, 'universe REP supply')
	const supplyDeposit = supply / 10_000_000n
	const initialDeposit = supplyDeposit > 10n ** 18n ? supplyDeposit : 10n ** 18n
	if (threshold <= initialDeposit) throw new Error(registrationForkThresholdTooLow)
	return false
}

/** Authenticate the actual custody tree before offering approvals or transactions. */
export async function loadSecurityPoolAccount(client: ReadClient, securityPool: Address, owner: Address | undefined, universeId: bigint, questionStart = 0n, admissionStart = 0n, includeQuestions = true) {
	const anchor = await client.getBlock()
	const blockNumber = anchor.number
	if (blockNumber === undefined || anchor.hash === undefined) throw new Error(positionNeedsConfirmedBlock)
	await requireCanonicalSecurityPool(client, securityPool, blockNumber)
	const snapshot = await loadSecurityPoolCapitalSnapshot({ client: securityPoolReadClient(client), securityPool, owner, universeId, blockNumber })
	if (snapshot.blockHash !== anchor.hash) throw new Error(poolErrors.poolChanged)
	verifyRuntimeCode(await client.getCode({ address: securityPool, blockNumber }), getSecurityPoolRuntimeCode(), securityPoolArtifact.evm.deployedBytecode.immutableReferences, 'securityPool')
	const [factory, zoltar, originUniverseId, admissionAddress, settlement, reporters, quoteHelper, forkController, feeStreamsValue, lifecycleValue, services, capitalServicesValue, capitalForkValue, questionCount, auctionDelegateValue, auctionDeployerValue] = await Promise.all([
		client.readContract({ address: securityPool, abi: securityPoolArtifact.abi, functionName: 'factory', blockNumber }),
		client.readContract({ address: securityPool, abi: securityPoolArtifact.abi, functionName: 'zoltar', blockNumber }),
		client.readContract({ address: securityPool, abi: securityPoolArtifact.abi, functionName: 'originUniverseId', blockNumber }),
		client.readContract({ address: securityPool, abi: securityPoolArtifact.abi, functionName: 'questionAdmissionPolicy', blockNumber }),
		client.readContract({ address: securityPool, abi: securityPoolArtifact.abi, functionName: 'settlement', blockNumber }),
		client.readContract({ address: securityPool, abi: securityPoolArtifact.abi, functionName: 'reporters', blockNumber }),
		client.readContract({ address: securityPool, abi: securityPoolArtifact.abi, functionName: 'quoteHelper', blockNumber }),
		client.readContract({ address: securityPool, abi: securityPoolArtifact.abi, functionName: 'forkController', blockNumber }),
		client.readContract({ address: snapshot.capitalLedger, abi: linksAbi, functionName: 'feeStreams', blockNumber }),
		client.readContract({ address: snapshot.capitalLedger, abi: linksAbi, functionName: 'lifecycleDelegate', blockNumber }),
		client.readContract({ address: securityPool, abi: securityPoolArtifact.abi, functionName: 'services', blockNumber }),
		client.readContract({ address: snapshot.capitalLedger, abi: linksAbi, functionName: 'services', blockNumber }),
		client.readContract({ address: snapshot.capitalLedger, abi: linksAbi, functionName: 'forkAuthority', blockNumber }),
		client.readContract({ address: securityPool, abi: securityPoolArtifact.abi, functionName: 'questionCount', blockNumber }),
		client.readContract({ address: snapshot.capitalLedger, abi: linksAbi, functionName: 'repairAuctionDelegate', blockNumber }),
		client.readContract({ address: securityPool, abi: linksAbi, functionName: 'repairAuctionDeployer', blockNumber }),
	])
	const feeStreams = requireAddressValue(feeStreamsValue, 'pool fees contract')
	const lifecycle = requireAddressValue(lifecycleValue, 'pool setup contract')
	const repairAuctionDelegate = requireAddressValue(auctionDelegateValue, 'pool auction contract')
	const infrastructure = getInfraContractAddresses()
	if (getAddress(factory) !== getAddress(infrastructure.securityPoolFactory) || getAddress(zoltar) !== getAddress(infrastructure.zoltar)) throw new Error(poolErrors.protocolMismatch)
	if (getAddress(requireAddressValue(auctionDeployerValue, 'auction deployer')) !== getAddress(infrastructure.securityPoolRepairAuctionDeployer)) throw new Error(poolErrors.auctionContractMismatch)
	if (requireAddressValue(capitalServicesValue, 'pool operations address') !== getAddress(services)) throw new Error(poolErrors.poolServicesMismatch)
	if (requireAddressValue(capitalForkValue, 'fork settings for pool capital') !== getAddress(forkController)) throw new Error(poolErrors.poolForkMismatch)
	const start = questionStart > questionCount ? 0n : questionStart
	// Other contract accounts remain readable, but gain no auction-owner authority:
	// a clone of another implementation stays an ordinary owner, and a clone of the
	// canonical implementation is authenticated fully before it gains any.
	const bindings = owner === undefined ? undefined : decodeAuctionVaultBindings(await client.getCode({ address: owner, blockNumber }))
	const auctionVault = owner !== undefined && bindings !== undefined && (await isCanonicalAuctionVaultImplementation(client, bindings.implementation, blockNumber)) ? await authenticateSecurityPoolAuctionVault(client, securityPool, owner, blockNumber) : undefined
	const fundingOwner = auctionVault?.bidder ?? owner
	const depositSpender = auctionVault?.vault ?? snapshot.capitalLedger
	const collateralToken = await client.readContract({ address: securityPool, abi: securityPoolArtifact.abi, functionName: 'collateralToken', blockNumber })
	const collateral = collateralPresentation(collateralToken)
	const [walletCollateral, collateralAllowance] = await Promise.all([
		fundingOwner === undefined ? 0n : client.readContract({ address: collateralToken, abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [fundingOwner], blockNumber }),
		fundingOwner === undefined ? 0n : client.readContract({ address: collateralToken, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [fundingOwner, services], blockNumber }),
	])
	const [questions, admission, walletAttoRep, allowanceAttoRep, walletAttoEth, bookValue, premiumValue] = await Promise.all([
		includeQuestions ? client.readContract({ address: securityPool, abi: securityPoolArtifact.abi, functionName: 'getQuestions', args: [start, 64n], blockNumber }) : [],
		loadSecurityPoolAdmission(client, admissionAddress, originUniverseId, blockNumber, admissionStart),
		fundingOwner === undefined ? 0n : client.readContract({ address: snapshot.repToken, abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [fundingOwner], blockNumber }),
		fundingOwner === undefined ? 0n : client.readContract({ address: snapshot.repToken, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [fundingOwner, depositSpender], blockNumber }),
		fundingOwner === undefined ? 0n : client.getBalance({ address: fundingOwner, blockNumber }),
		client.readContract({ address: settlement, abi: linksAbi, functionName: 'ledger', blockNumber }),
		client.readContract({ address: services, abi: linksAbi, functionName: 'premiumLedger', blockNumber }),
	])
	const book = requireAddressValue(bookValue, 'payout records')
	const premium = requireAddressValue(premiumValue, 'reporting fees contract')
	await Promise.all([
		verifyCapitalLedgerClone(client, securityPool, snapshot.capitalLedger, universeId, snapshot.repToken, blockNumber),
		verifyModule(client, lifecycle, lifecycleArtifact, lifecycle, 'pool setup contract', blockNumber, 'implementation'),
		verifyModule(client, repairAuctionDelegate, auctionDelegateArtifact, repairAuctionDelegate, 'pool auction contract', blockNumber, 'implementation'),
		verifyCapitalModuleClone(client, snapshot.commitmentIndex, indexArtifact, snapshot.capitalLedger, 'pool capacity contract', blockNumber),
		verifyCapitalModuleClone(client, feeStreams, feesArtifact, snapshot.capitalLedger, 'pool fees contract', blockNumber),
		verifyModule(client, settlement, settlementArtifact, securityPool, 'payout contract', blockNumber),
		verifyModule(client, book, bookArtifact, settlement, 'payout records', blockNumber),
		verifyModule(client, reporters, reporterArtifact, securityPool, 'reporting contract', blockNumber),
		verifyModule(client, quoteHelper, purchaseArtifact, securityPool, 'security pool purchase helper', blockNumber),
		verifyModule(client, forkController, forkArtifact, securityPool, 'fork contract', blockNumber),
		verifyModule(client, services, servicesArtifact, securityPool, 'pool operations contract', blockNumber),
		verifyModule(client, premium, premiumArtifact, services, 'reporting fees contract', blockNumber, 'services'),
	])
	const [capitalUniverse, capitalProtocol, reporterProtocol, forkProtocol, canonicalRep] = await Promise.all([
		client.readContract({ address: snapshot.capitalLedger, abi: linksAbi, functionName: 'universeId', blockNumber }),
		client.readContract({ address: snapshot.capitalLedger, abi: linksAbi, functionName: 'zoltar', blockNumber }),
		client.readContract({ address: reporters, abi: linksAbi, functionName: 'zoltar', blockNumber }),
		client.readContract({ address: forkController, abi: linksAbi, functionName: 'zoltar', blockNumber }),
		client.readContract({ address: zoltar, abi: linksAbi, functionName: 'getRepToken', args: [universeId], blockNumber }),
	])
	if (requireBigintValue(capitalUniverse, 'capital universe') !== universeId || requireAddressValue(canonicalRep, 'pool REP token') !== snapshot.repToken || [capitalProtocol, reporterProtocol, forkProtocol].some(value => requireAddressValue(value, 'linked protocol contract') !== getAddress(zoltar)))
		throw new Error(poolErrors.modulesMismatch)

	const [block, chainId] = await Promise.all([client.getBlock({ blockNumber }), client.getChainId()])
	if (block.hash !== snapshot.blockHash || chainId !== snapshot.chainId) throw new Error(poolErrors.poolChanged)
	// The credited amounts stand in when the preview fails: the account stays usable and claiming still pays the full amount.
	const [claimableEarnings, liquidationDuration] = await Promise.all([
		owner === undefined ? undefined : loadSecurityPoolClaimableEarnings(snapshot, async (contracts, block) => await readRequiredMulticall(client, contracts, block)).catch(() => undefined),
		client
			.readContract({ address: snapshot.commitmentIndex, abi: indexArtifact.abi, functionName: 'LIQUIDATION_AUCTION_DURATION', blockNumber })
			.then(value => requireBigintValue(value, 'liquidation duration'))
			.catch(() => undefined),
	])
	return {
		...snapshot,
		...(claimableEarnings === undefined ? {} : { claimableEarnings }),
		...(liquidationDuration === undefined ? {} : { liquidationDuration }),
		collateralToken,
		collateral,
		walletCollateral,
		collateralAllowance,
		services,
		originUniverseId,
		questionAdmissionPolicy: admissionAddress,
		admission,
		questions,
		questionCount,
		questionStart: start,
		walletAttoRep,
		allowanceAttoRep,
		walletAttoEth,
		forkController,
		...(auctionVault === undefined ? {} : { auctionVault }),
	}
}
export type SecurityPoolAccountSnapshot = Awaited<ReturnType<typeof loadSecurityPoolAccount>>

export function securityPoolCreationRequest(owner: Address, origin: SecurityPoolOriginConfig, maximumQuestionHorizonSeconds: bigint, questionAdmissionPolicy: Address, economics: SecurityPoolEconomicsConfig) {
	return buildSecurityPoolDeploymentRequest({ owner, origin, maximumQuestionHorizonSeconds, questionAdmissionPolicy, economics, factory: getInfraContractAddresses().securityPoolFactory, creationCode: getSecurityPoolCreationCode() })
}
/** The factory creates the security pool, so its address comes from the factory's deployment event, not the receipt. */
export function securityPoolAddressFromCreationReceipt(receipt: { logs: Parameters<typeof securityPoolAddressFromDeploymentLogs>[0] }) {
	return securityPoolAddressFromDeploymentLogs(receipt.logs, getInfraContractAddresses().securityPoolFactory)
}
export function securityPoolContractRequest(account: Address, to: Address, functionName: string, args: readonly unknown[] = []): SecurityPoolTransaction {
	return { account, to, value: 0n, data: encodeFunctionData({ abi: securityPoolArtifact.abi, functionName, args }) }
}

export async function sendSecurityPoolTransaction(client: WriteClient, request: SecurityPoolTransaction, title: string, validate: () => Promise<void> = async () => undefined, receiptOptions?: SubmittedTransactionReceiptOptions) {
	const captured = { ...request }
	if (getAddress(captured.account) !== getAddress(client.account.address)) throw new Error(transactionOwnerRequired)
	const validateCaptured = async () => {
		await validate()
		await captured.validateBeforeSubmit?.()
	}
	const gas = captured.gas === undefined ? {} : { gas: captured.gas }
	const simulate = () => withTimeout(client.call({ account: client.account, to: captured.to, data: captured.data, value: captured.value, ...gas }), 15_000, currentStateCheckFailed)
	const reviewChecksTransaction = checksTransactionReview(client)
	if (!reviewChecksTransaction) {
		await validateCaptured()
		await simulate()
	}
	const checkedAt = performance.now()
	const review = { functionName: title, contractAddress: captured.to, data: captured.data, value: captured.value, reviewTitle: title, reviewDescription: captured.reviewDescription, ...gas }
	client.onTransactionPlan?.([
		{
			...review,
			requireReview: true,
			readReviewRows: captured.readReviewRows,
			...(captured.refreshReviewData === undefined ? {} : { refreshReviewData: captured.refreshReviewData }),
			validateBeforeSubmit: async () => {
				await validateCaptured()
				if (!reviewChecksTransaction && performance.now() - checkedAt > 30_000) await simulate()
			},
		},
	])
	client.onTransactionPrepared?.({ ...review, args: undefined, chainName: client.chain.name, account: client.account })
	const hash = await client.sendTransaction({ to: captured.to, data: captured.data, value: captured.value, nonce: captured.nonce, ...gas })
	const result = await waitForSubmittedTransactionReceipt(client, hash, receiptOptions)
	return { hash: result.hash, receipt: result.receipt }
}

export function securityPoolReadClient(client: ReadClient): SecurityPoolReadClient & Pick<PublicClient, 'multicall'> {
	return {
		multicall: parameters => client.multicall({ ...parameters, multicallAddress: getMulticall3Address() }),
		getChainId: () => client.getChainId(),
		readContract: parameters => client.readContract(parameters),
		getBlock: async parameters => {
			const block = await client.getBlock(parameters)
			if (block.number === undefined || block.hash === undefined) throw new Error(poolErrors.poolReadBlock)
			return { number: block.number, hash: block.hash, timestamp: block.timestamp, baseFeePerGas: block.baseFeePerGas }
		},
	}
}

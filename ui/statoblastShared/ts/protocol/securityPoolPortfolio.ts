import { encodeFunctionData, getAddress, parseAbi, parseAbiItem, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioDeploymentRequest, buildPortfolioPrepareNextRequest, loadPortfolioCapitalSnapshot, type PortfolioReadClient, type PortfolioEconomicsConfig } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import type { ReadClient, WriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { waitForSubmittedTransactionReceipt } from '@zoltar/ui-core-shared/transactions/transactionReceipt.js'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_SecurityPoolCapitalFeeStreams_SecurityPoolCapitalFeeStreams as feesArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	statoblast_SecurityPoolReporterLedger_SecurityPoolReporterLedger as reporterArtifact,
	statoblast_SecurityPoolPortfolioPurchase_SecurityPoolPortfolioPurchase as purchaseArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
} from '../contractArtifact.js'
import { getInfraContractAddresses, getSecurityPoolPortfolioByteCode, getSecurityPoolPortfolioRuntimeCode, getPortfolioDeployers } from './deploymentHelpers.js'
import { requireAddressValue, requireBigintValue, requireIntegerLikeValue } from './decoders.js'
import { loadPortfolioAdmission } from './securityPoolPortfolioAdmission.js'

export type PortfolioTransaction = { account: Address; to?: Address; data: Hex; value?: bigint; reviewDescription?: string; validateBeforeSubmit?: () => Promise<void> }
const linksAbi = parseAbi([
	'function portfolio() view returns (address)',
	'function zoltar() view returns (address)',
	'function universeId() view returns (uint248)',
	'function ledger() view returns (address)',
	'function feeStreams() view returns (address)',
	'function getRepToken(uint248 universeId) view returns (address)',
	'function setupStage() view returns (uint8)',
	'function prepareNext()',
	'function factory() view returns (address)',
	'function originUniverseId() view returns (uint248)',
])
type RuntimeArtifact = { evm: { deployedBytecode: { object: string; immutableReferences: Readonly<Record<string, readonly { start: number; length: number }[]>> } } }

export function verifyRuntimeCode(actual: Hex | undefined, expected: Hex, references: Readonly<Record<string, readonly { start: number; length: number }[]>>, label: string) {
	if (actual === undefined || actual.length !== expected.length) throw new Error(`Unrecognized ${label} runtime code.`)
	for (const entries of Object.values(references)) {
		let immutableValue: string | undefined
		for (const entry of entries) {
			const value = actual.slice(2 + entry.start * 2, 2 + (entry.start + entry.length) * 2).toLowerCase()
			if (immutableValue !== undefined && immutableValue !== value) throw new Error(`Inconsistent ${label} immutable values.`)
			immutableValue = value
		}
	}
	const mask = (code: string) => {
		let masked = code.toLowerCase()
		for (const entry of Object.values(references).flat()) {
			const start = 2 + entry.start * 2
			const length = entry.length * 2
			if (start < 2 || start + length > code.length) throw new Error('Invalid compiler immutable reference.')
			masked = masked.slice(0, start) + '0'.repeat(length) + masked.slice(start + length)
		}
		return masked
	}
	if (mask(actual) !== mask(expected)) throw new Error(`Unrecognized ${label} runtime code.`)
}

async function verifyModule(client: ReadClient, address: Address, artifact: RuntimeArtifact, authority: Address, label: string, blockNumber: bigint) {
	verifyRuntimeCode(await client.getCode({ address, blockNumber }), `0x${artifact.evm.deployedBytecode.object}`, artifact.evm.deployedBytecode.immutableReferences, label)
	const actualValue = await client.readContract({ address, abi: linksAbi, functionName: 'portfolio', blockNumber })
	const actual = requireAddressValue(actualValue, 'module authority')
	if (getAddress(actual) !== getAddress(authority)) throw new Error(`${label} belongs to another authority.`)
}

/** A bounded setup status is readable before the custody modules exist. */
export async function loadPortfolioSetup(client: ReadClient, portfolio: Address, owner: Address) {
	const [block, chainId] = await Promise.all([client.getBlock(), client.getChainId()])
	if (block.number === undefined || block.hash === undefined) throw new Error('Portfolio setup requires a mined block.')
	const blockNumber = block.number
	verifyRuntimeCode(await client.getCode({ address: portfolio, blockNumber }), getSecurityPoolPortfolioRuntimeCode(), portfolioArtifact.evm.deployedBytecode.immutableReferences, 'portfolio')
	const [stageValue, factoryValue, zoltarValue, originValue] = await Promise.all([
		client.readContract({ address: portfolio, abi: linksAbi, functionName: 'setupStage', blockNumber }),
		client.readContract({ address: portfolio, abi: linksAbi, functionName: 'factory', blockNumber }),
		client.readContract({ address: portfolio, abi: linksAbi, functionName: 'zoltar', blockNumber }),
		client.readContract({ address: portfolio, abi: linksAbi, functionName: 'originUniverseId', blockNumber }),
	])
	const infrastructure = getInfraContractAddresses()
	if (getAddress(requireAddressValue(factoryValue, 'portfolio factory')) !== getAddress(infrastructure.securityPoolFactory) || getAddress(requireAddressValue(zoltarValue, 'portfolio protocol')) !== getAddress(infrastructure.zoltar)) throw new Error('Portfolio uses unrecognized protocol contracts.')
	const stage = Number(requireIntegerLikeValue(stageValue, 'setup stage'))
	if (stage < 0 || stage > 3) throw new Error('Invalid portfolio setup stage.')
	const [finalBlock, finalChain] = await Promise.all([client.getBlock({ blockNumber }), client.getChainId()])
	if (finalBlock.hash !== block.hash || finalChain !== chainId) throw new Error('Portfolio setup changed. Refresh and retry.')
	return { portfolio, owner, stage, originUniverseId: requireBigintValue(originValue, 'origin universe'), chainId, blockNumber, blockHash: block.hash }
}
export type PortfolioSetupSnapshot = Awaited<ReturnType<typeof loadPortfolioSetup>>
export function portfolioPreparationRequest(owner: Address, portfolio: Address): PortfolioTransaction {
	return buildPortfolioPrepareNextRequest({ caller: owner, portfolio })
}

/** Authenticate the actual custody tree before offering approvals or transactions. */
export async function loadPortfolioAccount(client: ReadClient, portfolio: Address, owner: Address, universeId: bigint, questionStart = 0n, admissionStart = 0n) {
	const snapshot = await loadPortfolioCapitalSnapshot({ client: portfolioReadClient(client), portfolio, owner, universeId })
	const blockNumber = snapshot.blockNumber
	verifyRuntimeCode(await client.getCode({ address: portfolio, blockNumber }), getSecurityPoolPortfolioRuntimeCode(), portfolioArtifact.evm.deployedBytecode.immutableReferences, 'portfolio')
	const [factory, zoltar, originUniverseId, admissionAddress, settlement, reporters, quoteHelper, forkController, feeStreamsValue, questionCount] = await Promise.all([
		client.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'factory', blockNumber }),
		client.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'zoltar', blockNumber }),
		client.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'originUniverseId', blockNumber }),
		client.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'questionAdmissionPolicy', blockNumber }),
		client.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'settlement', blockNumber }),
		client.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'reporters', blockNumber }),
		client.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'quoteHelper', blockNumber }),
		client.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'forkController', blockNumber }),
		client.readContract({ address: snapshot.capitalLedger, abi: linksAbi, functionName: 'feeStreams', blockNumber }),
		client.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'questionCount', blockNumber }),
	])
	const feeStreams = requireAddressValue(feeStreamsValue, 'fee streams')
	const infrastructure = getInfraContractAddresses()
	if (getAddress(factory) !== getAddress(infrastructure.securityPoolFactory) || getAddress(zoltar) !== getAddress(infrastructure.zoltar)) throw new Error('Portfolio uses unrecognized protocol contracts.')
	const start = questionStart > questionCount ? 0n : questionStart
	const [questions, admission, walletAttoRep, allowanceAttoRep, walletAttoEth, bookValue] = await Promise.all([
		client.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'getQuestions', args: [start, 64n], blockNumber }),
		loadPortfolioAdmission(client, admissionAddress, originUniverseId, blockNumber, admissionStart),
		client.readContract({ address: snapshot.repToken, abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [owner], blockNumber }),
		client.readContract({ address: snapshot.repToken, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [owner, snapshot.capitalLedger], blockNumber }),
		client.getBalance({ address: owner, blockNumber }),
		client.readContract({ address: settlement, abi: linksAbi, functionName: 'ledger', blockNumber }),
	])
	const book = requireAddressValue(bookValue, 'settlement book')
	await Promise.all([
		verifyModule(client, snapshot.capitalLedger, capitalArtifact, portfolio, 'capital ledger', blockNumber),
		verifyModule(client, snapshot.commitmentIndex, indexArtifact, snapshot.capitalLedger, 'commitment index', blockNumber),
		verifyModule(client, feeStreams, feesArtifact, snapshot.capitalLedger, 'capital fee streams', blockNumber),
		verifyModule(client, settlement, settlementArtifact, portfolio, 'settlement engine', blockNumber),
		verifyModule(client, book, bookArtifact, settlement, 'settlement book', blockNumber),
		verifyModule(client, reporters, reporterArtifact, portfolio, 'reporter ledger', blockNumber),
		verifyModule(client, quoteHelper, purchaseArtifact, portfolio, 'portfolio purchase helper', blockNumber),
		verifyModule(client, forkController, forkArtifact, portfolio, 'fork coordinator', blockNumber),
	])
	const [capitalUniverse, capitalProtocol, reporterProtocol, forkProtocol, canonicalRep] = await Promise.all([
		client.readContract({ address: snapshot.capitalLedger, abi: linksAbi, functionName: 'universeId', blockNumber }),
		client.readContract({ address: snapshot.capitalLedger, abi: linksAbi, functionName: 'zoltar', blockNumber }),
		client.readContract({ address: reporters, abi: linksAbi, functionName: 'zoltar', blockNumber }),
		client.readContract({ address: forkController, abi: linksAbi, functionName: 'zoltar', blockNumber }),
		client.readContract({ address: zoltar, abi: linksAbi, functionName: 'getRepToken', args: [universeId], blockNumber }),
	])
	if (requireBigintValue(capitalUniverse, 'capital universe') !== universeId || requireAddressValue(canonicalRep, 'canonical REP') !== snapshot.repToken || [capitalProtocol, reporterProtocol, forkProtocol].some(value => requireAddressValue(value, 'module protocol') !== getAddress(zoltar)))
		throw new Error('Portfolio modules use another universe or protocol.')

	const [block, chainId] = await Promise.all([client.getBlock({ blockNumber }), client.getChainId()])
	if (block.hash !== snapshot.blockHash || chainId !== snapshot.chainId) throw new Error('Chain changed while reading the portfolio. Refresh and try again.')
	return { ...snapshot, originUniverseId, questionAdmissionPolicy: admissionAddress, admission, questions, questionCount, questionStart: start, walletAttoRep, allowanceAttoRep, walletAttoEth, forkController }
}
export type PortfolioAccountSnapshot = Awaited<ReturnType<typeof loadPortfolioAccount>>

export function portfolioCreationRequest(owner: Address, initialOriginPool: Address, maximumQuestionHorizonSeconds: bigint, questionAdmissionPolicy: Address, economics: PortfolioEconomicsConfig) {
	return buildPortfolioDeploymentRequest({ owner, initialOriginPool, maximumQuestionHorizonSeconds, questionAdmissionPolicy, economics, factory: getInfraContractAddresses().securityPoolFactory, deployers: getPortfolioDeployers(), artifact: { abi: portfolioArtifact.abi, bytecode: getSecurityPoolPortfolioByteCode() } })
}
export function portfolioContractRequest(account: Address, to: Address, functionName: string, args: readonly unknown[] = []): PortfolioTransaction {
	return { account, to, value: 0n, data: encodeFunctionData({ abi: portfolioArtifact.abi, functionName, args }) }
}

export async function sendPortfolioTransaction(client: WriteClient, request: PortfolioTransaction, title: string, validate: () => Promise<void> = async () => undefined) {
	const captured = { ...request }
	if (getAddress(captured.account) !== getAddress(client.account.address)) throw new Error('Connect the transaction owner account.')
	const validateCaptured = async () => {
		await validate()
		await captured.validateBeforeSubmit?.()
	}
	await validateCaptured()
	await client.call({ account: client.account, to: captured.to, data: captured.data, value: captured.value })
	const review = { functionName: title, contractAddress: captured.to, data: captured.data, value: captured.value, reviewTitle: title, reviewDescription: captured.reviewDescription }
	client.onTransactionPlan?.([{ ...review, requireReview: true, validateBeforeSubmit: validateCaptured }])
	client.onTransactionPrepared?.({ ...review, args: undefined, chainName: client.chain.name, account: client.account })
	const hash = await client.sendTransaction({ to: captured.to, data: captured.data, value: captured.value })
	const result = await waitForSubmittedTransactionReceipt(client, hash)
	return { hash: result.hash, receipt: result.receipt }
}

export function portfolioReadClient(client: ReadClient): PortfolioReadClient {
	return {
		getChainId: () => client.getChainId(),
		readContract: parameters => client.readContract(parameters),
		getBlock: async parameters => {
			const block = await client.getBlock(parameters)
			if (block.number === undefined || block.hash === undefined) throw new Error('Portfolio snapshot requires a mined block.')
			return { number: block.number, hash: block.hash, timestamp: block.timestamp }
		},
	}
}

const principalDepositedEvent = parseAbiItem('event PrincipalDeposited(address indexed payer,address indexed owner,uint256 amountAttoRep)')
/** Discovery is restricted to the browser-local simulation and authenticated again on load. */
export async function discoverSimulationPortfolio(client: ReadClient, backend: 'simulation' | 'injected', owner: Address): Promise<Address | undefined> {
	if (backend !== 'simulation') return undefined
	const logs = await client.getLogs({ event: principalDepositedEvent, args: { owner }, fromBlock: 0n })
	for (const log of [...logs].reverse()) {
		try {
			const portfolioValue = await client.readContract({ address: log.address, abi: linksAbi, functionName: 'portfolio' })
			const portfolio = requireAddressValue(portfolioValue, 'discovered portfolio')
			if (portfolio !== zeroAddress) {
				verifyRuntimeCode(await client.getCode({ address: portfolio }), getSecurityPoolPortfolioRuntimeCode(), portfolioArtifact.evm.deployedBytecode.immutableReferences, 'portfolio')
				return getAddress(portfolio)
			}
		} catch (failure) {
			console.warn('Skipped an unverified simulation portfolio candidate.', failure)
		}
	}
	return undefined
}

import { createPublicClient, http, getAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { createMockReadClient, createBlockWithTimestamp } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getInfraContractAddresses, getSecurityPoolPortfolioRuntimeCode } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import {
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_SecurityPoolCapitalFeeStreams_SecurityPoolCapitalFeeStreams as feesArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as engineArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	statoblast_SecurityPoolReporterLedger_SecurityPoolReporterLedger as reporterArtifact,
	statoblast_SecurityPoolPortfolioPurchase_SecurityPoolPortfolioPurchase as purchaseArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	statoblast_SecurityPoolOpenAdmissionPolicy_SecurityPoolOpenAdmissionPolicy as openArtifact,
} from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { capitalSnapshot, owner, portfolio, capital, token, index } from './capitalFixture.js'
export const modules = {
	fees: getAddress('0x0000000000000000000000000000000000000061'),
	engine: getAddress('0x0000000000000000000000000000000000000062'),
	book: getAddress('0x0000000000000000000000000000000000000063'),
	reporters: getAddress('0x0000000000000000000000000000000000000064'),
	purchase: getAddress('0x0000000000000000000000000000000000000065'),
	fork: getAddress('0x0000000000000000000000000000000000000066'),
}
export function capitalClient(initial = capitalSnapshot()) {
	let snapshot = initial
	let setupStage = 3n
	const overrides: Record<string, unknown> = {}
	const reads: { name: string; args: readonly unknown[] | undefined; blockNumber: bigint | undefined }[] = []
	const codes = new Map<Address, Hex>([
		[portfolio, getSecurityPoolPortfolioRuntimeCode()],
		[capital, `0x${capitalArtifact.evm.deployedBytecode.object}`],
		[index, `0x${indexArtifact.evm.deployedBytecode.object}`],
		[modules.fees, `0x${feesArtifact.evm.deployedBytecode.object}`],
		[modules.engine, `0x${engineArtifact.evm.deployedBytecode.object}`],
		[modules.book, `0x${bookArtifact.evm.deployedBytecode.object}`],
		[modules.reporters, `0x${reporterArtifact.evm.deployedBytecode.object}`],
		[modules.purchase, `0x${purchaseArtifact.evm.deployedBytecode.object}`],
		[modules.fork, `0x${forkArtifact.evm.deployedBytecode.object}`],
		[token, `0x${openArtifact.evm.deployedBytecode.object}`],
	])
	const client = createPublicClient({ transport: http('https://example.test') }).extend(() => ({
		getChainId: async () => snapshot.chainId,
		getCode: async ({ address }: { address: Address }) => codes.get(address),
		getBalance: async () => snapshot.walletAttoEth,
		getBlock: async () => ({ ...createBlockWithTimestamp(snapshot.timestamp), number: snapshot.blockNumber, hash: snapshot.blockHash }),
		...createMockReadClient(async request => {
			reads.push({ name: request.functionName, args: request.args, blockNumber: request.blockNumber })
			const infrastructure = getInfraContractAddresses()
			const values: Record<string, unknown> = {
				setupStage,
				originUniverseId: snapshot.originUniverseId,
				universeId: snapshot.universeId,
				capitalLedger: capital,
				zoltar: infrastructure.zoltar,
				factory: infrastructure.securityPoolFactory,
				settlement: modules.engine,
				commitmentIndex: index,
				repToken: token,
				getRepToken: token,
				ledger: modules.book,
				minimumOutcomeExchangeRate: snapshot.economics.minimumOutcomeRate,
				...snapshot.economics,
				acceptedPrice: snapshot.acceptedPrice,
				securityMultiplierBps: snapshot.securityMultiplierBps,
				priceValidUntil: snapshot.priceValidUntil,
				isPriceValid: snapshot.priceValid,
				demandAttoEth: snapshot.demandAttoEth,
				totalFreeAttoRep: snapshot.totalFreeAttoRep,
				frozen: snapshot.frozen,
				importing: snapshot.importing,
				exported: snapshot.exported,
				ownerAccount: snapshot.ownerAccount,
				ownerCollateral: [snapshot.ownerPrincipalAttoRep, snapshot.ownerCommitmentAttoEth, snapshot.withdrawableAttoRep],
				totals: [snapshot.totalPledgedAttoRep, snapshot.totalCommitmentAttoEth, snapshot.healthyCommitmentAttoEth],
				currentBatch: snapshot.currentBatch,
				nextBatch: snapshot.nextBatch,
				getForkTime: snapshot.forkTime,
				getForkChoiceDeadline: snapshot.forkChoiceDeadline,
				questionAdmissionPolicy: token,
				reporters: modules.reporters,
				quoteHelper: modules.purchase,
				forkController: modules.fork,
				feeStreams: modules.fees,
				questionCount: snapshot.questionCount,
				balanceOf: snapshot.walletAttoRep,
				allowance: snapshot.allowanceAttoRep,
				...overrides,
			}
			if (request.functionName === 'portfolio') {
				if (request.address === index || request.address === modules.fees) return capital
				if (request.address === modules.book) return modules.engine
				return portfolio
			}
			if (request.functionName === 'accountOf' || request.functionName === 'positionExecutionReserveAttoEth' || request.functionName === 'liquidationStarted') {
				const position = snapshot.positions.find(position => position.id === request.args?.[0])
				if (position === undefined) throw new Error('Unknown position')
				if (request.functionName === 'accountOf') return [position.owner, position.batch, position.rep, position.commitment, position.maxHealthyPrice, position.releasedRep, position.feesAttoEth, position.feesAttoRep]
				return request.functionName === 'liquidationStarted' ? position.liquidationStarted : position.executionReserveAttoEth
			}
			if (request.functionName === 'getQuestions') {
				const start = request.args?.[0]
				const count = request.args?.[1]
				if (typeof start !== 'bigint' || typeof count !== 'bigint') throw new Error('Missing page bounds')
				const remaining = snapshot.questionCount - start
				return Array.from({ length: Number(remaining < count ? remaining : count) }, (_, i) => start + BigInt(i) + 1n)
			}
			if (!(request.functionName in values)) throw new Error(`Unexpected capital read ${request.functionName}`)
			return values[request.functionName]
		}),
	}))
	const backend = { ...createFakeBackend({ accountAddress: owner }), createReadClient: () => client }
	return {
		client,
		backend,
		reads,
		codes,
		setRead: (name: string, value: unknown) => {
			overrides[name] = value
		},
		setSetupStage: (stage: bigint) => {
			setupStage = stage
		},
		setSnapshot: (next: typeof snapshot) => {
			snapshot = next
		},
		install: () => installActiveEnvironmentForTesting(backend),
	}
}

import { encodeFunctionData, getAddress, isAddress, parseAbi, zeroAddress, type Address, type AbiValue } from '@zoltar/core-shared/evm/ethereum'
import type { PortfolioReadClient } from './securityPoolPortfolioRead.js'
import { loadPortfolioCapitalSnapshot, requiredPortfolioExecutionReserve } from './securityPoolPortfolioCapital.js'

const abi = parseAbi([
	'function recapitalizeUniverse(uint248 universeId) payable',
	'function forkController() view returns (address)',
	'function portfolio() view returns (address)',
	'function zoltar() view returns (address)',
	'function getForkTime(uint248 universeId) view returns (uint256)',
	'function getForkChoiceDeadline(uint248 universeId) view returns (uint256)',
	'function getForkRecapitalizationDeadline(uint248 universeId) view returns (uint256)',
	'function getChildUniverseId(uint248 universeId,uint256 outcome) pure returns (uint248)',
	'function getRepToken(uint248 universeId) view returns (address)',
	'function capitalLedger(uint248 universeId) view returns (address)',
	'function forks(uint248 universeId) view returns (uint256 backing,uint256 commitment,uint256 cash,uint256 units,uint256 price,uint256 assignedCash,uint256 neutralCash,uint256 recoveredUnits,bool frozen,bool recoveryFunded,bool migrationPrepared)',
	'function branches(uint248 child) view returns (uint248 parent,uint256 outcome,uint256 chosenBacking,uint256 chosenCommitment,uint256 parentCash,uint256 protectedCommitment,address auction,bool prepared,bool started,bool ready)',
	'function choices(uint248 source,address owner) view returns (uint256 outcome,bool recorded)',
	'function freeze(uint248 source)',
	'function choose(uint248 source,uint256 outcome)',
	'function startBranch(uint248 source,uint256 outcome) returns (uint248)',
	'function finalizeBranch(uint248 child)',
	'function buyRecapitalization(uint248 child,uint256 maximumRep,uint256 minimumRep,uint256 maximumCommitment,uint256 maximumOwnRep,uint256 targetHealth,uint256 executionReserve) payable returns (uint256 rep,uint256 commitment)',
	'function recoverUnchosenCash(uint248 source,uint256 questionId,uint256 shares) returns (uint256)',
	'function transferPortfolioRecoveryRights(uint248 sourceUniverse,address recipient,uint256[3] amountsAttoShares)',
	'function collectProtectedPrincipal(uint248 child)',
	'function quote(uint256 maximumEth,uint256 maximumRep) view returns (uint256 rep,uint256 commitment,uint256 cost)',
	'function minimumFillAttoEth() view returns (uint256)',
	'function maximumRepSoldAttoRep() view returns (uint256)',
	'function soldAttoRep() view returns (uint256)',
	'function raisedAttoEth() view returns (uint256)',
	'function missingCashAttoEth() view returns (uint256)',
	'function requiredRep(uint256 commitment,uint256 targetHealth) view returns (uint256)',
])
function uint(value: unknown, label: string, bits = 256): bigint {
	if (typeof value !== 'bigint' || value < 0n || value >= 1n << BigInt(bits)) throw new Error(`${label} must fit uint${bits}.`)
	return value
}
function address(value: unknown, allowZero = false): Address {
	if (typeof value !== 'string' || !isAddress(value) || (!allowZero && getAddress(value) === zeroAddress)) throw new Error('Choose a nonzero contract address.')
	return getAddress(value)
}
function fields(value: unknown, names: readonly string[]): unknown[] {
	if (Array.isArray(value) && value.length === names.length) return value
	if (value !== null && typeof value === 'object' && !Array.isArray(value)) return names.map(name => Reflect.get(value, name))
	throw new Error('Invalid portfolio fork response.')
}
function bool(value: unknown): boolean {
	if (typeof value !== 'boolean') throw new Error('Invalid portfolio fork state.')
	return value
}
type ForkRequest = { owner: Address; controller: Address; universeId: bigint }
function request(parameters: ForkRequest, functionName: string, args: readonly AbiValue[] = [], value = 0n) {
	return { account: address(parameters.owner), to: address(parameters.controller), value: uint(value, 'Transaction value'), data: encodeFunctionData({ abi, functionName, args: [uint(parameters.universeId, 'Universe', 248), ...args] }) }
}
/** One irrevocable choice moves the owner's committed principal; idle REP and old fees stay in the source. */
export function buildPortfolioForkChoiceRequest(parameters: ForkRequest & { outcomeIndex: bigint }) {
	return request(parameters, 'choose', [uint(parameters.outcomeIndex, 'Fork outcome')])
}
/** Permissionless shared preparation touches one branch, independently of question count. */
export function buildPortfolioForkStartRequest(parameters: ForkRequest & { outcomeIndex: bigint }) {
	return request(parameters, 'startBranch', [uint(parameters.outcomeIndex, 'Fork outcome')])
}
export function buildPortfolioForkFinalizeRequest(parameters: ForkRequest) {
	return request(parameters, 'finalizeBranch')
}
/** @public Permissionless keeper transaction settling a branch's retired protocol reserve after activation. */
export function buildPortfolioForkCollectProtectedRequest(parameters: ForkRequest) {
	return request(parameters, 'collectProtectedPrincipal')
}
export function buildPortfolioForkRecoveryRequest(parameters: ForkRequest & { questionId: bigint; shares: bigint }) {
	if (uint(parameters.shares, 'Complete sets') === 0n) throw new Error('Recovery shares must be positive.')
	return request(parameters, 'recoverUnchosenCash', [uint(parameters.questionId, 'Question'), parameters.shares])
}
/** Transfer only source cash-recovery rights, in Invalid/Yes/No order, without moving branch shares. */
export function buildPortfolioRecoveryRightsTransferRequest(parameters: { owner: Address; shareToken: Address; universeId: bigint; recipient: Address; amountsAttoShares: readonly [bigint, bigint, bigint] }) {
	const owner = address(parameters.owner)
	const recipient = address(parameters.recipient)
	if (owner === recipient) throw new Error('Recovery recipient must be another account.')
	const amounts = parameters.amountsAttoShares.map(amount => uint(amount, 'Recovery rights'))
	if (amounts.length !== 3 || amounts.every(amount => amount === 0n)) throw new Error('Choose positive recovery rights for at least one of three outcomes.')
	return { account: owner, to: address(parameters.shareToken), value: 0n, data: encodeFunctionData({ abi, functionName: 'transferPortfolioRecoveryRights', args: [uint(parameters.universeId, 'Universe', 248), recipient, amounts] }) }
}
/** Payment is a budget; unused sale cash is refunded. Extra collateral and accepted K are separately capped. */
export function buildPortfolioRecapPurchaseRequest(parameters: ForkRequest & { maximumRep: bigint; minimumRep: bigint; maximumCommitment: bigint; maximumOwnRep: bigint; targetHealthFactorBps: bigint; executionReserveAttoEth: bigint; maximumCostAttoEth: bigint }) {
	const maximum = uint(parameters.maximumRep, 'Maximum REP')
	const minimum = uint(parameters.minimumRep, 'Minimum REP')
	if (maximum === 0n || minimum === 0n || minimum > maximum) throw new Error('REP bounds must be positive and ordered.')
	const health = uint(parameters.targetHealthFactorBps, 'Health target')
	if (health < 10_000n) throw new Error('Health target must be at least 100%.')
	const reserve = uint(parameters.executionReserveAttoEth, 'Execution reserve')
	const cost = uint(parameters.maximumCostAttoEth, 'Purchase budget')
	if (cost === 0n) throw new Error('Purchase budget must be positive.')
	return request(parameters, 'buyRecapitalization', [maximum, minimum, uint(parameters.maximumCommitment, 'Maximum commitment'), uint(parameters.maximumOwnRep, 'Maximum own REP'), health, reserve], uint(cost + reserve, 'Total payment'))
}

/** Donate cash to existing claims without receiving shares, REP or a repayment right. */
export function buildPortfolioVoluntaryRepairRequest(parameters: { owner: Address; portfolio: Address; universeId: bigint; amountAttoEth: bigint }) {
	const amount = uint(parameters.amountAttoEth, 'Repair donation')
	if (amount === 0n) throw new Error('Repair donation must be positive.')
	return { account: address(parameters.owner), to: address(parameters.portfolio), value: amount, data: encodeFunctionData({ abi, functionName: 'recapitalizeUniverse', args: [uint(parameters.universeId, 'Universe', 248)] }) }
}

export type PortfolioForkSnapshot = Awaited<ReturnType<typeof loadPortfolioForkSnapshot>>
/** Bounded reads at one block; no owner, question, bid or ancestor enumeration. */
export async function loadPortfolioForkSnapshot(parameters: { client: PortfolioReadClient; portfolio: Address; owner: Address; universeId: bigint; outcomeIndex?: bigint }) {
	const { client } = parameters
	const portfolio = address(parameters.portfolio)
	const owner = address(parameters.owner)
	const universeId = uint(parameters.universeId, 'Universe', 248)
	const [block, chainId] = await Promise.all([client.getBlock(), client.getChainId()])
	if (block.number === undefined || block.hash === undefined) throw new Error('Fork snapshot requires a mined block.')
	const blockNumber = block.number
	const blockHash = block.hash
	const read = (target: Address, functionName: string, args: readonly AbiValue[] = []) => client.readContract({ address: target, abi, functionName, args, blockNumber })
	const [controllerValue, zoltarValue] = await Promise.all([read(portfolio, 'forkController'), read(portfolio, 'zoltar')])
	const controller = address(controllerValue)
	const zoltar = address(zoltarValue)
	const [authority, protocol, forkTimeValue, choiceDeadlineValue, recapDeadlineValue, forkValue, choiceValue] = await Promise.all([
		read(controller, 'portfolio'),
		read(controller, 'zoltar'),
		read(zoltar, 'getForkTime', [universeId]),
		read(zoltar, 'getForkChoiceDeadline', [universeId]),
		read(zoltar, 'getForkRecapitalizationDeadline', [universeId]),
		read(controller, 'forks', [universeId]),
		read(controller, 'choices', [universeId, owner]),
	])
	if (address(authority) !== portfolio || address(protocol) !== zoltar) throw new Error('Fork controller belongs to a different portfolio.')
	const f = fields(forkValue, ['backing', 'commitment', 'cash', 'units', 'price', 'assignedCash', 'neutralCash', 'recoveredUnits', 'frozen', 'recoveryFunded', 'migrationPrepared'])
	const c = fields(choiceValue, ['outcome', 'recorded'])
	const fork = {
		backing: uint(f[0], 'Fork backing'),
		commitment: uint(f[1], 'Fork commitment'),
		cash: uint(f[2], 'Fork cash'),
		units: uint(f[3], 'Fork units'),
		price: uint(f[4], 'Fork price'),
		assignedCash: uint(f[5], 'Assigned cash'),
		neutralCash: uint(f[6], 'Neutral cash'),
		recoveredUnits: uint(f[7], 'Recovered units'),
		frozen: bool(f[8]),
		recoveryFunded: bool(f[9]),
		migrationPrepared: bool(f[10]),
	}
	if (fork.assignedCash > fork.cash || fork.recoveredUnits > fork.units) throw new Error('Invalid fork accounting.')
	const choice = { outcomeIndex: uint(c[0], 'Chosen outcome'), recorded: bool(c[1]) }
	const chosenOutcome = choice.recorded ? choice.outcomeIndex : undefined
	const outcomeIndex = parameters.outcomeIndex === undefined ? chosenOutcome : uint(parameters.outcomeIndex, 'Fork outcome')
	let branch: { universeId: bigint; parent: bigint; outcomeIndex: bigint; chosenBacking: bigint; chosenCommitment: bigint; parentCash: bigint; protectedCommitment: bigint; auction: Address; prepared: boolean; started: boolean; ready: boolean; repToken: Address; capitalLedger: Address } | undefined
	if (outcomeIndex !== undefined) {
		const child = uint(await read(zoltar, 'getChildUniverseId', [universeId, outcomeIndex]), 'Child universe', 248)
		const b = fields(await read(controller, 'branches', [child]), ['parent', 'outcome', 'chosenBacking', 'chosenCommitment', 'parentCash', 'protectedCommitment', 'auction', 'prepared', 'started', 'ready'])
		const prepared = bool(b[7])
		const parent = uint(b[0], 'Parent universe', 248)
		const branchOutcome = uint(b[1], 'Branch outcome')
		if (prepared && (parent !== universeId || branchOutcome !== outcomeIndex)) throw new Error('Selected branch belongs to a different fork.')
		const [token, capital] = prepared ? await Promise.all([read(zoltar, 'getRepToken', [child]), read(portfolio, 'capitalLedger', [child])]) : [zeroAddress, zeroAddress]
		branch = {
			universeId: child,
			parent,
			outcomeIndex,
			chosenBacking: uint(b[2], 'Chosen backing'),
			chosenCommitment: uint(b[3], 'Chosen commitment'),
			parentCash: uint(b[4], 'Child cash'),
			protectedCommitment: uint(b[5], 'Protected commitment'),
			auction: address(b[6], true),
			prepared,
			started: bool(b[8]),
			ready: bool(b[9]),
			repToken: address(token, true),
			capitalLedger: address(capital, !prepared),
		}
	}
	const forkTime = uint(forkTimeValue, 'Fork time')
	const choiceDeadline = uint(choiceDeadlineValue, 'Choice deadline')
	const recapitalizationDeadline = uint(recapDeadlineValue, 'Recap deadline')
	if (forkTime !== 0n && (choiceDeadline <= forkTime || recapitalizationDeadline <= choiceDeadline)) throw new Error('Invalid native fork deadlines.')
	const [finalBlock, finalChain] = await Promise.all([client.getBlock({ blockNumber }), client.getChainId()])
	if (finalChain !== chainId || finalBlock.hash !== blockHash) throw new Error('Fork snapshot changed. Refresh and retry.')
	return { chainId, blockNumber, blockHash, timestamp: block.timestamp, portfolio, owner, controller, zoltar, universeId, forkTime, choiceDeadline, recapitalizationDeadline, fork, choice, branch }
}

export type PortfolioRecapQuote = Awaited<ReturnType<typeof loadPortfolioRecapQuote>>
export async function loadPortfolioRecapQuote(parameters: { client: PortfolioReadClient; snapshot: PortfolioForkSnapshot; maximumCostAttoEth: bigint; maximumRep: bigint; targetHealthFactorBps: bigint }) {
	const { client, snapshot } = parameters
	const branch = snapshot.branch
	if (branch === undefined || !branch.started || branch.ready || branch.auction === zeroAddress) throw new Error('Recap sale unavailable.')
	const costLimit = uint(parameters.maximumCostAttoEth, 'Purchase budget')
	const repLimit = uint(parameters.maximumRep, 'Maximum REP')
	const target = uint(parameters.targetHealthFactorBps, 'Health target')
	if (target < 10_000n) throw new Error('Health target must be at least 100%.')
	const read = (address: Address, functionName: string, args: readonly AbiValue[] = []) => client.readContract({ address, abi, functionName, args, blockNumber: snapshot.blockNumber })
	const [quoteValue, capital, minimumFillValue, maximumSoldValue, soldValue, raisedValue, missingCashValue] = await Promise.all([
		read(branch.auction, 'quote', [costLimit, repLimit]),
		loadPortfolioCapitalSnapshot({ client, portfolio: snapshot.portfolio, owner: snapshot.owner, universeId: branch.universeId, blockNumber: snapshot.blockNumber }),
		read(branch.auction, 'minimumFillAttoEth'),
		read(branch.auction, 'maximumRepSoldAttoRep'),
		read(branch.auction, 'soldAttoRep'),
		read(branch.auction, 'raisedAttoEth'),
		read(branch.auction, 'missingCashAttoEth'),
	])
	const q = fields(quoteValue, ['rep', 'commitment', 'cost'])
	const rep = uint(q[0], 'Quoted REP')
	const commitment = uint(q[1], 'Quoted commitment')
	const cost = uint(q[2], 'Quoted cost')
	if (rep > repLimit || cost > costLimit) throw new Error('Recap quote exceeds purchase limits.')
	const position = capital.positions.find(position => position.commitment > 0n)
	const totalCommitment = capital.ownerCommitmentAttoEth + commitment
	const requiredRep = commitment === 0n ? 0n : uint(await read(branch.capitalLedger, 'requiredRep', [totalCommitment, target]), 'Required owner collateral')
	const availableRep = capital.ownerPrincipalAttoRep + rep
	const ownRep = requiredRep > availableRep ? requiredRep - availableRep : 0n
	const requiredReserve = commitment === 0n ? 0n : requiredPortfolioExecutionReserve({ commitment: totalCommitment, ...capital.economics })
	const existingReserve = capital.ownerAccount.executionReserveAttoEth + (position?.executionReserveAttoEth ?? 0n)
	const executionReserve = requiredReserve > existingReserve ? requiredReserve - existingReserve : 0n
	let reason: string | undefined
	if (rep === 0n) reason = 'No REP is available within this budget.'
	else if (cost < uint(minimumFillValue, 'Minimum fill') && uint(soldValue, 'Sold REP') + rep !== uint(maximumSoldValue, 'Maximum sale REP') && uint(raisedValue, 'Raised cash') + cost !== uint(missingCashValue, 'Required cash')) reason = 'Purchase is below this recap sale’s minimum fill.'
	else if (commitment > 0n && position !== undefined && position.batch !== 0n) reason = 'Retiring principal cannot accept a recap commitment.'
	else if (commitment > 0n && totalCommitment < capital.economics.minimumCommitmentAttoEth) reason = 'Accepted commitment is below this pool’s minimum.'
	const [finalBlock, finalChain] = await Promise.all([client.getBlock({ blockNumber: snapshot.blockNumber }), client.getChainId()])
	if (finalBlock.hash !== snapshot.blockHash || finalChain !== snapshot.chainId) throw new Error('Fork snapshot changed. Refresh and retry.')
	return { rep, commitment, cost, ownRep, executionReserve, capital, reason }
}

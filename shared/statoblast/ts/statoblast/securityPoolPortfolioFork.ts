import { encodeFunctionData, getAddress, isAddress, parseAbi, zeroAddress, type Address, type AbiValue } from '@zoltar/core-shared/evm/ethereum'
import type { PortfolioReadClient } from './securityPoolPortfolioRead.js'

const abi = parseAbi([
	'function forkController() view returns (address)',
	'function portfolio() view returns (address)',
	'function zoltar() view returns (address)',
	'function getForkTime(uint248 universeId) view returns (uint256)',
	'function getForkChoiceDeadline(uint248 universeId) view returns (uint256)',
	'function getForkRecapitalizationDeadline(uint248 universeId) view returns (uint256)',
	'function getChildUniverseId(uint248 universeId,uint256 outcome) pure returns (uint248)',
	'function getRepToken(uint248 universeId) view returns (address)',
	'function capitalLedger(uint248 universeId) view returns (address)',
	'function forks(uint248 universeId) view returns (uint256 backing,uint256 commitment,uint256 cash,uint256 units,uint256 recoveryAttoRep,uint256 assignedCash,uint256 neutralCash,uint256 recoveredUnits,bool frozen,bool recoveryFunded,bool migrationPrepared)',
	'function branches(uint248 child) view returns (uint248 parent,uint256 outcome,uint256 chosenBacking,uint256 chosenCommitment,uint256 parentCash,uint256 recoveryAttoRep,bool prepared,bool started,bool ready)',
	'function choices(uint248 source,address owner) view returns (uint256 outcome,bool recorded)',
	'function freeze(uint248 source)',
	'function choose(uint248 source,uint256 outcome)',
	'function startBranch(uint248 source,uint256 outcome) returns (uint248)',
	'function finalizeBranch(uint248 child)',
	'function recoverUnchosenCash(uint248 source,uint256 questionId,uint256 shares) returns (uint256)',
	'function transferPortfolioRecoveryRights(uint248 sourceUniverse,address recipient,uint256[3] amountsAttoShares)',
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
	const [authority, protocol, forkTimeValue, choiceDeadlineValue, activationDeadlineValue, forkValue, choiceValue] = await Promise.all([
		read(controller, 'portfolio'),
		read(controller, 'zoltar'),
		read(zoltar, 'getForkTime', [universeId]),
		read(zoltar, 'getForkChoiceDeadline', [universeId]),
		read(zoltar, 'getForkRecapitalizationDeadline', [universeId]),
		read(controller, 'forks', [universeId]),
		read(controller, 'choices', [universeId, owner]),
	])
	if (address(authority) !== portfolio || address(protocol) !== zoltar) throw new Error('Fork controller belongs to a different portfolio.')
	const f = fields(forkValue, ['backing', 'commitment', 'cash', 'units', 'recoveryAttoRep', 'assignedCash', 'neutralCash', 'recoveredUnits', 'frozen', 'recoveryFunded', 'migrationPrepared'])
	const c = fields(choiceValue, ['outcome', 'recorded'])
	const fork = {
		backing: uint(f[0], 'Fork backing'),
		commitment: uint(f[1], 'Fork commitment'),
		cash: uint(f[2], 'Fork cash'),
		units: uint(f[3], 'Fork units'),
		recoveryAttoRep: uint(f[4], 'Fork recovery REP'),
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
	let branch: { universeId: bigint; parent: bigint; outcomeIndex: bigint; chosenBacking: bigint; chosenCommitment: bigint; parentCash: bigint; recoveryAttoRep: bigint; prepared: boolean; started: boolean; ready: boolean; repToken: Address; capitalLedger: Address } | undefined
	if (outcomeIndex !== undefined) {
		const child = uint(await read(zoltar, 'getChildUniverseId', [universeId, outcomeIndex]), 'Child universe', 248)
		const b = fields(await read(controller, 'branches', [child]), ['parent', 'outcome', 'chosenBacking', 'chosenCommitment', 'parentCash', 'recoveryAttoRep', 'prepared', 'started', 'ready'])
		const prepared = bool(b[6])
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
			recoveryAttoRep: uint(b[5], 'Claim recovery REP'),
			prepared,
			started: bool(b[7]),
			ready: bool(b[8]),
			repToken: address(token, true),
			capitalLedger: address(capital, !prepared),
		}
	}
	const forkTime = uint(forkTimeValue, 'Fork time')
	const choiceDeadline = uint(choiceDeadlineValue, 'Choice deadline')
	const activationDeadline = uint(activationDeadlineValue, 'Activation deadline')
	if (forkTime !== 0n && (choiceDeadline <= forkTime || activationDeadline <= choiceDeadline)) throw new Error('Invalid native fork deadlines.')
	const [finalBlock, finalChain] = await Promise.all([client.getBlock({ blockNumber }), client.getChainId()])
	if (finalChain !== chainId || finalBlock.hash !== blockHash) throw new Error('Fork snapshot changed. Refresh and retry.')
	return { chainId, blockNumber, blockHash, timestamp: block.timestamp, portfolio, owner, controller, zoltar, universeId, forkTime, choiceDeadline, activationDeadline, fork, choice, branch }
}

import { encodeFunctionData, parseAbi, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import type { PortfolioForkSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { requireAddressValue, requireBigintValue, requireBigintArray, requireBooleanValue } from './decoders.js'
import { loadPortfolioForkOutcome } from './securityPoolPortfolioFork.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'

const abi = parseAbi([
	'function factory() view returns (address)',
	'function questionOriginIds(uint256 questionId) view returns (bytes32)',
	'function getSecurityPool(bytes32 originId,uint248 universeId) view returns (address)',
	'function originUniverseId() view returns (uint248)',
	'function getPool(uint256 questionId,uint248 universeId) view returns (address)',
	'function sourceGame(uint248 universeId,uint256 questionId) view returns (address)',
	'function securityPool() view returns (address)',
	'function shareToken() view returns (address)',
	'function balanceOfPortfolioRecoveryRights(uint248 universeId,address owner) view returns (uint256[3])',
	'function isPortfolioRecoveryEligible(uint248 universeId) view returns (bool)',
	'function preparePortfolioQuestion(address source,uint248 targetUniverse) returns (address)',
])
export async function loadSharedForkOutcome(client: ReadClient, snapshot: PortfolioForkSnapshot, outcomeIndex: bigint) {
	const result = await loadPortfolioForkOutcome(client, { zoltar: snapshot.zoltar, universeId: snapshot.universeId, outcomeIndex, blockNumber: snapshot.blockNumber })
	if ((await client.getBlock({ blockNumber: snapshot.blockNumber })).hash !== snapshot.blockHash) throw new Error('Fork snapshot changed. Refresh and retry.')
	return result
}
export async function loadPortfolioSourceRecovery(client: ReadClient, snapshot: Pick<PortfolioForkSnapshot, 'portfolio' | 'owner' | 'universeId' | 'blockNumber' | 'blockHash'>, questionId: bigint) {
	const blockNumber = snapshot.blockNumber
	const [factoryValue, originId, originValue, gameValue] = await Promise.all([
		client.readContract({ address: snapshot.portfolio, abi, functionName: 'factory', blockNumber }),
		client.readContract({ address: snapshot.portfolio, abi, functionName: 'questionOriginIds', args: [questionId], blockNumber }),
		client.readContract({ address: snapshot.portfolio, abi, functionName: 'originUniverseId', blockNumber }),
		client.readContract({ address: snapshot.portfolio, abi, functionName: 'sourceGame', args: [snapshot.universeId, questionId], blockNumber }),
	])
	const factory = requireAddressValue(factoryValue, 'portfolio factory')
	if (typeof originId !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(originId) || BigInt(originId) === 0n) throw new Error('Question is not registered in this portfolio.')
	const pool = requireAddressValue(await client.readContract({ address: factory, abi, functionName: 'getSecurityPool', args: [originId, snapshot.universeId], blockNumber }), 'source pool')
	const origin = requireBigintValue(originValue, 'origin universe')
	const game = requireAddressValue(gameValue, 'source game')
	const sourceValue = game === zeroAddress ? await client.readContract({ address: snapshot.portfolio, abi, functionName: 'getPool', args: [questionId, origin], blockNumber }) : await client.readContract({ address: game, abi, functionName: 'securityPool', blockNumber })
	const source = requireAddressValue(sourceValue, 'reporter source pool')
	if (source === zeroAddress) throw new Error('Question is not registered in this portfolio.')
	const shareTokenValue = await client.readContract({ address: source, abi, functionName: 'shareToken', blockNumber })
	const shareToken = requireAddressValue(shareTokenValue, 'source shares')
	const [rightsValue, eligibleValue] = await Promise.all([
		client.readContract({ address: shareToken, abi, functionName: 'balanceOfPortfolioRecoveryRights', args: [snapshot.universeId, snapshot.owner], blockNumber }),
		client.readContract({ address: shareToken, abi, functionName: 'isPortfolioRecoveryEligible', args: [snapshot.universeId], blockNumber }),
	])
	const eligible = requireBooleanValue(eligibleValue, 'source recovery eligibility')
	const rights = requireBigintArray(rightsValue, 'source recovery rights')
	if (rights.length !== 3 || rights.some(value => value < 0n || value >= 1n << 256n)) throw new Error('Invalid source recovery rights.')
	const availableShares = rights.reduce((minimum, value) => (value < minimum ? value : minimum), rights[0] ?? 0n)
	if ((await client.getBlock({ blockNumber })).hash !== snapshot.blockHash) throw new Error('Fork snapshot changed. Refresh and retry.')
	return { pool, source, shareToken, eligible, rights, availableShares }
}
export function buildPortfolioRecoveryPreparation(snapshot: PortfolioForkSnapshot, source: Awaited<ReturnType<typeof loadPortfolioSourceRecovery>>) {
	return { account: snapshot.owner, to: getInfraContractAddresses().securityPoolForker, value: 0n, data: encodeFunctionData({ abi, functionName: 'preparePortfolioQuestion', args: [source.source, snapshot.universeId] }) }
}

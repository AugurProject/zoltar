import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as ts from 'typescript'
import * as contractAbis from '../../src/contracts/abi.ts'
import { CANONICAL_MUTATING_CONTRACT_MANIFEST, MUTATING_CONTRACT_SURFACE, classifiedMethod, type ContractAbiEntryKind } from '../../src/contracts/surface.ts'
import { CHAOS_OPERATION_CATALOG } from '../../src/operations/catalog.ts'

const {
	auctionAbi,
	coordinatorAbi,
	erc1155Abi,
	erc20Abi,
	escalationGameAbi,
	genesisUniswapSeederAbi,
	liquidationApprovalRegistryAbi,
	openOracleAbi,
	questionDataAbi,
	securityPoolAbi,
	securityPoolFactoryAbi,
	securityPoolForkerAbi,
	shareTokenAbi,
	tradingFactoryAbi,
	tradingPairAbi,
	tradingRouterAbi,
	uniswapV3FactoryAbi,
	uniswapV3PoolAbi,
	wethAbi,
	zoltarAbi,
} = contractAbis

const curatedAbiBindings = [
	{ abi: questionDataAbi, artifactSource: 'contracts/ZoltarQuestionData.sol', contract: 'ZoltarQuestionData' },
	{ abi: zoltarAbi, artifactSource: 'contracts/Zoltar.sol', contract: 'Zoltar' },
	{ abi: erc20Abi, artifactSource: 'contracts/GenesisReputationToken.sol', contract: 'GenesisReputationToken' },
	{ abi: securityPoolFactoryAbi, artifactSource: 'contracts/statoblast/factories/SecurityPoolFactory.sol', contract: 'SecurityPoolFactory' },
	{ abi: securityPoolAbi, artifactSource: 'contracts/statoblast/SecurityPool.sol', contract: 'SecurityPool' },
	{ abi: coordinatorAbi, artifactSource: 'contracts/statoblast/OpenOraclePriceCoordinator.sol', contract: 'OpenOraclePriceCoordinator' },
	{ abi: liquidationApprovalRegistryAbi, artifactSource: 'contracts/statoblast/LiquidationApprovalRegistry.sol', contract: 'LiquidationApprovalRegistry' },
	{ abi: securityPoolForkerAbi, artifactSource: 'contracts/statoblast/SecurityPoolForker.sol', contract: 'SecurityPoolForker' },
	{ abi: auctionAbi, artifactSource: 'contracts/statoblast/UniformPriceDualCapBatchAuction.sol', contract: 'UniformPriceDualCapBatchAuction' },
	{
		abi: escalationGameAbi,
		artifactSource: 'contracts/statoblast/EscalationGame.sol',
		contract: 'EscalationGame',
		delegatedViews: [
			{
				artifactSource: 'contracts/statoblast/EscalationGameClaimDelegate.sol',
				contract: 'EscalationGameClaimDelegate',
				functions: ['applyInheritedClaimRetention', 'applyInheritedSourceStorageBasis'],
			},
		],
	},
	{ abi: openOracleAbi, artifactSource: 'contracts/statoblast/openOracle/OpenOracle.sol', contract: 'OpenOracle' },
	{ abi: wethAbi, artifactSource: 'contracts/statoblast/WETH9.sol', contract: 'WETH9' },
	{ abi: shareTokenAbi, artifactSource: 'contracts/statoblast/tokens/ShareToken.sol', contract: 'ShareToken' },
	{ abi: erc1155Abi, artifactSource: 'contracts/statoblast/tokens/ShareToken.sol', contract: 'ShareToken' },
	{ abi: tradingFactoryAbi, artifactSource: 'contracts/trading/TwoWayConstantProductFactory.sol', contract: 'TwoWayConstantProductFactory' },
	{ abi: tradingPairAbi, artifactSource: 'contracts/trading/TwoWayConstantProductPair.sol', contract: 'TwoWayConstantProductPair' },
	{ abi: tradingRouterAbi, artifactSource: 'contracts/trading/TwoWayConstantProductRouter.sol', contract: 'TwoWayConstantProductRouter' },
	{ abi: uniswapV3FactoryAbi, artifactSource: 'contracts/chaos/GenesisUniswapV3Seeder.sol', catalogSurface: false, contract: 'IGenesisUniswapV3Factory' },
	{ abi: uniswapV3PoolAbi, artifactSource: 'contracts/chaos/GenesisUniswapV3Seeder.sol', catalogSurface: false, contract: 'IGenesisUniswapV3PoolState' },
	{ abi: genesisUniswapSeederAbi, artifactSource: 'contracts/chaos/GenesisUniswapV3Seeder.sol', catalogSurface: false, contract: 'GenesisUniswapV3Seeder' },
] as const

const expectedCanonicalManifest = [
	'ZoltarQuestionData:contracts/ZoltarQuestionData.sol:static-endpoint',
	'Zoltar:contracts/Zoltar.sol:static-endpoint',
	'GenesisReputationToken:contracts/GenesisReputationToken.sol:static-endpoint',
	'ReputationToken:contracts/ReputationToken.sol:dynamic-endpoint',
	'SecurityPoolFactory:contracts/statoblast/factories/SecurityPoolFactory.sol:static-endpoint',
	'SecurityPoolDeployer:contracts/statoblast/factories/SecurityPoolDeployer.sol:deployment-helper',
	'SecurityPoolDeploymentWorker:contracts/statoblast/factories/SecurityPoolDeployer.sol:deployment-helper',
	'SecurityPool:contracts/statoblast/SecurityPool.sol:dynamic-endpoint',
	'SecurityPoolOperationsDelegate:contracts/statoblast/SecurityPoolOperationsDelegate.sol:delegate-module',
	'SecurityPoolEventEmitter:contracts/statoblast/SecurityPoolEventEmitter.sol:delegate-module',
	'OpenOraclePriceCoordinator:contracts/statoblast/OpenOraclePriceCoordinator.sol:dynamic-endpoint',
	'LiquidationApprovalRegistry:contracts/statoblast/LiquidationApprovalRegistry.sol:dynamic-endpoint',
	'PriceOracleManagerAndOperatorQueuerFactory:contracts/statoblast/factories/PriceOracleManagerAndOperatorQueuerFactory.sol:static-endpoint',
	'LiquidationApprovalRegistryDeployer:contracts/statoblast/factories/PriceOracleManagerAndOperatorQueuerFactory.sol:deployment-helper',
	'PriceCoordinatorDeploymentWorker:contracts/statoblast/factories/PriceOracleManagerAndOperatorQueuerFactory.sol:deployment-helper',
	'SecurityPoolForker:contracts/statoblast/SecurityPoolForker.sol:static-endpoint',
	'SecurityPoolForkerVaultMigrationDelegate:contracts/statoblast/SecurityPoolForkerVaultMigrationDelegate.sol:delegate-module',
	'EscalationGameForker:contracts/statoblast/EscalationGameForker.sol:delegate-module',
	'SecurityPoolMigrationProxy:contracts/statoblast/SecurityPoolMigrationProxy.sol:migration-proxy',
	'EscalationGameFactory:contracts/statoblast/factories/EscalationGameFactory.sol:static-endpoint',
	'EscalationGame:contracts/statoblast/EscalationGame.sol:dynamic-endpoint',
	'EscalationGameClaimDelegate:contracts/statoblast/EscalationGameClaimDelegate.sol:fallback-module',
	'EscalationGameDepositDelegate:contracts/statoblast/EscalationGameDepositDelegate.sol:delegate-module',
	'ShareTokenFactory:contracts/statoblast/factories/ShareTokenFactory.sol:static-endpoint',
	'ShareToken:contracts/statoblast/tokens/ShareToken.sol:dynamic-endpoint',
	'UniformPriceDualCapBatchAuctionFactory:contracts/statoblast/factories/UniformPriceDualCapBatchAuctionFactory.sol:static-endpoint',
	'UniformPriceDualCapBatchAuction:contracts/statoblast/UniformPriceDualCapBatchAuction.sol:dynamic-endpoint',
	'OpenOracle:contracts/statoblast/openOracle/OpenOracle.sol:static-endpoint',
	'WETH9:contracts/statoblast/WETH9.sol:static-endpoint',
	'TwoWayConstantProductFactory:contracts/trading/TwoWayConstantProductFactory.sol:static-endpoint',
	'TwoWayConstantProductPair:contracts/trading/TwoWayConstantProductPair.sol:dynamic-endpoint',
	'TwoWayConstantProductRouter:contracts/trading/TwoWayConstantProductRouter.sol:static-endpoint',
] as const

const artifactPath = path.resolve(import.meta.dir, '../../../../solidity/artifacts/Contracts.json')

function record(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} is not an object`)
	return Object.fromEntries(Object.entries(value))
}

function artifactParameterType(value: unknown, label: string): string {
	const parameter = record(value, label)
	const type = parameter['type']
	if (typeof type !== 'string') throw new Error(`${label}.type is missing`)
	if (!type.startsWith('tuple')) return type
	const components = parameter['components']
	if (!Array.isArray(components)) throw new Error(`${label}.components is missing`)
	return `(${components.map((component, index) => artifactParameterType(component, `${label}.components[${index.toString()}]`)).join(',')})${type.slice('tuple'.length)}`
}

function artifactFunctionSignature(value: unknown, label: string) {
	const item = record(value, label)
	if (typeof item['name'] !== 'string' || !Array.isArray(item['inputs'])) throw new Error(`${label} is missing its function identity`)
	const inputTypes = item['inputs'].map((input, index) => artifactParameterType(input, `${label}.inputs[${index.toString()}]`))
	return `${item['name']}(${inputTypes.join(',')})`
}

function abiParameterShape(value: unknown, label: string, eventInput = false): Record<string, unknown> {
	const parameter = record(value, label)
	const name = parameter['name']
	const type = parameter['type']
	if (typeof name !== 'string' || typeof type !== 'string') throw new Error(`${label} is missing its ABI parameter shape`)
	const shape: Record<string, unknown> = { name, type }
	if (eventInput) {
		const indexed = parameter['indexed']
		if (typeof indexed !== 'boolean') throw new Error(`${label}.indexed is missing`)
		shape['indexed'] = indexed
	}
	if (type.startsWith('tuple')) {
		const components = parameter['components']
		if (!Array.isArray(components)) throw new Error(`${label}.components is missing`)
		shape['components'] = components.map((component, index) => abiParameterShape(component, `${label}.components[${index.toString()}]`))
	}
	return shape
}

function curatedAbiEntryShape(value: unknown, label: string): Record<string, unknown> {
	const item = record(value, label)
	const type = item['type']
	const name = item['name']
	const inputs = item['inputs']
	if ((type !== 'function' && type !== 'event') || typeof name !== 'string' || !Array.isArray(inputs)) throw new Error(`${label} is not a curated function or event`)
	if (type === 'event') {
		const anonymous = item['anonymous']
		if (typeof anonymous !== 'boolean') throw new Error(`${label}.anonymous is missing`)
		return { anonymous, inputs: inputs.map((input, index) => abiParameterShape(input, `${label}.inputs[${index.toString()}]`, true)), name, type }
	}
	const outputs = item['outputs']
	const stateMutability = item['stateMutability']
	if (!Array.isArray(outputs) || typeof stateMutability !== 'string') throw new Error(`${label} is missing its function shape`)
	return {
		inputs: inputs.map((input, index) => abiParameterShape(input, `${label}.inputs[${index.toString()}]`)),
		name,
		outputs: outputs.map((output, index) => abiParameterShape(output, `${label}.outputs[${index.toString()}]`)),
		stateMutability,
		type,
	}
}

function abiEntryIdentity(value: unknown, label: string): string {
	const item = record(value, label)
	const type = item['type']
	const name = item['name']
	const inputs = item['inputs']
	if ((type !== 'function' && type !== 'event') || typeof name !== 'string' || !Array.isArray(inputs)) throw new Error(`${label} is missing its ABI identity`)
	const inputTypes = inputs.map((input, index) => artifactParameterType(input, `${label}.inputs[${index.toString()}]`))
	return `${type}:${name}(${inputTypes.join(',')})`
}

function loadArtifactContracts() {
	const document = record(JSON.parse(readFileSync(artifactPath, 'utf8')), 'artifact document')
	return record(document['contracts'], 'artifact contracts')
}

function contractArtifact(contracts: Record<string, unknown>, artifactSource: string, contract: string) {
	const source = record(contracts[artifactSource], artifactSource)
	return record(source[contract], `${artifactSource}.${contract}`)
}

function contractAbi(contracts: Record<string, unknown>, artifactSource: string, contract: string) {
	const abi = contractArtifact(contracts, artifactSource, contract)['abi']
	if (!Array.isArray(abi)) throw new Error(`${contract} artifact ABI is missing`)
	return abi
}

function mutatingFunctions(abi: readonly unknown[]) {
	return abi.filter(item => typeof item === 'object' && item !== null && 'type' in item && 'name' in item && 'stateMutability' in item && item.type === 'function' && typeof item.name === 'string' && item.stateMutability !== 'view' && item.stateMutability !== 'pure')
}

function mutatingAbiEntries(abi: readonly unknown[]) {
	return abi.filter(item => {
		if (typeof item !== 'object' || item === null || !('type' in item)) return false
		if (item.type === 'fallback' || item.type === 'receive') return true
		return 'name' in item && 'stateMutability' in item && item.type === 'function' && typeof item.name === 'string' && item.stateMutability !== 'view' && item.stateMutability !== 'pure'
	})
}

function artifactAbiEntryIdentity(value: unknown, label: string): { abiEntryKind: ContractAbiEntryKind; method: string } {
	const item = record(value, label)
	const type = item['type']
	if (type === 'fallback' || type === 'receive') return { abiEntryKind: type, method: type }
	if (type !== 'function' || typeof item['name'] !== 'string') throw new Error(`${label} is missing its ABI entry identity`)
	return { abiEntryKind: 'function', method: item['name'] }
}

function operationStepSelectors(sourcePath: string) {
	const source = ts.createSourceFile(sourcePath, readFileSync(sourcePath, 'utf8'), ts.ScriptTarget.Latest, true)
	const selectors = new Set<string>()
	const visit = (node: ts.Node) => {
		if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'encodeStep') {
			const options = node.arguments[0]
			if (options !== undefined && ts.isObjectLiteralExpression(options)) {
				const property = options.properties.find(candidate => ts.isPropertyAssignment(candidate) && candidate.name.getText(source) === 'functionName')
				if (property !== undefined && ts.isPropertyAssignment(property) && ts.isStringLiteral(property.initializer)) selectors.add(property.initializer.text)
			}
		}
		ts.forEachChild(node, visit)
	}
	visit(source)
	return selectors
}

function solidityFunctionBody(source: string, method: string) {
	const escapedMethod = method.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const match = new RegExp(`\\bfunction\\s+${escapedMethod}\\s*\\(`).exec(source)
	if (match === null) throw new Error(`Solidity function ${method} is missing`)
	const openingBrace = source.indexOf('{', match.index)
	const declarationEnd = source.indexOf(';', match.index)
	if (openingBrace < 0 || (declarationEnd >= 0 && declarationEnd < openingBrace)) throw new Error(`Solidity function ${method} has no implementation body`)
	let depth = 0
	for (let index = openingBrace; index < source.length; index += 1) {
		const character = source[index]
		if (character === '{') depth += 1
		if (character !== '}') continue
		depth -= 1
		if (depth === 0) return source.slice(openingBrace + 1, index)
	}
	throw new Error(`Solidity function ${method} has an unterminated implementation body`)
}

describe('contract operation classification', () => {
	test('declares the cumulative REP migration events and own-fork target getter exactly', () => {
		expect(zoltarAbi.find(item => item.type === 'event' && item.name === 'MigrationRepSplit')).toMatchObject({
			inputs: [
				{ indexed: true, name: 'migrator', type: 'address' },
				{ indexed: false, name: 'recipient', type: 'address' },
				{ indexed: true, name: 'universeId', type: 'uint248' },
				{ indexed: false, name: 'outcomeIndex', type: 'uint256' },
				{ indexed: true, name: 'childUniverseId', type: 'uint248' },
				{ indexed: false, name: 'amountAttoRep', type: 'uint256' },
				{ indexed: false, name: 'childMigrationRepAmountAttoRep', type: 'uint256' },
			],
		})
		expect(securityPoolForkerAbi.find(item => item.type === 'event' && item.name === 'ChildRepSplit')).toMatchObject({
			inputs: [
				{ indexed: true, name: 'parent', type: 'address' },
				{ indexed: true, name: 'outcomeIndex', type: 'uint256' },
				{ indexed: false, name: 'childPoolRepSplitAttoRep', type: 'uint256' },
				{ indexed: false, name: 'pendingChildAttoRep', type: 'uint256' },
			],
		})
		expect(securityPoolForkerAbi.find(item => item.type === 'function' && item.name === 'getOwnForkMigrationStatus')).toMatchObject({
			outputs: [
				{ name: 'ownFork', type: 'bool' },
				{ name: 'auctionableAttoRepAtFork', type: 'uint256' },
				{ name: 'vaultRepAtForkAttoRep', type: 'uint256' },
				{ name: 'escalationChildRepPerSelectedOutcomeAttoRep', type: 'uint256' },
				{ name: 'escrowSourceRepAtForkAttoRep', type: 'uint256' },
			],
			stateMutability: 'view',
		})
	})

	test('declares exact liquidation graph, reservation, timing, and semantic event fields', () => {
		expect(liquidationApprovalRegistryAbi.find(item => item.type === 'function' && item.name === 'coordinator')).toMatchObject({ outputs: [{ name: '', type: 'address' }], stateMutability: 'view' })
		expect(liquidationApprovalRegistryAbi.find(item => item.type === 'function' && item.name === 'liquidationReservations')).toMatchObject({
			inputs: [{ name: '', type: 'uint256' }],
			outputs: [
				{ name: 'approvalId', type: 'bytes32' },
				{ name: 'reservedDebtAttoEth', type: 'uint256' },
				{ name: 'settled', type: 'bool' },
			],
		})
		expect(coordinatorAbi.find(item => item.type === 'function' && item.name === 'lastSettlementTimestamp')).toMatchObject({ outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' })
		expect(coordinatorAbi.find(item => item.type === 'function' && item.name === 'stagedOperationCounter')).toMatchObject({ outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' })
		expect(coordinatorAbi.find(item => item.type === 'event' && item.name === 'LiquidationRouteStaged')).toMatchObject({
			inputs: [
				{ indexed: true, name: 'operationId', type: 'uint256' },
				{ indexed: true, name: 'operator', type: 'address' },
				{ indexed: true, name: 'receiverVault', type: 'address' },
				{ indexed: false, name: 'targetVault', type: 'address' },
				{ indexed: false, name: 'approvalId', type: 'bytes32' },
				{ indexed: false, name: 'requestedDebtAttoEth', type: 'uint256' },
				{ indexed: false, name: 'reservedDebtAttoEth', type: 'uint256' },
			],
		})
		expect(securityPoolAbi.find(item => item.type === 'event' && item.name === 'VaultLiquidated')).toMatchObject({
			inputs: [
				{ indexed: true, name: 'operationId', type: 'uint256' },
				{ indexed: false, name: 'operator', type: 'address' },
				{ indexed: true, name: 'receiverVault', type: 'address' },
				{ indexed: true, name: 'targetVault', type: 'address' },
				{ indexed: false, name: 'securityBondDebtMovedAttoEth', type: 'uint256' },
				{ indexed: false, name: 'capacityOwnershipMovedAttoRep', type: 'uint256' },
				{ indexed: false, name: 'badDebtAttoEth', type: 'uint256' },
			],
		})
	})

	test('classifies indexed migrations and excludes an unguarded liquidation queue', () => {
		expect(classifiedMethod('Zoltar', 'splitMigrationRep')).toMatchObject({ classification: 'selectable', operationId: 'zoltar.migration.split' })
		expect(classifiedMethod('SecurityPoolForker', 'migrateRepToZoltar')).toMatchObject({ classification: 'lifecycle-obligation', operationId: 'statoblast.fork.migrate-rep' })
		const liquidation = classifiedMethod('OpenOraclePriceCoordinator', 'requestPriceIfNeededAndStageLiquidation')
		expect(liquidation?.classification).toBe('excluded-dangerous')
		expect(liquidation?.reason).toContain('bad debt')
	})

	test('classifies disputes as random work and limits deposits to sweepable ERC-20 credit', () => {
		expect(classifiedMethod('OpenOracle', 'dispute')).toMatchObject({ classification: 'selectable', operationId: 'open-oracle.dispute' })
		const deposit = classifiedMethod('OpenOracle', 'deposit')
		expect(deposit).toMatchObject({ classification: 'selectable', operationId: 'open-oracle.deposit' })
		expect(deposit?.reason).toContain('Native deposits are intentionally excluded')
		expect(deposit?.reason).toContain('WETH and REP')
	})

	test('models claimAuctionProceeds as an explicit alias of the executable settlement route', () => {
		const claim = classifiedMethod('SecurityPoolForker', 'claimAuctionProceeds')
		expect(claim).toMatchObject({ classification: 'lifecycle-obligation', operationId: 'statoblast.auction.settle-bids' })
		expect(record(claim, 'claimAuctionProceeds classification')['semanticAliasOf']).toEqual({
			contract: 'SecurityPoolForker',
			method: 'settleAuctionBids',
			relation: 'target-subsumes-source',
			sharedImplementation: '_claimAuctionProceeds',
		})
	})

	test('pins the canonical deployed mutating code-family manifest', () => {
		expect(CANONICAL_MUTATING_CONTRACT_MANIFEST.map(entry => `${entry.contract}:${entry.artifactSource}:${entry.exposure}`)).toEqual([...expectedCanonicalManifest])
		expect(new Set(CANONICAL_MUTATING_CONTRACT_MANIFEST.map(entry => entry.contract)).size).toBe(CANONICAL_MUTATING_CONTRACT_MANIFEST.length)
		for (const entry of CANONICAL_MUTATING_CONTRACT_MANIFEST) {
			expect(entry.artifactSource, entry.contract).not.toContain('/interfaces/')
			expect(entry.artifactSource, entry.contract).not.toContain('/test/')
		}
		expect(CANONICAL_MUTATING_CONTRACT_MANIFEST.map(entry => entry.contract)).not.toContain('Multicall3')
	})

	test('keeps deployment helpers, direct delegates, orphan factories, and migration proxies out of random work', () => {
		const helperContracts = new Set(CANONICAL_MUTATING_CONTRACT_MANIFEST.filter(entry => entry.exposure === 'deployment-helper' || entry.exposure === 'fallback-module' || entry.exposure === 'migration-proxy').map(entry => entry.contract))
		const directDelegateContracts = new Set(CANONICAL_MUTATING_CONTRACT_MANIFEST.filter(entry => entry.exposure === 'delegate-module').map(entry => entry.contract))
		const orphanFactoryContracts = new Set(['EscalationGameFactory', 'PriceOracleManagerAndOperatorQueuerFactory', 'ShareTokenFactory', 'UniformPriceDualCapBatchAuctionFactory'])
		for (const entry of MUTATING_CONTRACT_SURFACE) {
			if (helperContracts.has(entry.contract)) expect(entry.classification, `${entry.contract}.${entry.method}`).toBe('role-restricted')
			if (directDelegateContracts.has(entry.contract) || orphanFactoryContracts.has(entry.contract)) expect(entry.classification, `${entry.contract}.${entry.method}`).toBe('excluded-dangerous')
		}
	})

	test('tracks the claim checkpoint selector exposed through the escalation-game fallback', () => {
		const contracts = loadArtifactContracts()
		const gameAbi = contractAbi(contracts, 'contracts/statoblast/EscalationGame.sol', 'EscalationGame')
		const constructor = gameAbi.find(item => typeof item === 'object' && item !== null && 'type' in item && item.type === 'constructor')
		expect(constructor).toMatchObject({ inputs: expect.arrayContaining([{ internalType: 'contract EscalationGameClaimDelegate', name: '_claimDelegate', type: 'address' }]) })
		expect(gameAbi).toContainEqual(expect.objectContaining({ stateMutability: 'nonpayable', type: 'fallback' }))
		const delegateMutations = mutatingFunctions(contractAbi(contracts, 'contracts/statoblast/EscalationGameClaimDelegate.sol', 'EscalationGameClaimDelegate'))
		expect(delegateMutations.map((item, index) => artifactFunctionSignature(item, `EscalationGameClaimDelegate[${index.toString()}]`))).toEqual(['initializeForkClaimCheckpoint(address)'])
		expect(classifiedMethod('EscalationGameClaimDelegate', 'initializeForkClaimCheckpoint')).toMatchObject({ classification: 'role-restricted' })
	})

	test('classifies canonical receive and fallback entry points by ABI kind', () => {
		const wethDeposit = classifiedMethod('WETH9', 'deposit')
		expect(classifiedMethod('WETH9', 'receive', 'receive')).toMatchObject({ abiEntryKind: 'receive', classification: wethDeposit?.classification, operationId: wethDeposit?.operationId })
		expect(classifiedMethod('SecurityPool', 'receive', 'receive')).toMatchObject({ abiEntryKind: 'receive', classification: 'role-restricted' })
		expect(classifiedMethod('SecurityPoolForker', 'receive', 'receive')).toMatchObject({ abiEntryKind: 'receive', classification: 'role-restricted' })
		expect(classifiedMethod('TwoWayConstantProductRouter', 'receive', 'receive')).toMatchObject({ abiEntryKind: 'receive', classification: 'role-restricted' })
		expect(classifiedMethod('EscalationGame', 'fallback', 'fallback')).toMatchObject({ abiEntryKind: 'fallback', classification: 'role-restricted' })
	})

	test('classifies every mutating method in the hand-maintained execution ABIs', () => {
		for (const binding of curatedAbiBindings) {
			if ('catalogSurface' in binding && binding.catalogSurface === false) continue
			const { abi, contract } = binding
			for (const item of abi) {
				if (item.type !== 'function' || item.stateMutability === 'view' || item.stateMutability === 'pure') continue
				expect(classifiedMethod(contract, item.name), `${contract}.${item.name}`).toBeDefined()
			}
		}
	})

	test('matches every curated function and event shape to its generated artifact', () => {
		const contracts = loadArtifactContracts()
		const boundAbis = new Set<readonly unknown[]>(curatedAbiBindings.map(binding => binding.abi))
		expect(boundAbis.size).toBe(Object.keys(contractAbis).length)
		for (const [name, abi] of Object.entries(contractAbis)) {
			expect(Array.isArray(abi), `${name} ABI export`).toBeTrue()
			if (Array.isArray(abi)) expect(boundAbis.has(abi), `${name} artifact binding`).toBeTrue()
		}
		for (const binding of curatedAbiBindings) {
			const { abi, artifactSource, contract } = binding
			const generatedEntries = new Map(
				contractAbi(contracts, artifactSource, contract)
					.filter(item => typeof item === 'object' && item !== null && 'type' in item && (item.type === 'function' || item.type === 'event'))
					.map((item, index) => [abiEntryIdentity(item, `${contract}.generated[${index.toString()}]`), item]),
			)
			if ('delegatedViews' in binding) {
				for (const delegatedView of binding.delegatedViews) {
					const functionNames = new Set<string>(delegatedView.functions)
					for (const [index, item] of contractAbi(contracts, delegatedView.artifactSource, delegatedView.contract).entries()) {
						if (typeof item !== 'object' || item === null || !('type' in item) || !('name' in item) || item.type !== 'function' || typeof item.name !== 'string' || !functionNames.has(item.name)) continue
						generatedEntries.set(abiEntryIdentity(item, `${delegatedView.contract}.generated[${index.toString()}]`), item)
					}
				}
			}
			for (const [index, item] of abi.entries()) {
				const label = `${contract}.curated[${index.toString()}]`
				const identity = abiEntryIdentity(item, label)
				const generated = generatedEntries.get(identity)
				expect(generated, identity).toBeDefined()
				if (generated === undefined) continue
				expect(curatedAbiEntryShape(item, label), identity).toEqual(curatedAbiEntryShape(generated, `${contract}.generated.${identity}`))
			}
		}
	})

	test('backs every classified selectable or lifecycle operation id with a catalog definition', () => {
		const catalogIds = new Set(CHAOS_OPERATION_CATALOG.map(definition => definition.id))
		for (const entry of MUTATING_CONTRACT_SURFACE) {
			if (entry.operationId !== undefined) expect(catalogIds, `${entry.contract}.${entry.method} -> ${entry.operationId}`).toContain(entry.operationId)
		}
	})

	test('routes every prerequisite selector through workflow steps and validates semantic aliases', () => {
		const stepSelectors = new Set<string>()
		for (const file of ['open-oracle.ts', 'statoblast.ts', 'trading.ts', 'zoltar.ts']) {
			for (const selector of operationStepSelectors(path.resolve(import.meta.dir, '../../src/operations', file))) stepSelectors.add(selector)
		}
		for (const entry of MUTATING_CONTRACT_SURFACE.filter(candidate => candidate.classification === 'prerequisite')) {
			const definition = CHAOS_OPERATION_CATALOG.find(candidate => candidate.id === entry.operationId)
			expect(definition?.classification, `${entry.contract}.${entry.method} prerequisite catalog metadata`).toBe('prerequisite')
			expect(definition?.method, `${entry.contract}.${entry.method} prerequisite selector metadata`).toBe(entry.method)
			expect(stepSelectors, `${entry.contract}.${entry.method} executable workflow step`).toContain(entry.method)
		}

		const aliases = MUTATING_CONTRACT_SURFACE.filter(entry => entry.semanticAliasOf !== undefined)
		expect(aliases.length).toBeGreaterThan(0)
		for (const entry of aliases) {
			const alias = entry.semanticAliasOf
			if (alias === undefined) continue
			const target = classifiedMethod(alias.contract, alias.method)
			expect(target, `${entry.contract}.${entry.method} semantic alias target`).toBeDefined()
			if (target === undefined) continue
			expect(alias.relation, `${entry.contract}.${entry.method} semantic alias relation`).toBe('target-subsumes-source')
			expect(target.semanticAliasOf, `${entry.contract}.${entry.method} semantic alias chain`).toBeUndefined()
			expect(target.classification, `${entry.contract}.${entry.method} semantic classification`).toBe(entry.classification)
			expect(target.operationId, `${entry.contract}.${entry.method} semantic operation`).toBe(entry.operationId)
			const definition = CHAOS_OPERATION_CATALOG.find(candidate => candidate.id === target.operationId)
			expect(definition, `${entry.contract}.${entry.method} executable semantic operation`).toMatchObject({
				classification: target.classification,
				contract: alias.contract,
				method: alias.method,
			})
			if (definition === undefined) continue
			expect(['selectable', 'lifecycle-obligation'], `${entry.contract}.${entry.method} executable semantic classification`).toContain(definition.classification)
			expect(
				CHAOS_OPERATION_CATALOG.some(candidate => candidate.contract === entry.contract && candidate.method === entry.method),
				`${entry.contract}.${entry.method} duplicate catalog route`,
			).toBeFalse()

			const manifest = CANONICAL_MUTATING_CONTRACT_MANIFEST.find(candidate => candidate.contract === entry.contract)
			expect(manifest, `${entry.contract}.${entry.method} canonical source`).toBeDefined()
			if (manifest === undefined) continue
			const source = readFileSync(path.resolve(import.meta.dir, '../../../../solidity', manifest.artifactSource), 'utf8')
			const sharedCall = new RegExp(`\\b${alias.sharedImplementation}\\s*\\(`)
			expect(solidityFunctionBody(source, entry.method), `${entry.contract}.${entry.method} shared implementation`).toMatch(sharedCall)
			expect(solidityFunctionBody(source, alias.method), `${alias.contract}.${alias.method} shared implementation`).toMatch(sharedCall)
		}
	})

	test('has no duplicate classifications and explains every exclusion', () => {
		const keys = MUTATING_CONTRACT_SURFACE.map(entry => `${entry.contract}.${entry.abiEntryKind}.${entry.method}`)
		expect(new Set(keys).size).toBe(keys.length)
		for (const entry of MUTATING_CONTRACT_SURFACE) {
			if (entry.classification === 'role-restricted' || entry.classification === 'excluded-dangerous') {
				expect(entry.reason, `${entry.contract}.${entry.method}`).toBeDefined()
				expect(entry.reason?.length ?? 0, `${entry.contract}.${entry.method}`).toBeGreaterThan(20)
			} else expect(entry.operationId).toBeDefined()
		}
	})

	test('conforms every classification to one generated manifest artifact', () => {
		const contracts = loadArtifactContracts()
		const manifestByContract = new Map(CANONICAL_MUTATING_CONTRACT_MANIFEST.map(entry => [entry.contract, entry]))
		for (const entry of MUTATING_CONTRACT_SURFACE) {
			const manifestEntry = manifestByContract.get(entry.contract)
			expect(manifestEntry, entry.contract).toBeDefined()
			if (manifestEntry === undefined) continue
			const abi = contractAbi(contracts, manifestEntry.artifactSource, entry.contract)
			const matchingEntries = abi.filter(item => {
				if (typeof item !== 'object' || item === null || !('type' in item)) return false
				if (entry.abiEntryKind !== 'function') return item.type === entry.abiEntryKind
				return item.type === 'function' && 'name' in item && item.name === entry.method
			})
			expect(matchingEntries.length, `${entry.contract}.${entry.abiEntryKind}.${entry.method}`).toBeGreaterThan(0)
		}
	})

	test('classifies every generated mutation and special entry in the canonical deployed manifest', () => {
		const contracts = loadArtifactContracts()
		for (const { artifactSource, contract } of CANONICAL_MUTATING_CONTRACT_MANIFEST) {
			const output = contractArtifact(contracts, artifactSource, contract)
			const deployedBytecode = record(record(output['evm'], `${contract}.evm`)['deployedBytecode'], `${contract}.evm.deployedBytecode`)['object']
			expect(typeof deployedBytecode, `${contract} deployed bytecode type`).toBe('string')
			expect(typeof deployedBytecode === 'string' ? deployedBytecode.length : 0, `${contract} deployed bytecode`).toBeGreaterThan(0)
			const generatedEntries = mutatingAbiEntries(contractAbi(contracts, artifactSource, contract)).map((item, index) => ({ identity: artifactAbiEntryIdentity(item, `${contract}[${index.toString()}]`), item }))
			expect(generatedEntries.length, `${contract} manifest eligibility`).toBeGreaterThan(0)
			const entryIdentities = new Map(generatedEntries.map(entry => [`${entry.identity.abiEntryKind}:${entry.identity.method}`, entry.identity]))
			for (const { abiEntryKind, method } of entryIdentities.values()) {
				const classification = classifiedMethod(contract, method, abiEntryKind)
				expect(classification, `${contract}.${abiEntryKind}.${method}`).toBeDefined()
				expect(classification?.abiEntryKind, `${contract}.${abiEntryKind}.${method} ABI kind`).toBe(abiEntryKind)
				const overloads = generatedEntries.filter(entry => entry.identity.abiEntryKind === abiEntryKind && entry.identity.method === method)
				if (abiEntryKind !== 'function') {
					expect(overloads.length, `${contract}.${abiEntryKind} uniqueness`).toBe(1)
					expect(classification?.signatures, `${contract}.${abiEntryKind} signature list`).toBeUndefined()
					continue
				}
				if (overloads.length < 2) {
					expect(classification?.signatures, `${contract}.${method} unnecessary signature list`).toBeUndefined()
					continue
				}
				const signatures = overloads.map((entry, index) => artifactFunctionSignature(entry.item, `${contract}.${method}[${index.toString()}]`)).sort()
				expect([...(classification?.signatures ?? [])].sort(), `${contract}.${method} overload coverage`).toEqual(signatures)
			}
		}
	})
})

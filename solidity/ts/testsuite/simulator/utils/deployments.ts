import { peripherals_interfaces_IAugur_IAugur, IERC20_IERC20, peripherals_interfaces_IWeth9_IWeth9, peripherals_Auction_Auction, peripherals_openOracle_OpenOracle_OpenOracle, peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer, peripherals_SecurityPool_SecurityPool, peripherals_factories_AuctionFactory_AuctionFactory, ReputationToken_ReputationToken, Zoltar_Zoltar, peripherals_SecurityPoolUtils_SecurityPoolUtils, peripherals_tokens_ShareToken_ShareToken, peripherals_factories_SecurityPoolFactory_SecurityPoolFactory, peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory, peripherals_factories_ShareTokenFactory_ShareTokenFactory } from '../../../types/contractArtifact.js'
import { QuestionOutcome } from '../types/types.js'
import { addressString } from './bigint.js'
import { ETHEREUM_LOGS_LOGGER_ADDRESS, TEST_ADDRESSES, WETH_ADDRESS } from './constants.js'
import { Deployment } from './logExplaining.js'
import { getInfraContractAddresses, getSecurityPoolAddresses } from './deployPeripherals.js'
import { getChildUniverseId, getRepTokenAddress } from './utilities.js'
import { zeroAddress } from 'viem'

const getUniverseName = (universeId: bigint): string => {
	const path: string[] = []
	let currentUniverseId = universeId
	while (currentUniverseId > 0n) {
		const branchIndex = Number(currentUniverseId & 0b11n) - 1
		const outcomeName = QuestionOutcome[branchIndex] as keyof typeof QuestionOutcome
		path.push(outcomeName)
		currentUniverseId = currentUniverseId >> 2n
	}
	if (path.length === 0) return 'U-Genesis'
	return `U-Genesis-${ path.join('-') }`
}

const getDeploymentsForUniverse = (universeId: bigint, securityPoolAddress: `0x${ string }`, repTokenAddress: `0x${ string }`, priceOracleManagerAndOperatorQueuerAddress: `0x${ string }`, shareTokenAddress: `0x${ string }`, auction: `0x${ string }`): Deployment[] => [
	{
		abi: ReputationToken_ReputationToken.abi,
		deploymentName: `RepV2 ${ getUniverseName(universeId) }`,
		address: repTokenAddress
	}, {
		abi: peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.abi,
		deploymentName: `PriceOracleManagerAndOperatorQueuer ${ getUniverseName(universeId) }`,
		address: priceOracleManagerAndOperatorQueuerAddress
	}, {
		abi: peripherals_SecurityPool_SecurityPool.abi,
		deploymentName: `ETH SecurityPool ${ getUniverseName(universeId) }`,
		address: securityPoolAddress
	}, {
		abi: peripherals_tokens_ShareToken_ShareToken.abi,
		deploymentName: `ShareToken ${ getUniverseName(universeId) }`,
		address: shareTokenAddress
	}, {
		abi: peripherals_Auction_Auction.abi,
		deploymentName: `Truth Auction ${ getUniverseName(universeId) }`,
		address: auction
	}
] as const

export const getDeployments = (genesisUniverse: bigint, questionId: bigint, securityMultiplier: bigint): Deployment[] => {
	const infraAddresses = getInfraContractAddresses()
	const originAddresses = getSecurityPoolAddresses(zeroAddress, genesisUniverse, questionId, securityMultiplier)

	const oucomes = [0n, 1n, 2n]

	const getChildAddresses = (parentSecurityPoolAddress: `0x${ string }`, parentUniverseId: bigint): Deployment[] => {
		return oucomes.flatMap((outcome) => {
			const universeId = getChildUniverseId(parentUniverseId, outcome)
			const childAddresses = getSecurityPoolAddresses(parentSecurityPoolAddress, universeId, questionId, securityMultiplier)
			return getDeploymentsForUniverse(universeId, childAddresses.securityPool, getRepTokenAddress(universeId), childAddresses.priceOracleManagerAndOperatorQueuer, childAddresses.shareToken, childAddresses.truthAuction)
		})
	}

	return ([
		...getDeploymentsForUniverse(genesisUniverse, originAddresses.securityPool, getRepTokenAddress(genesisUniverse), originAddresses.priceOracleManagerAndOperatorQueuer, originAddresses.shareToken, originAddresses.truthAuction),
		...getChildAddresses(originAddresses.securityPool, genesisUniverse), // children
		...oucomes.flatMap((outcome) => getChildAddresses(getSecurityPoolAddresses(originAddresses.securityPool, genesisUniverse, questionId, securityMultiplier).securityPool, getChildUniverseId(genesisUniverse, outcome))), // grand children
		{
			abi: Zoltar_Zoltar.abi,
			deploymentName: 'Zoltar',
			address: infraAddresses.zoltar,
		}, {
			abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
			deploymentName: 'Security Pool Factory',
			address: infraAddresses.securityPoolFactory
		}, {
			abi: peripherals_factories_AuctionFactory_AuctionFactory.abi,
			deploymentName: 'Auction Factory',
			address: infraAddresses.auctionFactory
		}, {
			abi: peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory.abi,
			deploymentName: 'Price Oracle Manager And Operator Queuer Factory',
			address: infraAddresses.priceOracleManagerAndOperatorQueuerFactory
		}, {
			abi: peripherals_factories_ShareTokenFactory_ShareTokenFactory.abi,
			deploymentName: 'Share Token Factory',
			address: infraAddresses.shareTokenFactory
		}, {
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			deploymentName: 'Open Oracle',
			address: infraAddresses.openOracle
		}, {
			abi: peripherals_interfaces_IWeth9_IWeth9.abi,
			deploymentName: 'WETH',
			address: WETH_ADDRESS
		}, {
			abi: peripherals_interfaces_IAugur_IAugur.abi,
			deploymentName: 'Augur',
			address: '0x23916a8f5c3846e3100e5f587ff14f3098722f5d'
		}, {
			abi: IERC20_IERC20.abi,
			deploymentName: 'ETH',
			address: addressString(ETHEREUM_LOGS_LOGGER_ADDRESS)
		}, {
			abi: undefined,
			deploymentName: 'Micah Deployer',
			address: `0x7a0d94f55792c434d74a40883c6ed8545e406d12`
		}, {
			abi: peripherals_SecurityPoolUtils_SecurityPoolUtils.abi,
			deploymentName: 'Security Pool Utils',
			address: infraAddresses.securityPoolUtils
		}, {
			abi: undefined,
			deploymentName: 'Augur V2 Genesis',
			address: '0x49244BD018Ca9fd1f06ecC07B9E9De773246e5AA'
		},
		...TEST_ADDRESSES.map((testAddress, index) => ({
			abi: undefined,
			deploymentName: `TEST_ADDRESSES[${ index }]`,
			address: addressString(testAddress)
		} as const))
	] as const).filter((entry) => BigInt(entry.address) !== 0n)
}

import { peripherals_interfaces_IAugur_IAugur, IERC20_IERC20, peripherals_interfaces_IWeth9_IWeth9, peripherals_Auction_Auction, peripherals_CompleteSet_CompleteSet, peripherals_openOracle_OpenOracle_OpenOracle, peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer, peripherals_SecurityPool_SecurityPool, peripherals_SecurityPoolFactory_SecurityPoolFactory, ReputationToken_ReputationToken, Zoltar_Zoltar, peripherals_SecurityPoolUtils_SecurityPoolUtils } from '../../../types/contractArtifact.js'
import { EthereumAddressString, QuestionOutcome } from '../types/types.js'
import { addressString } from './bigint.js'
import { ETHEREUM_LOGS_LOGGER_ADDRESS, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES, WETH_ADDRESS } from './constants.js'
import { Deployment } from './logExplaining.js'
import { getCompleteSetAddress, getOpenOracleAddress, getPriceOracleManagerAndOperatorQueuerAddress, getSecurityPoolAddress, getSecurityPoolFactoryAddress, getSecurityPoolUtilsAddress, getTruthAuction } from './peripherals.js'
import { getChildUniverseId, getRepTokenAddress, getZoltarAddress } from './utilities.js'

const getDeploymentsForUniverse = (universeId: bigint, securityPoolAddress: EthereumAddressString, repTokenAddress: EthereumAddressString, priceOracleManagerAndOperatorQueuerAddress: EthereumAddressString, completeSetAddress: EthereumAddressString, auction: EthereumAddressString): Deployment[] => [
	{
		abi: ReputationToken_ReputationToken.abi,
		deploymentName: `RepV2-U${ universeId }`,
		address: repTokenAddress
	}, {
		abi: peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.abi,
		deploymentName: `PriceOracleManagerAndOperatorQueuer U${ universeId }`,
		address: priceOracleManagerAndOperatorQueuerAddress
	}, {
		abi: peripherals_SecurityPool_SecurityPool.abi,
		deploymentName: `ETH SecurityPool U${ universeId }`,
		address: securityPoolAddress
	}, {
		abi: peripherals_CompleteSet_CompleteSet.abi,
		deploymentName: `CompleteSet U${ universeId }`,
		address: completeSetAddress
	}, {
		abi: peripherals_Auction_Auction.abi,
		deploymentName: `Truth Auction U${ universeId }`,
		address: auction
	}
] as const

export const getDeployments = (genesisUniverse: bigint, questionId: bigint, securityMultiplier: bigint): Deployment[] => {
	const securityPoolAddress = getSecurityPoolAddress(addressString(0x0n), genesisUniverse, questionId, securityMultiplier)
	const repToken = addressString(GENESIS_REPUTATION_TOKEN)
	const priceOracleManagerAndOperatorQueuerAddress = getPriceOracleManagerAndOperatorQueuerAddress(securityPoolAddress, repToken)
	const completeSetAddress = getCompleteSetAddress(securityPoolAddress)
	const truthAuction = getTruthAuction(securityPoolAddress)

	const oucomes = [QuestionOutcome.Invalid, QuestionOutcome.No, QuestionOutcome.Yes]

	const getChildAddresses = (parentSecurityPoolAddress: EthereumAddressString, parentUniverseId: bigint): Deployment[] => {
		return oucomes.flatMap((outcome) => {
			const universeId = getChildUniverseId(parentUniverseId, outcome)
			const securityPoolAddress = getSecurityPoolAddress(parentSecurityPoolAddress, universeId, questionId, securityMultiplier)
			const priceOracleManagerAndOperatorQueuerAddress = getPriceOracleManagerAndOperatorQueuerAddress(securityPoolAddress, getRepTokenAddress(universeId))
			const completeSetAddress = getCompleteSetAddress(securityPoolAddress)
			const truthAuction = getTruthAuction(securityPoolAddress)
			return getDeploymentsForUniverse(universeId, securityPoolAddress, getRepTokenAddress(universeId), priceOracleManagerAndOperatorQueuerAddress, completeSetAddress, truthAuction)
		})
	}

	return [
		...getDeploymentsForUniverse(genesisUniverse, securityPoolAddress, getRepTokenAddress(genesisUniverse), priceOracleManagerAndOperatorQueuerAddress, completeSetAddress, truthAuction),
		...getChildAddresses(securityPoolAddress, genesisUniverse), // children
		...oucomes.flatMap((outcome) => getChildAddresses(getSecurityPoolAddress(securityPoolAddress, genesisUniverse, questionId, securityMultiplier), getChildUniverseId(genesisUniverse, outcome))), // grand children
		{
			abi: Zoltar_Zoltar.abi,
			deploymentName: 'Zoltar',
			address: getZoltarAddress(),
		}, {
			abi: peripherals_SecurityPoolFactory_SecurityPoolFactory.abi,
			deploymentName: 'SecurityPoolFactory',
			address: getSecurityPoolFactoryAddress()
		}, {
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			deploymentName: 'OpenOracle',
			address: getOpenOracleAddress()
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
			address: getSecurityPoolUtilsAddress()
		}, {
			abi: undefined,
			deploymentName: 'Augur V2 Genesis',
			address: '0x49244BD018Ca9fd1f06ecC07B9E9De773246e5AA'
		},
		...TEST_ADDRESSES.map((testAddress, index) => ({
			abi: undefined,
			deploymentName: `Test EOA(${ index + 1 })`,
			address: addressString(testAddress)
		} as const))
	] as const
}

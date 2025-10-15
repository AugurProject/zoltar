import { QuestionOutcome } from '../types/peripheralTypes.js'
import { addressString } from './bigint.js'
import { ETHEREUM_LOGS_LOGGER_ADDRESS, GENESIS_REPUTATION_TOKEN, WETH_ADDRESS } from './constants.js'
import { Deployment } from './peripheralLogs.js'
import { getCompleteSetAddress, getOpenOracleAddress, getPriceOracleManagerAndOperatorQueuerAddress, getSecurityPoolAddress, getSecurityPoolFactoryAddress, getTruthAuction } from './peripherals.js'
import { getChildUniverseId, getRepTokenAddress, getZoltarAddress } from './utilities.js'

const getDeploymentsForUniverse = (universeId: bigint, securityPoolAddress: `0x${ string }`, repTokenAddress: `0x${ string }`, priceOracleManagerAndOperatorQueuerAddress: `0x${ string }`, completeSetAddress: `0x${ string }`, auction: `0x${ string }`) => [
	{
		definitionFilename: 'contracts/ReputationToken.sol',
		contractName: 'ReputationToken',
		deploymentName: `RepV2-U${ universeId }`,
		address: repTokenAddress
	}, {
		definitionFilename: 'contracts/peripherals/SecurityPool.sol',
		contractName: `PriceOracleManagerAndOperatorQueuer`,
		deploymentName: `PriceOracleManagerAndOperatorQueuer U${ universeId }`,
		address: priceOracleManagerAndOperatorQueuerAddress
	}, {
		definitionFilename: 'contracts/peripherals/SecurityPool.sol',
		contractName: 'SecurityPool',
		deploymentName: `ETH SecurityPool U${ universeId }`,
		address: securityPoolAddress
	}, {
		definitionFilename: 'contracts/peripherals/CompleteSet.sol',
		contractName: 'CompleteSet',
		deploymentName: `CompleteSet U${ universeId }`,
		address: completeSetAddress
	}, {
		definitionFilename: 'contracts/peripherals/Auction.sol',
		contractName: 'Auction',
		deploymentName: `Truth Auction U${ universeId }`,
		address: auction
	}
]

export const getDeployments = (genesisUniverse: bigint, questionId: bigint, securityMultiplier: bigint): Deployment[] => {
	// get SecurityPoolFactory
	// get origin security pool
	const securityPoolAddress = getSecurityPoolAddress(addressString(0x0n), genesisUniverse, questionId, securityMultiplier)
	const repToken = addressString(GENESIS_REPUTATION_TOKEN)
	const priceOracleManagerAndOperatorQueuerAddress = getPriceOracleManagerAndOperatorQueuerAddress(securityPoolAddress, repToken)
	const completeSetAddress = getCompleteSetAddress(securityPoolAddress)
	const truthAuction = getTruthAuction(securityPoolAddress)

	const oucomes = [QuestionOutcome.Invalid, QuestionOutcome.No, QuestionOutcome.Yes]

	const getChildAddresses = (parentSecurityPoolAddress: `0x${ string }`, parentUniverseId: bigint): Deployment[] => {
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
			definitionFilename: 'contracts/Zoltar.sol',
			deploymentName: 'Colored Core',
			contractName: 'Zoltar',
			address: getZoltarAddress(),
		}, {
			definitionFilename: 'contracts/peripherals/SecurityPool.sol',
			deploymentName: 'SecurityPoolFactory',
			contractName: 'SecurityPoolFactory',
			address: getSecurityPoolFactoryAddress()
		}, {
			definitionFilename: 'contracts/peripherals/openOracle/OpenOracle.sol',
			deploymentName: 'OpenOracle',
			contractName: 'OpenOracle',
			address: getOpenOracleAddress()
		}, {
			definitionFilename: 'contracts/IWeth9.sol',
			contractName: 'IWeth9',
			deploymentName: 'WETH',
			address: WETH_ADDRESS
		}, {
			definitionFilename: 'contracts/IAugur.sol',
			contractName: 'IAugur',
			deploymentName: 'Augur',
			address: '0x23916a8f5c3846e3100e5f587ff14f3098722f5d'
		}, {
			definitionFilename: 'contracts/IERC20.sol',
			contractName: 'IERC20',
			deploymentName: 'ETH',
			address: addressString(ETHEREUM_LOGS_LOGGER_ADDRESS)
		}
	]
}


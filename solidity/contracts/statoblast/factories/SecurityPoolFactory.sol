// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;
import { ZoltarQuestionData } from '../../ZoltarQuestionData.sol';
import { ISecurityPoolNative } from '../interfaces/ISecurityPoolNative.sol';
import { IQuestionLedger, ISecurityPoolFactory, SystemState } from '../interfaces/IQuestionLedger.sol';
import { OpenOracle } from '../openOracle/OpenOracle.sol';
import { Zoltar } from '../../Zoltar.sol';
import { ShareTokenFactory } from './ShareTokenFactory.sol';
import { IShareToken } from '../interfaces/IShareToken.sol';
import { SharedPoolPriceFeedFactory } from './SharedPoolPriceFeedFactory.sol';
import { SharedPoolPriceFeed } from '../SharedPoolPriceFeed.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { EscalationGameFactory } from './EscalationGameFactory.sol';
import { IQuestionForker } from '../interfaces/IQuestionForker.sol';
import { QuestionLedgerDeployer, QuestionLedgerConfiguration } from './QuestionLedgerDeployer.sol';
import { SecurityPoolUtils } from '../SecurityPoolUtils.sol';
import { SharedPoolPriceFeed } from '../SharedPoolPriceFeed.sol';

contract SecurityPoolFactory is ISecurityPoolFactory {
	ShareTokenFactory immutable shareTokenFactory;
	SharedPoolPriceFeedFactory immutable sharedPoolPriceFeedFactory;
	Zoltar public immutable override zoltar;
	OpenOracle immutable openOracle;
	EscalationGameFactory immutable escalationGameFactory;
	ZoltarQuestionData immutable questionData;
	IQuestionForker immutable questionForker;
	QuestionLedgerDeployer immutable questionLedgerDeployer;
	QuestionLedgerDeployment[] private questionLedgerDeployments;
	// Every caller that configured a security pool namespace, in registration order.
	address[] private securityPools;
	struct QuestionLedgerRegistration {
		IQuestionLedger pool;
		bool claimed;
	}
	struct QuestionLedgerMetadata {
		bytes32 originId;
		address securityPool;
		bool hasInheritedForkOutcome;
	}
	// Pool ID from getQuestionLedgerId(originId, universeId) -> reservation and eventual pool.
	mapping(bytes32 => QuestionLedgerRegistration) private questionLedgerRegistrations;
	mapping(IQuestionLedger => QuestionLedgerMetadata) private questionLedgerMetadata;
	mapping(address => mapping(uint248 => address)) public sharedPriceFeeds;
	struct PriceConfiguration {
		uint256 priorityFee;
		ReputationToken originToken;
	}
	mapping(address => PriceConfiguration) private securityPoolConfigurations;
	/// @notice Hash of the only security pool creation code this factory deploys.
	bytes32 public immutable securityPoolCreationCodeHash;
	// Module deployers every security pool uses for its origin and for each fork child.
	address private immutable capitalLedgerDeployer;
	address private immutable commitmentIndexDeployer;
	address private immutable capitalFeeStreamsDeployer;
	address private immutable settlementBookDeployer;
	address private immutable securityPoolSettlementDeployer;
	address private immutable reporterLedgerDeployer;
	address private immutable forkCoordinatorDeployer;
	address private immutable securityPoolServicesDeployer;
	address private immutable securityPoolRepairAuctionDeployer;
	uint256 private constant SECURITY_POOL_CONFIGURATION_BYTES = 13 * 32;
	/// @notice Security pools this factory deployed from the canonical creation code.
	/// Only they can open a pool namespace, so every registered pool belongs to one.
	mapping(address => bool) public isSecurityPool;
	mapping(address => uint256) private securityPoolCreationCount;

	event DeployQuestionLedger(IQuestionLedger indexed questionLedger, SharedPoolPriceFeed priceFeed, IShareToken shareToken, IQuestionLedger indexed parent, uint248 indexed universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 initialReportPriorityFeeAttoEthPerGas);
	event QuestionLedgerRegistered(bytes32 indexed originId, bytes32 indexed poolId, uint248 indexed universeId, IQuestionLedger questionLedger);
	event SecurityPoolRegistered(address indexed securityPool, uint248 indexed originUniverseId);
	event SharedPriceFeedRegistered(address indexed securityPool, uint248 indexed universeId, address indexed priceFeed);
	event SecurityPoolDeployed(address indexed securityPool, address indexed creator);

	constructor(IQuestionForker _questionForker, ZoltarQuestionData _questionData, EscalationGameFactory _escalationGameFactory, OpenOracle _openOracle, Zoltar _zoltar, ShareTokenFactory _shareTokenFactory, SharedPoolPriceFeedFactory _sharedPoolPriceFeedFactory, address questionLedgerDelegate, bytes32 _securityPoolCreationCodeHash, address[9] memory securityPoolModuleDeployers) {
		require(_securityPoolCreationCodeHash != bytes32(0), 'Security pool creation code hash missing');
		// The deployers are deterministic addresses that may be deployed after this
		// factory. Every security pool constructor requires each of them to hold code.
		securityPoolCreationCodeHash = _securityPoolCreationCodeHash;
		capitalLedgerDeployer = securityPoolModuleDeployers[0];
		commitmentIndexDeployer = securityPoolModuleDeployers[1];
		capitalFeeStreamsDeployer = securityPoolModuleDeployers[2];
		settlementBookDeployer = securityPoolModuleDeployers[3];
		securityPoolSettlementDeployer = securityPoolModuleDeployers[4];
		reporterLedgerDeployer = securityPoolModuleDeployers[5];
		forkCoordinatorDeployer = securityPoolModuleDeployers[6];
		securityPoolServicesDeployer = securityPoolModuleDeployers[7];
		securityPoolRepairAuctionDeployer = securityPoolModuleDeployers[8];
		questionForker = _questionForker;
		shareTokenFactory = _shareTokenFactory;
		sharedPoolPriceFeedFactory = _sharedPoolPriceFeedFactory;
		zoltar = _zoltar;
		openOracle = _openOracle;
		escalationGameFactory = _escalationGameFactory;
		questionData = _questionData;
		require(questionLedgerDelegate.code.length != 0, 'Question ledger delegate has no code');
		questionLedgerDeployer = new QuestionLedgerDeployer(questionLedgerDelegate);
	}

	function questionLedgerDeploymentCount() external view returns (uint256) {
		return questionLedgerDeployments.length;
	}

	function securityPoolCount() external view returns (uint256) {
		return securityPools.length;
	}

	function securityPoolsRange(uint256 startIndex, uint256 count) external view returns (address[] memory page) {
		require(startIndex <= securityPools.length, 'Security pool range start out of bounds');
		require(count <= securityPools.length - startIndex, 'Security pool range count too large');
		page = new address[](count);
		for (uint256 index = 0; index < count; index++) {
			page[index] = securityPools[startIndex + index];
		}
	}

	function getQuestionLedger(bytes32 originId, uint248 universeId) external view returns (IQuestionLedger) {
		return questionLedgerRegistrations[getQuestionLedgerId(originId, universeId)].pool;
	}

	function getQuestionLedgerOriginId(IQuestionLedger questionLedger) external view returns (bytes32) {
		return questionLedgerMetadata[questionLedger].originId;
	}

	function getQuestionLedgerHasInheritedForkOutcome(IQuestionLedger questionLedger) external view returns (bool) {
		return questionLedgerMetadata[questionLedger].hasInheritedForkOutcome;
	}

	function getQuestionOriginId(address securityPool, uint248 originUniverseId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 initialReportPriorityFeeAttoEthPerGas) public pure returns (bytes32) {
		return
			keccak256(abi.encode(keccak256('Statoblast security pool origin'), securityPool, originUniverseId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas));
	}

	function securityPoolOf(IQuestionLedger questionLedger) external view returns (address) {
		return questionLedgerMetadata[questionLedger].securityPool;
	}

	function getQuestionLedgerId(bytes32 originId, uint248 universeId) public pure returns (bytes32) {
		return keccak256(abi.encode(originId, universeId));
	}

	function questionLedgerDeploymentsRange(uint256 startIndex, uint256 count) external view returns (QuestionLedgerDeployment[] memory deployments) {
		require(startIndex <= questionLedgerDeployments.length, 'Pool range start out of bounds');
		require(count <= questionLedgerDeployments.length - startIndex, 'Pool range count too large');
		deployments = new QuestionLedgerDeployment[](count);
		for (uint256 index = 0; index < count; index++) {
			deployments[index] = questionLedgerDeployments[startIndex + index];
		}
	}

	function deployChildQuestionLedger(IQuestionLedger parent, IShareToken shareToken, uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps) external returns (IQuestionLedger questionLedger) {
		require(msg.sender == address(questionForker), 'Only question forker');
		bytes32 originId = questionLedgerMetadata[parent].originId;
		require(address(questionLedgerRegistrations[getQuestionLedgerId(originId, parent.universeId())].pool) == address(parent), 'Parent pool is not canonical');
		address securityPool = questionLedgerMetadata[parent].securityPool;
		require(securityPool != address(0), 'Security pool missing');
		require(sharedPriceFeeds[securityPool][universeId] != address(0), 'Prepare shared child price feed');
		(bool hasInheritedForkOutcome, ) = ISecurityPoolNative(securityPool).inheritedFixedOutcome(universeId, questionId);
		require(address(parent.shareToken()) == address(shareToken), 'Child share token mismatch');
		uint256 initialReportPriorityFeeAttoEthPerGas = parent.priceFeed().initialReportPriorityFeeAttoEthPerGas();
		_reserveQuestionLedger(originId, universeId);
		SharedPoolPriceFeed priceFeed = _getOrCreateSharedPriceFeed(securityPool, universeId);
		questionLedger = deployQuestionLedger(shareToken, parent, priceFeed, universeId, questionId, statoblastSecurityMultiplierBps);
		_registerQuestionLedger(originId, universeId, questionLedger, hasInheritedForkOutcome, securityPool);
		questionLedger.setStartingParams();
		_recordQuestionLedgerDeployment(QuestionLedgerDeployment({questionLedger: questionLedger, priceFeed: priceFeed, shareToken: shareToken, parent: parent, universeId: universeId, questionId: questionId, statoblastSecurityMultiplierBps: statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas: initialReportPriorityFeeAttoEthPerGas}));
	}

	/// @notice Maximum supported priority fee for a new oracle configuration.
	function maximumReportCollateral() external view override returns (uint256) {
		uint256 haltMultiplier = sharedPoolPriceFeedFactory.escalationHaltMultiplierBps();
		// The report uses floor(deposit * haltMultiplier / BPS).
		uint256 maximum = (uint256(type(uint128).max) + 1) * 10_000 - 1;
		maximum /= haltMultiplier;
		return maximum < type(uint128).max ? maximum : type(uint128).max;
	}

	function maximumReportPriorityFeeAttoEthPerGas() external view override returns (uint256) {
		return sharedPoolPriceFeedFactory.maximumReportPriorityFeeAttoEthPerGas();
	}

	/// @notice Deploys a security pool from the canonical creation code with this factory and
	/// its pinned module deployers. `configuration` is the ABI encoding of the origin
	/// configuration, question horizon, admission policy and economics, in that order.
	/// @dev A security pool's modules hold provider REP and trader collateral, and each fork
	/// child gets fresh ones from the same deployers. Fixing the code and the deployers
	/// here is what lets pools, the forker and exchanges trust a registered security pool.
	function deploySecurityPool(bytes calldata creationCode, bytes calldata configuration) external returns (address securityPool) {
		require(keccak256(creationCode) == securityPoolCreationCodeHash, 'Security pool creation code is not canonical');
		require(configuration.length == SECURITY_POOL_CONFIGURATION_BYTES, 'Security pool configuration length invalid');
		bytes memory initCode = abi.encodePacked(creationCode, abi.encode(address(this), capitalLedgerDeployer, commitmentIndexDeployer, capitalFeeStreamsDeployer, settlementBookDeployer, securityPoolSettlementDeployer, reporterLedgerDeployer, forkCoordinatorDeployer, securityPoolServicesDeployer, securityPoolRepairAuctionDeployer), configuration);
		// The address depends on the creator, so no other deployment can take it.
		bytes32 salt = keccak256(abi.encode(msg.sender, securityPoolCreationCount[msg.sender]++));
		assembly ('memory-safe') {
			securityPool := create2(0, add(initCode, 0x20), mload(initCode), salt)
			if iszero(securityPool) {
				let size := returndatasize()
				let data := mload(0x40)
				returndatacopy(data, 0, size)
				revert(data, size)
			}
		}
		isSecurityPool[securityPool] = true;
		emit SecurityPoolDeployed(securityPool, msg.sender);
	}

	/// @notice Deploy in the caller's own namespace; another caller can never add a ledger to it.
	function deploySecurityPoolQuestionLedger(uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 initialReportPriorityFeeAttoEthPerGas) external returns (IQuestionLedger questionLedger) {
		return
			_deployOriginQuestionLedger(msg.sender, universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas);
	}

	function _deployOriginQuestionLedger(address securityPool, uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 initialReportPriorityFeeAttoEthPerGas) private returns (IQuestionLedger questionLedger) {
		// The caller's security pool namespace prevents another creator from reserving its question identity.
		require(securityPoolConfigurations[securityPool].priorityFee != 0, 'Security pool configuration missing');
		require(statoblastSecurityMultiplierBps >= SecurityPoolUtils.MINIMUM_SECURITY_MULTIPLIER_BPS, 'Multiplier must be at least 10500 BPS');

		// Validate that the question exists
		require(questionData.questionCreatedTimestamp(questionId) > 0, 'Question does not exist');
		require(block.timestamp < questionData.getQuestionEndDate(questionId), 'Question has already ended');

		// Validate that it's a yes-no question (exactly 2 outcomes: Yes and No)
		string[] memory outcomes = questionData.getOutcomeLabels(questionId, 0, 3);
		require(outcomes.length == 2, 'Question must have two outcomes');
		require(keccak256(bytes(outcomes[0])) == keccak256(bytes('Yes')), 'First outcome must be Yes');
		require(keccak256(bytes(outcomes[1])) == keccak256(bytes('No')), 'Second outcome must be No');
		require(zoltar.getForkTime(universeId) == 0, 'Universe already forked');

		ReputationToken reputationToken = zoltar.getRepToken(universeId);
		require(address(reputationToken) != address(0x0), 'Universe REP token missing');
		require(zoltar.getNonDecisionThresholdAttoRep(universeId) > _getInitialEscalationDepositAttoRep(universeId), 'Escalation threshold too low');
		bytes32 originId = getQuestionOriginId(securityPool, universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas);
		_reserveQuestionLedger(originId, universeId);
		require(initialReportPriorityFeeAttoEthPerGas == securityPoolConfigurations[securityPool].priorityFee, 'Security pool configuration mismatch');
		SharedPoolPriceFeed priceFeed = _getOrCreateSharedPriceFeed(securityPool, universeId);

		// Each origin lineage has its own share token, which is reused by all migrated children.
		IShareToken shareToken = shareTokenFactory.deployShareToken(originId, questionId);
		questionLedger = deployQuestionLedger(shareToken, IQuestionLedger(payable(address(0))), priceFeed, universeId, questionId, statoblastSecurityMultiplierBps);

		_registerQuestionLedger(originId, universeId, questionLedger, false, securityPool);
		questionLedger.setStartingParams();
		shareToken.authorize(questionLedger);
		_recordQuestionLedgerDeployment(QuestionLedgerDeployment({questionLedger: questionLedger, priceFeed: priceFeed, shareToken: shareToken, parent: IQuestionLedger(payable(address(0))), universeId: universeId, questionId: questionId, statoblastSecurityMultiplierBps: statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas: initialReportPriorityFeeAttoEthPerGas}));
	}

	function _reserveQuestionLedger(bytes32 originId, uint248 universeId) private {
		bytes32 poolId = getQuestionLedgerId(originId, universeId);
		require(!questionLedgerRegistrations[poolId].claimed, 'Question ledger origin and universe already claimed');
		questionLedgerRegistrations[poolId].claimed = true;
	}

	function _registerQuestionLedger(bytes32 originId, uint248 universeId, IQuestionLedger questionLedger, bool hasInheritedForkOutcome, address securityPool) private {
		bytes32 poolId = getQuestionLedgerId(originId, universeId);
		require(address(questionLedgerRegistrations[poolId].pool) == address(0x0), 'Pool already registered');
		questionLedgerRegistrations[poolId].pool = questionLedger;
		questionLedgerMetadata[questionLedger] = QuestionLedgerMetadata({originId: originId, securityPool: securityPool, hasInheritedForkOutcome: hasInheritedForkOutcome});
		emit QuestionLedgerRegistered(originId, poolId, universeId, questionLedger);
	}

	function _recordQuestionLedgerDeployment(QuestionLedgerDeployment memory deployment) private {
		questionLedgerDeployments.push(deployment);
		emit DeployQuestionLedger(deployment.questionLedger, deployment.priceFeed, deployment.shareToken, deployment.parent, deployment.universeId, deployment.questionId, deployment.statoblastSecurityMultiplierBps, deployment.initialReportPriorityFeeAttoEthPerGas);
	}

	function deployQuestionLedger(IShareToken shareToken, IQuestionLedger parent, SharedPoolPriceFeed priceFeed, uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps) private returns (IQuestionLedger questionLedger) {
		questionLedger = questionLedgerDeployer.deploy(QuestionLedgerConfiguration({questionForker: address(questionForker), questionData: questionData, escalationGameFactory: escalationGameFactory, priceFeed: priceFeed, shareToken: shareToken, openOracle: openOracle, parent: parent, zoltar: zoltar, universeId: universeId, questionId: questionId, statoblastSecurityMultiplierBps: statoblastSecurityMultiplierBps}));
	}

	/// @notice Initialize a security pool's oracle configuration without a standalone question pool.
	/// @dev Only a security pool this factory deployed can open a namespace. The first call registers it for enumeration.
	function initializeSecurityPoolPriceFeed(uint248 universeId, uint256 priorityFee) external returns (address) {
		require(isSecurityPool[msg.sender], 'Security pool is not canonical');
		require(address(zoltar.getRepToken(universeId)) != address(0), 'Universe REP token missing');
		require(zoltar.getForkTime(universeId) == 0, 'Origin universe forked');
		PriceConfiguration storage config = securityPoolConfigurations[msg.sender];
		if (config.priorityFee == 0) {
			require(priorityFee > 0 && priorityFee <= sharedPoolPriceFeedFactory.maximumReportPriorityFeeAttoEthPerGas(), 'Invalid report priority fee');
			config.priorityFee = priorityFee;
			config.originToken = zoltar.getRepToken(universeId);
			securityPools.push(msg.sender);
			emit SecurityPoolRegistered(msg.sender, universeId);
		} else {
			require(config.priorityFee == priorityFee && address(config.originToken) == address(zoltar.getRepToken(universeId)), 'Security pool configuration mismatch');
		}
		return address(_getOrCreateSharedPriceFeed(msg.sender, universeId));
	}

	/// @notice Initialize a known branch from the caller's immutable origin configuration.
	function initializeSecurityPoolPriceFeedForUniverse(uint248 universeId) external returns (address) {
		require(securityPoolConfigurations[msg.sender].priorityFee != 0, 'Security pool configuration missing');
		ISecurityPoolNative(msg.sender).securityPoolTime(universeId);
		require(address(zoltar.getRepToken(universeId)) != address(0), 'Branch REP is missing');
		return address(_getOrCreateSharedPriceFeed(msg.sender, universeId));
	}

	/// @notice Prepare child REP and its shared feed independently of the more expensive ledger migration.
	/// @dev Anyone may prepare; the canonical forked parent fixes all namespace and oracle configuration.
	function prepareSecurityPoolChildPriceFeed(IQuestionLedger parent, uint256 outcomeIndex) external returns (address) {
		uint248 parentUniverseId = parent.universeId();
		require(address(questionLedgerRegistrations[getQuestionLedgerId(questionLedgerMetadata[parent].originId, parentUniverseId)].pool) == address(parent), 'Parent pool is not canonical');
		address securityPool = questionLedgerMetadata[parent].securityPool;
		require(securityPool != address(0), 'Parent has no security pool');
		require(parent.systemState() == SystemState.PoolForked, 'Parent not forked');
		uint248 universeId = zoltar.getChildUniverseId(parentUniverseId, outcomeIndex);
		if (address(zoltar.getRepToken(universeId)) == address(0)) zoltar.deployChild(parentUniverseId, outcomeIndex);
		return address(_getOrCreateSharedPriceFeed(securityPool, universeId));
	}

	/// @notice Prepare one known security pool branch without materializing its ancestor questions.
	function prepareSecurityPoolPriceFeed(IQuestionLedger source, uint248 universeId) external returns (address) {
		address securityPool = questionLedgerMetadata[source].securityPool;
		require(securityPool != address(0), 'Source has no security pool');
		require(address(questionLedgerRegistrations[getQuestionLedgerId(questionLedgerMetadata[source].originId, source.universeId())].pool) == address(source), 'Source pool is not canonical');
		ISecurityPoolNative(securityPool).securityPoolTime(universeId);
		require(address(zoltar.getRepToken(universeId)) != address(0), 'Branch REP is missing');
		return address(_getOrCreateSharedPriceFeed(securityPool, universeId));
	}

	function _getOrCreateSharedPriceFeed(address securityPool, uint248 universeId) private returns (SharedPoolPriceFeed feed) {
		feed = SharedPoolPriceFeed(payable(sharedPriceFeeds[securityPool][universeId]));
		if (address(feed) == address(0)) {
			feed = sharedPoolPriceFeedFactory.deploySharedPoolPriceFeed(openOracle, securityPoolConfigurations[securityPool].priorityFee, securityPool, universeId, zoltar.getRepToken(universeId), keccak256(abi.encode(securityPool, universeId)));
			sharedPriceFeeds[securityPool][universeId] = address(feed);
			emit SharedPriceFeedRegistered(securityPool, universeId, address(feed));
		}
	}

	function _getInitialEscalationDepositAttoRep(uint248 universeId) private view returns (uint256 initialDepositAttoRep) {
		return
			SecurityPoolUtils.calculateInitialEscalationDepositAttoRep(zoltar.getUniverseTheoreticalSupplyAttoRep(universeId));
	}
}

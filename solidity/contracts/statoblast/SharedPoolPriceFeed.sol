// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IWeth9 } from './interfaces/IWeth9.sol';
import { ISecurityPool, ISecurityPoolFactory } from './interfaces/ISecurityPool.sol';
import { OpenOracle } from './openOracle/OpenOracle.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import './OpenOraclePriceCoordinatorTypes.sol';

interface ISharedPoolPriceCoordinator {
	function securityPool() external view returns (ISecurityPool);
	function reputationToken() external view returns (ReputationToken);
	function openOracle() external view returns (OpenOracle);
	function weth() external view returns (IWeth9);
	function gasConsumedOpenOracleReportPrice() external view returns (uint256);
	function gasConsumedSettlement() external view returns (uint32);
	function gasUnitsForOneDispute() external view returns (uint256);
	function initialReportPriorityFeeAttoEthPerGas() external view returns (uint256);
	function targetPriceErrorForDispute() external view returns (uint256);
	function openOracleSecurityMultiplierBps() external view returns (uint256);
	function settlementTime() external view returns (uint48);
	function disputeDelay() external view returns (uint24);
	function protocolFee() external view returns (uint24);
	function feePercentage() external view returns (uint24);
	function multiplier() external view returns (uint16);
	function protocolFeeRecipient() external view returns (address);
	function escalationHaltMultiplierBps() external view returns (uint256);
	function maxSettlementBaseFeeMultiplierBps() external view returns (uint256);
	function sharedPriceSettled(uint256 reportId, bool accepted, string calldata reason) external;
}

interface ISharedPoolPortfolioPriceCheckpoint {
	function onSharedPriceAccepted(uint248 universeId, uint256 price, uint48 validUntil) external;
	function oracleExposure(uint248 universeId) external view returns (uint256);
	function clocks(uint248 universeId) external view returns (uint48, uint48, bool, bool);
}

/// @notice One REP/ETH report and freshness clock for all question ledgers in one pool and universe.
/// @dev Report sizing reads live aggregate capital, including direct authorizations
/// that do not touch any question. No question or owner enumeration is required.
contract SharedPoolPriceFeed {
	bool public constant timeType = true;
	bool public constant trackDisputes = true;
	uint256 public constant OPEN_INTEREST_DIVIDER = 100;
	uint256 public constant MAX_PENDING_SETTLEMENT_OPERATIONS = 4;
	uint256 public constant SETTLEMENT_GAS_OVERHEAD = 50_000;
	uint256 public constant FEED_SETTLEMENT_GAS_OVERHEAD = 4_000_000;
	address public immutable configCoordinator;
	address public immutable securityPoolFactory;
	address public immutable portfolio;
	ReputationToken public immutable reputationToken;
	OpenOracle public immutable openOracle;
	IWeth9 public immutable weth;
	uint256 public immutable gasConsumedOpenOracleReportPrice;
	uint32 public immutable gasConsumedSettlement;
	uint256 public immutable gasUnitsForOneDispute;
	uint256 public immutable initialReportPriorityFeeAttoEthPerGas;
	uint256 public immutable targetPriceErrorForDispute;
	uint256 public immutable openOracleSecurityMultiplierBps;
	uint48 public immutable settlementTime;
	uint24 public immutable disputeDelay;
	uint24 public immutable protocolFee;
	uint24 public immutable feePercentage;
	uint16 public immutable multiplier;
	address public immutable protocolFeeRecipient;
	uint256 public immutable escalationHaltMultiplierBps;
	uint256 public immutable maxSettlementBaseFeeMultiplierBps;
	uint248 public immutable universeId;
	uint256 public pendingReportId;
	address public pendingReportSponsor;
	address public pendingCoordinator;
	uint256 public pendingReportMaxSettlementBaseFeeAttoEthPerGas;
	uint256 public lastPrice;
	uint256 public lastSettlementTimestamp;
	uint256 private checkpointedExposureAttoEth;
	mapping(address => bool) public registeredCoordinators;
	/// @dev 0 = unknown or pending, 1 = accepted, 2 = rejected or recovered.
	mapping(uint256 => uint8) public reportOutcome;

	event CoordinatorRegistered(address indexed coordinator, address indexed securityPool);
	event ExposureCheckpoint(address indexed coordinator, uint256 exposureAttoEth, uint256 aggregateExposureAttoEth);
	event PriceRequested(uint256 indexed reportId, uint256 pendingReportMaxSettlementBaseFeeAttoEthPerGas);
	event ReportFundingAssigned(uint256 indexed reportId, address indexed coordinator, address indexed sponsor);
	event PriceReported(uint256 indexed reportId, uint256 price, uint256 lastSettlementTimestamp);
	event PriceReportRejected(uint256 indexed reportId, string reason, uint256 pendingReportId, uint256 pendingReportMaxSettlementBaseFeeAttoEthPerGas, uint256 lastPrice, uint256 lastSettlementTimestamp);
	event PendingReportRecovered(uint256 indexed reportId, uint256 settlementTimestamp, uint256 pendingReportId, uint256 pendingReportMaxSettlementBaseFeeAttoEthPerGas, uint256 lastPrice, uint256 lastSettlementTimestamp);
	event CoordinatorSettlementDeferred(uint256 indexed reportId, address indexed coordinator);

	constructor(address _configCoordinator, address _securityPoolFactory, address _portfolio, uint248 _universeId, ReputationToken _reputationToken) {
		require(_securityPoolFactory != address(0), 'Security pool factory zero');
		securityPoolFactory = _securityPoolFactory;
		require(_portfolio != address(0), 'Portfolio zero');
		portfolio = _portfolio;
		universeId = _universeId;
		configCoordinator = _configCoordinator;
		ISharedPoolPriceCoordinator config = ISharedPoolPriceCoordinator(_configCoordinator);
		require(address(_reputationToken) != address(0), 'REP token missing');
		reputationToken = _reputationToken;
		openOracle = config.openOracle();
		weth = config.weth();
		gasConsumedOpenOracleReportPrice = config.gasConsumedOpenOracleReportPrice();
		gasConsumedSettlement = config.gasConsumedSettlement();
		gasUnitsForOneDispute = config.gasUnitsForOneDispute();
		initialReportPriorityFeeAttoEthPerGas = config.initialReportPriorityFeeAttoEthPerGas();
		targetPriceErrorForDispute = config.targetPriceErrorForDispute();
		openOracleSecurityMultiplierBps = config.openOracleSecurityMultiplierBps();
		settlementTime = config.settlementTime();
		disputeDelay = config.disputeDelay();
		protocolFee = config.protocolFee();
		feePercentage = config.feePercentage();
		multiplier = config.multiplier();
		protocolFeeRecipient = config.protocolFeeRecipient();
		escalationHaltMultiplierBps = config.escalationHaltMultiplierBps();
		maxSettlementBaseFeeMultiplierBps = config.maxSettlementBaseFeeMultiplierBps();
	}

	/// @notice Factory-only registration after the coordinator and ledger have been atomically linked.
	function registerCoordinator(address coordinatorAddress) external {
		require(msg.sender == securityPoolFactory, 'Only security pool factory');
		require(!registeredCoordinators[coordinatorAddress], 'Coordinator already registered');
		ISharedPoolPriceCoordinator coordinator = ISharedPoolPriceCoordinator(coordinatorAddress);
		ISecurityPool pool = coordinator.securityPool();
		require(address(pool) != address(0) && address(pool.securityPoolFactory()) == securityPoolFactory, 'Wrong security pool factory');
		require(address(pool.openOraclePriceCoordinator()) == coordinatorAddress, 'Wrong pool coordinator');
		require(address(coordinator.reputationToken()) == address(reputationToken) && address(pool.repToken()) == address(reputationToken), 'Wrong REP token');
		require(address(coordinator.openOracle()) == address(openOracle) && address(coordinator.weth()) == address(weth), 'Wrong oracle tokens');
		require(coordinator.initialReportPriorityFeeAttoEthPerGas() == initialReportPriorityFeeAttoEthPerGas, 'Shared feed priority fee mismatch');
		require(pool.universeId() == universeId, 'Wrong pool universe');
		require(ISecurityPoolFactory(securityPoolFactory).getSecurityPoolPortfolio(pool) == portfolio, 'Wrong pool portfolio');
		require(ISecurityPoolFactory(securityPoolFactory).sharedPriceFeeds(portfolio, universeId) == address(this), 'Feed is not canonical');
		registeredCoordinators[coordinatorAddress] = true;
		_syncExposure(coordinatorAddress, pool);
		emit CoordinatorRegistered(coordinatorAddress, address(pool));
	}

	/// @notice Emits a changed aggregate exposure after an authenticated question checkpoint.
	function syncExposure(address coordinatorAddress) external {
		require(registeredCoordinators[coordinatorAddress], 'Unregistered coordinator');
		_syncExposure(coordinatorAddress, ISharedPoolPriceCoordinator(coordinatorAddress).securityPool());
	}

	function _syncExposure(address coordinatorAddress, ISecurityPool pool) private {
		require(pool.universeId() == universeId, 'Wrong exposure universe');
		uint256 exposureAttoEth = aggregateExposureAttoEth();
		if (exposureAttoEth == checkpointedExposureAttoEth) return;
		checkpointedExposureAttoEth = exposureAttoEth;
		emit ExposureCheckpoint(coordinatorAddress, exposureAttoEth, exposureAttoEth);
	}

	function aggregateExposureAttoEth() public view returns (uint256) {
		return ISharedPoolPortfolioPriceCheckpoint(portfolio).oracleExposure(universeId);
	}

	/// @notice Report collateral covers aggregate standing commitment or funded demand.
	function minimumToken1ReportAttoEth() public view returns (uint256) {
		uint256 priorityFeeReportAttoEth = _minimumToken1ReportAttoEthForGasPrice(initialReportPriorityFeeAttoEthPerGas);
		uint256 baseFeeReportAttoEth = _minimumToken1ReportAttoEthForGasPrice(block.basefee);
		uint256 exposureReportAttoEth = Math.ceilDiv(aggregateExposureAttoEth(), OPEN_INTEREST_DIVIDER);
		uint256 dynamicReportAttoEth =
			baseFeeReportAttoEth > exposureReportAttoEth ? baseFeeReportAttoEth : exposureReportAttoEth;
		uint256 minimumReportAttoEth = priorityFeeReportAttoEth + dynamicReportAttoEth;
		return minimumReportAttoEth > 0 ? minimumReportAttoEth : 1;
	}

	function _minimumToken1ReportAttoEthForGasPrice(uint256 gasPriceAttoEthPerGas) private view returns (uint256) {
		if (gasPriceAttoEthPerGas == 0) return 0;
		uint256 disputeGasCost = Math.mulDiv(gasPriceAttoEthPerGas, gasUnitsForOneDispute, 1);
		uint256 correctionProfitNumerator = targetPriceErrorForDispute - uint256(protocolFee) - uint256(feePercentage);
		return
			Math.mulDiv(disputeGasCost, openOracleSecurityMultiplierBps * (OPEN_ORACLE_PERCENTAGE_PRECISION + targetPriceErrorForDispute), SecurityPoolUtils.BPS_DENOMINATOR * correctionProfitNumerator, Math.Rounding.Ceil);
	}

	function getSettlementCallbackGasLimit() public view returns (uint32) {
		uint256 limit = _coordinatorCallbackGasLimit() + FEED_SETTLEMENT_GAS_OVERHEAD;
		require(limit <= type(uint32).max, 'Callback gas exceeds uint32');
		return uint32(limit);
	}

	function _coordinatorCallbackGasLimit() private view returns (uint256) {
		return (uint256(gasConsumedSettlement) + SETTLEMENT_GAS_OVERHEAD) * MAX_PENDING_SETTLEMENT_OPERATIONS;
	}

	function _requestGasUnits() private view returns (uint256) {
		return 4 * (getSettlementCallbackGasLimit() + gasConsumedOpenOracleReportPrice);
	}

	function getRequestPriceCostAttoEth() public view returns (uint256) {
		return block.basefee * _requestGasUnits() + REQUEST_BOUNTY_OFFSET_ATTO_ETH;
	}

	/// @notice A registered coordinator authenticates the sponsor and forwards the report's exact token funding.
	function requestPrice(address sponsor, uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth, uint256 bountyAttoEth) external payable {
		require(registeredCoordinators[msg.sender], 'Unregistered coordinator');
		(, , , bool ready) = ISharedPoolPortfolioPriceCheckpoint(portfolio).clocks(universeId);
		require(ready, 'Portfolio universe not ready');
		require(sponsor != address(0), 'Report sponsor zero');
		require(!isPriceValid(), 'Oracle price already fresh');
		require(pendingReportId == 0, 'Oracle request already pending');
		require(proposedRepPerEthPrice > 0, 'Initial oracle price zero');
		require(bountyAttoEth >= getRequestPriceCostAttoEth(), 'Oracle bounty too small');
		require(msg.value == bountyAttoEth, 'Incorrect oracle bounty');
		uint256 minimumWethReportAttoEth = minimumToken1ReportAttoEth();
		uint256 initialWethReportAttoEth =
			requestedInitialAttoWeth > minimumWethReportAttoEth ? requestedInitialAttoWeth : minimumWethReportAttoEth;
		uint256 initialRepReportAttoRep = Math.mulDiv(initialWethReportAttoEth, proposedRepPerEthPrice, SecurityPoolUtils.PRICE_PRECISION, Math.Rounding.Ceil);
		uint256 escalationHaltAttoEth = Math.mulDiv(initialWethReportAttoEth, escalationHaltMultiplierBps, SecurityPoolUtils.BPS_DENOMINATOR);
		uint256 exposureEscalationHaltAttoEth = Math.ceilDiv(aggregateExposureAttoEth(), OPEN_INTEREST_DIVIDER);
		if (exposureEscalationHaltAttoEth > escalationHaltAttoEth)
			escalationHaltAttoEth = exposureEscalationHaltAttoEth;
		require(initialWethReportAttoEth <= type(uint128).max, 'WETH report exceeds uint128');
		require(initialRepReportAttoRep <= type(uint128).max, 'REP report exceeds uint128');
		require(escalationHaltAttoEth <= type(uint128).max, 'Oracle escalation halt amount exceeds uint128 maximum');
		require(bountyAttoEth <= type(uint96).max, 'Oracle settler reward exceeds uint96 maximum');
		uint256 impliedRequestBaseFeeAttoEthPerGas =
			(bountyAttoEth - REQUEST_BOUNTY_OFFSET_ATTO_ETH) / _requestGasUnits();
		pendingReportMaxSettlementBaseFeeAttoEthPerGas =
			(impliedRequestBaseFeeAttoEthPerGas * maxSettlementBaseFeeMultiplierBps) /
			SecurityPoolUtils.BPS_DENOMINATOR;
		pendingReportSponsor = sponsor;
		pendingCoordinator = msg.sender;
		require(weth.transferFrom(msg.sender, address(this), initialWethReportAttoEth), 'WETH transfer for initial report failed');
		require(reputationToken.transferFrom(msg.sender, address(this), initialRepReportAttoRep), 'REP transfer for initial report failed');
		require(weth.approve(address(openOracle), initialWethReportAttoEth), 'WETH approval for initial report failed');
		require(reputationToken.approve(address(openOracle), initialRepReportAttoRep), 'REP approval for initial report failed');
		OpenOracle.OracleGame memory reportParams = OpenOracle.OracleGame({currentAmount1: uint128(initialWethReportAttoEth), currentAmount2: uint128(initialRepReportAttoRep), currentReporter: address(this), reportTimestamp: 0, settlementTimestamp: 0, token1: address(weth), lastReportOppoTime: 0, settlementTime: settlementTime, escalationHalt: uint128(escalationHaltAttoEth), protocolFeeRecipient: protocolFeeRecipient, settlerReward: uint96(bountyAttoEth), token2: address(reputationToken), numReports: 0, disputeDelay: disputeDelay, feePercentage: feePercentage, multiplier: multiplier, callbackContract: address(this), callbackGasLimit: getSettlementCallbackGasLimit(), protocolFee: protocolFee, flags: OPEN_ORACLE_FLAG_STORE_ALL | OPEN_ORACLE_FLAG_TRACK_DISPUTES | OPEN_ORACLE_FLAG_TIME_TYPE});
		pendingReportId = openOracle.report{value: bountyAttoEth}(reportParams, false, false, OpenOracle.TimingBoundaries({blockNumber: 0, blockNumberBound: 0, blockTimestamp: 0, blockTimestampBound: 0}));
		emit PriceRequested(pendingReportId, pendingReportMaxSettlementBaseFeeAttoEthPerGas);
		emit ReportFundingAssigned(pendingReportId, msg.sender, sponsor);
	}

	/// @notice The accepted price is committed before a bounded attempt to execute the requesting ledger's work.
	function openOracleCallback(uint256 reportId, uint256 amount1, uint256 amount2, uint256, address, address) external {
		require(msg.sender == address(openOracle), 'Only OpenOracle');
		require(reportId != 0 && reportId == pendingReportId, 'Oracle report mismatch');
		address coordinator = pendingCoordinator;
		uint256 maxSettlementBaseFeeAttoEthPerGas = pendingReportMaxSettlementBaseFeeAttoEthPerGas;
		_withdrawOpenOracleReporterBalances(pendingReportSponsor);
		_clearPendingReport();
		(string memory reason, uint256 priceTimestamp) = _validateSettledReport(reportId, amount1, amount2, maxSettlementBaseFeeAttoEthPerGas);
		bool accepted = bytes(reason).length == 0;
		reportOutcome[reportId] = accepted ? 1 : 2;
		if (accepted) {
			uint256 nextPrice = Math.mulDiv(amount2, SecurityPoolUtils.PRICE_PRECISION, amount1);
			uint256 validForSeconds =
				block.chainid == SEPOLIA_CHAIN_ID ? SEPOLIA_PRICE_VALID_FOR_SECONDS : PRICE_VALID_FOR_SECONDS;
			require(priceTimestamp + validForSeconds <= type(uint48).max, 'Price validity clock exhausted');
			// This checkpoint is atomic with acceptance. A failed optional question
			// callback cannot reassign already-earned fees to the new eligibility set.
			ISharedPoolPortfolioPriceCheckpoint(portfolio).onSharedPriceAccepted(universeId, nextPrice, uint48(priceTimestamp + validForSeconds));
			// Freshness begins when the final report becomes eligible, never when a delayed settler calls.
			lastSettlementTimestamp = priceTimestamp;
			lastPrice = nextPrice;
			emit PriceReported(reportId, lastPrice, lastSettlementTimestamp);
		} else emit PriceReportRejected(reportId, reason, 0, 0, lastPrice, lastSettlementTimestamp);
		_notifyCoordinator(coordinator, reportId, accepted, reason);
	}

	/// @notice Retires a report whose OpenOracle settlement callback failed, without accepting its price later.
	function recoverSettledPendingReport() external {
		uint256 reportId = pendingReportId;
		require(reportId != 0, 'No report to recover');
		(, , , , uint48 settlementTimestamp) = IStoredOpenOracleGame(address(openOracle)).storedGame(reportId);
		require(settlementTimestamp != 0, 'Report not settled');
		address coordinator = pendingCoordinator;
		_withdrawOpenOracleReporterBalances(pendingReportSponsor);
		_clearPendingReport();
		reportOutcome[reportId] = 2;
		emit PendingReportRecovered(reportId, settlementTimestamp, 0, 0, lastPrice, lastSettlementTimestamp);
		_notifyCoordinator(coordinator, reportId, false, 'Report recovered');
	}

	function _clearPendingReport() private {
		pendingReportId = 0;
		pendingReportSponsor = address(0);
		pendingCoordinator = address(0);
		pendingReportMaxSettlementBaseFeeAttoEthPerGas = 0;
	}

	function _notifyCoordinator(address coordinator, uint256 reportId, bool accepted, string memory reason) private {
		try
			ISharedPoolPriceCoordinator(coordinator).sharedPriceSettled{gas: _coordinatorCallbackGasLimit()}(reportId, accepted, reason)
		{} catch {
			emit CoordinatorSettlementDeferred(reportId, coordinator);
		}
	}

	function _withdrawOpenOracleReporterBalances(address sponsor) private {
		openOracle.withdrawTo(address(weth), type(uint256).max, sponsor);
		openOracle.withdrawTo(address(reputationToken), type(uint256).max, sponsor);
	}

	function _validateSettledReport(uint256 reportId, uint256 amount1, uint256 amount2, uint256 maxSettlementBaseFeeAttoEthPerGas) private view returns (string memory reason, uint256 priceTimestamp) {
		if (block.basefee > maxSettlementBaseFeeAttoEthPerGas) return ('Base fee too high', 0);
		(, , , uint48 finalReportTimestamp, , , , , , , , , uint24 numReports, , , , , , , ) = openOracle.storedGame(reportId);
		if (numReports == type(uint24).max) return ('Counter saturated', 0);
		if (numReports == 0 || !_isFinalReportProfitable(reportId, numReports, amount1))
			return ('Report uneconomic', 0);
		priceTimestamp = uint256(finalReportTimestamp) + settlementTime;
		if (!_isFreshPriceTimestamp(priceTimestamp)) return ('Report stale', 0);
		if (amount1 == 0 || amount2 == 0) return ('Empty oracle settlement', 0);
		if (Math.mulDiv(amount2, SecurityPoolUtils.PRICE_PRECISION, amount1) == 0) return ('Oracle price is zero', 0);
	}

	function _isFinalReportProfitable(uint256 reportId, uint24 numReports, uint256 finalAmount1) private view returns (bool) {
		(, , uint128 finalReportBaseFee, ) = openOracle.disputeHistory(reportId, numReports - 1);
		uint256 minimumProfitableReportAttoEth =
			_minimumToken1ReportAttoEthForGasPrice(initialReportPriorityFeeAttoEthPerGas) +
				Math.max(_minimumToken1ReportAttoEthForGasPrice(uint256(finalReportBaseFee)), Math.ceilDiv(aggregateExposureAttoEth(), OPEN_INTEREST_DIVIDER));
		return finalAmount1 >= minimumProfitableReportAttoEth;
	}

	function isPriceValid() public view returns (bool) {
		return lastPrice > 0 && _isFreshPriceTimestamp(lastSettlementTimestamp);
	}

	function _isFreshPriceTimestamp(uint256 priceTimestamp) private view returns (bool) {
		uint256 validForSeconds =
			block.chainid == SEPOLIA_CHAIN_ID ? SEPOLIA_PRICE_VALID_FOR_SECONDS : PRICE_VALID_FOR_SECONDS;
		return priceTimestamp != 0 && priceTimestamp + validForSeconds > block.timestamp;
	}
}

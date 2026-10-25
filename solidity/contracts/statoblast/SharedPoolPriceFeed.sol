// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IWeth9 } from './interfaces/IWeth9.sol';
import { ISecurityPool, ISecurityPoolFactory } from './interfaces/ISecurityPool.sol';
import { OpenOracle } from './openOracle/OpenOracle.sol';
import { SharedPoolReportEscrow } from './SharedPoolReportEscrow.sol';
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
}

interface ISharedPoolPortfolioPriceCheckpoint {
	function onSharedPriceAccepted(uint248 universeId, uint256 price, uint48 validUntil) external;
	function oracleExposure(uint248 universeId) external view returns (uint256);
	function clocks(uint248 universeId) external view returns (uint48, uint48, bool, bool);
	function rewardOracleReport(uint248 universeId, address sponsor, uint256 gasUnits, uint256 requestedAt) external;
}

/// @notice One REP/ETH report and freshness clock for all question ledgers in one pool and universe.
/// @dev Report sizing reads live aggregate capital, including direct authorizations
/// that do not touch any question. No question or owner enumeration is required.
contract SharedPoolPriceFeed {
	bool public constant timeType = true;
	bool public constant trackDisputes = true;
	uint256 public constant OPEN_INTEREST_DIVIDER = 100;
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
	uint256 public pendingExposureLimitAttoEth;
	uint256 public acceptedExposureLimitAttoEth;
	uint256 public acceptedEpoch;
	struct ReportCandidate {
		SharedPoolReportEscrow escrow;
		address sponsor;
		address coordinator;
		uint256 maxSettlementBaseFee;
		uint256 requestedAt;
		uint256 requestGas;
	}
	mapping(uint256 => ReportCandidate) public reportCandidates;
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
		require(targetPriceErrorForDispute < OPEN_ORACLE_PERCENTAGE_PRECISION, 'Oracle uncertainty reaches one hundred percent');
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

	/// @notice Capital may grow only within an already challenged report's budget.
	/// Pending candidates neither lower this budget nor grant premature capacity.
	function validateExposure() external view {
		require(aggregateExposureAttoEth() <= acceptedExposureLimitAttoEth, 'Accepted report exposure exceeded');
	}

	/// @notice Conservative upper REP/ETH bound for entry, withdrawals and capacity.
	function conservativePrice() external view returns (uint256) {
		return
			Math.mulDiv(lastPrice, OPEN_ORACLE_PERCENTAGE_PRECISION, OPEN_ORACLE_PERCENTAGE_PRECISION - targetPriceErrorForDispute, Math.Rounding.Ceil);
	}

	/// @notice Lower REP/ETH bound for externally rewarded adverse actions.
	function liquidationPrice() external view returns (uint256) {
		return
			Math.mulDiv(lastPrice, OPEN_ORACLE_PERCENTAGE_PRECISION, OPEN_ORACLE_PERCENTAGE_PRECISION + targetPriceErrorForDispute);
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

	function getSettlementCallbackGasLimit() public pure returns (uint32) {
		uint256 limit = FEED_SETTLEMENT_GAS_OVERHEAD;
		require(limit <= type(uint32).max, 'Callback gas exceeds uint32');
		return uint32(limit);
	}

	/// @notice The report sponsor funds its own transactions. Due accepted work is
	/// reimbursed by the portfolio service treasury, independently of settlement.
	/// A large mandatory public bounty would let unrelated settlers capture the
	/// sponsor's funding before it can earn that service reimbursement.
	function getRequestPriceCostAttoEth() public pure returns (uint256) {
		return REQUEST_BOUNTY_OFFSET_ATTO_ETH;
	}

	/// @notice A registered coordinator authenticates the sponsor and forwards the report's exact token funding.
	function requestPrice(address sponsor, uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth, uint256 bountyAttoEth) external payable returns (uint256 reportId) {
		uint256 initialGas = gasleft();
		require(registeredCoordinators[msg.sender], 'Unregistered coordinator');
		(, , , bool ready) = ISharedPoolPortfolioPriceCheckpoint(portfolio).clocks(universeId);
		require(ready, 'Portfolio universe not ready');
		require(sponsor != address(0), 'Report sponsor zero');
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
		pendingExposureLimitAttoEth =
			(initialWethReportAttoEth - _minimumToken1ReportAttoEthForGasPrice(initialReportPriorityFeeAttoEthPerGas)) *
			OPEN_INTEREST_DIVIDER;
		pendingReportMaxSettlementBaseFeeAttoEthPerGas = Math.mulDiv(block.basefee + initialReportPriorityFeeAttoEthPerGas, maxSettlementBaseFeeMultiplierBps, SecurityPoolUtils.BPS_DENOMINATOR);
		pendingReportSponsor = sponsor;
		pendingCoordinator = msg.sender;
		SharedPoolReportEscrow escrow;
		(reportId, escrow) = this.createReportEscrow(msg.sender, sponsor, initialWethReportAttoEth, initialRepReportAttoRep, escalationHaltAttoEth, bountyAttoEth);
		pendingReportId = reportId;
		reportCandidates[reportId] = ReportCandidate(escrow, sponsor, msg.sender, pendingReportMaxSettlementBaseFeeAttoEthPerGas, block.timestamp, initialGas - gasleft());
		emit PriceRequested(pendingReportId, pendingReportMaxSettlementBaseFeeAttoEthPerGas);
		emit ReportFundingAssigned(pendingReportId, msg.sender, sponsor);
	}

	function createReportEscrow(address payer, address sponsor, uint256 wethAmount, uint256 repAmount, uint256 haltAmount, uint256 bounty) external returns (uint256 id, SharedPoolReportEscrow escrow) {
		require(msg.sender == address(this), 'Only report creation');
		escrow = new SharedPoolReportEscrow(sponsor, openOracle, weth, reputationToken);
		require(weth.transferFrom(payer, address(escrow), wethAmount), 'WETH transfer for initial report failed');
		require(reputationToken.transferFrom(payer, address(escrow), repAmount), 'REP transfer for initial report failed');
		OpenOracle.OracleGame memory parameters;
		parameters.currentAmount1 = uint128(wethAmount);
		parameters.currentAmount2 = uint128(repAmount);
		parameters.currentReporter = address(escrow);
		parameters.token1 = address(weth);
		parameters.settlementTime = settlementTime;
		parameters.escalationHalt = uint128(haltAmount);
		parameters.protocolFeeRecipient = protocolFeeRecipient;
		parameters.settlerReward = uint96(bounty);
		parameters.token2 = address(reputationToken);
		parameters.disputeDelay = disputeDelay;
		parameters.feePercentage = feePercentage;
		parameters.multiplier = multiplier;
		parameters.callbackContract = address(escrow);
		parameters.callbackGasLimit = getSettlementCallbackGasLimit();
		parameters.protocolFee = protocolFee;
		parameters.flags = OPEN_ORACLE_FLAG_STORE_ALL | OPEN_ORACLE_FLAG_TRACK_DISPUTES | OPEN_ORACLE_FLAG_TIME_TYPE;
		id = escrow.start{value: bounty}(parameters);
	}

	/// @notice Accept one independently challenged candidate without executing a question's queue.
	/// Every candidate remains individually recoverable. A disputed report cannot
	/// prevent a different sponsor from establishing a fresh, funded observation.
	function settleReport(uint256 reportId, uint256 amount1, uint256 amount2) external {
		uint256 initialGas = gasleft();
		ReportCandidate memory candidate = reportCandidates[reportId];
		require(address(candidate.escrow) == msg.sender && msg.sender != address(0), 'Wrong report escrow');
		require(reportOutcome[reportId] == 0, 'Report already completed');
		(string memory reason, uint256 priceTimestamp) = _validateSettledReport(reportId, amount1, amount2, candidate.maxSettlementBaseFee);
		bool accepted = bytes(reason).length == 0;
		reportOutcome[reportId] = accepted ? 1 : 2;
		_clearLatestReport(reportId);
		if (accepted) {
			uint256 nextPrice = Math.mulDiv(amount2, SecurityPoolUtils.PRICE_PRECISION, amount1);
			uint256 validForSeconds = priceValidityWindowSeconds();
			require(priceTimestamp + validForSeconds <= type(uint48).max, 'Price validity clock exhausted');
			// Final report collateral may increase during disputes. Only its actually
			// challenged final amount grants capacity, never a pending candidate.
			acceptedExposureLimitAttoEth =
				(amount1 - _minimumToken1ReportAttoEthForGasPrice(initialReportPriorityFeeAttoEthPerGas)) *
				OPEN_INTEREST_DIVIDER;
			acceptedEpoch++;
			lastSettlementTimestamp = priceTimestamp;
			lastPrice = nextPrice;
			ISharedPoolPortfolioPriceCheckpoint(portfolio).onSharedPriceAccepted(universeId, nextPrice, uint48(priceTimestamp + validForSeconds));
			emit PriceReported(reportId, lastPrice, lastSettlementTimestamp);
			// Rewards are a separately capped treasury expense, never report funding.
			// Budget exhaustion or optional accounting cannot roll back a valid price.
			try
				ISharedPoolPortfolioPriceCheckpoint(portfolio).rewardOracleReport{gas: 300_000}(universeId, candidate.sponsor, candidate.requestGas + initialGas - gasleft() + 250_000, candidate.requestedAt)
			{} catch {}
		} else
			emit PriceReportRejected(reportId, reason, pendingReportId, pendingReportMaxSettlementBaseFeeAttoEthPerGas, lastPrice, lastSettlementTimestamp);
	}

	/// @notice Process the latest candidate after a failed OpenOracle callback.
	function recoverSettledPendingReport() external {
		recoverReport(pendingReportId);
	}

	/// @notice Retire one failed callback without accepting its price late.
	function recoverReport(uint256 reportId) public {
		ReportCandidate memory candidate = reportCandidates[reportId];
		require(address(candidate.escrow) != address(0) && reportOutcome[reportId] == 0, 'No report to recover');
		(, , , , uint48 settlementTimestamp) = IStoredOpenOracleGame(address(openOracle)).storedGame(reportId);
		require(settlementTimestamp != 0, 'Report not settled');
		reportOutcome[reportId] = 2;
		_clearLatestReport(reportId);
		candidate.escrow.withdrawFunding();
		emit PendingReportRecovered(reportId, settlementTimestamp, pendingReportId, pendingReportMaxSettlementBaseFeeAttoEthPerGas, lastPrice, lastSettlementTimestamp);
	}

	function _clearLatestReport(uint256 reportId) private {
		if (reportId != pendingReportId) return;
		pendingReportId = 0;
		pendingReportSponsor = address(0);
		pendingCoordinator = address(0);
		pendingReportMaxSettlementBaseFeeAttoEthPerGas = 0;
		pendingExposureLimitAttoEth = 0;
	}

	function _validateSettledReport(uint256 reportId, uint256 amount1, uint256 amount2, uint256 maxSettlementBaseFeeAttoEthPerGas) private view returns (string memory reason, uint256 priceTimestamp) {
		if (block.basefee > maxSettlementBaseFeeAttoEthPerGas) return ('Base fee too high', 0);
		(, , , uint48 finalReportTimestamp, , , , , , , , , uint24 numReports, , , , , , , ) = openOracle.storedGame(reportId);
		if (numReports == type(uint24).max) return ('Counter saturated', 0);
		if (numReports == 0 || !_isFinalReportProfitable(reportId, numReports, amount1))
			return ('Report uneconomic', 0);
		priceTimestamp = uint256(finalReportTimestamp) + settlementTime;
		if (priceTimestamp < lastSettlementTimestamp) return ('Report timestamp not newer', 0);
		if (
			priceTimestamp == lastSettlementTimestamp &&
			(amount1 - _minimumToken1ReportAttoEthForGasPrice(initialReportPriorityFeeAttoEthPerGas)) *
				OPEN_INTEREST_DIVIDER <=
				acceptedExposureLimitAttoEth
		) return ('Report adds no newer observation or capacity', 0);
		if (!_isFreshPriceTimestamp(priceTimestamp)) return ('Report stale', 0);
		if (amount1 == 0 || amount2 == 0) return ('Empty oracle settlement', 0);
		if (Math.mulDiv(amount2, SecurityPoolUtils.PRICE_PRECISION, amount1) == 0) return ('Oracle price is zero', 0);
	}

	/// @notice A settled candidate may authorize its owner's growth even when a
	/// newer, smaller canonical report has already arrived. The capital ledger
	/// retains this conservative quote as that owner's withdrawal floor until
	/// a later canonical epoch has independently secured the enlarged exposure.
	function reportAuthorization(uint256 reportId, uint256 newExposure) external view returns (uint256 conservativeReportPrice, uint256 epoch) {
		ReportCandidate memory candidate = reportCandidates[reportId];
		require(address(candidate.escrow) != address(0), 'Unknown report candidate');
		(
			uint128 amount1,
			uint128 amount2,
			,
			uint48 reportedAt,
			uint48 settledAt,
			,
			,
			,
			,
			,
			,
			,
			uint24 numReports,
			,
			,
			,
			,
			,
			,

		) = openOracle.storedGame(reportId);
		require(settledAt != 0 && amount1 != 0 && amount2 != 0, 'Report candidate not settled');
		require(block.basefee <= candidate.maxSettlementBaseFee, 'Report base fee limit exceeded');
		require(numReports != 0 && numReports != type(uint24).max, 'Report counter invalid');
		require(_isFreshPriceTimestamp(uint256(reportedAt) + settlementTime), 'Report candidate stale');
		require(_isProfitableForExposure(reportId, numReports, amount1, newExposure), 'Report exposure insufficient');
		uint256 price = Math.mulDiv(amount2, SecurityPoolUtils.PRICE_PRECISION, amount1);
		require(price != 0, 'Oracle price is zero');
		conservativeReportPrice = Math.mulDiv(price, OPEN_ORACLE_PERCENTAGE_PRECISION, OPEN_ORACLE_PERCENTAGE_PRECISION - targetPriceErrorForDispute, Math.Rounding.Ceil);
		return (conservativeReportPrice, acceptedEpoch);
	}

	function _isFinalReportProfitable(uint256 reportId, uint24 numReports, uint256 finalAmount1) private view returns (bool) {
		return _isProfitableForExposure(reportId, numReports, finalAmount1, aggregateExposureAttoEth());
	}

	function _isProfitableForExposure(uint256 reportId, uint24 numReports, uint256 finalAmount1, uint256 exposure) private view returns (bool) {
		(, , uint128 finalReportBaseFee, ) = openOracle.disputeHistory(reportId, numReports - 1);
		uint256 minimumProfitableReportAttoEth =
			_minimumToken1ReportAttoEthForGasPrice(initialReportPriorityFeeAttoEthPerGas) +
				Math.max(_minimumToken1ReportAttoEthForGasPrice(uint256(finalReportBaseFee)), Math.ceilDiv(exposure, OPEN_INTEREST_DIVIDER));
		return finalAmount1 >= minimumProfitableReportAttoEth;
	}

	function isPriceValid() public view returns (bool) {
		return lastPrice > 0 && _isFreshPriceTimestamp(lastSettlementTimestamp);
	}

	/// @notice One complete challenge period plus bounded keeper slack after settlement eligibility.
	/// @dev Mainnet's 480-second challenge and 300-second slack allow continuous renewal,
	/// but permit a final report to remain usable for at most 1,260 seconds after reporting.
	/// A pending, disputed or rejected renewal never extends the accepted price's expiry.
	function priceValidityWindowSeconds() public view returns (uint256) {
		return
			uint256(settlementTime) +
			(block.chainid == SEPOLIA_CHAIN_ID ? SEPOLIA_PRICE_VALID_FOR_SECONDS : PRICE_VALID_FOR_SECONDS);
	}

	function priceValidUntil() public view returns (uint256) {
		return lastSettlementTimestamp == 0 ? 0 : lastSettlementTimestamp + priceValidityWindowSeconds();
	}

	function _isFreshPriceTimestamp(uint256 priceTimestamp) private view returns (bool) {
		return priceTimestamp != 0 && priceTimestamp + priceValidityWindowSeconds() > block.timestamp;
	}
}

// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../IERC20.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { IWeth9 } from './interfaces/IWeth9.sol';
import { OpenOraclePriceCoordinator, OperationExecutionStatus, OperationType } from './OpenOraclePriceCoordinator.sol';

enum OperationBountyState {
	None,
	Open,
	Assigned,
	Paid,
	Refunded
}

struct OperationBounty {
	address creator;
	address operator;
	OperationType operation;
	address targetVault;
	uint256 amount;
	uint256 validForSeconds;
	address rewardToken;
	uint256 rewardAmount;
	uint256 acceptanceDeadline;
	uint256 minimumInitialWeth;
	uint256 maximumInitialWeth;
	uint256 operationId;
	uint256 reportId;
	OperationBountyState state;
}

contract OpenOracleOperationBountyBoard {
	using SafeERC20Ops for IERC20;

	OpenOraclePriceCoordinator public immutable coordinator;
	ReputationToken public immutable reputationToken;
	IWeth9 public immutable weth;
	uint256 public nextOperationBountyId = 1;
	mapping(uint256 => OperationBounty) public operationBounties;

	event OperationBountyPosted(
		uint256 indexed bountyId,
		address indexed creator,
		address indexed rewardToken,
		OperationType operation,
		address targetVault,
		uint256 amount,
		uint256 validForSeconds,
		uint256 rewardAmount,
		uint256 acceptanceDeadline,
		uint256 minimumInitialWeth,
		uint256 maximumInitialWeth
	);
	event OperationBountyAccepted(
		uint256 indexed bountyId,
		address indexed operator,
		uint256 indexed operationId,
		uint256 reportId
	);
	event OperationBountyClaimed(
		uint256 indexed bountyId,
		address indexed operator,
		address indexed rewardToken,
		uint256 rewardAmount
	);
	event OperationBountyRefunded(
		uint256 indexed bountyId,
		address indexed creator,
		address indexed rewardToken,
		uint256 rewardAmount
	);

	constructor(OpenOraclePriceCoordinator _coordinator, ReputationToken _reputationToken, IWeth9 _weth) {
		coordinator = _coordinator;
		reputationToken = _reputationToken;
		weth = _weth;
	}

	function postOperationBounty(
		OperationType operation,
		address targetVault,
		uint256 amount,
		uint256 validForSeconds,
		address rewardToken,
		uint256 rewardAmount,
		uint256 acceptanceDeadline,
		uint256 minimumInitialWeth,
		uint256 maximumInitialWeth
	) external returns (uint256 bountyId) {
		coordinator.validateOperationBounty(operation, msg.sender, targetVault, amount, validForSeconds);
		require(
			rewardToken == address(reputationToken) || rewardToken == address(weth),
			'Operation bounty reward token must be this coordinator REP or WETH'
		);
		require(rewardAmount > 0, 'Operation bounty reward must be positive');
		require(acceptanceDeadline > block.timestamp, 'Operation bounty acceptance deadline must be in the future');
		require(
			maximumInitialWeth == 0 || minimumInitialWeth <= maximumInitialWeth,
			'Operation bounty initial report bounds are invalid'
		);

		bountyId = nextOperationBountyId++;
		operationBounties[bountyId] = OperationBounty({
			creator: msg.sender,
			operator: address(0),
			operation: operation,
			targetVault: targetVault,
			amount: amount,
			validForSeconds: validForSeconds,
			rewardToken: rewardToken,
			rewardAmount: rewardAmount,
			acceptanceDeadline: acceptanceDeadline,
			minimumInitialWeth: minimumInitialWeth,
			maximumInitialWeth: maximumInitialWeth,
			operationId: 0,
			reportId: 0,
			state: OperationBountyState.Open
		});
		IERC20(rewardToken).safeTransferFrom(msg.sender, address(this), rewardAmount);
		emit OperationBountyPosted(
			bountyId,
			msg.sender,
			rewardToken,
			operation,
			targetVault,
			amount,
			validForSeconds,
			rewardAmount,
			acceptanceDeadline,
			minimumInitialWeth,
			maximumInitialWeth
		);
	}

	function acceptOperationBounty(
		uint256 bountyId,
		uint256 proposedRepPerEthPrice,
		uint256 requestedInitialWeth
	) external payable returns (uint256 operationId) {
		OperationBounty storage bounty = operationBounties[bountyId];
		require(bounty.state == OperationBountyState.Open, 'Operation bounty is not open');
		require(block.timestamp <= bounty.acceptanceDeadline, 'Operation bounty acceptance deadline has passed');
		if (!coordinator.isPriceValid()) {
			uint256 currentPendingReportId = coordinator.pendingReportId();
			if (currentPendingReportId == 0) {
				uint256 minimumWethReport = coordinator.minimumToken1Report();
				uint256 initialWethReport =
					requestedInitialWeth > minimumWethReport ? requestedInitialWeth : minimumWethReport;
				_validateInitialWeth(bounty, initialWethReport);
			} else {
				(uint128 currentInitialWeth, , , , , , ) = coordinator.openOracle().reportStatus(
					currentPendingReportId
				);
				_validateInitialWeth(bounty, currentInitialWeth);
			}
		}

		bounty.operator = msg.sender;
		bounty.state = OperationBountyState.Assigned;
		(operationId, bounty.reportId) = coordinator.stageAndRequestOperationBounty{ value: msg.value }(
			msg.sender,
			bounty.creator,
			bounty.operation,
			bounty.targetVault,
			bounty.amount,
			bounty.validForSeconds,
			proposedRepPerEthPrice,
			requestedInitialWeth
		);
		bounty.operationId = operationId;
		emit OperationBountyAccepted(bountyId, msg.sender, operationId, bounty.reportId);
	}

	function _validateInitialWeth(OperationBounty storage bounty, uint256 initialWeth) private view {
		require(initialWeth >= bounty.minimumInitialWeth, 'Initial report WETH amount is below the bounty minimum');
		if (bounty.maximumInitialWeth != 0) {
			require(initialWeth <= bounty.maximumInitialWeth, 'Initial report WETH amount exceeds the bounty maximum');
		}
	}

	function claimOperationBounty(uint256 bountyId) external {
		OperationBounty storage bounty = operationBounties[bountyId];
		require(bounty.state == OperationBountyState.Assigned, 'Operation bounty is not assigned');
		require(msg.sender == bounty.operator, 'Only the assigned operator can claim the operation bounty');
		(OperationExecutionStatus status, , ) = coordinator.operationExecutionResults(bounty.operationId);
		require(
			status == OperationExecutionStatus.Succeeded,
			'Operation bounty cannot be claimed before successful execution'
		);
		bounty.state = OperationBountyState.Paid;
		IERC20(bounty.rewardToken).safeTransfer(msg.sender, bounty.rewardAmount);
		emit OperationBountyClaimed(bountyId, msg.sender, bounty.rewardToken, bounty.rewardAmount);
	}

	function refundOperationBounty(uint256 bountyId) external {
		OperationBounty storage bounty = operationBounties[bountyId];
		require(msg.sender == bounty.creator, 'Only the bounty creator can refund the operation bounty');
		if (bounty.state == OperationBountyState.Assigned) {
			(OperationExecutionStatus status, , ) = coordinator.operationExecutionResults(bounty.operationId);
			if (status == OperationExecutionStatus.Pending) {
				coordinator.cancelExpiredOperationBounty(bounty.operationId);
			} else {
				require(status == OperationExecutionStatus.Failed, 'Successful operation bounty cannot be refunded');
			}
		} else {
			require(bounty.state == OperationBountyState.Open, 'Operation bounty cannot be refunded');
		}

		bounty.state = OperationBountyState.Refunded;
		IERC20(bounty.rewardToken).safeTransfer(bounty.creator, bounty.rewardAmount);
		emit OperationBountyRefunded(bountyId, bounty.creator, bounty.rewardToken, bounty.rewardAmount);
	}

	function getOperationBounties(
		uint256 startId,
		uint256 count
	) external view returns (uint256[] memory bountyIds, OperationBounty[] memory bounties) {
		if (startId == 0 || startId >= nextOperationBountyId || count == 0) {
			return (new uint256[](0), new OperationBounty[](0));
		}
		uint256 available = nextOperationBountyId - startId;
		uint256 resultCount = count < available ? count : available;
		bountyIds = new uint256[](resultCount);
		bounties = new OperationBounty[](resultCount);
		for (uint256 index = 0; index < resultCount; index++) {
			uint256 bountyId = startId + index;
			bountyIds[index] = bountyId;
			bounties[index] = operationBounties[bountyId];
		}
	}
}

contract OpenOracleOperationBountyBoardFactory {
	address public immutable owner;

	constructor() {
		owner = msg.sender;
	}

	function deploy(
		OpenOraclePriceCoordinator coordinator,
		ReputationToken reputationToken,
		IWeth9 weth,
		bytes32 salt
	) external returns (OpenOracleOperationBountyBoard board) {
		require(msg.sender == owner, 'Only the owner can deploy an operation bounty board');
		board = new OpenOracleOperationBountyBoard{ salt: keccak256(abi.encode(coordinator, salt)) }(
			coordinator,
			reputationToken,
			weth
		);
	}
}

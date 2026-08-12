// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../IERC20.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { IWeth9 } from './interfaces/IWeth9.sol';
import { OpenOraclePriceCoordinator, OperationType } from './OpenOraclePriceCoordinator.sol';

interface IStoredOpenOracleBountyGame {
	function storedGame(uint256 reportId)
		external
		view
		returns (
			uint128 currentAmount1,
			uint128 currentAmount2,
			address currentReporter,
			uint48 reportTimestamp,
			uint48 settlementTimestamp
		);
}

enum OperationBountyState {
	None,
	Open,
	Assigned,
	Paid,
	Refunded
}

enum OperationExecutionStatus {
	None,
	Pending,
	Succeeded,
	Failed
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
	uint256 minimumInitialAttoWeth;
	uint256 maximumInitialAttoWeth;
	uint256 operationId;
	uint256 reportId;
	OperationBountyState state;
}

contract OpenOracleOperationBountyBoard {
	using SafeERC20Ops for IERC20;

	OpenOraclePriceCoordinator public coordinator;
	ReputationToken public reputationToken;
	IWeth9 public weth;
	uint256 public nextOperationBountyId;
	mapping(uint256 => OperationBounty) public operationBounties;
	mapping(uint256 => OperationExecutionStatus) public operationExecutionStatuses;
	bool private initialized;

	event OperationBountyPosted(uint256 indexed bountyId, address indexed creator, address indexed rewardToken, OperationType operation, address targetVault, uint256 amount, uint256 validForSeconds, uint256 rewardAmount, uint256 acceptanceDeadline, uint256 minimumInitialAttoWeth, uint256 maximumInitialAttoWeth);
	event OperationBountyAccepted(uint256 indexed bountyId, address indexed operator, uint256 indexed operationId, uint256 reportId);
	event OperationBountyClaimed(uint256 indexed bountyId, address indexed operator, address indexed rewardToken, uint256 rewardAmount);
	event OperationBountyRefunded(uint256 indexed bountyId, address indexed creator, address indexed rewardToken, uint256 rewardAmount);

	constructor() {
		initialized = true;
	}

	function initialize(OpenOraclePriceCoordinator _coordinator, ReputationToken _reputationToken, IWeth9 _weth) external {
		require(!initialized, 'Operation bounty board is already initialized');
		require(address(_coordinator) != address(0) && address(_reputationToken) != address(0) && address(_weth) != address(0), 'Invalid operation bounty board setup');
		initialized = true;
		coordinator = _coordinator;
		reputationToken = _reputationToken;
		weth = _weth;
		nextOperationBountyId = 1;
	}

	function postOperationBounty(OperationType operation, address targetVault, uint256 amount, uint256 validForSeconds, address rewardToken, uint256 rewardAmount, uint256 acceptanceDeadline, uint256 minimumInitialAttoWeth, uint256 maximumInitialAttoWeth) external returns (uint256 bountyId) {
		require(amount > 0 && validForSeconds > 0 && validForSeconds <= 5 minutes, 'Invalid bounty operation');
		require(operation == OperationType.Liquidation ? targetVault != msg.sender : targetVault == msg.sender, 'Invalid bounty target');
		require(rewardToken == address(reputationToken) || rewardToken == address(weth), 'Operation bounty reward token must be this coordinator REP or WETH');
		require(rewardAmount > 0, 'Operation bounty reward must be positive');
		require(acceptanceDeadline > block.timestamp, 'Operation bounty acceptance deadline must be in the future');
		require(maximumInitialAttoWeth == 0 || minimumInitialAttoWeth <= maximumInitialAttoWeth, 'Operation bounty initial report bounds are invalid');

		bountyId = nextOperationBountyId++;
		operationBounties[bountyId] = OperationBounty({creator: msg.sender, operator: address(0), operation: operation, targetVault: targetVault, amount: amount, validForSeconds: validForSeconds, rewardToken: rewardToken, rewardAmount: rewardAmount, acceptanceDeadline: acceptanceDeadline, minimumInitialAttoWeth: minimumInitialAttoWeth, maximumInitialAttoWeth: maximumInitialAttoWeth, operationId: 0, reportId: 0, state: OperationBountyState.Open});
		IERC20(rewardToken).safeTransferFrom(msg.sender, address(this), rewardAmount);
		emit OperationBountyPosted(bountyId, msg.sender, rewardToken, operation, targetVault, amount, validForSeconds, rewardAmount, acceptanceDeadline, minimumInitialAttoWeth, maximumInitialAttoWeth);
	}

	function acceptOperationBounty(uint256 bountyId, uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth) external payable returns (uint256 operationId) {
		OperationBounty storage bounty = operationBounties[bountyId];
		require(bounty.state == OperationBountyState.Open, 'Operation bounty is not open');
		require(block.timestamp <= bounty.acceptanceDeadline, 'Operation bounty acceptance deadline has passed');
		if (!coordinator.isPriceValid()) {
			uint256 currentPendingReportId = coordinator.pendingReportId();
			if (currentPendingReportId == 0) {
				uint256 minimumReportAttoWeth = coordinator.minimumToken1ReportAttoEth();
				uint256 initialReportAttoWeth =
					requestedInitialAttoWeth > minimumReportAttoWeth ? requestedInitialAttoWeth : minimumReportAttoWeth;
				_validateInitialAttoWeth(bounty, initialReportAttoWeth);
			} else {
				(uint128 currentInitialAttoWeth, , , , ) = IStoredOpenOracleBountyGame(address(coordinator.openOracle())).storedGame(currentPendingReportId);
				_validateInitialAttoWeth(bounty, currentInitialAttoWeth);
			}
		}

		bounty.operator = msg.sender;
		bounty.state = OperationBountyState.Assigned;
		operationExecutionStatuses[bountyId] = OperationExecutionStatus.Pending;
		(operationId, bounty.reportId) = coordinator.stageAndRequestOperationBounty{value: msg.value}(bountyId, msg.sender, bounty.creator, bounty.operation, bounty.targetVault, bounty.amount, bounty.validForSeconds, proposedRepPerEthPrice, requestedInitialAttoWeth);
		bounty.operationId = operationId;
		emit OperationBountyAccepted(bountyId, msg.sender, operationId, bounty.reportId);
	}

	function _validateInitialAttoWeth(OperationBounty storage bounty, uint256 initialAttoWeth) private view {
		require(initialAttoWeth >= bounty.minimumInitialAttoWeth, 'Initial report WETH amount is below the bounty minimum');
		if (bounty.maximumInitialAttoWeth != 0) {
			require(initialAttoWeth <= bounty.maximumInitialAttoWeth, 'Initial report WETH amount exceeds the bounty maximum');
		}
	}

	function claimOperationBounty(uint256 bountyId) external {
		OperationBounty storage bounty = operationBounties[bountyId];
		require(bounty.state == OperationBountyState.Assigned, 'Operation bounty is not assigned');
		require(msg.sender == bounty.operator, 'Only the assigned operator can claim the operation bounty');
		require(operationExecutionStatuses[bountyId] == OperationExecutionStatus.Succeeded, 'Operation bounty cannot be claimed before successful execution');
		bounty.state = OperationBountyState.Paid;
		IERC20(bounty.rewardToken).safeTransfer(msg.sender, bounty.rewardAmount);
		emit OperationBountyClaimed(bountyId, msg.sender, bounty.rewardToken, bounty.rewardAmount);
	}

	function refundOperationBounty(uint256 bountyId) external {
		OperationBounty storage bounty = operationBounties[bountyId];
		require(msg.sender == bounty.creator, 'Only the bounty creator can refund the operation bounty');
		if (bounty.state == OperationBountyState.Assigned) {
			OperationExecutionStatus status = operationExecutionStatuses[bountyId];
			if (status == OperationExecutionStatus.Pending) {
				coordinator.expireStagedOperation(bounty.operationId);
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

	function recordOperationResult(uint256 bountyId, bool success) external {
		require(msg.sender == address(coordinator), 'Only coordinator');
		require(operationBounties[bountyId].state == OperationBountyState.Assigned, 'Operation bounty is not assigned');
		operationExecutionStatuses[bountyId] =
			success ? OperationExecutionStatus.Succeeded : OperationExecutionStatus.Failed;
	}

	function getOperationBounties(uint256 startId, uint256 count) external view returns (uint256[] memory bountyIds, OperationBounty[] memory bounties) {
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
	OpenOracleOperationBountyBoard public implementation;

	constructor() {
		owner = msg.sender;
	}

	function deploy(OpenOraclePriceCoordinator coordinator, ReputationToken reputationToken, IWeth9 weth, bytes32 salt) external returns (OpenOracleOperationBountyBoard board) {
		require(msg.sender == owner, 'Only the owner can deploy an operation bounty board');
		OpenOracleOperationBountyBoard currentImplementation = implementation;
		if (address(currentImplementation) == address(0)) {
			currentImplementation = new OpenOracleOperationBountyBoard();
			implementation = currentImplementation;
		}
		bytes memory initCode = abi.encodePacked(hex'3d602d80600a3d3981f3', hex'363d3d373d3d3d363d73', address(currentImplementation), hex'5af43d82803e903d91602b57fd5bf3');
		address deployed;
		bytes32 deploymentSalt = keccak256(abi.encode(coordinator, salt));
		assembly ('memory-safe') {
			deployed := create2(0, add(initCode, 0x20), mload(initCode), deploymentSalt)
		}
		require(deployed != address(0), 'Operation bounty board deployment failed');
		board = OpenOracleOperationBountyBoard(deployed);
		board.initialize(coordinator, reputationToken, weth);
	}
}

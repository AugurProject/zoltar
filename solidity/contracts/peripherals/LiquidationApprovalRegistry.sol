// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SignatureValidation } from './SignatureValidation.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';

interface ILiquidationApprovalCoordinator {
	function securityPool() external view returns (address);
}

struct LiquidationApprovalParams {
	address securityPool;
	address receiverVault;
	address operator;
	address targetVault;
	uint256 maxCumulativeDebtAttoEth;
	uint256 maxDebtPerLiquidationAttoEth;
	uint256 minPostLiquidationHealthFactorBps;
	uint256 validAfter;
	uint256 validUntil;
	uint256 nonce;
}

struct LiquidationApprovalState {
	LiquidationApprovalParams params;
	uint256 availableDebtAttoEth;
	uint256 reservedDebtAttoEth;
	uint256 consumedDebtAttoEth;
	bool revoked;
}

struct LiquidationReservation {
	bytes32 approvalId;
	uint256 reservedDebtAttoEth;
	bool settled;
}

contract LiquidationApprovalRegistry {
	using SignatureValidation for address;

	address public coordinator;
	bytes32 public constant LIQUIDATION_APPROVAL_TYPEHASH = keccak256(
		'LiquidationApproval(address securityPool,address receiverVault,address operator,address targetVault,uint256 maxCumulativeDebtAttoEth,uint256 maxDebtPerLiquidationAttoEth,uint256 minPostLiquidationHealthFactorBps,uint256 validAfter,uint256 validUntil,uint256 nonce)'
	);
	bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(
		'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'
	);
	bytes32 private constant EIP712_NAME_HASH = keccak256('Statoblast Liquidation Approvals');
	bytes32 private constant EIP712_VERSION_HASH = keccak256('1');

	mapping(bytes32 => LiquidationApprovalState) private liquidationApprovals;
	mapping(address => mapping(uint256 => bool)) private usedLiquidationApprovalNonces;
	mapping(address => uint256) public minimumLiquidationApprovalNonce;
	mapping(uint256 => LiquidationReservation) public liquidationReservations;

	event LiquidationApprovalSet(
		bytes32 indexed approvalId,
		address indexed receiverVault,
		address indexed operator,
		address securityPool,
		address targetVault,
		uint256 maxCumulativeDebtAttoEth,
		uint256 maxDebtPerLiquidationAttoEth,
		uint256 minPostLiquidationHealthFactorBps,
		uint256 validAfter,
		uint256 validUntil,
		uint256 nonce
	);
	event LiquidationApprovalRevoked(
		bytes32 indexed approvalId,
		address indexed receiverVault,
		uint256 availableDebtAttoEth,
		uint256 reservedDebtAttoEth,
		uint256 consumedDebtAttoEth
	);
	event LiquidationApprovalNonceInvalidated(address indexed receiverVault, uint256 previousNonce, uint256 newNonce);
	event LiquidationApprovalReserved(
		bytes32 indexed approvalId,
		uint256 indexed operationId,
		uint256 reservedDebtAttoEth,
		uint256 resultingAvailableDebtAttoEth,
		uint256 resultingReservedDebtAttoEth
	);
	event LiquidationApprovalReleased(
		bytes32 indexed approvalId,
		uint256 indexed operationId,
		uint256 releasedDebtAttoEth,
		uint256 resultingAvailableDebtAttoEth,
		uint256 resultingReservedDebtAttoEth
	);
	event LiquidationApprovalConsumed(
		bytes32 indexed approvalId,
		uint256 indexed operationId,
		uint256 consumedDebtAttoEth,
		uint256 releasedDebtAttoEth,
		uint256 resultingAvailableDebtAttoEth,
		uint256 resultingReservedDebtAttoEth,
		uint256 resultingConsumedDebtAttoEth
	);

	modifier onlyCoordinator() {
		require(msg.sender == coordinator, 'Only coordinator');
		_;
	}

	function initialize(address _coordinator) external {
		require(coordinator == address(0) && _coordinator != address(0), 'Registry already initialized');
		coordinator = _coordinator;
	}

	function DOMAIN_SEPARATOR() public view returns (bytes32) {
		return
			keccak256(
				abi.encode(EIP712_DOMAIN_TYPEHASH, EIP712_NAME_HASH, EIP712_VERSION_HASH, block.chainid, address(this))
			);
	}

	function liquidationApprovalDigest(LiquidationApprovalParams calldata params) public view returns (bytes32) {
		return keccak256(abi.encodePacked('\x19\x01', DOMAIN_SEPARATOR(), _structHash(params)));
	}

	function getLiquidationApproval(bytes32 approvalId) external view returns (LiquidationApprovalState memory) {
		return liquidationApprovals[approvalId];
	}

	function setLiquidationApproval(LiquidationApprovalParams calldata params) external returns (bytes32 approvalId) {
		require(msg.sender == params.receiverVault, 'Only receiver vault');
		return _install(params);
	}

	function permitLiquidationApproval(
		LiquidationApprovalParams calldata params,
		bytes calldata signature
	) external returns (bytes32 approvalId) {
		require(
			params.receiverVault.isValidSignatureNow(liquidationApprovalDigest(params), signature),
			'Invalid signature'
		);
		return _install(params);
	}

	function revokeLiquidationApproval(bytes32 approvalId) external {
		LiquidationApprovalState storage approval = liquidationApprovals[approvalId];
		require(approval.params.receiverVault == msg.sender, 'Only receiver vault');
		require(!approval.revoked, 'Approval revoked');
		approval.revoked = true;
		emit LiquidationApprovalRevoked(
			approvalId,
			msg.sender,
			approval.availableDebtAttoEth,
			approval.reservedDebtAttoEth,
			approval.consumedDebtAttoEth
		);
	}

	function invalidateLiquidationApprovalNonce(uint256 newNonce) external {
		uint256 previousNonce = minimumLiquidationApprovalNonce[msg.sender];
		require(newNonce > previousNonce, 'Nonce must increase');
		minimumLiquidationApprovalNonce[msg.sender] = newNonce;
		emit LiquidationApprovalNonceInvalidated(msg.sender, previousNonce, newNonce);
	}

	function reserve(
		uint256 operationId,
		bytes32 approvalId,
		address receiverVault,
		address targetVault,
		address operator,
		uint256 requestedDebtAttoEth,
		uint256 snapshotTargetDebtAttoEth,
		uint256 latestExecutionTimestamp
	) external onlyCoordinator returns (uint256 reservedDebtAttoEth) {
		LiquidationApprovalState storage approval = liquidationApprovals[approvalId];
		LiquidationApprovalParams storage params = approval.params;
		require(params.receiverVault == receiverVault, 'Wrong receiver');
		require(params.operator == operator, 'Wrong operator');
		require(params.securityPool == ILiquidationApprovalCoordinator(coordinator).securityPool(), 'Wrong pool');
		require(params.targetVault == address(0) || params.targetVault == targetVault, 'Wrong target');
		require(!approval.revoked, 'Approval revoked');
		require(params.nonce >= minimumLiquidationApprovalNonce[receiverVault], 'Nonce invalidated');
		require(block.timestamp >= params.validAfter, 'Approval not active');
		require(latestExecutionTimestamp <= params.validUntil, 'Approval expires early');
		reservedDebtAttoEth = requestedDebtAttoEth;
		if (reservedDebtAttoEth > snapshotTargetDebtAttoEth) reservedDebtAttoEth = snapshotTargetDebtAttoEth;
		if (reservedDebtAttoEth > params.maxDebtPerLiquidationAttoEth)
			reservedDebtAttoEth = params.maxDebtPerLiquidationAttoEth;
		if (reservedDebtAttoEth > approval.availableDebtAttoEth) reservedDebtAttoEth = approval.availableDebtAttoEth;
		require(reservedDebtAttoEth > 0, 'Quota unavailable');
		approval.availableDebtAttoEth -= reservedDebtAttoEth;
		approval.reservedDebtAttoEth += reservedDebtAttoEth;
		liquidationReservations[operationId] = LiquidationReservation(approvalId, reservedDebtAttoEth, false);
		emit LiquidationApprovalReserved(
			approvalId,
			operationId,
			reservedDebtAttoEth,
			approval.availableDebtAttoEth,
			approval.reservedDebtAttoEth
		);
	}

	function release(uint256 operationId) external onlyCoordinator {
		LiquidationReservation storage reservation = liquidationReservations[operationId];
		if (reservation.approvalId == bytes32(0) || reservation.settled) return;
		reservation.settled = true;
		LiquidationApprovalState storage approval = liquidationApprovals[reservation.approvalId];
		approval.reservedDebtAttoEth -= reservation.reservedDebtAttoEth;
		approval.availableDebtAttoEth += reservation.reservedDebtAttoEth;
		emit LiquidationApprovalReleased(
			reservation.approvalId,
			operationId,
			reservation.reservedDebtAttoEth,
			approval.availableDebtAttoEth,
			approval.reservedDebtAttoEth
		);
	}

	function consume(uint256 operationId, uint256 debtMovedAttoEth) external onlyCoordinator {
		LiquidationReservation storage reservation = liquidationReservations[operationId];
		if (reservation.approvalId == bytes32(0)) return;
		require(!reservation.settled && debtMovedAttoEth <= reservation.reservedDebtAttoEth, 'Reservation invalid');
		reservation.settled = true;
		LiquidationApprovalState storage approval = liquidationApprovals[reservation.approvalId];
		uint256 releasedDebtAttoEth = reservation.reservedDebtAttoEth - debtMovedAttoEth;
		approval.reservedDebtAttoEth -= reservation.reservedDebtAttoEth;
		approval.consumedDebtAttoEth += debtMovedAttoEth;
		approval.availableDebtAttoEth += releasedDebtAttoEth;
		emit LiquidationApprovalConsumed(
			reservation.approvalId,
			operationId,
			debtMovedAttoEth,
			releasedDebtAttoEth,
			approval.availableDebtAttoEth,
			approval.reservedDebtAttoEth,
			approval.consumedDebtAttoEth
		);
	}

	function minimumHealthFactorBps(uint256 operationId) external view returns (uint256) {
		bytes32 approvalId = liquidationReservations[operationId].approvalId;
		return
			approvalId == bytes32(0)
				? SecurityPoolUtils.BPS_DENOMINATOR
				: liquidationApprovals[approvalId].params.minPostLiquidationHealthFactorBps;
	}

	function _install(LiquidationApprovalParams calldata params) private returns (bytes32 approvalId) {
		require(params.securityPool == ILiquidationApprovalCoordinator(coordinator).securityPool(), 'Wrong pool');
		require(params.receiverVault != address(0) && params.operator != address(0), 'Zero role');
		require(params.maxCumulativeDebtAttoEth > 0 && params.maxDebtPerLiquidationAttoEth > 0, 'Limit zero');
		require(params.maxDebtPerLiquidationAttoEth <= params.maxCumulativeDebtAttoEth, 'Per operation high');
		require(params.minPostLiquidationHealthFactorBps >= SecurityPoolUtils.BPS_DENOMINATOR, 'Health factor low');
		require(params.validUntil > params.validAfter, 'Window invalid');
		require(params.validUntil > block.timestamp, 'Approval expired');
		require(params.nonce >= minimumLiquidationApprovalNonce[params.receiverVault], 'Nonce invalidated');
		require(!usedLiquidationApprovalNonces[params.receiverVault][params.nonce], 'Nonce used');
		approvalId = _structHash(params);
		require(liquidationApprovals[approvalId].params.receiverVault == address(0), 'Approval exists');
		usedLiquidationApprovalNonces[params.receiverVault][params.nonce] = true;
		LiquidationApprovalState storage approval = liquidationApprovals[approvalId];
		approval.params = params;
		approval.availableDebtAttoEth = params.maxCumulativeDebtAttoEth;
		emit LiquidationApprovalSet(
			approvalId,
			params.receiverVault,
			params.operator,
			params.securityPool,
			params.targetVault,
			params.maxCumulativeDebtAttoEth,
			params.maxDebtPerLiquidationAttoEth,
			params.minPostLiquidationHealthFactorBps,
			params.validAfter,
			params.validUntil,
			params.nonce
		);
	}

	function _structHash(LiquidationApprovalParams calldata params) private pure returns (bytes32) {
		return
			keccak256(
				abi.encode(
					LIQUIDATION_APPROVAL_TYPEHASH,
					params.securityPool,
					params.receiverVault,
					params.operator,
					params.targetVault,
					params.maxCumulativeDebtAttoEth,
					params.maxDebtPerLiquidationAttoEth,
					params.minPostLiquidationHealthFactorBps,
					params.validAfter,
					params.validUntil,
					params.nonce
				)
			);
	}
}

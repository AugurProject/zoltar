// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { DeploymentStatusOracle } from '../../DeploymentStatusOracle.sol';
import { IERC20 } from '../../IERC20.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { SafeERC20Ops } from '../../SafeERC20Ops.sol';
import { ScalarOutcomes } from '../../ScalarOutcomes.sol';
import { BinaryOutcomes } from '../../peripherals/BinaryOutcomes.sol';
import { EscalationGame } from '../../peripherals/EscalationGame.sol';
import { EscalationGameProofVerifier } from '../../peripherals/EscalationGameProofVerifier.sol';
import { MERKLE_MOUNTAIN_RANGE_MAX_PEAKS } from '../../peripherals/EscalationGameTypes.sol';
import { MerkleMountainRange } from '../../peripherals/MerkleMountainRange.sol';
import { EscalationGameFactory } from '../../peripherals/factories/EscalationGameFactory.sol';
import { ERC1155 } from '../../peripherals/tokens/ERC1155.sol';
import { TokenId } from '../../peripherals/tokens/TokenId.sol';

contract ERC1155CoverageHarness is ERC1155 {
	function mintOne(address to, uint256 id, uint256 value) external {
		_mint(to, id, value);
	}

	function mintMany(address to, uint256[] memory ids, uint256[] memory values) external {
		_mintBatch(to, ids, values);
	}

	function burnOne(address account, uint256 id, uint256 value) external {
		_burn(account, id, value);
	}

	function burnMany(address account, uint256[] memory ids, uint256[] memory values) external {
		_burnBatch(account, ids, values);
	}

	function transferWithLegacyHelper(address from, address to, uint256 id, uint256 value) external {
		_transferFrom(from, to, id, value);
	}

	function internalTransferWithLegacyHelper(address from, address to, uint256 id, uint256 value) external {
		_internalTransferFrom(from, to, id, value);
	}

	function batchTransferWithLegacyHelper(
		address from,
		address to,
		uint256[] memory ids,
		uint256[] memory values
	) external {
		_batchTransferFrom(from, to, ids, values);
	}

	function internalBatchTransferWithLegacyHelper(
		address from,
		address to,
		uint256[] memory ids,
		uint256[] memory values
	) external {
		_internalBatchTransferFrom(from, to, ids, values);
	}
}

contract CoverageAttributionExecuted {
	function select(bool firstBranch) external pure returns (uint256) {
		if (firstBranch) {
			uint256 executedValue = 11;
			return executedValue;
		}
		uint256 unreachableValue = 19;
		return unreachableValue;
	}
}

contract CoverageAttributionDecoy {
	function select(bool firstBranch) external pure returns (uint256) {
		if (firstBranch) {
			uint256 decoyValue = 23;
			return decoyValue;
		}
		uint256 unreachableDecoyValue = 29;
		return unreachableDecoyValue;
	}
}

contract EscalationGameFactoryCoverageSecurityPool {
	ReputationToken public immutable repToken;

	constructor(ReputationToken configuredRepToken) {
		repToken = configuredRepToken;
	}

	function deployStartedGame(
		EscalationGameFactory factory,
		uint256 startBond,
		uint256 nonDecisionThreshold
	) external returns (EscalationGame) {
		return factory.deployEscalationGame(startBond, nonDecisionThreshold);
	}

	function deployForkedGame(
		EscalationGameFactory factory,
		uint256 startBond,
		uint256 nonDecisionThreshold,
		uint256 elapsedAtFork
	) external returns (EscalationGame) {
		return factory.deployEscalationGameFromFork(startBond, nonDecisionThreshold, elapsedAtFork);
	}
}

contract CoverageHelpersHarness {
	using SafeERC20Ops for IERC20;

	EscalationGameProofVerifier private immutable proofVerifier;

	constructor() {
		proofVerifier = new EscalationGameProofVerifier();
	}

	function deployDeploymentStatusOracle(
		address[] memory deploymentAddresses
	) external returns (DeploymentStatusOracle) {
		return new DeploymentStatusOracle(deploymentAddresses);
	}

	function safeApproveToken(IERC20 token, address spender, uint256 amount) external {
		token.safeApprove(spender, amount);
	}

	function safeTransferToken(IERC20 token, address receiver, uint256 amount) external {
		token.safeTransfer(receiver, amount);
	}

	function safeTransferFromToken(IERC20 token, address sender, address receiver, uint256 amount) external {
		token.safeTransferFrom(sender, receiver, amount);
	}

	function getTokenId(uint248 universeId, BinaryOutcomes.BinaryOutcome outcome) external pure returns (uint256) {
		return TokenId.getTokenId(universeId, outcome);
	}

	function getTokenIds(
		uint248 universeId,
		BinaryOutcomes.BinaryOutcome[] calldata outcomes
	) external pure returns (uint256[] memory) {
		return TokenId.getTokenIds(universeId, outcomes);
	}

	function unpackTokenId(
		uint256 tokenId
	) external pure returns (uint248 universe, BinaryOutcomes.BinaryOutcome outcome) {
		return TokenId.unpackTokenId(tokenId);
	}

	function hashLeaf(
		address depositor,
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 amount,
		uint256 parentDepositIndex,
		uint256 cumulativeAmount,
		uint256 sourceNodeId
	) external pure returns (bytes32) {
		return
			MerkleMountainRange.hashLeaf(
				depositor,
				outcome,
				amount,
				parentDepositIndex,
				cumulativeAmount,
				sourceNodeId
			);
	}

	function hashParent(bytes32 left, bytes32 right) external pure returns (bytes32) {
		return MerkleMountainRange.hashParent(left, right);
	}

	function bagPeaks(bytes32[] memory peaks, uint256 peakCount) external pure returns (bytes32) {
		return MerkleMountainRange.bagPeaks(peaks, peakCount);
	}

	function computeEmptyNullifierRoot() external view returns (bytes32) {
		return proofVerifier.computeEmptyNullifierRoot();
	}

	function getCurrentCarryPeakForLeaf(
		uint256 leafCount,
		uint256 leafIndex
	) external view returns (uint256 peakHeight, uint256 peakStartIndex) {
		return proofVerifier.getCurrentCarryPeakForLeaf(leafCount, leafIndex);
	}

	function bagCarryPeaks(
		bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS] memory peakHashes,
		uint256 leafCount
	) external view returns (bytes32) {
		return proofVerifier.bagCarryPeaks(peakHashes, leafCount);
	}

	function bagCarryPeakSamples(
		bytes32 firstPeakHash,
		bytes32 secondPeakHash,
		uint256 leafCount
	) external view returns (bytes32) {
		bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS] memory peakHashes;
		peakHashes[0] = firstPeakHash;
		peakHashes[1] = secondPeakHash;
		return proofVerifier.bagCarryPeaks(peakHashes, leafCount);
	}

	function computeMerkleMountainRangeRootFromProof(
		bytes32 leafHash,
		uint256 leafCount,
		uint256 leafIndex,
		uint256 peakHeight,
		bytes32[] calldata siblings
	) external view returns (bytes32) {
		return
			proofVerifier.computeMerkleMountainRangeRootFromProof(leafHash, leafCount, leafIndex, peakHeight, siblings);
	}

	function computeNullifierRoot(
		uint256 parentDepositIndex,
		bytes32[] calldata siblings,
		bytes32 leafValue
	) external view returns (bytes32) {
		return proofVerifier.computeNullifierRoot(parentDepositIndex, siblings, leafValue);
	}

	function getScalarOutcomeName(
		uint120[2] memory payoutNumerators,
		string memory unit,
		uint256 numTicks,
		int256 minValue,
		int256 maxValue
	) external pure returns (string memory) {
		return ScalarOutcomes.getScalarOutcomeName(payoutNumerators, unit, numTicks, minValue, maxValue);
	}

	function addInt256Uint256(int256 value, uint256 addend) external pure returns (int256) {
		return ScalarOutcomes.addInt256Uint256(value, addend);
	}

	function absoluteInt256(int256 value) external pure returns (uint256) {
		return ScalarOutcomes.absoluteInt256(value);
	}

	function mulDiv(uint256 x, uint256 y, uint256 denominator) external pure returns (uint256) {
		return ScalarOutcomes.mulDiv(x, y, denominator);
	}

	function intToDecimalString(int256 value, uint256 decimals) external pure returns (string memory) {
		return ScalarOutcomes.intToDecimalString(value, decimals);
	}

	function zeroPadLeft(string memory value, uint256 totalLength) external pure returns (string memory) {
		return ScalarOutcomes.zeroPadLeft(value, totalLength);
	}

	function uintToString(uint256 value) external pure returns (string memory) {
		return ScalarOutcomes.uintToString(value);
	}
}

// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool } from '../interfaces/ISecurityPool.sol';
import { EscalationGame } from '../EscalationGame.sol';
import { EscalationGameProofVerifier } from '../EscalationGameProofVerifier.sol';
import { BinaryOutcomes } from '../BinaryOutcomes.sol';
import { EscalationGameClaimDelegate } from '../EscalationGameClaimDelegate.sol';
import { ISecurityPoolForker } from '../interfaces/ISecurityPoolForker.sol';

contract EscalationGameFactory {
	uint256 private constant CREATION_CODE_CHUNK_SIZE = 24_000;

	EscalationGameProofVerifier public immutable proofVerifier;
	EscalationGameClaimDelegate public immutable claimDelegate;
	address private immutable escalationGameCreationCodePartOne;
	address private immutable escalationGameCreationCodePartTwo;

	constructor(EscalationGameClaimDelegate _claimDelegate) {
		require(address(_claimDelegate).code.length > 0, 'Claim delegate');
		claimDelegate = _claimDelegate;
		proofVerifier = new EscalationGameProofVerifier();
		bytes memory creationCode = type(EscalationGame).creationCode;
		uint256 firstPartLength =
			creationCode.length < CREATION_CODE_CHUNK_SIZE ? creationCode.length : CREATION_CODE_CHUNK_SIZE;
		escalationGameCreationCodePartOne = _deployCodePart(creationCode, 0, firstPartLength);
		escalationGameCreationCodePartTwo = _deployCodePart(
			creationCode,
			firstPartLength,
			creationCode.length - firstPartLength
		);
	}

	function _deployCodePart(
		bytes memory completeCode,
		uint256 offset,
		uint256 length
	) private returns (address codePart) {
		require(length <= CREATION_CODE_CHUNK_SIZE, 'Creation code chunk too large');
		bytes memory part = new bytes(length);
		assembly {
			mcopy(add(part, 0x20), add(add(completeCode, 0x20), offset), length)
		}
		bytes memory deployCode = abi.encodePacked(
			hex'61',
			bytes2(uint16(length)),
			hex'600e60003961',
			bytes2(uint16(length)),
			hex'6000f3',
			part
		);
		assembly {
			codePart := create(0, add(deployCode, 0x20), mload(deployCode))
		}
		require(codePart != address(0x0), 'Creation code chunk deployment failed');
	}

	function deployEscalationGame(uint256 startBond, uint256 _nonDecisionThreshold) external returns (EscalationGame) {
		require(_nonDecisionThreshold > 1, 'Escalation threshold too low');
		if (startBond >= _nonDecisionThreshold) startBond = _nonDecisionThreshold - 1;
		EscalationGame gameImplementation = _deployEscalationGame();
		gameImplementation.start(startBond, _nonDecisionThreshold);
		return gameImplementation;
	}

	function deployEscalationGameFromFork(
		uint256 startBond,
		uint256 nonDecisionThreshold,
		uint256 elapsedAtFork,
		BinaryOutcomes.BinaryOutcome fixedQuestionOutcome
	) external returns (EscalationGame) {
		ISecurityPool child = ISecurityPool(payable(msg.sender));
		ISecurityPool parent = child.parent();
		bool winnerHaircutPaidByFork;
		uint256 forkCarryInitialBacking;
		if (address(parent) != address(0x0)) {
			ISecurityPoolForker forker = ISecurityPoolForker(child.securityPoolForker());
			winnerHaircutPaidByFork = forker.isEscalationWinnerHaircutPaidByFork(parent);
			(, forkCarryInitialBacking, ) = forker.getOwnForkRepBuckets(parent);
		}
		EscalationGame gameImplementation = _deployEscalationGame();
		gameImplementation.startFromFork(
			startBond,
			nonDecisionThreshold,
			elapsedAtFork,
			fixedQuestionOutcome,
			winnerHaircutPaidByFork,
			forkCarryInitialBacking
		);
		return gameImplementation;
	}

	function _deployEscalationGame() private returns (EscalationGame gameImplementation) {
		ISecurityPool securityPool = ISecurityPool(payable(msg.sender));
		address partOne = escalationGameCreationCodePartOne;
		address partTwo = escalationGameCreationCodePartTwo;
		uint256 partOneLength;
		uint256 partTwoLength;
		assembly {
			partOneLength := extcodesize(partOne)
			partTwoLength := extcodesize(partTwo)
		}
		bytes memory creationCode = new bytes(partOneLength + partTwoLength);
		assembly {
			extcodecopy(partOne, add(creationCode, 0x20), 0, partOneLength)
			extcodecopy(partTwo, add(add(creationCode, 0x20), partOneLength), 0, partTwoLength)
		}
		// Code storage is cheaper to deploy and read than one storage slot per 32-byte
		// word, while two fixed parts keep each carrier below EIP-170.
		bytes memory initCode = abi.encodePacked(
			creationCode,
			abi.encode(securityPool, securityPool.repToken(), proofVerifier, claimDelegate)
		);
		address deployed;
		assembly {
			deployed := create2(0, add(initCode, 0x20), mload(initCode), 0)
			if iszero(deployed) {
				let revertDataSize := returndatasize()
				if gt(revertDataSize, 0) {
					returndatacopy(0, 0, revertDataSize)
					revert(0, revertDataSize)
				}
			}
		}
		require(deployed != address(0x0), 'Escalation game deployment failed');
		gameImplementation = EscalationGame(deployed);
	}
}

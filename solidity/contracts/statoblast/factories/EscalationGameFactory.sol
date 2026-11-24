// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { EscalationGameRepCustody } from '../EscalationGameRepCustody.sol';
import { SecurityPoolReporterLedger } from '../SecurityPoolReporterLedger.sol';
import { ISecurityPoolNative } from '../interfaces/ISecurityPoolNative.sol';
import { IQuestionLedger } from '../interfaces/IQuestionLedger.sol';
import { EscalationGame } from '../EscalationGame.sol';
import { EscalationGameProofVerifier } from '../EscalationGameProofVerifier.sol';
import { BinaryOutcomes } from '../BinaryOutcomes.sol';
import { EscalationGameDepositDelegate } from '../EscalationGameDepositDelegate.sol';
import { Create2Deployment } from './Create2Deployment.sol';

contract EscalationGameFactory {
	uint256 private constant CREATION_CODE_CHUNK_SIZE = 24_000;

	EscalationGameProofVerifier public immutable proofVerifier;
	EscalationGameDepositDelegate public immutable depositDelegate;
	address private immutable escalationGameCreationCodePartOne;
	address private immutable escalationGameCreationCodePartTwo;

	constructor(EscalationGameDepositDelegate _depositDelegate) {
		require(address(_depositDelegate).code.length > 0, 'Deposit delegate');
		proofVerifier = new EscalationGameProofVerifier();
		bytes memory creationCode = type(EscalationGame).creationCode;
		uint256 firstPartLength =
			creationCode.length < CREATION_CODE_CHUNK_SIZE ? creationCode.length : CREATION_CODE_CHUNK_SIZE;
		escalationGameCreationCodePartOne = _deployCodePart(creationCode, 0, firstPartLength);
		escalationGameCreationCodePartTwo = _deployCodePart(creationCode, firstPartLength, creationCode.length - firstPartLength);
		// Stateless delegate code is shared by every game; game storage stays isolated through delegatecall.
		depositDelegate = _depositDelegate;
	}

	function _deployCodePart(bytes memory completeCode, uint256 offset, uint256 length) private returns (address codePart) {
		require(length <= CREATION_CODE_CHUNK_SIZE, 'Creation code chunk too large');
		bytes memory part = new bytes(length);
		assembly {
			mcopy(add(part, 0x20), add(add(completeCode, 0x20), offset), length)
		}
		// The carrier starts with STOP: it can never execute, and a chunk that happens
		// to begin with 0xEF cannot make its deployment fail under EIP-3541.
		uint16 carrierLength = uint16(length + 1);
		bytes memory deployCode = abi.encodePacked(hex'61', bytes2(carrierLength), hex'600e60003961', bytes2(carrierLength), hex'6000f3', hex'00', part);
		assembly {
			codePart := create(0, add(deployCode, 0x20), mload(deployCode))
		}
		require(codePart != address(0x0), 'Creation code chunk deployment failed');
	}

	function deployEscalationGame(uint256 startBondAttoRep, uint256 _nonDecisionThresholdAttoRep) external returns (EscalationGame) {
		require(EscalationGameRepCustody.securityPool(msg.sender) != address(0), 'Reporter security pool required');
		require(_nonDecisionThresholdAttoRep > 1, 'Escalation threshold too low');
		if (startBondAttoRep >= _nonDecisionThresholdAttoRep) startBondAttoRep = _nonDecisionThresholdAttoRep - 1;
		EscalationGame gameImplementation = _deployOrReuseEscalationGame(IQuestionLedger(payable(msg.sender)));
		gameImplementation.start(startBondAttoRep, _nonDecisionThresholdAttoRep);
		return gameImplementation;
	}

	function deployEscalationGameFromFork(uint256 startBondAttoRep, uint256 nonDecisionThresholdAttoRep, int256 elapsedAtFork, BinaryOutcomes.BinaryOutcome fixedQuestionOutcome) external returns (EscalationGame) {
		IQuestionLedger child = IQuestionLedger(payable(msg.sender));
		bool winnerHaircutPaidByFork;
		uint256 forkCarryInitialBackingAttoRep;
		address securityPool = EscalationGameRepCustody.securityPool(address(child));
		require(securityPool != address(0), 'Reporter security pool required');
		{
			(SecurityPoolReporterLedger.Question memory state, ) = SecurityPoolReporterLedger(ISecurityPoolNative(securityPool).reporterLedger(child.universeId())).question(child.universeId(), child.questionId());
			winnerHaircutPaidByFork = state.winnerHaircutPaidByFork;
			forkCarryInitialBackingAttoRep = state.balanceAttoRep;
		}
		EscalationGame gameImplementation = _deployOrReuseEscalationGame(child);
		gameImplementation.startFromFork(startBondAttoRep, nonDecisionThresholdAttoRep, elapsedAtFork, fixedQuestionOutcome, winnerHaircutPaidByFork, forkCarryInitialBackingAttoRep);
		return gameImplementation;
	}

	/// @notice Deploys `questionLedger`'s Escalation Game without starting it, so the first report does not pay
	/// the deployment gas (#1453). Anyone can prepare a game for `questionLedger`. The factory starts an ordinary
	/// game on the first report or initializes an inherited game through `startFromFork`. The inherited clock stays
	/// paused until the question ledger resumes the continuation.
	function prepareEscalationGame(IQuestionLedger questionLedger) external returns (EscalationGame) {
		return _deployOrReuseEscalationGame(questionLedger);
	}

	/// @notice The address at which `questionLedger`'s Escalation Game is or will be deployed.
	function escalationGameAddress(IQuestionLedger questionLedger) external view returns (EscalationGame) {
		return EscalationGame(_create2Address(_escalationGameInitCode(questionLedger)));
	}

	function _deployOrReuseEscalationGame(IQuestionLedger questionLedger) private returns (EscalationGame) {
		bytes memory initCode = _escalationGameInitCode(questionLedger);
		address prepared = _create2Address(initCode);
		// A reused game may be unstarted (prepared) or already started; start and startFromFork accept only this
		// factory, and the game refuses any second start, so reuse can never restart or re-parameterize a game.
		if (prepared.code.length != 0) return EscalationGame(prepared);
		address deployed = Create2Deployment.deploy(initCode, 0);
		require(deployed != address(0x0), 'Escalation game deployment failed');
		return EscalationGame(deployed);
	}

	function _create2Address(bytes memory initCode) private view returns (address) {
		return
			address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), bytes32(0), keccak256(initCode))))));
	}

	function _escalationGameInitCode(IQuestionLedger questionLedger) private view returns (bytes memory) {
		address partOne = escalationGameCreationCodePartOne;
		address partTwo = escalationGameCreationCodePartTwo;
		uint256 partOneLength;
		uint256 partTwoLength;
		assembly {
			partOneLength := sub(extcodesize(partOne), 1)
			partTwoLength := sub(extcodesize(partTwo), 1)
		}
		bytes memory creationCode = new bytes(partOneLength + partTwoLength);
		assembly {
			extcodecopy(partOne, add(creationCode, 0x20), 1, partOneLength)
			extcodecopy(partTwo, add(add(creationCode, 0x20), partOneLength), 1, partTwoLength)
		}
		// Code storage is cheaper to deploy and read than one storage slot per 32-byte
		// word, while two fixed parts keep each carrier below EIP-170.
		return
			abi.encodePacked(creationCode, abi.encode(questionLedger, questionLedger.repToken(), proofVerifier, depositDelegate));
	}
}

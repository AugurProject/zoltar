// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Create2Address } from '../../Create2Address.sol';

import { EscalationGameRepCustody } from '../EscalationGameRepCustody.sol';
import { SecurityPoolReporterLedger } from '../SecurityPoolReporterLedger.sol';
import { ISecurityPoolNative } from '../interfaces/ISecurityPoolNative.sol';
import { IQuestionLedger } from '../interfaces/IQuestionLedger.sol';
import { EscalationGame } from '../EscalationGame.sol';
import { EscalationGameProofVerifier } from '../EscalationGameProofVerifier.sol';
import { BinaryOutcomes } from '../BinaryOutcomes.sol';
import { EscalationGameDepositDelegate } from '../EscalationGameDepositDelegate.sol';
import { CreationCodeStorage } from '../CreationCodeStorage.sol';

contract EscalationGameFactory {
	EscalationGameProofVerifier public immutable proofVerifier;
	EscalationGameDepositDelegate public immutable depositDelegate;
	address private immutable escalationGameCreationCodePartOne;
	address private immutable escalationGameCreationCodePartTwo;

	constructor(EscalationGameDepositDelegate _depositDelegate) {
		require(address(_depositDelegate).code.length > 0, 'Deposit delegate');
		proofVerifier = new EscalationGameProofVerifier();
		(escalationGameCreationCodePartOne, escalationGameCreationCodePartTwo) = CreationCodeStorage.store(type(EscalationGame).creationCode);
		// Stateless delegate code is shared by every game; game storage stays isolated through delegatecall.
		depositDelegate = _depositDelegate;
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
		return EscalationGame(CreationCodeStorage.deploy2(initCode, 0));
	}

	function _create2Address(bytes memory initCode) private view returns (address) {
		return Create2Address.predict(address(this), bytes32(0), keccak256(initCode));
	}

	function _escalationGameInitCode(IQuestionLedger questionLedger) private view returns (bytes memory) {
		bytes memory creationCode = CreationCodeStorage.load(escalationGameCreationCodePartOne, escalationGameCreationCodePartTwo);
		// Code storage is cheaper to deploy and read than one storage slot per 32-byte
		// word, while two fixed parts keep each carrier below EIP-170.
		return
			abi.encodePacked(creationCode, abi.encode(questionLedger, questionLedger.repToken(), proofVerifier, depositDelegate));
	}
}

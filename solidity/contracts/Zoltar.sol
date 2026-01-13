// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.33;

import './Constants.sol';
import './ReputationToken.sol';

contract Zoltar {

	struct Universe {
		ReputationToken reputationToken;
		uint56 forkingQuestion;
		uint256 forkTime;
	}

	mapping(uint192 => Universe) public universes;

	struct QuestionData {
		uint64 endTime;
		uint192 originUniverse;
		address designatedReporter;
		string extraInfo;
	}

	struct QuestionResolutionData {
		address initialReporter;
		Outcome outcome;
		uint64 reportTime;
		bool finalized;
	}

	enum Outcome {
		Invalid,
		Yes,
		No,
		None
	}

	mapping(uint56 => QuestionData) public questions;

	// UniverseId => QuestionId => Data
	mapping(uint192 => mapping(uint56 => QuestionResolutionData)) questionResolutions;

	uint56 questionIdCounter = 0;

	// TODO: Revist what behavior the bond should be
	uint256 constant public REP_BOND = 1 ether;

	uint256 constant public DESIGNATED_REPORTING_TIME = 3 days;
	uint256 constant public DISPUTE_PERIOD = 1 days;

	constructor() {
		universes[0] = Universe(
			ReputationToken(Constants.GENESIS_REPUTATION_TOKEN),
			0,
			0
		);
	}

	function isQuestionLegit(uint192 _universeId, uint56 _questionId) public view returns (bool) {
		QuestionData memory questionData = questions[_questionId];
		require(questionData.endTime != 0, "Question is not valid");

		if (questionData.originUniverse == _universeId) return true;

		Universe memory universeData = universes[_universeId];
		require(address(universeData.reputationToken) != address(0), "Universe is not valid");

		do {
			_universeId >>= 2;
			// If a parent didn't fork this wouldn't be a valid universe
			Universe memory curUniverseData = universes[_universeId];
			if (curUniverseData.forkTime == 0) return false;

			// A resolved question cannot have children, as a question in a forked universe does not get resolved there
			QuestionResolutionData memory questionResolutionData = questionResolutions[_universeId][_questionId];
			if (questionResolutionDataIsFinalized(questionResolutionData)) return false;

			// If other checks passed and the ids are equal its a legitimate child. If this never gets reached it isn't.
			if (questionData.originUniverse == _universeId) return true;
		} while (_universeId > 0);

		return false;
	}

	function createQuestion(uint192 _universeId, uint64 _endTime, address _designatedReporterAddress, string memory _extraInfo) public returns (uint56 _questionId) {
		Universe memory universe = universes[_universeId];
		require(universe.forkingQuestion == 0, "Universe is forked");
		universe.reputationToken.transferFrom(msg.sender, address(this), REP_BOND);
		_questionId = ++questionIdCounter;
		questions[_questionId] = QuestionData(
			_endTime,
			_universeId,
			_designatedReporterAddress,
			_extraInfo
		);
	}

	function reportOutcome(uint192 _universeId, uint56 _questionId, Outcome _outcome) external {
		Universe memory universe = universes[_universeId];
		require(universe.forkingQuestion == 0, "Universe is forked");
		QuestionData memory questionData = questions[_questionId];
		QuestionResolutionData memory questionResolutionData = questionResolutions[_universeId][_questionId];
		require(questionResolutionData.reportTime == 0, "Question already has a report");
		require(_outcome != Outcome.None, "Invalid outcome");
		require(block.timestamp > questionData.endTime, "Question has not ended");
		require(msg.sender == questionData.designatedReporter || block.timestamp > questionData.endTime + DESIGNATED_REPORTING_TIME, "Reporter must be designated reporter");

		questionResolutions[_universeId][_questionId].initialReporter = msg.sender;
		questionResolutions[_universeId][_questionId].outcome = _outcome;
		questionResolutions[_universeId][_questionId].reportTime = uint64(block.timestamp);
	}

	function finalizeQuestion(uint192 _universeId, uint56 _questionId) external returns (Outcome) {
		Universe memory universe = universes[_universeId];
		QuestionResolutionData memory questionResolutionData = questionResolutions[_universeId][_questionId];
		if (!questionResolutionData.finalized) {
			require(questionResolutionDataIsFinalized(questionResolutionData), "Cannot withdraw REP bond before finalized");
			questionResolutionData.finalized = true;
			questionResolutions[_universeId][_questionId] = questionResolutionData;
			universe.reputationToken.transfer(questionResolutionData.initialReporter, REP_BOND);
		}
		return questionResolutionData.outcome;
	}

	function splitStakedRep(uint192 _universeId, uint56 _questionId) external {
		QuestionResolutionData memory questionResolutionData = questionResolutions[_universeId][_questionId];
		require(questionResolutionData.reportTime != 0, "No REP staked in this question");
		require(!questionResolutionDataIsFinalized(questionResolutionData), "Cannot migrate REP from finalized question");

		splitRepInternal(_universeId, REP_BOND, address(this), questionResolutionData.initialReporter, Outcome.None);
	}

	function isFinalized(uint192 _universeId, uint56 _questionId) external view returns (bool) {
		QuestionResolutionData memory questionResolutionData = questionResolutions[_universeId][_questionId];
		if (questionResolutionData.finalized) return true;
		return questionResolutionDataIsFinalized(questionResolutionData);
	}

	function questionResolutionDataIsFinalized(QuestionResolutionData memory questionResolutionData) internal view returns (bool) {
		return questionResolutionData.reportTime != 0 && block.timestamp > questionResolutionData.reportTime + DISPUTE_PERIOD;
	}

	function getWinningOutcome(uint192 _universeId, uint56 _questionId) public view returns (Outcome) {
		QuestionResolutionData memory questionResolutionData = questionResolutions[_universeId][_questionId];
		require(questionResolutionDataIsFinalized(questionResolutionData), "Question is not finalized");

		return questionResolutionData.outcome;
	}

	// TODO: Currently escalation game is a single dispute. Likely will be more complex.
	function dispute(uint192 _universeId, uint56 _questionId, Outcome _outcome) external {
		Universe memory universe = universes[_universeId];
		require(universe.forkingQuestion == 0, "Universe is forked");
		QuestionResolutionData memory questionResolutionData = questionResolutions[_universeId][_questionId];
		require(_outcome != questionResolutionData.outcome, "Dispute must be for a different outcome than the currently winning one");
		require(block.timestamp < questionResolutionData.reportTime + DISPUTE_PERIOD, "Question not in dispute window");
		require(_outcome != Outcome.None, "Invalid outcome");

		uint256 disputeStake = REP_BOND * 2;

		for (uint8 i = 1; i < Constants.NUM_OUTCOMES + 1; i++) {
			uint192 childUniverseId = (_universeId << 2) + i;
			universes[childUniverseId] = Universe(new ReputationToken{ salt: bytes32(uint256(childUniverseId)) }(address(this)), 0, 0);

			questionResolutions[childUniverseId][_questionId].reportTime = 1;
			questionResolutions[childUniverseId][_questionId].outcome = Outcome(i - 1);
			questionResolutions[childUniverseId][_questionId].finalized = true;
		}

		universe.forkingQuestion = _questionId;
		universe.forkTime = block.timestamp;
		universes[_universeId] = universe;

		splitRepInternal(_universeId, REP_BOND, questionResolutionData.initialReporter, questionResolutionData.initialReporter, questionResolutionData.outcome);
		splitRepInternal(_universeId, disputeStake, msg.sender, msg.sender, _outcome);
	}

	function splitRep(uint192 universeId) public {
		uint256 amount = universes[universeId].reputationToken.balanceOf(msg.sender);
		splitRepInternal(universeId, amount, msg.sender, msg.sender, Outcome.None);
	}

	// singleOutcome will only credit the provided outcome if it is a valid outcome, else all child universe REP will be minted
	function splitRepInternal(uint192 universeId, uint256 amount, address migrator, address recipient, Outcome singleOutcome) private {
		Universe memory universe = universes[universeId];
		require(universe.forkTime != 0, "Universe has not forked");

		// Genesis is using REPv2 which we cannot actually burn
		if (universeId == 0) {
			if (migrator == address(this)) {
				universe.reputationToken.transfer(Constants.BURN_ADDRESS, amount);
			} else {
				universe.reputationToken.transferFrom(migrator, Constants.BURN_ADDRESS, amount);
			}
		} else {
			ReputationToken(address(universe.reputationToken)).burn(migrator, amount);
		}

		for (uint8 i = 1; i < Constants.NUM_OUTCOMES + 1; i++) {
			if (singleOutcome != Outcome.None && i != uint8(singleOutcome) + 1) continue;
			uint192 childUniverseId = (universeId << 2) + i;
			Universe memory childUniverse = universes[childUniverseId];
			ReputationToken(address(childUniverse.reputationToken)).mint(recipient, amount);
		}

	}
}

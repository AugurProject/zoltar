// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;

import './Constants.sol';
import './ReputationToken.sol';
import './ZoltarQuestionData.sol';

uint256 constant FORK_THRESHOLD_DIVISOR = 20; // TODO, revisit, 5% of total supply atm
uint256 constant FORK_BURN_DIVISOR = 5; // TODO, revisit, 20% of fork threshold

contract Zoltar {
	struct Universe {
		uint256 forkTime;
		ReputationToken reputationToken;
		uint248 parentUniverseId;
		uint8 forkingOutcomeIndex;
	}

	mapping(uint248 => Universe) public universes;

	struct UniverseForkData {
		address forkedBy;
		uint256 forkerRepDeposit;
		uint256 questionId;
		uint256 numOutcomes;
	}

	mapping(uint248 => UniverseForkData) public universeForkData;

	event UniverseForked(address forker, uint248 universeId, uint256 questionId);
	event DeployChild(address deployer, uint248 universeId, uint8 outcomeIndex, uint248 childUniverseId, ReputationToken childReputationToken);
	event SplitRep(uint248 universeId, uint256 amount, address migrator, address recipient, uint8[] outcomeIndexes);
	event ForkerClaimRep(address forker, uint248 universeId, uint8[] outcomeIndexes, uint256 forkerRepDeposit);

	ZoltarQuestionData public zoltarQuestionData;
	bool public zoltarQuestionDataSet;

	function setZoltarQuestionData(ZoltarQuestionData _zoltarQuestionData) external {
		require(!zoltarQuestionDataSet, 'already set');
		zoltarQuestionData = _zoltarQuestionData;
		zoltarQuestionDataSet = true;
	}

	function getForkTime(uint248 universeId) external view returns (uint256) {
		Universe memory universe = universes[universeId];
		return universe.forkTime;
	}

	function getRepToken(uint248 universeId) external view returns (ReputationToken) {
		Universe memory universe = universes[universeId];
		return universe.reputationToken;
	}
	function getForkedBy(uint248 universeId) external view returns (address) {
		UniverseForkData memory forkData = universeForkData[universeId];
		return forkData.forkedBy;
	}
	function getForkerDeposit(uint248 universeId) external view returns (uint256) {
		UniverseForkData memory forkData = universeForkData[universeId];
		return forkData.forkerRepDeposit;
	}
	function getNumOutcomes(uint248 universeId) external view returns (uint256) {
		return universeForkData[universeId].numOutcomes;
	}

	constructor() {
		universes[0] = Universe(0, ReputationToken(Constants.GENESIS_REPUTATION_TOKEN), 0, 0);
	}

	function getForkThreshold(uint248 universeId) public view returns (uint256) {
		Universe memory universe = universes[universeId];
		return universe.reputationToken.getTotalTheoreticalSupply() / FORK_THRESHOLD_DIVISOR;
	}

	function forkUniverse(uint248 universeId, uint256 _questionId) public {
		Universe memory universe = universes[universeId];
		require(universe.forkTime == 0, 'Universe has forked already');
		require(zoltarQuestionDataSet, 'ZoltarQuestionData not set');
		// Validate that the question has outcomes
		(, string[4] memory outcomes) = zoltarQuestionData.getForkingData(_questionId);
		uint256 numOutcomes = 0;
		for (uint8 i = 0; i < 4; i++) {
			if (bytes(outcomes[i]).length > 0) numOutcomes++;
		}
		require(numOutcomes >= 1, 'need atleast one outcome');

		universes[universeId].forkTime = block.timestamp;
		uint256 forkThreshold = getForkThreshold(universeId);
		universeForkData[universeId] = UniverseForkData(msg.sender, forkThreshold - forkThreshold / FORK_BURN_DIVISOR, _questionId, numOutcomes);
		universes[universeId].reputationToken.transferFrom(msg.sender, address(this), forkThreshold);
		burnRep(universes[universeId].reputationToken, address(this), forkThreshold / FORK_BURN_DIVISOR); // burn 20%
		emit UniverseForked(msg.sender, universeId, _questionId);
	}

	function splitRep(uint248 universeId, uint8[] memory outcomeIndexes) public {
		uint256 amount = universes[universeId].reputationToken.balanceOf(msg.sender);
		splitRepInternal(universeId, amount, msg.sender, msg.sender, outcomeIndexes);
	}

	function burnRep(ReputationToken reputationToken, address migrator, uint256 amount) private {
		// Genesis is using REPv2 which we cannot actually burn
		if (address(reputationToken) == Constants.GENESIS_REPUTATION_TOKEN) {
			if (migrator == address(this)) {
				reputationToken.transfer(Constants.BURN_ADDRESS, amount);
			} else {
				reputationToken.transferFrom(migrator, Constants.BURN_ADDRESS, amount);
			}
		} else {
			ReputationToken(address(reputationToken)).burn(migrator, amount);
		}
	}

	function getOutcomeName(uint248 universeId) external view returns (string memory) {
		if (universeId == 0) return 'Genesis';
		Universe memory universe = universes[universeId];
		if (universe.forkingOutcomeIndex == 0) return 'Invalid';
		uint256 questionId = universeForkData[universe.parentUniverseId].questionId;
		(, string[4] memory outcomes) = zoltarQuestionData.getForkingData(questionId);
		return outcomes[universe.forkingOutcomeIndex - 1];
	}

	function getChildUniverseId(uint248 universeId, uint8 outcomeIndex) public pure returns (uint248) {
		return uint248(uint256(keccak256(abi.encode(universeId, outcomeIndex))));
	}

	function deployChild(uint248 universeId, uint8 outcomeIndex) public {
		Universe memory universe = universes[universeId];
		require(universe.forkTime != 0, 'Universe has not forked');
		uint248 childUniverseId = getChildUniverseId(universeId, outcomeIndex);
		ReputationToken childReputationToken = new ReputationToken{ salt: bytes32(uint256(childUniverseId)) }(address(this));
		childReputationToken.setMaxTheoreticalSupply(universe.reputationToken.getTotalTheoreticalSupply());
		universes[childUniverseId] = Universe(0, childReputationToken, universeId, outcomeIndex);
		emit DeployChild(msg.sender, universeId, outcomeIndex, childUniverseId, childReputationToken);
	}

	function forkerClaimRep(uint248 universeId, uint8[] memory outcomeIndexes) public {
		UniverseForkData memory data = universeForkData[universeId];
		require(data.forkedBy == msg.sender, 'only forker can claim');
		universeForkData[universeId].forkerRepDeposit = 0;
		emit ForkerClaimRep(msg.sender, universeId, outcomeIndexes, data.forkerRepDeposit);
		splitRepInternal(universeId, data.forkerRepDeposit, address(this), data.forkedBy, outcomeIndexes);
	}

	function splitRepInternal(uint248 universeId, uint256 amount, address migrator, address recipient, uint8[] memory outcomeIndexes) private {
		Universe memory universe = universes[universeId];
		require(universe.forkTime != 0, 'Universe has not forked');
		emit SplitRep(universeId, amount, migrator, recipient, outcomeIndexes);
		burnRep(universe.reputationToken, migrator, amount);
		// Get number of outcomes from stored fork data
		uint256 numOutcomes = universeForkData[universeId].numOutcomes;
		for (uint8 i = 0; i < outcomeIndexes.length; i++) {
			require(i == 0 || outcomeIndexes[i] > outcomeIndexes[i - 1], 'outcomes are not sorted');
			require(outcomeIndexes[i] < numOutcomes + 1, 'outcome index overflow'); // +1 for Invalid
			uint248 childUniverseId = getChildUniverseId(universeId, outcomeIndexes[i]);
			if (address(universes[childUniverseId].reputationToken) == address(0x0)) deployChild(universeId, outcomeIndexes[i]);
			universes[childUniverseId].reputationToken.mint(recipient, amount);
		}
	}
}


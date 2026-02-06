// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.33;

import './Constants.sol';
import './ReputationToken.sol';

uint256 constant FORK_TRESHOLD_DIVISOR = 20; // TODO, revisit, 5% of total supply atm
uint256 constant FORK_BURN_DIVISOR = 5; // TODO, revisit, 20% of fork treshold

contract Zoltar {
	struct Universe {
		uint256 forkTime;
		ReputationToken reputationToken;
		uint248 parentUniverseId;
		uint8 forkingOutcomeIndex;
	}

	mapping(uint248 => Universe) public universes;

	struct UniverseForkData {
		string forkingQuestionExtraInfo;
		address forkedBy;
		uint256 forkerRepDeposit;
		string[8] forkingQuestionCategories;
	}

	mapping(uint248 => UniverseForkData) public universeForkData;

	function getForkTime(uint248 universeId) external view returns (uint256) {
		Universe memory universe = universes[universeId];
		return universe.forkTime;
	}

	function getForkingQuestionCategories(uint248 universeId) external view returns (string[8] memory) {
		return universeForkData[universeId].forkingQuestionCategories;
	}

	function getRepToken(uint248 universeId) external view returns (ReputationToken) {
		Universe memory universe = universes[universeId];
		return universe.reputationToken;
	}

	constructor() {
		universes[0] = Universe(0, ReputationToken(Constants.GENESIS_REPUTATION_TOKEN), 0, 0);
	}

	function forkUniverse(uint248 universeId, string memory _extraInfo, string[8] memory _questionCategories) public {
		Universe memory universe = universes[universeId];
		require(universe.forkTime == 0, 'Universe has forked already');
		require(_questionCategories.length >= 1, 'need atleast one category on top of invalid');
		universes[universeId].forkTime = block.timestamp;
		uint256 forkTreshold = universe.reputationToken.maxTheoreticalSupply() / FORK_TRESHOLD_DIVISOR;
		universeForkData[universeId] = UniverseForkData(_extraInfo, msg.sender, forkTreshold - forkTreshold / 5, _questionCategories);
		universes[universeId].reputationToken.transferFrom(msg.sender, address(this), forkTreshold);
		burnRep(universes[universeId].reputationToken, address(this), forkTreshold / 5); // burn 20%
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
		return universeForkData[universe.parentUniverseId].forkingQuestionCategories[universe.forkingOutcomeIndex - 1];
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
	}

	function forkerClaimRep(uint248 universeId, uint8[] memory outcomeIndices) public {
		UniverseForkData memory data = universeForkData[universeId];
		require(data.forkedBy == msg.sender, 'only forker can claim');
		universeForkData[universeId].forkerRepDeposit = 0;
		splitRepInternal(universeId, data.forkerRepDeposit, address(this), data.forkedBy, outcomeIndices);
	}

	function splitRepInternal(uint248 universeId, uint256 amount, address migrator, address recipient, uint8[] memory outcomeIndices) private {
		Universe memory universe = universes[universeId];
		require(universe.forkTime != 0, 'Universe has not forked');
		burnRep(universe.reputationToken, migrator, amount);
		for (uint8 i = 0; i < outcomeIndices.length; i++) {
			require(i == 0 || outcomeIndices[i] > outcomeIndices[i-1], 'outcomes are not sorted'); // force sorting to avoid duplicate indices
			require(outcomeIndices[i] < universeForkData[universeId].forkingQuestionCategories.length + 1, 'outcome index overflow');
			uint248 childUniverseId = getChildUniverseId(universeId, outcomeIndices[i]);
			Universe memory childUniverse = universes[childUniverseId];
			if (address(childUniverse.reputationToken) == address(0x0)) {
				deployChild(universeId, outcomeIndices[i]);
			}
			ReputationToken(address(childUniverse.reputationToken)).mint(recipient, amount);
		}
	}
}

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
		uint256 forkQuestionId;
		uint256 forkingOutcomeIndex;

		ReputationToken reputationToken;
		uint248 parentUniverseId;
	}

	mapping(uint248 => Universe) public universes;

	struct AddressRepMigration {
		uint256 repBalance;
		mapping(uint248 => uint256) migrationAmounts; // how much migrated to each universe
	}
	mapping(address => mapping(uint248 => AddressRepMigration)) public repTokensMigrated; // userAddress -> fromUniverse

	event UniverseForked(address forker, uint248 universeId, uint256 questionId);
	event DeployChild(address deployer, uint248 universeId, uint256 outcomeIndex, uint248 childUniverseId, ReputationToken childReputationToken);

	ZoltarQuestionData public zoltarQuestionData;

	constructor(ZoltarQuestionData _zoltarQuestionData) {
		zoltarQuestionData = _zoltarQuestionData;
		universes[0] = Universe(0, 0, 0, ReputationToken(Constants.GENESIS_REPUTATION_TOKEN), 0);
	}

	function getForkTime(uint248 universeId) external view returns (uint256) {
		Universe memory universe = universes[universeId];
		return universe.forkTime;
	}

	function getRepToken(uint248 universeId) external view returns (ReputationToken) {
		Universe memory universe = universes[universeId];
		return universe.reputationToken;
	}

	function getForkThreshold(uint248 universeId) public view returns (uint256) {
		Universe memory universe = universes[universeId];
		return universe.reputationToken.getTotalTheoreticalSupply() / FORK_THRESHOLD_DIVISOR;
	}

	function forkUniverse(uint248 universeId, uint256 questionId) public {
		Universe memory universe = universes[universeId];
		require(universe.forkTime == 0, 'Universe has forked already');
		// TODO, add check that questionid exists in zoltarQuestionData, and its time has passed
		universes[universeId].forkTime = block.timestamp;
		universes[universeId].forkQuestionId = questionId;
		uint256 forkThreshold = getForkThreshold(universeId);
		burnRep(universes[universeId].reputationToken, msg.sender, forkThreshold);
		repTokensMigrated[msg.sender][universeId].repBalance = forkThreshold - forkThreshold / FORK_BURN_DIVISOR;// burn 20%
		emit UniverseForked(msg.sender, universeId, questionId);
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

	function getChildUniverseId(uint248 universeId, uint256 outcomeIndex) public pure returns (uint248) {
		return uint248(uint256(keccak256(abi.encode(universeId, outcomeIndex))));
	}

	function deployChild(uint248 universeId, uint256 outcomeIndex) public {
		Universe memory universe = universes[universeId];
		require(universe.forkTime != 0, 'Universe has not forked');
		uint248 childUniverseId = getChildUniverseId(universeId, outcomeIndex);
		ReputationToken childReputationToken = new ReputationToken{ salt: bytes32(uint256(childUniverseId)) }(address(this));
		childReputationToken.setMaxTheoreticalSupply(universe.reputationToken.getTotalTheoreticalSupply());
		universes[childUniverseId] = Universe(0, universe.forkQuestionId, outcomeIndex, childReputationToken, universeId);
		emit DeployChild(msg.sender, universeId, outcomeIndex, childUniverseId, childReputationToken);
	}

	// stores rep to universe that can then be migrated with internal REP migration
	function prepareRepForMigration(uint248 universeId, uint256 amount) public {
		Universe memory universe = universes[universeId];
		require(universe.forkTime != 0, 'Universe has not forked');
		burnRep(universe.reputationToken, msg.sender, amount);
		repTokensMigrated[msg.sender][universeId].repBalance += amount;
	}
	function migrateInternalRep(uint248 universeId, uint256 amount, uint256[] memory outcomeIndexes) public {
		Universe memory universe = universes[universeId];
		require(universe.forkTime != 0, 'Universe has not forked');
		splitRepInternal(universeId, amount, msg.sender, outcomeIndexes);
	}

	function splitRepInternal(uint248 universeId, uint256 amount, address recipient, uint256[] memory outcomeIndexes) private {
		for (uint256 i = 0; i < outcomeIndexes.length; i++) {
			uint248 childUniverseId = getChildUniverseId(universeId, outcomeIndexes[i]);
			// todo, check that outcome index is valid outcome
			if (address(universes[childUniverseId].reputationToken) == address(0x0)) deployChild(universeId, outcomeIndexes[i]);
			repTokensMigrated[msg.sender][universeId].migrationAmounts[childUniverseId] += amount;
			require(repTokensMigrated[msg.sender][universeId].migrationAmounts[childUniverseId] <= repTokensMigrated[msg.sender][universeId].repBalance, 'cannot migrate more than internal balance');
			universes[childUniverseId].reputationToken.mint(recipient, amount);
		}
	}
}


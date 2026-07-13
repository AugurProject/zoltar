// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import './Constants.sol';
import './IERC20.sol';
import './ReputationToken.sol';
import './SafeERC20Ops.sol';
import './ZoltarQuestionData.sol';

contract Zoltar {
	using SafeERC20Ops for IERC20;

	struct Universe {
		uint256 forkTime;
		uint256 forkQuestionId;
		uint256 forkingOutcomeIndex;
		ReputationToken reputationToken;
		uint248 parentUniverseId;
	}

	mapping(uint248 => Universe) public universes;
	mapping(uint248 => uint256[]) public deployedChildOutcomeIndexes;
	mapping(uint248 => uint256) private universeTheoreticalSupplies;
	mapping(uint248 => uint256) private childUniverseTheoreticalSupplySnapshots;

	struct AddressRepMigration {
		uint256 migrationRepBalance;
		mapping(uint248 => uint256) childMigrationRepAmounts; // how much migrated to each child universe
	}
	mapping(address => mapping(uint248 => AddressRepMigration)) private migrationRepBalances; // userAddress -> fromUniverse

	event UniverseForked(
		address forker,
		uint248 universeId,
		uint256 questionId,
		uint256 forkTime,
		uint256 forkThreshold,
		uint256 migrationRepBalance,
		uint256 universeTheoreticalSupply
	);
	event DeployChild(
		address deployer,
		uint248 universeId,
		uint256 outcomeIndex,
		uint248 childUniverseId,
		ReputationToken childReputationToken,
		uint256 childUniverseTheoreticalSupply
	);
	event MigrationRepAdded(
		address migrator,
		uint248 universeId,
		uint256 amount,
		uint256 migrationRepBalance,
		uint256 universeTheoreticalSupply
	);
	event MigrationRepSplit(
		address migrator,
		address recipient,
		uint248 universeId,
		uint256 outcomeIndex,
		uint248 childUniverseId,
		uint256 amount,
		uint256 childMigrationRepAmount
	);
	event UniverseInitialized(
		uint248 universeId,
		uint256 forkTime,
		uint256 forkQuestionId,
		uint256 forkingOutcomeIndex,
		ReputationToken reputationToken,
		uint248 parentUniverseId,
		uint256 universeTheoreticalSupply
	);

	uint256 public immutable forkThresholdDivisor;
	uint256 public immutable forkBurnDivisor;
	ZoltarQuestionData public immutable zoltarQuestionData;

	constructor(ZoltarQuestionData _zoltarQuestionData, uint256 _forkThresholdDivisor, uint256 _forkBurnDivisor) {
		require(_forkThresholdDivisor > 1, 'Zoltar fork threshold divisor must be greater than one');
		require(_forkBurnDivisor > 1, 'Zoltar fork burn divisor must be greater than one');
		zoltarQuestionData = _zoltarQuestionData;
		forkThresholdDivisor = _forkThresholdDivisor;
		forkBurnDivisor = _forkBurnDivisor;
		universes[0] = Universe(0, 0, 0, ReputationToken(Constants.GENESIS_REPUTATION_TOKEN), 0);
		require(Constants.GENESIS_REPUTATION_TOKEN.code.length != 0, 'Genesis REP token address must contain code');
		// The configured genesis token must expose `getTotalTheoreticalSupply()`.
		// This constructor intentionally relies on that non-ERC20 extension when wiring
		// the genesis universe to an external REP deployment.
		uint256 genesisSupply = ReputationToken(Constants.GENESIS_REPUTATION_TOKEN).getTotalTheoreticalSupply();
		require(genesisSupply != 0, 'Genesis REP missing supply: theoretical supply must be non-zero');
		universeTheoreticalSupplies[0] = genesisSupply;
		emit UniverseInitialized(0, 0, 0, 0, ReputationToken(Constants.GENESIS_REPUTATION_TOKEN), 0, genesisSupply);
	}

	function getForkTime(uint248 universeId) external view returns (uint256) {
		Universe memory universe = universes[universeId];
		return universe.forkTime;
	}

	function forkQuestionMatches(uint248 universeId, uint256 questionId) external view returns (bool) {
		return universes[universeId].forkQuestionId == questionId;
	}

	function getRepToken(uint248 universeId) external view returns (ReputationToken) {
		Universe memory universe = universes[universeId];
		return universe.reputationToken;
	}

	function getForkThreshold(uint248 universeId) public view returns (uint256) {
		return getUniverseTheoreticalSupply(universeId) / forkThresholdDivisor;
	}

	function getUniverseTheoreticalSupply(uint248 universeId) public view returns (uint256) {
		return universeTheoreticalSupplies[universeId];
	}

	function forkUniverse(uint248 universeId, uint256 questionId) public {
		Universe memory universe = universes[universeId];
		require(address(universe.reputationToken) != address(0x0), 'Universe not initialized with a REP token');
		require(address(universe.reputationToken).code.length != 0, 'Universe REP token address must contain code');
		require(universeTheoreticalSupplies[universeId] != 0, 'Universe theoretical REP supply must be non-zero');
		require(universe.forkTime == 0, 'Universe has forked already and cannot fork again');
		// Intended behavior: Zoltar treats questions as global protocol objects rather
		// than binding them to a specific universe. Any ended question can force a fork
		// in any unforked universe, and downstream protocols are expected to enforce any
		// stricter universe/question relationship they require.
		require(
			zoltarQuestionData.questionCreatedTimestamp(questionId) > 0,
			'Question does not exist in ZoltarQuestionData'
		);
		uint256 endTime = zoltarQuestionData.getQuestionEndDate(questionId);
		require(block.timestamp >= endTime, 'Question has not ended, so it cannot force a fork yet');
		universes[universeId].forkTime = block.timestamp;
		universes[universeId].forkQuestionId = questionId;
		uint256 forkThreshold = getForkThreshold(universeId);
		burnRep(universes[universeId].reputationToken, msg.sender, forkThreshold);
		universeTheoreticalSupplies[universeId] -= forkThreshold;
		uint256 migrationRepBalance = forkThreshold - forkThreshold / forkBurnDivisor;
		// The child maximum retains the initiator's credited migration REP. Only the
		// uncredited haircut is permanently absent from every child universe.
		childUniverseTheoreticalSupplySnapshots[universeId] =
			universeTheoreticalSupplies[universeId] + migrationRepBalance;
		migrationRepBalances[msg.sender][universeId].migrationRepBalance = migrationRepBalance;
		emit UniverseForked(
			msg.sender,
			universeId,
			questionId,
			universes[universeId].forkTime,
			forkThreshold,
			migrationRepBalance,
			universeTheoreticalSupplies[universeId]
		);
	}

	function burnRep(ReputationToken reputationToken, address migrator, uint256 amount) private {
		// Genesis is using REPv2 which we cannot actually burn
		if (address(reputationToken) == Constants.GENESIS_REPUTATION_TOKEN) {
			if (migrator == address(this)) {
				IERC20(address(reputationToken)).safeTransfer(Constants.BURN_ADDRESS, amount);
			} else {
				IERC20(address(reputationToken)).safeTransferFrom(migrator, Constants.BURN_ADDRESS, amount);
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
		require(universe.forkTime != 0, 'Universe has not forked, so child universes are unavailable');
		require(
			!zoltarQuestionData.isMalformedAnswerOption(universe.forkQuestionId, outcomeIndex),
			'Malformed outcome index for the universe fork question'
		);
		uint248 childUniverseId = getChildUniverseId(universeId, outcomeIndex);
		// Prevent overwriting an existing child universe
		require(
			address(universes[childUniverseId].reputationToken) == address(0),
			'Child universe already deployed for this outcome'
		);
		ReputationToken childReputationToken = new ReputationToken{ salt: bytes32(uint256(childUniverseId)) }(
			address(this)
		);
		uint256 childUniverseTheoreticalSupply = childUniverseTheoreticalSupplySnapshots[universeId];
		childReputationToken.setMaxTheoreticalSupply(childUniverseTheoreticalSupply);
		universeTheoreticalSupplies[childUniverseId] = childUniverseTheoreticalSupply;
		universes[childUniverseId] = Universe(
			0,
			universe.forkQuestionId,
			outcomeIndex,
			childReputationToken,
			universeId
		);
		deployedChildOutcomeIndexes[universeId].push(outcomeIndex);
		emit DeployChild(
			msg.sender,
			universeId,
			outcomeIndex,
			childUniverseId,
			childReputationToken,
			childUniverseTheoreticalSupply
		);
	}

	function getDeployedChildUniverses(
		uint248 universeId,
		uint256 startIndex,
		uint256 count
	)
		external
		view
		returns (uint256[] memory outcomeIndexes, uint248[] memory childUniverseIds, Universe[] memory childUniverses)
	{
		uint256[] storage deployedOutcomeIndexes = deployedChildOutcomeIndexes[universeId];
		uint256 iterateUntil = _sliceEnd(startIndex, count, deployedOutcomeIndexes.length);
		if (iterateUntil <= startIndex) return (new uint256[](0), new uint248[](0), new Universe[](0));
		uint256 resultLength = iterateUntil - startIndex;
		outcomeIndexes = new uint256[](resultLength);
		childUniverseIds = new uint248[](resultLength);
		childUniverses = new Universe[](resultLength);
		for (uint256 i = startIndex; i < iterateUntil; i++) {
			uint256 resultIndex = i - startIndex;
			uint248 childUniverseId = getChildUniverseId(universeId, deployedOutcomeIndexes[i]);
			outcomeIndexes[resultIndex] = deployedOutcomeIndexes[i];
			childUniverseIds[resultIndex] = childUniverseId;
			childUniverses[resultIndex] = universes[childUniverseId];
		}
	}

	function _sliceEnd(uint256 startIndex, uint256 count, uint256 total) internal pure returns (uint256) {
		if (startIndex >= total || count == 0) return startIndex;
		uint256 availableCount = total - startIndex;
		if (count >= availableCount) return total;
		return startIndex + count;
	}

	// stores rep in the migration balance for a universe
	function addRepToMigrationBalance(uint248 universeId, uint256 amount) public {
		Universe memory universe = universes[universeId];
		require(universe.forkTime != 0, 'Universe has not forked, so migration balance cannot be added');
		burnRep(universe.reputationToken, msg.sender, amount);
		universeTheoreticalSupplies[universeId] -= amount;
		migrationRepBalances[msg.sender][universeId].migrationRepBalance += amount;
		emit MigrationRepAdded(
			msg.sender,
			universeId,
			amount,
			migrationRepBalances[msg.sender][universeId].migrationRepBalance,
			universeTheoreticalSupplies[universeId]
		);
	}
	function splitMigrationRep(uint248 universeId, uint256 amount, uint256[] memory outcomeIndexes) public {
		Universe memory universe = universes[universeId];
		require(universe.forkTime != 0, 'Universe has not forked, so migration REP cannot be split');
		splitRepInternal(universeId, amount, msg.sender, outcomeIndexes);
	}

	function splitRepInternal(
		uint248 universeId,
		uint256 amount,
		address recipient,
		uint256[] memory outcomeIndexes
	) private {
		uint256 questionId = universes[universeId].forkQuestionId;
		// Fork migration intentionally duplicates the holder's migration balance across the
		// selected child universes. For example, splitting 1 parent-universe REP into the
		// Yes and No children mints 1 Yes-child REP and 1 No-child REP. The original
		// parent-universe REP is not preserved here: it has already been burned into the
		// migration balance before child-universe REP is minted.
		for (uint256 i = 0; i < outcomeIndexes.length; i++) {
			uint256 outcomeIndex = outcomeIndexes[i];
			require(
				!zoltarQuestionData.isMalformedAnswerOption(questionId, outcomeIndex),
				'Malformed outcome index for the fork migration question'
			);
			uint248 childUniverseId = getChildUniverseId(universeId, outcomeIndex);
			if (address(universes[childUniverseId].reputationToken) == address(0x0))
				deployChild(universeId, outcomeIndex);
			migrationRepBalances[msg.sender][universeId].childMigrationRepAmounts[childUniverseId] += amount;
			require(
				migrationRepBalances[msg.sender][universeId].childMigrationRepAmounts[childUniverseId] <=
					migrationRepBalances[msg.sender][universeId].migrationRepBalance,
				'Cannot migrate more than internal balance: requested child REP exceeds sender migration REP'
			);
			universes[childUniverseId].reputationToken.mint(recipient, amount);
			emit MigrationRepSplit(
				msg.sender,
				recipient,
				universeId,
				outcomeIndex,
				childUniverseId,
				amount,
				migrationRepBalances[msg.sender][universeId].childMigrationRepAmounts[childUniverseId]
			);
		}
	}

	function getMigrationRepBalance(
		address migrator,
		uint248 universeId
	) public view returns (uint256 migrationRepBalance) {
		return migrationRepBalances[migrator][universeId].migrationRepBalance;
	}
}

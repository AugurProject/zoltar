// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

contract RetirementTokenMock {
	mapping(address => uint256) public balanceOf;
	mapping(address => mapping(address => uint256)) public allowance;

	function mint(address account, uint256 amount) external {
		balanceOf[account] += amount;
	}

	function approve(address spender, uint256 amount) external returns (bool) {
		allowance[msg.sender][spender] = amount;
		return true;
	}

	function transfer(address recipient, uint256 amount) external returns (bool) {
		require(balanceOf[msg.sender] >= amount, 'Balance');
		balanceOf[msg.sender] -= amount;
		balanceOf[recipient] += amount;
		return true;
	}
}

contract RetirementV3PoolMock {
	struct Position {
		uint128 liquidity;
		uint256 feeGrowthInside0LastX128;
		uint256 feeGrowthInside1LastX128;
		uint128 tokensOwed0;
		uint128 tokensOwed1;
	}

	mapping(bytes32 => Position) public positions;
	RetirementTokenMock public immutable token0;
	RetirementTokenMock public immutable token1;

	constructor(RetirementTokenMock token0_, RetirementTokenMock token1_) {
		token0 = token0_;
		token1 = token1_;
	}

	function positionKey(address owner, int24 tickLower, int24 tickUpper) public pure returns (bytes32) {
		return keccak256(abi.encodePacked(owner, tickLower, tickUpper));
	}

	function seed(address owner, int24 tickLower, int24 tickUpper, uint128 liquidity, uint128 tokensOwed0, uint128 tokensOwed1) external {
		positions[positionKey(owner, tickLower, tickUpper)] = Position(liquidity, 0, 0, tokensOwed0, tokensOwed1);
	}

	function burn(int24 tickLower, int24 tickUpper, uint128 amount) external returns (uint256 amount0, uint256 amount1) {
		Position storage position = positions[positionKey(msg.sender, tickLower, tickUpper)];
		require(position.liquidity >= amount, 'Liquidity');
		position.liquidity -= amount;
		position.tokensOwed0 += amount;
		position.tokensOwed1 += amount * 2;
		return (amount, amount * 2);
	}

	function collect(address recipient, int24 tickLower, int24 tickUpper, uint128 amount0Requested, uint128 amount1Requested) external returns (uint128 amount0, uint128 amount1) {
		Position storage position = positions[positionKey(msg.sender, tickLower, tickUpper)];
		amount0 = amount0Requested < position.tokensOwed0 ? amount0Requested : position.tokensOwed0;
		amount1 = amount1Requested < position.tokensOwed1 ? amount1Requested : position.tokensOwed1;
		position.tokensOwed0 -= amount0;
		position.tokensOwed1 -= amount1;
		require(token0.transfer(recipient, amount0) && token1.transfer(recipient, amount1), 'Transfer');
	}
}

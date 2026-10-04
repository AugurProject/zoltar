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

	function transferFrom(address sender, address recipient, uint256 amount) external returns (bool) {
		require(allowance[sender][msg.sender] >= amount, 'Allowance');
		require(balanceOf[sender] >= amount, 'Balance');
		allowance[sender][msg.sender] -= amount;
		balanceOf[sender] -= amount;
		balanceOf[recipient] += amount;
		return true;
	}

	function transfer(address recipient, uint256 amount) external returns (bool) {
		require(balanceOf[msg.sender] >= amount, 'Balance');
		balanceOf[msg.sender] -= amount;
		balanceOf[recipient] += amount;
		return true;
	}
}

contract RetirementOpenOracleMock {
	mapping(address => mapping(address => mapping(address => uint256))) public internalAllowance;
	mapping(address => mapping(address => uint256)) public tokenHolder;

	function approveInternal(address spender, address token, uint256 amount) external {
		internalAllowance[msg.sender][spender][token] = amount;
	}

	function creditNative(address owner) external payable {
		tokenHolder[owner][address(0)] += msg.value;
	}

	function withdrawTo(address token, uint256 amount, address payable recipient) external {
		require(token == address(0), 'Token');
		require(tokenHolder[msg.sender][token] >= amount, 'Credit');
		tokenHolder[msg.sender][token] -= amount;
		(bool success,) = recipient.call{value: amount}('');
		require(success, 'Transfer');
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

	event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick);
	event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1);
	event Collect(address indexed owner, address recipient, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount0, uint128 amount1);
	mapping(bytes32 => Position) public positions;
	RetirementTokenMock public immutable token0;
	RetirementTokenMock public immutable token1;
	uint24 public constant fee = 3000;

	constructor(RetirementTokenMock token0_, RetirementTokenMock token1_) {
		token0 = token0_;
		token1 = token1_;
	}

	function swapForFixture(address tokenIn, address tokenOut, address recipient, uint256 amountIn, uint256 amountOut) external {
		require(tokenIn != tokenOut && (tokenOut == address(token0) || tokenOut == address(token1)), 'Tokens');
		require(RetirementTokenMock(tokenOut).transfer(recipient, amountOut), 'Transfer');
		emit Swap(msg.sender, recipient, tokenIn == address(token0) ? int256(amountIn) : -int256(amountOut), tokenIn == address(token1) ? int256(amountIn) : -int256(amountOut), uint160(1 << 96), 1000, 0);
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
		emit Burn(msg.sender, tickLower, tickUpper, amount, amount, amount * 2);
		return (amount, amount * 2);
	}

	function collect(address recipient, int24 tickLower, int24 tickUpper, uint128 amount0Requested, uint128 amount1Requested) external returns (uint128 amount0, uint128 amount1) {
		Position storage position = positions[positionKey(msg.sender, tickLower, tickUpper)];
		amount0 = amount0Requested < position.tokensOwed0 ? amount0Requested : position.tokensOwed0;
		amount1 = amount1Requested < position.tokensOwed1 ? amount1Requested : position.tokensOwed1;
		position.tokensOwed0 -= amount0;
		position.tokensOwed1 -= amount1;
		require(token0.transfer(recipient, amount0) && token1.transfer(recipient, amount1), 'Transfer');
		emit Collect(msg.sender, recipient, tickLower, tickUpper, amount0, amount1);
	}
}


contract RetirementV3RouterMock {
	struct ExactInputSingleParams {
		address tokenIn;
		address tokenOut;
		uint24 fee;
		address recipient;
		uint256 deadline;
		uint256 amountIn;
		uint256 amountOutMinimum;
		uint160 sqrtPriceLimitX96;
	}

	address public immutable factory;
	address public immutable WETH9;
	RetirementV3PoolMock public immutable pool;

	constructor(address factory_, address weth_, RetirementV3PoolMock pool_) {
		factory = factory_;
		WETH9 = weth_;
		pool = pool_;
	}

	function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut) {
		require(block.timestamp <= params.deadline, 'Deadline');
		require(params.fee == 10000 && params.sqrtPriceLimitX96 == 0, 'Route');
		amountOut = params.amountIn * 99 / 100;
		require(amountOut >= params.amountOutMinimum, 'Minimum output');
		require(RetirementTokenMock(params.tokenIn).transferFrom(msg.sender, address(pool), params.amountIn), 'Transfer');
		pool.swapForFixture(params.tokenIn, params.tokenOut, params.recipient, params.amountIn, amountOut);
	}
}

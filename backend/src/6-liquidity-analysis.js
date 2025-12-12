
// 6-liquidity-analysis.js
// Analyzes token liquidity: finds pools, checks LP holders, detects locks

const { ethers } = require('ethers');

// ===========================================
// CONFIGURATION
// ===========================================

// RPC endpoint (using Ethereum for now since Monad DEXes aren't live yet)
const RPC_URL = 'https://ethereum-rpc.publicnode.com';
const provider = new ethers.JsonRpcProvider(RPC_URL);

// Uniswap V2 Factory - this contract creates all trading pairs
// Every V2 pair is registered here
const UNISWAP_V2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';

// Common base tokens that tokens are paired with
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';

// Known liquidity locker contracts
const KNOWN_LOCKERS = [
    '0x663A5C229c09b049E36dCc11a9B0d4a8Eb9db214', // Unicrypt
    '0x71B5759d73262FBb223956913ecF4ecC51057641', // PinkLock
    '0xE2fE530C047f2d85298b07D9333C05737f1435fB', // Team.Finance
];

// Burn addresses (LP sent here = permanently locked)
const BURN_ADDRESSES = [
    '0x0000000000000000000000000000000000000000', // Zero address
    '0x000000000000000000000000000000000000dEaD', // Dead address
];

// ===========================================
// ABIs - The "language" to talk to contracts
// ===========================================

// Factory ABI - We only need one function: getPair
// This asks the factory: "What's the pool address for tokenA + tokenB?"
const FACTORY_ABI = [
    'function getPair(address tokenA, address tokenB) view returns (address pair)'
];

// Pair (Pool) ABI - Functions we need to read pool data
const PAIR_ABI = [
    // Get the two tokens in this pool
    'function token0() view returns (address)',
    'function token1() view returns (address)',
    
    // Get how much of each token is in the pool
    'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
    
    // LP token functions (the pair contract IS the LP token)
    'function totalSupply() view returns (uint256)',
    'function balanceOf(address owner) view returns (uint256)',
    'function decimals() view returns (uint8)'
];

// Standard ERC20 ABI for reading token info
const ERC20_ABI = [
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)'
];

// ===========================================
// FUNCTION 1: Find the liquidity pool
// ===========================================

async function findPool(tokenAddress) {
    console.log('\nSearching for liquidity pools...\n');
    
    // Create a contract instance to talk to the Factory
    const factory = new ethers.Contract(UNISWAP_V2_FACTORY, FACTORY_ABI, provider);
    
    // Base tokens to check - most tokens pair with one of these
    const baseTokens = [
        { address: WETH, name: 'WETH' },
        { address: USDC, name: 'USDC' },
        { address: USDT, name: 'USDT' }
    ];
    
    const foundPools = [];
    
    // Check each base token to see if a pool exists
    for (const base of baseTokens) {
        try {
            // Ask factory: "Is there a pool for TOKEN + BASE?"
            const pairAddress = await factory.getPair(tokenAddress, base.address);
            
            // If address is not zero, pool exists
            if (pairAddress !== '0x0000000000000000000000000000000000000000') {
                console.log('Found pool: ' + base.name + ' pair at ' + pairAddress);
                foundPools.push({
                    pairAddress: pairAddress,
                    baseToken: base.name,
                    baseTokenAddress: base.address
                });
            }
        } catch (error) {
            console.log('Error checking ' + base.name + ' pair: ' + error.message);
        }
    }
    
    if (foundPools.length === 0) {
        console.log('No liquidity pools found for this token');
    } else {
        console.log('\nTotal pools found: ' + foundPools.length);
    }
    
    return foundPools;
}

// ===========================================
// FUNCTION 2: Get liquidity amount in a pool
// ===========================================

async function getPoolLiquidity(poolInfo, tokenAddress) {
    console.log('\nAnalyzing liquidity in ' + poolInfo.baseToken + ' pool...\n');
    
    // Create contract instance for the pair
    const pair = new ethers.Contract(poolInfo.pairAddress, PAIR_ABI, provider);
    
    // Get which token is token0 and which is token1
    // Uniswap orders them by address, so we need to check
    const token0 = await pair.token0();
    const token1 = await pair.token1();
    
    // Get the reserves (how much of each token is in the pool)
    const reserves = await pair.getReserves();
    
    // Figure out which reserve belongs to which token
    let tokenReserve, baseReserve;
    if (token0.toLowerCase() === tokenAddress.toLowerCase()) {
        tokenReserve = reserves.reserve0;
        baseReserve = reserves.reserve1;
    } else {
        tokenReserve = reserves.reserve1;
        baseReserve = reserves.reserve0;
    }
    
    // Get decimals for proper formatting
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const baseContract = new ethers.Contract(poolInfo.baseTokenAddress, ERC20_ABI, provider);
    
    const tokenDecimals = await tokenContract.decimals();
    const baseDecimals = await baseContract.decimals();
    const tokenSymbol = await tokenContract.symbol();
    
    // Format the reserves to human-readable numbers
    const formattedTokenReserve = ethers.formatUnits(tokenReserve, tokenDecimals);
    const formattedBaseReserve = ethers.formatUnits(baseReserve, baseDecimals);
    
    console.log('Pool contents:');
    console.log('  ' + tokenSymbol + ': ' + Number(formattedTokenReserve).toLocaleString());
    console.log('  ' + poolInfo.baseToken + ': ' + Number(formattedBaseReserve).toLocaleString());
    
    // Calculate rough USD value (assuming ETH = $3000, stables = $1)
    let estimatedValueUSD;
    if (poolInfo.baseToken === 'WETH') {
        estimatedValueUSD = Number(formattedBaseReserve) * 3000 * 2; // x2 because pool has both sides
    } else {
        estimatedValueUSD = Number(formattedBaseReserve) * 2; // USDC/USDT
    }
    
    console.log('  Estimated total liquidity: $' + estimatedValueUSD.toLocaleString());
    
    // Risk assessment based on liquidity amount
    let liquidityRisk;
    if (estimatedValueUSD < 1000) {
        liquidityRisk = 'CRITICAL - Extremely low liquidity';
    } else if (estimatedValueUSD < 10000) {
        liquidityRisk = 'HIGH - Very low liquidity';
    } else if (estimatedValueUSD < 50000) {
        liquidityRisk = 'MEDIUM - Low liquidity';
    } else if (estimatedValueUSD < 100000) {
        liquidityRisk = 'LOW - Decent liquidity';
    } else {
        liquidityRisk = 'SAFE - Good liquidity';
    }
    
    console.log('  Liquidity risk: ' + liquidityRisk);
    
    return {
        pairAddress: poolInfo.pairAddress,
        baseToken: poolInfo.baseToken,
        tokenReserve: formattedTokenReserve,
        baseReserve: formattedBaseReserve,
        estimatedValueUSD: estimatedValueUSD,
        liquidityRisk: liquidityRisk
    };
}

// ===========================================
// FUNCTION 3: Check LP token distribution
// ===========================================

async function checkLPHolders(pairAddress) {
    console.log('\nAnalyzing LP token holders...\n');
    
    // The pair contract IS the LP token
    const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
    
    // Get total supply of LP tokens
    const totalSupply = await pair.totalSupply();
    const totalSupplyFormatted = ethers.formatUnits(totalSupply, 18);
    
    console.log('Total LP tokens: ' + Number(totalSupplyFormatted).toLocaleString());
    
    // Check how much LP is burned (sent to dead addresses)
    let burnedAmount = BigInt(0);
    for (const burnAddress of BURN_ADDRESSES) {
        const balance = await pair.balanceOf(burnAddress);
        burnedAmount = burnedAmount + balance;
    }
    const burnedPercent = Number(burnedAmount * BigInt(10000) / totalSupply) / 100;
    
    console.log('Burned LP: ' + burnedPercent.toFixed(2) + '%');
    
    // Check how much LP is in known lockers
    let lockedAmount = BigInt(0);
    const lockersWithBalance = [];
    
    for (const locker of KNOWN_LOCKERS) {
        const balance = await pair.balanceOf(locker);
        if (balance > 0) {
            lockedAmount = lockedAmount + balance;
            const lockerPercent = Number(balance * BigInt(10000) / totalSupply) / 100;
            lockersWithBalance.push({
                address: locker,
                percent: lockerPercent
            });
        }
    }
    const lockedPercent = Number(lockedAmount * BigInt(10000) / totalSupply) / 100;
    
    console.log('Locked LP: ' + lockedPercent.toFixed(2) + '%');
    if (lockersWithBalance.length > 0) {
        for (const locker of lockersWithBalance) {
            console.log('  - Locker ' + locker.address.slice(0, 10) + '...: ' + locker.percent.toFixed(2) + '%');
        }
    }
    
    // Calculate "safe" LP (burned + locked)
    const safePercent = burnedPercent + lockedPercent;
    const atRiskPercent = 100 - safePercent;
    
    console.log('\nLP Security Summary:');
    console.log('  Safe (burned + locked): ' + safePercent.toFixed(2) + '%');
    console.log('  At risk (can be removed): ' + atRiskPercent.toFixed(2) + '%');
    
    // Risk assessment
    let lpRisk;
    if (safePercent >= 95) {
        lpRisk = 'SAFE - Almost all LP is locked/burned';
    } else if (safePercent >= 80) {
        lpRisk = 'LOW - Most LP is secured';
    } else if (safePercent >= 50) {
        lpRisk = 'MEDIUM - Partial LP security';
    } else if (safePercent >= 20) {
        lpRisk = 'HIGH - Most LP can be removed';
    } else {
        lpRisk = 'CRITICAL - LP not secured';
    }
    
    console.log('  LP Risk: ' + lpRisk);
    
    return {
        totalSupply: totalSupplyFormatted,
        burnedPercent: burnedPercent,
        lockedPercent: lockedPercent,
        safePercent: safePercent,
        atRiskPercent: atRiskPercent,
        lpRisk: lpRisk,
        lockers: lockersWithBalance
    };
}

// ===========================================
// MAIN FUNCTION: Run complete liquidity analysis
// ===========================================

async function analyzeLiquidity(tokenAddress) {
    console.log('========================================');
    console.log('LIQUIDITY ANALYSIS');
    console.log('========================================');
    console.log('Token: ' + tokenAddress);
    
    try {
        // Step 1: Find all pools for this token
        const pools = await findPool(tokenAddress);
        
        if (pools.length === 0) {
            console.log('\nNo liquidity pools found. Token may not be tradeable.');
            return {
                success: false,
                error: 'No pools found',
                overallRisk: 'CRITICAL - No liquidity'
            };
        }
        
        // Step 2: Analyze each pool
        const poolAnalysis = [];
        
        for (const pool of pools) {
            console.log('\n----------------------------------------');
            
            // Get liquidity amount
            const liquidity = await getPoolLiquidity(pool, tokenAddress);
            
            // Check LP holder distribution
            const lpHolders = await checkLPHolders(pool.pairAddress);
            
            poolAnalysis.push({
                ...liquidity,
                ...lpHolders
            });
        }
        
        // Step 3: Calculate overall risk
        console.log('\n========================================');
        console.log('FINAL LIQUIDITY REPORT');
        console.log('========================================');
        
        // Find the main pool (highest liquidity)
        const mainPool = poolAnalysis.reduce((a, b) => 
            a.estimatedValueUSD > b.estimatedValueUSD ? a : b
        );
        
        console.log('\nMain pool: ' + mainPool.baseToken);
        console.log('Liquidity: $' + mainPool.estimatedValueUSD.toLocaleString());
        console.log('LP Burned: ' + mainPool.burnedPercent.toFixed(2) + '%');
        console.log('LP Locked: ' + mainPool.lockedPercent.toFixed(2) + '%');
        console.log('LP At Risk: ' + mainPool.atRiskPercent.toFixed(2) + '%');
        
        // Determine overall risk
        let overallRisk;
        const liquidityOK = mainPool.estimatedValueUSD >= 10000;
        const lpSecure = mainPool.safePercent >= 80;
        
        if (liquidityOK && lpSecure) {
            overallRisk = 'LOW';
        } else if (liquidityOK || lpSecure) {
            overallRisk = 'MEDIUM';
        } else if (mainPool.estimatedValueUSD >= 1000 || mainPool.safePercent >= 20) {
            overallRisk = 'HIGH';
        } else {
            overallRisk = 'CRITICAL';
        }
        
        console.log('\nOVERALL LIQUIDITY RISK: ' + overallRisk);
        
        if (overallRisk === 'CRITICAL' || overallRisk === 'HIGH') {
            console.log('\nWarnings:');
            if (mainPool.estimatedValueUSD < 10000) {
                console.log('  - Low liquidity makes large trades impossible');
            }
            if (mainPool.safePercent < 80) {
                console.log('  - ' + mainPool.atRiskPercent.toFixed(0) + '% of LP can be removed (rug risk)');
            }
        }
        
        return {
            success: true,
            pools: poolAnalysis,
            mainPool: mainPool,
            overallRisk: overallRisk
        };
        
    } catch (error) {
        console.log('\nError during analysis: ' + error.message);
        return {
            success: false,
            error: error.message,
            overallRisk: 'UNKNOWN'
        };
    }
}

// ===========================================
// COMMAND LINE INTERFACE
// ===========================================

const tokenAddress = process.argv[2];

if (!tokenAddress) {
    console.log('Usage: node 6-liquidity-analysis.js <TOKEN_ADDRESS>');
    console.log('Example: node 6-liquidity-analysis.js 0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE');
    console.log('\nThis will check:');
    console.log('  - Does the token have a liquidity pool?');
    console.log('  - How much liquidity is in the pool?');
    console.log('  - Is the LP burned or locked?');
    console.log('  - What % of LP can be rugged?');
} else {
    analyzeLiquidity(tokenAddress);
}

// 7-holder-analysis.js
// Analyzes token holder distribution to detect whale risk and pump & dump potential

const { ethers } = require('ethers');

// ===========================================
// CONFIGURATION
// ===========================================

// Moralis API for holder data (PRIMARY)
const MORALIS_API = 'https://deep-index.moralis.io/api/v2.2';
const MORALIS_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6ImU2MTU4NjFmLWNmNzctNGVjNS04MTEwLWVmZTYxYzNiNWI4MCIsIm9yZ0lkIjoiNDg1MTgzIiwidXNlcklkIjoiNDk5MTYyIiwidHlwZUlkIjoiYzk5NDU2Y2EtZjA0Zi00OTM2LWJhZGEtMzE1ZTkyMTU3M2M0IiwidHlwZSI6IlBST0pFQ1QiLCJpYXQiOjE3NjUyMzQzNzgsImV4cCI6NDkyMDk5NDM3OH0.ln9HWATfvheKJTDBW9SgdPJLTsxmLyl4jmRQ7LvXOyo';

// Etherscan API V2 for fallback
const ETHERSCAN_API = 'https://api.etherscan.io/v2/api';
const ETHERSCAN_API_KEY = 'K6K49AIR8VNA9WWMWZ1M9CZTV6BNRYETZ5';
const CHAIN_ID = 1; // Ethereum mainnet

// RPC for additional on-chain checks
const RPC_URL = 'https://ethereum-rpc.publicnode.com';
const provider = new ethers.JsonRpcProvider(RPC_URL);

// Addresses to exclude from risk calculation (not real holders)
const EXCLUDED_ADDRESSES = [
    '0x0000000000000000000000000000000000000000', // Zero address (burned)
    '0x000000000000000000000000000000000000dead', // Dead address (burned)
    '0xdead000000000000000042069420694206942069', // Dead address variant (SHIB burn)
    '0x0000000000000000000000000000000000000001', // Burn address variant
];

// Function to check if address is a burn/dead address
function isBurnAddress(address) {
    const addr = address.toLowerCase();
    // Check exact matches
    if (EXCLUDED_ADDRESSES.some(ex => ex.toLowerCase() === addr)) {
        return true;
    }
    // Check if starts with 0xdead or 0x0000
    if (addr.startsWith('0xdead') || addr === '0x0000000000000000000000000000000000000000') {
        return true;
    }
    return false;
}

// Known contract types to label
const KNOWN_CONTRACTS = {
    '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f': 'Uniswap V2 Factory',
    '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D': 'Uniswap V2 Router',
    '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2': 'WETH',
};

// ERC20 ABI for basic token info
const ERC20_ABI = [
    'function totalSupply() view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function balanceOf(address) view returns (uint256)'
];

// ===========================================
// FUNCTION 1: Get token info from blockchain
// ===========================================

async function getTokenInfo(tokenAddress) {
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    
    const [totalSupply, decimals, symbol] = await Promise.all([
        token.totalSupply(),
        token.decimals(),
        token.symbol()
    ]);
    
    return {
        totalSupply: totalSupply,
        decimals: decimals,
        symbol: symbol,
        formattedSupply: ethers.formatUnits(totalSupply, decimals)
    };
}

// ===========================================
// FUNCTION 2: Fetch top holders from Moralis (PRIMARY)
// ===========================================

async function fetchTopHolders(tokenAddress) {
    console.log('\nFetching top holders from Moralis...\n');
    
    // Moralis token owners endpoint
    const url = `${MORALIS_API}/erc20/${tokenAddress}/owners?chain=eth&order=DESC&limit=50`;
    
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'accept': 'application/json',
                'X-API-Key': MORALIS_API_KEY
            }
        });
        
        const data = await response.json();
        
        if (data.result && data.result.length > 0) {
            console.log('Found ' + data.result.length + ' top holders from Moralis');
            
            // Format Moralis response to match our expected structure
            const holders = data.result.map(holder => ({
                address: holder.owner_address,
                balance: holder.balance_formatted || ethers.formatUnits(holder.balance, 18),
                percent: parseFloat(holder.percentage_relative_to_total_supply) || 0
            }));
            
            return holders;
        } else {
            console.log('Moralis API returned no holders');
            console.log('Response:', JSON.stringify(data).slice(0, 200));
            return null;
        }
    } catch (error) {
        console.log('Moralis API failed: ' + error.message);
        return null;
    }
}

// ===========================================
// FUNCTION 3: Alternative - Get holders via transfer events
// ===========================================

async function getHoldersFromTransfers(tokenAddress, tokenInfo) {
    console.log('\nFetching holder data via transfer events...\n');
    
    // Get recent transfers to find active holders (V2 with chainid)
    const url = `${ETHERSCAN_API}?chainid=${CHAIN_ID}&module=account&action=tokentx&contractaddress=${tokenAddress}&page=1&offset=100&sort=desc&apikey=${ETHERSCAN_API_KEY}`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        console.log('API Response status: ' + data.status);
        console.log('API Response message: ' + data.message);
        
        if (data.status !== '1' || !data.result) {
            console.log('Could not fetch transfer data');
            console.log('Full response:', JSON.stringify(data).slice(0, 200));
            return null;
        }
        
        // Collect unique addresses from transfers
        const addresses = new Set();
        for (const tx of data.result) {
            addresses.add(tx.to.toLowerCase());
            addresses.add(tx.from.toLowerCase());
        }
        
        console.log('Found ' + addresses.size + ' unique addresses from recent transfers');
        
        // Get balances for each address
        const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        const holders = [];
        
        let checked = 0;
        for (const addr of addresses) {
            try {
                const balance = await token.balanceOf(addr);
                if (balance > 0) {
                    const formatted = ethers.formatUnits(balance, tokenInfo.decimals);
                    const percent = (Number(formatted) / Number(tokenInfo.formattedSupply)) * 100;
                    
                    holders.push({
                        address: addr,
                        balance: formatted,
                        percent: percent
                    });
                }
                checked++;
                // Progress indicator every 20 addresses
                if (checked % 20 === 0) {
                    console.log('Checked ' + checked + '/' + addresses.size + ' addresses...');
                }
            } catch (e) {
                // Skip addresses that fail
            }
        }
        
        // Sort by balance descending
        holders.sort((a, b) => Number(b.balance) - Number(a.balance));
        
        return holders.slice(0, 20); // Top 20
        
    } catch (error) {
        console.log('Error fetching transfers: ' + error.message);
        return null;
    }
}

// ===========================================
// FUNCTION 4: Check if address is a contract
// ===========================================

async function isContract(address) {
    try {
        const code = await provider.getCode(address);
        return code !== '0x'; // If code exists, it's a contract
    } catch {
        return false;
    }
}

// ===========================================
// FUNCTION 5: Analyze holder distribution
// ===========================================

async function analyzeHolders(holders, tokenInfo) {
    console.log('\nAnalyzing holder distribution...\n');
    
    const analysis = {
        totalHolders: holders.length,
        burnedPercent: 0,
        top10Percent: 0,
        top1Percent: 0,
        whales: [],        // Holders with >5%
        contracts: [],     // Contract addresses
        wallets: [],       // Regular wallets
    };
    
    for (let i = 0; i < holders.length; i++) {
        const holder = holders[i];
        const addr = holder.address.toLowerCase();
        const percent = holder.percent;
        
        // Check if burned/excluded
        const isBurned = isBurnAddress(addr);
        
        if (isBurned) {
            analysis.burnedPercent += percent;
            continue; // Don't count as risk
        }
        
        // Check if known contract
        const knownName = KNOWN_CONTRACTS[ethers.getAddress(addr)] || null;
        
        // Check if it's a contract address
        const contractCheck = await isContract(addr);
        
        // Build holder info
        const holderInfo = {
            rank: i + 1,
            address: addr,
            percent: percent.toFixed(2),
            balance: Number(holder.balance).toLocaleString(),
            type: contractCheck ? 'contract' : 'wallet',
            label: knownName || (contractCheck ? 'Unknown Contract' : 'Wallet')
        };
        
        // Categorize
        if (contractCheck) {
            analysis.contracts.push(holderInfo);
        } else {
            analysis.wallets.push(holderInfo);
        }
        
        // Track whales (>5%)
        if (percent > 5) {
            analysis.whales.push(holderInfo);
        }
        
        // Track top 1 and top 10
        if (i === 0) {
            analysis.top1Percent = percent;
        }
        if (i < 10) {
            analysis.top10Percent += percent;
        }
    }
    
    return analysis;
}

// ===========================================
// FUNCTION 6: Calculate risk score
// ===========================================

function calculateHolderRisk(analysis) {
    console.log('\nCalculating holder risk...\n');
    
    const risks = [];
    
    // Risk 1: Top holder concentration
    if (analysis.top1Percent > 30) {
        risks.push({
            level: 'CRITICAL',
            message: 'Top holder owns ' + analysis.top1Percent.toFixed(1) + '% - extreme concentration'
        });
    } else if (analysis.top1Percent > 20) {
        risks.push({
            level: 'HIGH',
            message: 'Top holder owns ' + analysis.top1Percent.toFixed(1) + '% - high concentration'
        });
    } else if (analysis.top1Percent > 10) {
        risks.push({
            level: 'MEDIUM',
            message: 'Top holder owns ' + analysis.top1Percent.toFixed(1) + '% - moderate concentration'
        });
    }
    
    // Risk 2: Top 10 concentration
    if (analysis.top10Percent > 70) {
        risks.push({
            level: 'CRITICAL',
            message: 'Top 10 holders own ' + analysis.top10Percent.toFixed(1) + '% - very concentrated'
        });
    } else if (analysis.top10Percent > 50) {
        risks.push({
            level: 'HIGH',
            message: 'Top 10 holders own ' + analysis.top10Percent.toFixed(1) + '% - concentrated'
        });
    }
    
    // Risk 3: Number of whales
    const walletWhales = analysis.whales.filter(w => w.type === 'wallet');
    if (walletWhales.length > 3) {
        risks.push({
            level: 'MEDIUM',
            message: walletWhales.length + ' wallet whales with >5% each'
        });
    }
    
    // Positive: High burn percentage
    if (analysis.burnedPercent > 50) {
        risks.push({
            level: 'POSITIVE',
            message: analysis.burnedPercent.toFixed(1) + '% of supply is burned'
        });
    }
    
    // Determine overall risk
    const criticalCount = risks.filter(r => r.level === 'CRITICAL').length;
    const highCount = risks.filter(r => r.level === 'HIGH').length;
    const positiveCount = risks.filter(r => r.level === 'POSITIVE').length;
    
    let overallRisk;
    if (criticalCount > 0) {
        overallRisk = 'CRITICAL';
    } else if (highCount > 0) {
        overallRisk = 'HIGH';
    } else if (risks.length - positiveCount > 0) {
        overallRisk = 'MEDIUM';
    } else {
        overallRisk = 'LOW';
    }
    
    return {
        risks: risks,
        overallRisk: overallRisk
    };
}

// ===========================================
// MAIN FUNCTION: Run complete holder analysis
// ===========================================

async function analyzeTokenHolders(tokenAddress) {
    console.log('========================================');
    console.log('HOLDER ANALYSIS');
    console.log('========================================');
    console.log('Token: ' + tokenAddress);
    
    try {
        // Step 1: Get token info
        console.log('\nFetching token info...');
        const tokenInfo = await getTokenInfo(tokenAddress);
        console.log('Token: ' + tokenInfo.symbol);
        console.log('Total Supply: ' + Number(tokenInfo.formattedSupply).toLocaleString());
        
        // Step 2: Try to get holders from Moralis (primary)
        let holders = await fetchTopHolders(tokenAddress);
        
        // Step 3: Fallback to Etherscan transfer method if Moralis fails
        if (!holders) {
            console.log('\nMoralis API failed, falling back to Etherscan transfer events...');
            holders = await getHoldersFromTransfers(tokenAddress, tokenInfo);
        }
        
        if (!holders || holders.length === 0) {
            console.log('\nCould not fetch holder data');
            return {
                success: false,
                error: 'Could not fetch holder data'
            };
        }
        
        // Step 4: Analyze the holders
        const analysis = await analyzeHolders(holders, tokenInfo);
        
        // Step 5: Calculate risk
        const riskResult = calculateHolderRisk(analysis);
        
        // Step 6: Print results
        console.log('========================================');
        console.log('HOLDER REPORT');
        console.log('========================================');
        
        console.log('\nDistribution Summary:');
        console.log('  Burned/Dead: ' + analysis.burnedPercent.toFixed(2) + '%');
        console.log('  Top 1 Holder: ' + analysis.top1Percent.toFixed(2) + '%');
        console.log('  Top 10 Holders: ' + analysis.top10Percent.toFixed(2) + '%');
        console.log('  Whale Count (>5%): ' + analysis.whales.length);
        
        console.log('\nTop Holders:');
        const topToShow = [...analysis.contracts, ...analysis.wallets]
            .sort((a, b) => Number(b.percent) - Number(a.percent))
            .slice(0, 10);
            
        for (const holder of topToShow) {
            const typeIcon = holder.type === 'contract' ? '[Contract]' : '[Wallet]';
            console.log('  #' + holder.rank + ' ' + holder.percent + '% - ' + typeIcon + ' ' + holder.label);
            console.log('      ' + holder.address.slice(0, 20) + '...');
        }
        
        console.log('\nRisk Assessment:');
        for (const risk of riskResult.risks) {
            const prefix = risk.level === 'POSITIVE' ? '+' : '-';
            console.log('  ' + prefix + ' [' + risk.level + '] ' + risk.message);
        }
        
        console.log('\n========================================');
        console.log('OVERALL HOLDER RISK: ' + riskResult.overallRisk);
        console.log('========================================');
        
        return {
            success: true,
            tokenInfo: tokenInfo,
            analysis: analysis,
            riskResult: riskResult
        };
        
    } catch (error) {
        console.log('\nError during analysis: ' + error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

// ===========================================
// COMMAND LINE INTERFACE
// ===========================================

const tokenAddress = process.argv[2];

if (!tokenAddress) {
    console.log('Usage: node 7-holder-analysis.js <TOKEN_ADDRESS>');
    console.log('Example: node 7-holder-analysis.js 0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE');
    console.log('\nThis will check:');
    console.log('  - Who are the top token holders?');
    console.log('  - Is ownership concentrated in few wallets?');
    console.log('  - How much is burned vs held by whales?');
    console.log('  - Is there pump & dump risk?');
} else {
    analyzeTokenHolders(tokenAddress);
}

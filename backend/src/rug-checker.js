
// ================================================================
// RUG CHECKER - Unified Token Security Scanner (Multi-Chain)
// ================================================================
// Combines all analysis modules into one comprehensive report
// Supports: ETH, BSC, Base, Polygon, Arbitrum, Avalanche, and more
// ================================================================

const { ethers } = require('ethers');
const https = require('https');
const { CHAINS, BURN_ADDRESSES, getChain, getSupportedChains, DEFAULT_CHAIN } = require('./chains');

// ================================================================
// CONFIGURATION
// ================================================================

// Moralis API for holder data (works across chains)
const MORALIS_API = 'https://deep-index.moralis.io/api/v2.2';
const MORALIS_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6ImU2MTU4NjFmLWNmNzctNGVjNS04MTEwLWVmZTYxYzNiNWI4MCIsIm9yZ0lkIjoiNDg1MTgzIiwidXNlcklkIjoiNDk5MTYyIiwidHlwZUlkIjoiYzk5NDU2Y2EtZjA0Zi00OTM2LWJhZGEtMzE1ZTkyMTU3M2M0IiwidHlwZSI6IlBST0pFQ1QiLCJpYXQiOjE3NjUyMzQzNzgsImV4cCI6NDkyMDk5NDM3OH0.ln9HWATfvheKJTDBW9SgdPJLTsxmLyl4jmRQ7LvXOyo';

// Security API for honeypot detection (GoPlus - works across chains)
const SECURITY_API = 'https://api.gopluslabs.io/api/v1/token_security';

// DexScreener API for social links and sentiment (free, no key required)
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex';

// CoinGecko API for real-time prices (free, no key required)
const COINGECKO_API = 'https://api.coingecko.com/api/v3';

// ABIs (same across all EVM chains)
const ERC20_ABI = [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function totalSupply() view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function owner() view returns (address)',
    'function balanceOf(address) view returns (uint256)'
];

const FACTORY_ABI = [
    'function getPair(address tokenA, address tokenB) view returns (address pair)'
];

const PAIR_ABI = [
    'function token0() view returns (address)',
    'function token1() view returns (address)',
    'function getReserves() view returns (uint112, uint112, uint32)',
    'function totalSupply() view returns (uint256)',
    'function balanceOf(address) view returns (uint256)'
];

// Dangerous patterns for scanning
const DANGEROUS_KEYWORDS = {
    minting: ['mint', 'issue', 'create', 'inflate'],
    pausing: ['pause', 'freeze', 'halt', 'suspend'],
    blacklisting: ['blacklist', 'blocklist', 'ban', 'exclude'],
    fees: ['setfee', 'settax', 'updatefee', 'updatetax'],
    ownership: ['owner', 'admin', 'governance'],
    upgrades: ['upgrade', 'proxy', 'setimplementation']
};

// ================================================================
// CHAIN CONTEXT - Dynamic provider and config per chain
// ================================================================

// Cache providers to avoid recreating
const providerCache = new Map();
const failedRpcs = new Set(); // Track failed RPCs to avoid retrying

function getProvider(chainKey) {
    const chain = getChain(chainKey);
    if (!chain) {
        throw new Error(`Unsupported chain: ${chainKey}`);
    }
    
    // Check if we need to try a backup RPC
    const cacheKey = `${chainKey}_provider`;
    if (!providerCache.has(cacheKey)) {
        // Build list of RPCs to try (primary + backups)
        const rpcsToTry = [chain.rpc];
        if (chain.rpcBackup && chain.rpcBackup.length > 0) {
            rpcsToTry.push(...chain.rpcBackup);
        }
        
        // Use first non-failed RPC, or primary if all failed
        let rpcUrl = chain.rpc;
        for (const rpc of rpcsToTry) {
            if (!failedRpcs.has(rpc)) {
                rpcUrl = rpc;
                break;
            }
        }
        
        providerCache.set(cacheKey, new ethers.JsonRpcProvider(rpcUrl));
    }
    return providerCache.get(cacheKey);
}

// Switch to backup RPC if primary fails
function switchToBackupRpc(chainKey) {
    const chain = getChain(chainKey);
    if (!chain) return;
    
    const cacheKey = `${chainKey}_provider`;
    
    // Mark current RPC as failed
    failedRpcs.add(chain.rpc);
    
    // Try backup RPCs
    if (chain.rpcBackup && chain.rpcBackup.length > 0) {
        for (const backupRpc of chain.rpcBackup) {
            if (!failedRpcs.has(backupRpc)) {
                console.log(`   [!] Switching to backup RPC: ${backupRpc}`);
                providerCache.set(cacheKey, new ethers.JsonRpcProvider(backupRpc));
                return true;
            }
        }
    }
    return false;
}

function getChainConfig(chainKey) {
    const chain = getChain(chainKey);
    if (!chain) {
        throw new Error(`Unsupported chain: ${chainKey}. Supported: ${getSupportedChains().map(c => c.key).join(', ')}`);
    }
    return chain;
}

// ================================================================
// HELPER FUNCTIONS
// ================================================================

// Cache for native token prices (refreshes every 60 seconds)
const priceCache = new Map();
const PRICE_CACHE_DURATION = 60000; // 1 minute

async function getNativeTokenPrice(chainKey) {
    const chain = getChainConfig(chainKey);
    const cacheKey = chain.native.coingeckoId;
    const cached = priceCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.time) < PRICE_CACHE_DURATION) {
        return cached.price;
    }
    
    try {
        // Try CoinGecko first
        const url = `${COINGECKO_API}/simple/price?ids=${chain.native.coingeckoId}&vs_currencies=usd`;
        const response = await fetchJSON(url);
        
        if (response?.[chain.native.coingeckoId]?.usd) {
            const price = response[chain.native.coingeckoId].usd;
            priceCache.set(cacheKey, { price, time: Date.now() });
            return price;
        }
    } catch (error) {
        // CoinGecko failed, try DexScreener for wrapped token
        try {
            const dexUrl = `${DEXSCREENER_API}/tokens/${chain.native.wrapped}`;
            const dexResponse = await fetchJSON(dexUrl);
            if (dexResponse?.pairs?.[0]?.priceUsd) {
                const price = parseFloat(dexResponse.pairs[0].priceUsd);
                priceCache.set(cacheKey, { price, time: Date.now() });
                return price;
            }
        } catch {}
    }
    
    // Fallback defaults
    const fallbacks = {
        'ethereum': 3500,
        'binancecoin': 600,
        'matic-network': 0.8,
        'avalanche-2': 35,
        'fantom': 0.5
    };
    
    console.log(`   [!] Could not fetch live ${chain.native.symbol} price, using fallback`);
    return fallbacks[chain.native.coingeckoId] || 1;
}

function formatSmallNumber(num) {
    if (num === 0) return '0';
    if (num >= 1) {
        return num.toLocaleString('en-US', { maximumFractionDigits: 6 });
    }
    const str = num.toFixed(18);
    const trimmed = str.replace(/\.?0+$/, '');
    if (trimmed === '0') {
        const match = str.match(/0\.(0*)([1-9])/);
        if (match) {
            const zeros = match[1].length;
            return `0.${'0'.repeat(zeros)}${str.slice(zeros + 2, zeros + 8)}`.replace(/0+$/, '');
        }
    }
    return trimmed;
}

function isBurnAddress(address) {
    const addr = address.toLowerCase();
    if (BURN_ADDRESSES.some(ex => ex.toLowerCase() === addr)) return true;
    if (addr.startsWith('0xdead')) return true;
    if (addr === '0x0000000000000000000000000000000000000000') return true;
    return false;
}

async function fetchJSON(url, options = {}) {
    return new Promise((resolve) => {
        const urlObj = new URL(url);
        const requestOptions = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || {}
        };
        
        const protocol = urlObj.protocol === 'https:' ? https : require('http');
        
        const request = protocol.request(requestOptions, (response) => {
            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
                    resolve(null);
                }
            });
        });
        request.on('error', () => resolve(null));
        request.setTimeout(15000, () => { request.destroy(); resolve(null); });
        request.end();
    });
}

function printSection(title, status) {
    const statusIcon = status === 'PASS' ? 'PASS' : status === 'WARN' ? 'WARN' : status === 'FAIL' ? 'FAIL' : 'INFO';
    console.log(`\n[${statusIcon}] ${title}`);
    console.log('-'.repeat(50));
}

// ================================================================
// MODULE 1: BASIC TOKEN INFO (Enhanced with Age)
// ================================================================

async function checkTokenInfo(tokenAddress, chainKey = DEFAULT_CHAIN) {
    const chain = getChainConfig(chainKey);
    const provider = getProvider(chainKey);
    
    try {
        const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        
        const [name, symbol, decimals, totalSupply] = await Promise.all([
            token.name(),
            token.symbol(),
            token.decimals(),
            token.totalSupply()
        ]);
        
        const formattedSupply = ethers.formatUnits(totalSupply, decimals);
        
        // Check owner
        let owner = null;
        let ownerStatus = 'unknown';
        try {
            owner = await token.owner();
            if (owner === '0x0000000000000000000000000000000000000000') {
                ownerStatus = 'renounced';
            } else {
                ownerStatus = 'active';
            }
        } catch {
            ownerStatus = 'no-owner-function';
        }
        
        // Get contract age (from first transaction) - only if explorer API key available
        let contractAge = null;
        let creationDate = null;
        
        if (chain.explorer.apiKey) {
            try {
                const url = `${chain.explorer.api}?chainid=${chain.chainId}&module=account&action=txlist&address=${tokenAddress}&startblock=0&endblock=99999999&page=1&offset=1&sort=asc&apikey=${chain.explorer.apiKey}`;
                const data = await fetchJSON(url);
                if (data?.result?.[0]) {
                    const timestamp = parseInt(data.result[0].timeStamp);
                    creationDate = new Date(timestamp * 1000);
                    const ageMs = Date.now() - creationDate.getTime();
                    const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
                    contractAge = ageDays;
                }
            } catch {}
        }
        
        // Calculate burned supply
        let burnedSupply = 0;
        for (const burnAddr of BURN_ADDRESSES) {
            try {
                const balance = await token.balanceOf(burnAddr);
                burnedSupply += Number(ethers.formatUnits(balance, decimals));
            } catch {}
        }
        
        const totalSupplyNum = Number(formattedSupply);
        const burnedPercent = totalSupplyNum > 0 ? (burnedSupply / totalSupplyNum) * 100 : 0;
        const circulatingSupply = totalSupplyNum - burnedSupply;
        
        return {
            success: true,
            chain: chainKey,
            chainName: chain.name,
            name,
            symbol,
            decimals,
            totalSupply: formattedSupply,
            totalSupplyRaw: totalSupply,
            burnedSupply,
            burnedPercent,
            circulatingSupply,
            owner,
            ownerStatus,
            contractAge,
            creationDate,
            risk: ownerStatus === 'active' ? 'MEDIUM' : 'LOW'
        };
    } catch (error) {
        return { success: false, error: error.message, risk: 'UNKNOWN', chain: chainKey };
    }
}

// ================================================================
// MODULE 2: ABI FUNCTION SCAN
// ================================================================

async function checkContractFunctions(tokenAddress, chainKey = DEFAULT_CHAIN) {
    const chain = getChainConfig(chainKey);
    
    // Skip if no API key
    if (!chain.explorer.apiKey) {
        return { success: false, verified: false, risk: 'UNKNOWN', note: 'No explorer API key configured' };
    }
    
    const url = `${chain.explorer.api}?chainid=${chain.chainId}&module=contract&action=getabi&address=${tokenAddress}&apikey=${chain.explorer.apiKey}`;
    
    try {
        const result = await fetchJSON(url);
        
        if (!result || result.status !== '1') {
            return { success: false, verified: false, risk: 'UNKNOWN' };
        }
        
        const abi = JSON.parse(result.result);
        const functions = abi.filter(item => item.type === 'function').map(f => f.name.toLowerCase());
        
        const findings = { critical: [], high: [], medium: [], info: [] };
        
        for (const func of functions) {
            if (DANGEROUS_KEYWORDS.minting.some(k => func.includes(k))) {
                findings.critical.push({ name: func, risk: 'Can create new tokens' });
            }
            if (DANGEROUS_KEYWORDS.pausing.some(k => func.includes(k))) {
                findings.high.push({ name: func, risk: 'Can freeze trading' });
            }
            if (DANGEROUS_KEYWORDS.blacklisting.some(k => func.includes(k))) {
                findings.high.push({ name: func, risk: 'Can block wallets' });
            }
            if (DANGEROUS_KEYWORDS.fees.some(k => func.includes(k))) {
                findings.medium.push({ name: func, risk: 'Can change fees' });
            }
        }
        
        let risk = 'LOW';
        if (findings.critical.length > 0) risk = 'CRITICAL';
        else if (findings.high.length >= 2) risk = 'HIGH';
        else if (findings.high.length > 0 || findings.medium.length >= 2) risk = 'MEDIUM';
        
        return {
            success: true,
            verified: true,
            functionCount: functions.length,
            findings,
            risk
        };
    } catch (error) {
        return { success: false, error: error.message, risk: 'UNKNOWN' };
    }
}

// ================================================================
// MODULE 3: LIQUIDITY ANALYSIS (Enhanced with Price & Market Cap)
// ================================================================

async function checkLiquidity(tokenAddress, tokenInfo, chainKey = DEFAULT_CHAIN) {
    const chain = getChainConfig(chainKey);
    const provider = getProvider(chainKey);
    
    try {
        // First, get real-time price from DexScreener (aggregates all DEXes)
        let dexScreenerData = null;
        let priceInUSD = 0;
        let priceInNative = 0;
        let dexScreenerLiquidity = 0;
        let mainDex = 'Unknown';
        let mainPairAddress = null;
        
        try {
            const dexUrl = `${DEXSCREENER_API}/tokens/${tokenAddress}`;
            const dexResponse = await fetchJSON(dexUrl);
            
            if (dexResponse?.pairs && dexResponse.pairs.length > 0) {
                // Filter pairs for this chain and sort by liquidity
                const chainPairs = dexResponse.pairs.filter(p => 
                    p.chainId === chain.apis.dexscreener
                );
                
                if (chainPairs.length > 0) {
                    const sortedPairs = chainPairs.sort((a, b) => 
                        (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
                    );
                    const mainPair = sortedPairs[0];
                    
                    dexScreenerData = mainPair;
                    priceInUSD = parseFloat(mainPair.priceUsd) || 0;
                    priceInNative = parseFloat(mainPair.priceNative) || 0;
                    dexScreenerLiquidity = mainPair.liquidity?.usd || 0;
                    mainDex = mainPair.dexId || 'Unknown';
                    mainPairAddress = mainPair.pairAddress;
                }
            }
        } catch {}
        
        // Get real-time native token price
        const nativePrice = await getNativeTokenPrice(chainKey);
        
        // If DexScreener didn't have price, try on-chain DEXes as fallback
        let dexPairAddress = null;
        let nativeAmount = 0;
        let tokenAmount = 0;
        let dexLiquidity = 0;
        let foundDexName = '';
        
        // Build list of all DEXes to check (primary + additional)
        const dexesToCheck = [
            { name: chain.dex.name, factory: chain.dex.factory }
        ];
        
        // Add additional DEXes if configured (multi-DEX support)
        if (chain.additionalDexes && chain.additionalDexes.length > 0) {
            dexesToCheck.push(...chain.additionalDexes);
        }
        
        // Try each DEX factory until we find a pair
        for (const dex of dexesToCheck) {
            if (!dex.factory || dex.factory === '0x0000000000000000000000000000000000000000') continue;
            
            try {
                const factory = new ethers.Contract(dex.factory, FACTORY_ABI, provider);
                const pairAddr = await factory.getPair(tokenAddress, chain.native.wrapped);
                
                if (pairAddr && pairAddr !== '0x0000000000000000000000000000000000000000') {
                    const pair = new ethers.Contract(pairAddr, PAIR_ABI, provider);
                    const token0 = await pair.token0();
                    const reserves = await pair.getReserves();
                    
                    let nativeReserve, tokenReserve;
                    if (token0.toLowerCase() === chain.native.wrapped.toLowerCase()) {
                        nativeReserve = reserves[0];
                        tokenReserve = reserves[1];
                    } else {
                        nativeReserve = reserves[1];
                        tokenReserve = reserves[0];
                    }
                    
                    const thisNativeAmount = Number(ethers.formatEther(nativeReserve));
                    const thisTokenAmount = Number(ethers.formatUnits(tokenReserve, tokenInfo?.decimals || 18));
                    const thisLiquidity = thisNativeAmount * nativePrice * 2;
                    
                    // Use this DEX if it has more liquidity than previous
                    if (thisLiquidity > dexLiquidity) {
                        dexPairAddress = pairAddr;
                        nativeAmount = thisNativeAmount;
                        tokenAmount = thisTokenAmount;
                        dexLiquidity = thisLiquidity;
                        foundDexName = dex.name;
                        
                        // If no DexScreener price, calculate from DEX
                        if (priceInUSD === 0 && tokenAmount > 0) {
                            priceInNative = nativeAmount / tokenAmount;
                            priceInUSD = priceInNative * nativePrice;
                            mainDex = dex.name;
                            mainPairAddress = pairAddr;
                        }
                    }
                }
            } catch {}
        }
        
        // If still no price data, return error
        if (priceInUSD === 0) {
            return { success: false, error: 'No liquidity pool found', risk: 'CRITICAL' };
        }
        
        // Use the higher liquidity value
        const liquidityUSD = Math.max(dexScreenerLiquidity, dexLiquidity);
        const pairAddress = mainPairAddress || dexPairAddress;
        
        // Calculate market cap using circulating supply (total - burned)
        const totalSupplyNum = tokenInfo?.totalSupply ? parseFloat(tokenInfo.totalSupply.replace(/,/g, '')) : 0;
        const circulatingSupply = tokenInfo?.circulatingSupply || totalSupplyNum;
        const marketCap = priceInUSD * circulatingSupply;
        const fdv = priceInUSD * totalSupplyNum;
        
        // Check LP locks (only if we have a DEX pair)
        let burnedPercent = 0;
        let lockedPercent = 0;
        let safePercent = 0;
        let atRiskPercent = 100;
        
        if (dexPairAddress && dexPairAddress !== '0x0000000000000000000000000000000000000000') {
            try {
                const pair = new ethers.Contract(dexPairAddress, PAIR_ABI, provider);
                const lpTotalSupply = await pair.totalSupply();
                let burnedAmount = BigInt(0);
                let lockedAmount = BigInt(0);
                
                for (const addr of BURN_ADDRESSES) {
                    try {
                        const bal = await pair.balanceOf(addr);
                        burnedAmount += bal;
                    } catch {}
                }
                
                for (const addr of chain.lockers) {
                    try {
                        const bal = await pair.balanceOf(addr);
                        lockedAmount += bal;
                    } catch {}
                }
                
                if (lpTotalSupply > 0) {
                    burnedPercent = Number(burnedAmount * BigInt(10000) / lpTotalSupply) / 100;
                    lockedPercent = Number(lockedAmount * BigInt(10000) / lpTotalSupply) / 100;
                    safePercent = burnedPercent + lockedPercent;
                    atRiskPercent = 100 - safePercent;
                }
            } catch {}
        }
        
        let risk = 'LOW';
        if (liquidityUSD < 10000 && safePercent < 50) risk = 'CRITICAL';
        else if (liquidityUSD < 50000 || safePercent < 80) risk = 'MEDIUM';
        else if (safePercent < 50) risk = 'HIGH';
        
        return {
            success: true,
            pairAddress,
            mainDex,
            priceSource: dexScreenerData ? 'DexScreener (aggregated)' : chain.dex.name,
            nativeSymbol: chain.native.symbol,
            nativeAmount,
            tokenAmount,
            priceInNative,
            priceInUSD,
            nativePrice,
            marketCap,
            fdv,
            circulatingSupply,
            liquidityUSD,
            burnedPercent,
            lockedPercent,
            safePercent,
            atRiskPercent,
            risk
        };
    } catch (error) {
        return { success: false, error: error.message, risk: 'UNKNOWN' };
    }
}

// ================================================================
// MODULE 4: HOLDER ANALYSIS
// ================================================================

async function checkHolders(tokenAddress, chainKey = DEFAULT_CHAIN) {
    const chain = getChainConfig(chainKey);
    
    // Try Moralis first
    try {
        const url = `${MORALIS_API}/erc20/${tokenAddress}/owners?chain=${chain.apis.moralis}&order=DESC&limit=20`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'accept': 'application/json',
                'X-API-Key': MORALIS_API_KEY
            }
        });
        
        const data = await response.json();
        
        if (data.result && data.result.length > 0) {
            let burnedPercent = 0;
            let top1Percent = 0;
            let top10Percent = 0;
            const holders = [];
            
            for (let i = 0; i < data.result.length; i++) {
                const holder = data.result[i];
                const percent = parseFloat(holder.percentage_relative_to_total_supply) || 0;
                const addr = holder.owner_address.toLowerCase();
                
                if (isBurnAddress(addr)) {
                    burnedPercent += percent;
                    continue;
                }
                
                holders.push({
                    address: addr,
                    percent: percent
                });
                
                if (holders.length === 1) top1Percent = percent;
                if (holders.length <= 10) top10Percent += percent;
            }
            
            let risk = 'LOW';
            if (top1Percent > 30) risk = 'CRITICAL';
            else if (top1Percent > 20 || top10Percent > 70) risk = 'HIGH';
            else if (top1Percent > 10 || top10Percent > 50) risk = 'MEDIUM';
            
            return {
                success: true,
                source: 'Moralis',
                burnedPercent,
                top1Percent,
                top10Percent,
                topHolders: holders.slice(0, 10),
                risk
            };
        }
    } catch (e) {
        // Moralis failed, try GoPlus
    }
    
    // Fallback to GoPlus
    try {
        const goPlusUrl = `${SECURITY_API}/${chain.apis.goplus}?contract_addresses=${tokenAddress.toLowerCase()}`;
        const response = await fetchJSON(goPlusUrl);
        
        if (response && response.code === 1) {
            const tokenData = response.result[tokenAddress.toLowerCase()];
            
            if (tokenData && tokenData.holders && tokenData.holders.length > 0) {
                let burnedPercent = 0;
                let top1Percent = 0;
                let top10Percent = 0;
                const holders = [];
                
                for (const h of tokenData.holders) {
                    const percent = parseFloat(h.percent) * 100 || 0;
                    const addr = (h.address || '').toLowerCase();
                    
                    if (isBurnAddress(addr)) {
                        burnedPercent += percent;
                        continue;
                    }
                    
                    holders.push({
                        address: addr,
                        percent: percent,
                        isContract: h.is_contract === 1,
                        tag: h.tag || ''
                    });
                    
                    if (holders.length === 1) top1Percent = percent;
                    if (holders.length <= 10) top10Percent += percent;
                }
                
                let risk = 'LOW';
                if (top1Percent > 30) risk = 'CRITICAL';
                else if (top1Percent > 20 || top10Percent > 70) risk = 'HIGH';
                else if (top1Percent > 10 || top10Percent > 50) risk = 'MEDIUM';
                
                return {
                    success: true,
                    source: 'GoPlus',
                    holderCount: parseInt(tokenData.holder_count) || 0,
                    burnedPercent,
                    top1Percent,
                    top10Percent,
                    topHolders: holders.slice(0, 10),
                    risk
                };
            }
        }
    } catch (e) {
        // GoPlus also failed
    }
    
    return { success: false, error: 'No holder data available', risk: 'UNKNOWN' };
}

// ================================================================
// MODULE 5: HONEYPOT DETECTION
// ================================================================

async function checkHoneypot(tokenAddress, chainKey = DEFAULT_CHAIN) {
    const chain = getChainConfig(chainKey);
    const url = `${SECURITY_API}/${chain.apis.goplus}?contract_addresses=${tokenAddress.toLowerCase()}`;
    
    try {
        const response = await fetchJSON(url);
        
        if (!response || response.code !== 1) {
            return { success: false, error: 'Security API failed', risk: 'UNKNOWN' };
        }
        
        const tokenData = response.result[tokenAddress.toLowerCase()];
        
        if (!tokenData) {
            return { success: false, error: 'Token not in security database', risk: 'UNKNOWN' };
        }
        
        const toBool = (v) => v === '1' || v === 1 || v === true;
        const toPercent = (v) => {
            if (v === null || v === undefined || v === '') return null;
            const num = parseFloat(v);
            return isNaN(num) ? null : (num * 100);
        };
        
        const result = {
            success: true,
            isHoneypot: toBool(tokenData.is_honeypot),
            buyTax: toPercent(tokenData.buy_tax),
            sellTax: toPercent(tokenData.sell_tax),
            isProxy: toBool(tokenData.is_proxy),
            isMintable: toBool(tokenData.is_mintable),
            canTakeBackOwnership: toBool(tokenData.can_take_back_ownership),
            ownerCanChangeBalance: toBool(tokenData.owner_change_balance),
            hiddenOwner: toBool(tokenData.hidden_owner),
            cannotBuy: toBool(tokenData.cannot_buy),
            cannotSellAll: toBool(tokenData.cannot_sell_all),
            transferPausable: toBool(tokenData.transfer_pausable),
            isBlacklisted: toBool(tokenData.is_blacklisted),
            tradingCooldown: toBool(tokenData.trading_cooldown),
            isAntiWhale: toBool(tokenData.is_anti_whale),
            isOpenSource: toBool(tokenData.is_open_source),
            isAirdropScam: toBool(tokenData.is_airdrop_scam),
            lpHolders: tokenData.lp_holders || [],
            lpHolderCount: tokenData.lp_holder_count || '0',
            issues: { critical: [], high: [], medium: [], info: [] }
        };
        
        // Process LP holders
        let lpBurnedPercent = 0;
        let lpLockedPercent = 0;
        let lpUnlockedPercent = 0;
        const lpDetails = [];
        
        if (result.lpHolders && result.lpHolders.length > 0) {
            for (const holder of result.lpHolders) {
                const percent = parseFloat(holder.percent) * 100 || 0;
                const addr = (holder.address || '').toLowerCase();
                const tag = holder.tag || '';
                const isLocked = holder.is_locked === 1 || holder.is_locked === '1';
                
                const isBurned = addr.startsWith('0x0000000000000000000000000000000000000000') ||
                                 addr.startsWith('0x000000000000000000000000000000000000dead') ||
                                 addr.startsWith('0xdead') ||
                                 tag.toLowerCase().includes('burn') ||
                                 tag.toLowerCase().includes('dead');
                
                if (isBurned) {
                    lpBurnedPercent += percent;
                    lpDetails.push({ address: addr, percent, status: 'BURNED', tag: tag || 'Dead Address' });
                } else if (isLocked || tag.toLowerCase().includes('lock')) {
                    lpLockedPercent += percent;
                    lpDetails.push({ address: addr, percent, status: 'LOCKED', tag: tag || 'Locked' });
                } else {
                    lpUnlockedPercent += percent;
                    lpDetails.push({ address: addr, percent, status: 'UNLOCKED', tag: tag || 'Wallet' });
                }
            }
        }
        
        result.lpBurnedPercent = lpBurnedPercent;
        result.lpLockedPercent = lpLockedPercent;
        result.lpUnlockedPercent = lpUnlockedPercent;
        result.lpSafePercent = lpBurnedPercent + lpLockedPercent;
        result.lpDetails = lpDetails;
        
        // Extract token holder data from GoPlus (fallback for Moralis)
        result.holderCount = parseInt(tokenData.holder_count) || 0;
        result.tokenHolders = [];
        if (tokenData.holders && tokenData.holders.length > 0) {
            for (const h of tokenData.holders) {
                result.tokenHolders.push({
                    address: h.address,
                    percent: parseFloat(h.percent) * 100 || 0,
                    balance: h.balance,
                    isContract: h.is_contract === 1,
                    isLocked: h.is_locked === 1,
                    tag: h.tag || ''
                });
            }
        }
        
        // Categorize issues
        if (result.isHoneypot) result.issues.critical.push('HONEYPOT - Cannot sell');
        if (result.cannotBuy) result.issues.critical.push('Cannot buy');
        if (result.cannotSellAll) result.issues.critical.push('Cannot sell all tokens');
        if (result.isAirdropScam) result.issues.critical.push('Flagged as airdrop scam');
        if (result.sellTax !== null && result.sellTax > 50) result.issues.critical.push(`Extreme sell tax: ${result.sellTax.toFixed(1)}%`);
        
        if (result.ownerCanChangeBalance) result.issues.high.push('Owner can change balances');
        if (result.canTakeBackOwnership) result.issues.high.push('Can reclaim ownership');
        if (result.hiddenOwner) result.issues.high.push('Hidden owner');
        if (result.isMintable) result.issues.high.push('Mintable supply');
        if (result.sellTax !== null && result.sellTax > 20 && result.sellTax <= 50) result.issues.high.push(`High sell tax: ${result.sellTax.toFixed(1)}%`);
        
        if (result.isProxy) result.issues.medium.push('Proxy contract (upgradeable)');
        if (result.transferPausable) result.issues.medium.push('Transfers can be paused');
        if (result.isBlacklisted) result.issues.medium.push('Blacklist function');
        if (result.tradingCooldown) result.issues.medium.push('Trading cooldown');
        if (result.sellTax !== null && result.sellTax > 10 && result.sellTax <= 20) result.issues.medium.push(`Moderate sell tax: ${result.sellTax.toFixed(1)}%`);
        
        if (result.isOpenSource) result.issues.info.push('Contract verified');
        if (result.isAntiWhale) result.issues.info.push('Anti-whale mechanism');
        
        // LP risk assessment
        if (result.lpHolders.length > 0) {
            if (result.lpSafePercent < 20) {
                result.issues.critical.push(`Only ${result.lpSafePercent.toFixed(1)}% LP secured - HIGH RUG RISK`);
            } else if (result.lpSafePercent < 50) {
                result.issues.high.push(`${result.lpSafePercent.toFixed(1)}% LP secured - some rug risk`);
            } else if (result.lpSafePercent >= 80) {
                result.issues.info.push(`${result.lpSafePercent.toFixed(1)}% LP locked/burned`);
            }
        }
        
        // Calculate risk
        let risk = 'LOW';
        if (result.isHoneypot || result.issues.critical.length > 0) risk = 'CRITICAL';
        else if (result.issues.high.length >= 2) risk = 'HIGH';
        else if (result.issues.high.length > 0 || result.issues.medium.length >= 2) risk = 'MEDIUM';
        
        result.risk = risk;
        return result;
        
    } catch (error) {
        return { success: false, error: error.message, risk: 'UNKNOWN' };
    }
}

// ================================================================
// MODULE 6: SOCIAL & SENTIMENT (DexScreener API)
// ================================================================

async function checkSocialSentiment(tokenAddress, chainKey = DEFAULT_CHAIN) {
    const chain = getChainConfig(chainKey);
    const url = `${DEXSCREENER_API}/tokens/${tokenAddress}`;
    
    try {
        const response = await fetchJSON(url);
        
        if (!response || !response.pairs || response.pairs.length === 0) {
            return { success: false, error: 'Token not found on DexScreener', risk: 'UNKNOWN' };
        }
        
        // Filter pairs for this chain and get highest liquidity
        const chainPairs = response.pairs.filter(p => 
            p.chainId === chain.apis.dexscreener
        );
        
        if (chainPairs.length === 0) {
            return { success: false, error: `Token not found on ${chain.name}`, risk: 'UNKNOWN' };
        }
        
        const pairs = chainPairs.sort((a, b) => 
            (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
        );
        const mainPair = pairs[0];
        const tokenInfo = mainPair.baseToken.address.toLowerCase() === tokenAddress.toLowerCase() 
            ? mainPair.baseToken 
            : mainPair.quoteToken;
        
        const result = {
            success: true,
            tokenName: tokenInfo.name || 'Unknown',
            tokenSymbol: tokenInfo.symbol || 'Unknown',
            
            // Price changes
            priceChange5m: mainPair.priceChange?.m5 || 0,
            priceChange1h: mainPair.priceChange?.h1 || 0,
            priceChange6h: mainPair.priceChange?.h6 || 0,
            priceChange24h: mainPair.priceChange?.h24 || 0,
            
            // Volume
            volume24h: mainPair.volume?.h24 || 0,
            volume1h: mainPair.volume?.h1 || 0,
            
            // Transactions
            txns24h: mainPair.txns?.h24 || { buys: 0, sells: 0 },
            txns1h: mainPair.txns?.h1 || { buys: 0, sells: 0 },
            
            // Social links
            socials: mainPair.info?.socials || [],
            websites: mainPair.info?.websites || [],
            
            // Token images from DexScreener
            imageUrl: mainPair.info?.imageUrl || null,
            headerUrl: mainPair.info?.header || null,
            
            // URLs
            dexScreenerUrl: `https://dexscreener.com/${mainPair.chainId}/${mainPair.pairAddress}`,
            explorerUrl: `${chain.explorer.url}/token/${tokenAddress}`,
            pairAddress: mainPair.pairAddress,
            dexId: mainPair.dexId,
            totalPairs: pairs.length
        };
        
        // Calculate sentiment score
        let sentimentScore = 50;
        
        if (result.priceChange24h > 0) sentimentScore += Math.min(result.priceChange24h / 2, 15);
        else sentimentScore += Math.max(result.priceChange24h / 2, -15);
        
        if (result.priceChange1h > 0) sentimentScore += Math.min(result.priceChange1h / 2, 10);
        else sentimentScore += Math.max(result.priceChange1h / 2, -10);
        
        const totalBuys = result.txns24h.buys || 0;
        const totalSells = result.txns24h.sells || 0;
        const totalTxns = totalBuys + totalSells;
        
        if (totalTxns > 0) {
            const buyRatio = totalBuys / totalTxns;
            sentimentScore += (buyRatio - 0.5) * 40;
        }
        
        // Factor in volume - low volume is a negative signal
        const volume24h = result.volume24h || 0;
        if (volume24h < 1000) {
            sentimentScore -= 15; // Very low volume
        } else if (volume24h < 10000) {
            sentimentScore -= 5; // Low volume
        } else if (volume24h > 100000) {
            sentimentScore += 5; // High volume
        }
        
        sentimentScore = Math.max(0, Math.min(100, sentimentScore));
        
        let sentimentLevel;
        if (sentimentScore >= 70) sentimentLevel = 'VERY BULLISH';
        else if (sentimentScore >= 55) sentimentLevel = 'BULLISH';
        else if (sentimentScore >= 45) sentimentLevel = 'NEUTRAL';
        else if (sentimentScore >= 30) sentimentLevel = 'BEARISH';
        else sentimentLevel = 'VERY BEARISH';
        
        result.sentimentScore = Math.round(sentimentScore);
        result.sentimentLevel = sentimentLevel;
        result.buyRatio = totalTxns > 0 ? (totalBuys / totalTxns * 100).toFixed(1) : 'N/A';
        result.volumeActivity = result.volume24h > 10000 ? 'HIGH' : result.volume24h > 1000 ? 'MEDIUM' : 'LOW';
        
        return result;
        
    } catch (error) {
        return { success: false, error: error.message, risk: 'UNKNOWN' };
    }
}

// ================================================================
// MAIN: RUN ALL CHECKS
// ================================================================

async function rugCheck(tokenAddress, chainKey = DEFAULT_CHAIN) {
    const chain = getChainConfig(chainKey);
    
    console.log('\n');
    console.log('='.repeat(60));
    console.log('   RUG CHECKER - Comprehensive Token Security Scan');
    console.log('='.repeat(60));
    console.log(`   Token: ${tokenAddress}`);
    console.log(`   Chain: ${chain.name} (${chain.shortName})`);
    console.log(`   Time:  ${new Date().toISOString()}`);
    console.log('='.repeat(60));
    
    const results = {
        tokenInfo: null,
        contractScan: null,
        liquidity: null,
        holders: null,
        honeypot: null,
        sentiment: null
    };
    
    // ============ CHECK 1: TOKEN INFO ============
    printSection('1. TOKEN INFO', 'INFO');
    results.tokenInfo = await checkTokenInfo(tokenAddress, chainKey);
    
    if (results.tokenInfo.success) {
        console.log(`   Contract:     ${tokenAddress}`);
        console.log(`   Name:         ${results.tokenInfo.name}`);
        console.log(`   Symbol:       ${results.tokenInfo.symbol}`);
        console.log(`   Decimals:     ${results.tokenInfo.decimals}`);
        console.log(`   Total Supply: ${Number(results.tokenInfo.totalSupply.replace(/,/g, '')).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
        console.log(`   Burned:       ${results.tokenInfo.burnedSupply.toLocaleString('en-US', { maximumFractionDigits: 2 })} (${results.tokenInfo.burnedPercent.toFixed(2)}%)`);
        console.log(`   Circulating:  ${results.tokenInfo.circulatingSupply.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
        
        if (results.tokenInfo.ownerStatus === 'renounced') {
            console.log(`   Owner:        ${results.tokenInfo.owner} [BURN ADDRESS]`);
            console.log(`   Owner Status: RENOUNCED (ownership burned)`);
        } else if (results.tokenInfo.ownerStatus === 'no-owner-function') {
            console.log(`   Owner:        No owner function found`);
            console.log(`   Owner Status: N/A`);
        } else {
            console.log(`   Owner:        ${results.tokenInfo.owner || 'N/A'}`);
            console.log(`   Owner Status: ACTIVE (can make changes)`);
        }
        
        if (results.tokenInfo.contractAge !== null) {
            const ageStr = results.tokenInfo.contractAge === 0 ? 'Less than 1 day' :
                           results.tokenInfo.contractAge === 1 ? '1 day' :
                           results.tokenInfo.contractAge < 30 ? `${results.tokenInfo.contractAge} days` :
                           results.tokenInfo.contractAge < 365 ? `${Math.floor(results.tokenInfo.contractAge / 30)} months` :
                           `${Math.floor(results.tokenInfo.contractAge / 365)} years`;
            console.log(`   Age:          ${ageStr} (created ${results.tokenInfo.creationDate.toISOString().split('T')[0]})`);
        }
        
        console.log(`   Risk:         ${results.tokenInfo.risk}`);
    } else {
        console.log(`   Error: ${results.tokenInfo.error}`);
    }
    
    // ============ CHECK 2: CONTRACT FUNCTIONS ============
    printSection('2. CONTRACT FUNCTIONS', 'INFO');
    results.contractScan = await checkContractFunctions(tokenAddress, chainKey);
    
    if (results.contractScan.success) {
        console.log(`   Verified:     Yes`);
        console.log(`   Total Funcs:  ${results.contractScan.functionCount}`);
        console.log(`   Critical:     ${results.contractScan.findings.critical.length} issues`);
        console.log(`   High:         ${results.contractScan.findings.high.length} issues`);
        console.log(`   Medium:       ${results.contractScan.findings.medium.length} issues`);
        
        if (results.contractScan.findings.critical.length > 0) {
            console.log(`   `);
            console.log(`   CRITICAL FUNCTIONS FOUND:`);
            results.contractScan.findings.critical.forEach(f => {
                console.log(`     [!] ${f.name}() - ${f.risk}`);
            });
        }
        if (results.contractScan.findings.high.length > 0) {
            console.log(`   `);
            console.log(`   HIGH RISK FUNCTIONS:`);
            results.contractScan.findings.high.forEach(f => {
                console.log(`     [!] ${f.name}() - ${f.risk}`);
            });
        }
        if (results.contractScan.findings.medium.length > 0) {
            console.log(`   `);
            console.log(`   MEDIUM RISK FUNCTIONS:`);
            results.contractScan.findings.medium.forEach(f => {
                console.log(`     [-] ${f.name}() - ${f.risk}`);
            });
        }
        console.log(`   `);
        console.log(`   Risk:         ${results.contractScan.risk}`);
    } else {
        console.log(`   Verified:     No (contract not verified on ${chain.explorer.name})`);
        console.log(`   Note:         Unverified contracts are higher risk`);
        console.log(`   Risk:         ${results.contractScan.risk}`);
    }
    
    // ============ CHECK 3: LIQUIDITY ============
    printSection('3. LIQUIDITY & MARKET DATA', 'INFO');
    results.liquidity = await checkLiquidity(tokenAddress, results.tokenInfo, chainKey);
    
    if (results.liquidity.success) {
        console.log(`   PRICE & MARKET DATA:`);
        console.log(`   ${chain.native.symbol} Price: $${results.liquidity.nativePrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
        console.log(`   Token Price:  $${formatSmallNumber(results.liquidity.priceInUSD)} / ${formatSmallNumber(results.liquidity.priceInNative)} ${chain.native.symbol}`);
        console.log(`   Market Cap:   $${results.liquidity.marketCap.toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
        console.log(`   FDV:          $${results.liquidity.fdv.toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
        console.log(`   `);
        console.log(`   LIQUIDITY POOL:`);
        console.log(`   Pool Address: ${results.liquidity.pairAddress}`);
        console.log(`   Liquidity:    $${results.liquidity.liquidityUSD.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
        console.log(`   `);
        console.log(`   Risk:         ${results.liquidity.risk}`);
    } else {
        console.log(`   Error: ${results.liquidity.error}`);
        console.log(`   Note:  No ${chain.native.symbol} liquidity pool found on ${chain.dex.name}`);
        console.log(`   Risk:  ${results.liquidity.risk}`);
    }
    
    // ============ CHECK 4: HOLDERS ============
    printSection('4. HOLDER DISTRIBUTION', 'INFO');
    results.holders = await checkHolders(tokenAddress, chainKey);
    
    if (results.holders.success) {
        console.log(`   SUPPLY DISTRIBUTION:`);
        console.log(`   Burned/Dead:  ${results.holders.burnedPercent.toFixed(4)}%`);
        console.log(`   Circulating:  ${(100 - results.holders.burnedPercent).toFixed(4)}%`);
        console.log(`   `);
        console.log(`   CONCENTRATION:`);
        console.log(`   Top 1 Holder: ${results.holders.top1Percent.toFixed(4)}%`);
        console.log(`   Top 5 Hold:   ${results.holders.topHolders.slice(0, 5).reduce((a, h) => a + h.percent, 0).toFixed(4)}%`);
        console.log(`   Top 10 Hold:  ${results.holders.top10Percent.toFixed(4)}%`);
        console.log(`   `);
        console.log(`   TOP 5 HOLDERS:`);
        results.holders.topHolders.slice(0, 5).forEach((h, i) => {
            console.log(`     ${i + 1}. ${h.address}`);
            console.log(`        Holding: ${h.percent.toFixed(4)}%`);
        });
        console.log(`   `);
        console.log(`   Risk:         ${results.holders.risk}`);
    } else {
        console.log(`   Error: ${results.holders.error}`);
        console.log(`   Risk:  ${results.holders.risk}`);
    }
    
    // ============ CHECK 5: HONEYPOT ============
    printSection('5. HONEYPOT DETECTION', 'INFO');
    results.honeypot = await checkHoneypot(tokenAddress, chainKey);
    
    if (results.honeypot.success) {
        console.log(`   HONEYPOT STATUS:`);
        if (results.honeypot.isHoneypot) {
            console.log(`   [!!!] THIS IS A HONEYPOT - CANNOT SELL`);
        } else {
            console.log(`   Status:       Not a honeypot`);
        }
        console.log(`   `);
        console.log(`   TRADING TAXES:`);
        console.log(`   Buy Tax:      ${results.honeypot.buyTax !== null ? results.honeypot.buyTax.toFixed(2) + '%' : 'Unknown'}`);
        console.log(`   Sell Tax:     ${results.honeypot.sellTax !== null ? results.honeypot.sellTax.toFixed(2) + '%' : 'Unknown'}`);
        console.log(`   `);
        console.log(`   CONTRACT FLAGS:`);
        console.log(`   Open Source:  ${results.honeypot.isOpenSource ? 'Yes' : 'No'}`);
        console.log(`   Proxy:        ${results.honeypot.isProxy ? 'Yes (RISKY)' : 'No'}`);
        console.log(`   Mintable:     ${results.honeypot.isMintable ? 'Yes (RISKY)' : 'No'}`);
        console.log(`   Hidden Owner: ${results.honeypot.hiddenOwner ? 'Yes (RISKY)' : 'No'}`);
        console.log(`   Can Reclaim:  ${results.honeypot.canTakeBackOwnership ? 'Yes (RISKY)' : 'No'}`);
        console.log(`   `);
        console.log(`   TRADING FLAGS:`);
        console.log(`   Cannot Buy:   ${results.honeypot.cannotBuy ? 'Yes (CRITICAL)' : 'No'}`);
        console.log(`   Cannot Sell:  ${results.honeypot.cannotSellAll ? 'Yes (CRITICAL)' : 'No'}`);
        console.log(`   Pausable:     ${results.honeypot.transferPausable ? 'Yes' : 'No'}`);
        console.log(`   Blacklist:    ${results.honeypot.isBlacklisted ? 'Yes' : 'No'}`);
        console.log(`   Anti-Whale:   ${results.honeypot.isAntiWhale ? 'Yes' : 'No'}`);
        
        if (results.honeypot.lpHolders && results.honeypot.lpHolders.length > 0) {
            console.log(`   `);
            console.log(`   LP SECURITY:`);
            console.log(`   LP Holders:   ${results.honeypot.lpHolderCount}`);
            console.log(`   LP Burned:    ${results.honeypot.lpBurnedPercent.toFixed(2)}%`);
            console.log(`   LP Locked:    ${results.honeypot.lpLockedPercent.toFixed(2)}%`);
            console.log(`   LP Safe:      ${results.honeypot.lpSafePercent.toFixed(2)}%`);
            console.log(`   LP At Risk:   ${results.honeypot.lpUnlockedPercent.toFixed(2)}%`);
            
            if (results.honeypot.lpDetails && results.honeypot.lpDetails.length > 0) {
                console.log(`   `);
                console.log(`   TOP LP HOLDERS:`);
                results.honeypot.lpDetails.slice(0, 3).forEach((lp, i) => {
                    const statusIcon = lp.status === 'BURNED' ? 'BURNED' : 
                                       lp.status === 'LOCKED' ? 'LOCKED' : 'AT RISK';
                    console.log(`     ${i + 1}. ${lp.percent.toFixed(2)}% [${statusIcon}] ${lp.tag}`);
                });
            }
        }
        
        if (results.honeypot.issues.critical.length > 0 || results.honeypot.issues.high.length > 0) {
            console.log(`   `);
            console.log(`   ISSUES DETECTED:`);
            results.honeypot.issues.critical.forEach(i => console.log(`     [!!!] ${i}`));
            results.honeypot.issues.high.forEach(i => console.log(`     [!] ${i}`));
            results.honeypot.issues.medium.forEach(i => console.log(`     [-] ${i}`));
        }
        
        console.log(`   `);
        console.log(`   Risk:         ${results.honeypot.risk}`);
    } else {
        console.log(`   Error: ${results.honeypot.error}`);
        console.log(`   Note:  Token may be too new for security database`);
        console.log(`   Risk:  ${results.honeypot.risk}`);
    }
    
    // ============ CHECK 6: SOCIAL & SENTIMENT ============
    printSection('6. SOCIAL & MARKET SENTIMENT', 'INFO');
    results.sentiment = await checkSocialSentiment(tokenAddress, chainKey);
    
    if (results.sentiment.success) {
        console.log(`   PRICE ACTION:`);
        const fmtChange = (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
        console.log(`   5 min:        ${fmtChange(results.sentiment.priceChange5m)}`);
        console.log(`   1 hour:       ${fmtChange(results.sentiment.priceChange1h)}`);
        console.log(`   6 hours:      ${fmtChange(results.sentiment.priceChange6h)}`);
        console.log(`   24 hours:     ${fmtChange(results.sentiment.priceChange24h)}`);
        console.log(`   `);
        console.log(`   TRADING ACTIVITY:`);
        console.log(`   Volume 24h:   $${results.sentiment.volume24h.toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
        console.log(`   Activity:     ${results.sentiment.volumeActivity}`);
        console.log(`   Buys 24h:     ${results.sentiment.txns24h.buys}`);
        console.log(`   Sells 24h:    ${results.sentiment.txns24h.sells}`);
        console.log(`   Buy Ratio:    ${results.sentiment.buyRatio}%`);
        console.log(`   `);
        console.log(`   SENTIMENT:`);
        console.log(`   Score:        ${results.sentiment.sentimentScore}/100`);
        console.log(`   Level:        ${results.sentiment.sentimentLevel}`);
        
        if (results.sentiment.websites.length > 0 || results.sentiment.socials.length > 0) {
            console.log(`   `);
            console.log(`   SOCIAL LINKS:`);
            results.sentiment.websites.forEach(w => {
                console.log(`     [WEB] ${w.url}`);
            });
            results.sentiment.socials.forEach(s => {
                const platform = (s.type || 'link').toUpperCase();
                console.log(`     [${platform}] ${s.url}`);
            });
        }
        
        console.log(`   `);
        console.log(`   QUICK LINKS:`);
        console.log(`     DexScreener: ${results.sentiment.dexScreenerUrl}`);
        console.log(`     Explorer:    ${results.sentiment.explorerUrl}`);
    } else {
        console.log(`   Error: ${results.sentiment.error}`);
        console.log(`   Note:  Token may not have liquidity pools yet`);
    }
    
    // ============ FINAL REPORT ============
    console.log('\n');
    console.log('='.repeat(60));
    console.log('   FINAL RISK ASSESSMENT');
    console.log('='.repeat(60));
    
    // Calculate detailed risk score (0-100, higher = more risky)
    let riskScore = 0;
    
    if (results.tokenInfo?.success) {
        if (results.tokenInfo.ownerStatus === 'active') riskScore += 15;
        if (results.tokenInfo.contractAge !== null) {
            if (results.tokenInfo.contractAge < 7) riskScore += 10;
            else if (results.tokenInfo.contractAge < 30) riskScore += 5;
        }
    }
    
    if (results.contractScan?.success) {
        riskScore += results.contractScan.findings.critical.length * 10;
        riskScore += results.contractScan.findings.high.length * 5;
        riskScore += results.contractScan.findings.medium.length * 2;
    } else {
        riskScore += 15;
    }
    
    if (results.liquidity?.success) {
        if (results.liquidity.liquidityUSD < 1000) riskScore += 15;
        else if (results.liquidity.liquidityUSD < 10000) riskScore += 10;
        else if (results.liquidity.liquidityUSD < 50000) riskScore += 5;
        
        if (results.liquidity.safePercent < 20) riskScore += 10;
        else if (results.liquidity.safePercent < 50) riskScore += 7;
        else if (results.liquidity.safePercent < 80) riskScore += 3;
    } else {
        riskScore += 20;
    }
    
    if (results.holders?.success) {
        if (results.holders.top1Percent > 30) riskScore += 15;
        else if (results.holders.top1Percent > 20) riskScore += 10;
        else if (results.holders.top1Percent > 10) riskScore += 5;
        
        if (results.holders.top10Percent > 70) riskScore += 10;
        else if (results.holders.top10Percent > 50) riskScore += 5;
    }
    
    if (results.honeypot?.success) {
        if (results.honeypot.isHoneypot) riskScore += 50;
        if (results.honeypot.cannotBuy) riskScore += 20;
        if (results.honeypot.cannotSellAll) riskScore += 20;
        if (results.honeypot.ownerCanChangeBalance) riskScore += 15;
        if (results.honeypot.hiddenOwner) riskScore += 10;
        if (results.honeypot.canTakeBackOwnership) riskScore += 10;
        
        const sellTax = results.honeypot.sellTax || 0;
        if (sellTax > 50) riskScore += 25;
        else if (sellTax > 20) riskScore += 10;
        else if (sellTax > 10) riskScore += 5;
    }
    
    riskScore = Math.min(riskScore, 100);
    
    let overallRisk;
    if (riskScore >= 75) {
        overallRisk = 'CRITICAL';
    } else if (riskScore >= 50) {
        overallRisk = 'HIGH';
    } else if (riskScore >= 25) {
        overallRisk = 'MEDIUM';
    } else {
        overallRisk = 'LOW';
    }
    
    console.log(`\n   RISK BY CATEGORY:`);
    console.log(`   +-----------------------+------------+`);
    console.log(`   | Category              | Risk Level |`);
    console.log(`   +-----------------------+------------+`);
    console.log(`   | Token Info            | ${(results.tokenInfo?.risk || 'UNKNOWN').padEnd(10)} |`);
    console.log(`   | Contract Functions    | ${(results.contractScan?.risk || 'UNKNOWN').padEnd(10)} |`);
    console.log(`   | Liquidity             | ${(results.liquidity?.risk || 'UNKNOWN').padEnd(10)} |`);
    console.log(`   | Holder Distribution   | ${(results.holders?.risk || 'UNKNOWN').padEnd(10)} |`);
    console.log(`   | Honeypot Detection    | ${(results.honeypot?.risk || 'UNKNOWN').padEnd(10)} |`);
    console.log(`   | Market Sentiment      | ${(results.sentiment?.sentimentLevel || 'UNKNOWN').padEnd(10)} |`);
    console.log(`   +-----------------------+------------+`);
    
    console.log('\n' + '='.repeat(60));
    console.log('   ╔══════════════════════════════════════════════════════╗');
    console.log(`   ║  OVERALL RISK: ${overallRisk.padEnd(38)} ║`);
    console.log(`   ║  RISK SCORE:   ${riskScore}/100 ${('(' + '█'.repeat(Math.floor(riskScore / 5)) + '░'.repeat(20 - Math.floor(riskScore / 5)) + ')').padEnd(35)} ║`);
    console.log('   ╚══════════════════════════════════════════════════════╝');
    console.log('='.repeat(60));
    
    // Key findings
    console.log('\n   KEY FINDINGS:');
    
    if (results.tokenInfo?.success && results.tokenInfo.contractAge !== null) {
        if (results.tokenInfo.contractAge < 7) {
            console.log(`   [!] Very new token (${results.tokenInfo.contractAge} days old) - HIGH RISK`);
        } else if (results.tokenInfo.contractAge < 30) {
            console.log(`   [-] New token (${results.tokenInfo.contractAge} days old) - be cautious`);
        } else if (results.tokenInfo.contractAge > 365) {
            console.log(`   [+] Established token (${Math.floor(results.tokenInfo.contractAge / 365)} years old)`);
        }
    }
    
    if (results.liquidity?.success && results.liquidity.marketCap) {
        if (results.liquidity.marketCap < 100000) {
            console.log(`   [-] Very low market cap ($${results.liquidity.marketCap.toLocaleString('en-US', { maximumFractionDigits: 0 })})`);
        } else if (results.liquidity.marketCap > 10000000) {
            console.log(`   [+] Substantial market cap ($${(results.liquidity.marketCap / 1000000).toFixed(2)}M)`);
        }
    }
    
    if (results.tokenInfo?.success) {
        if (results.tokenInfo.ownerStatus === 'renounced') {
            console.log('   [+] Ownership BURNED to dead address (safe - no owner control)');
        } else if (results.tokenInfo.ownerStatus === 'active') {
            console.log('   [-] Owner still active (can make changes)');
        } else if (results.tokenInfo.ownerStatus === 'no-owner-function') {
            console.log('   [i] No owner function (may be safe or may be immutable)');
        }
    }
    
    if (results.contractScan?.success) {
        if (results.contractScan.findings.critical.length > 0) {
            console.log(`   [!] ${results.contractScan.findings.critical.length} CRITICAL functions found (mint/pause/etc)`);
        }
        if (results.contractScan.findings.high.length > 0) {
            console.log(`   [-] ${results.contractScan.findings.high.length} high-risk functions found`);
        }
        if (results.contractScan.findings.critical.length === 0 && results.contractScan.findings.high.length === 0) {
            console.log('   [+] No critical or high-risk functions detected');
        }
    }
    
    if (results.liquidity?.success) {
        if (results.liquidity.liquidityUSD > 100000) {
            console.log(`   [+] Good liquidity ($${results.liquidity.liquidityUSD.toLocaleString('en-US', { maximumFractionDigits: 0 })})`);
        } else if (results.liquidity.liquidityUSD < 10000) {
            console.log(`   [-] Low liquidity - hard to sell large amounts`);
        }
    }
    
    // Use honeypot LP data (more reliable than on-chain)
    if (results.honeypot?.success && results.honeypot.lpHolders?.length > 0) {
        const lpSafe = (results.honeypot.lpBurnedPercent || 0) + (results.honeypot.lpLockedPercent || 0);
        if (lpSafe > 80) {
            console.log(`   [+] ${lpSafe.toFixed(1)}% of LP is locked/burned`);
        } else if (lpSafe < 50) {
            console.log(`   [!] Only ${lpSafe.toFixed(1)}% of LP secured - RUG RISK`);
        }
    }
    
    if (results.holders?.success) {
        if (results.holders.burnedPercent > 30) {
            console.log(`   [+] ${results.holders.burnedPercent.toFixed(1)}% of supply burned`);
        }
        if (results.holders.top1Percent > 20) {
            console.log(`   [-] Top holder owns ${results.holders.top1Percent.toFixed(1)}% - whale risk`);
        }
        if (results.holders.top10Percent > 70) {
            console.log(`   [-] Top 10 holders own ${results.holders.top10Percent.toFixed(1)}% - concentrated`);
        }
    }
    
    if (results.honeypot?.success) {
        if (results.honeypot.isHoneypot) {
            console.log('   [!!!] HONEYPOT DETECTED - YOU CANNOT SELL THIS TOKEN');
        } else {
            console.log('   [+] Not a honeypot (verified)');
        }
        
        const sellTax = results.honeypot.sellTax || 0;
        const buyTax = results.honeypot.buyTax || 0;
        if (sellTax > 20) {
            console.log(`   [!] High sell tax: ${sellTax.toFixed(1)}%`);
        } else if (sellTax > 10) {
            console.log(`   [-] Moderate sell tax: ${sellTax.toFixed(1)}%`);
        } else if (sellTax <= 10 && buyTax <= 10) {
            console.log(`   [+] Low taxes (Buy: ${buyTax.toFixed(1)}%, Sell: ${sellTax.toFixed(1)}%)`);
        }
        
        if (results.honeypot.ownerCanChangeBalance) {
            console.log('   [!] Owner can modify token balances');
        }
        if (results.honeypot.hiddenOwner) {
            console.log('   [!] Hidden owner detected');
        }
    }
    
    if (results.sentiment?.success) {
        const sentiment = results.sentiment.sentimentLevel;
        if (sentiment === 'VERY BULLISH') {
            console.log(`   [+] Market sentiment: ${sentiment} (score: ${results.sentiment.sentimentScore}/100)`);
        } else if (sentiment === 'BULLISH') {
            console.log(`   [+] Market sentiment: ${sentiment} (score: ${results.sentiment.sentimentScore}/100)`);
        } else if (sentiment === 'BEARISH' || sentiment === 'VERY BEARISH') {
            console.log(`   [-] Market sentiment: ${sentiment} (score: ${results.sentiment.sentimentScore}/100)`);
        } else {
            console.log(`   [i] Market sentiment: ${sentiment} (score: ${results.sentiment.sentimentScore}/100)`);
        }
        
        if (results.sentiment.buyRatio !== 'N/A') {
            const buyRatio = parseFloat(results.sentiment.buyRatio);
            if (buyRatio > 60) {
                console.log(`   [+] Strong buying pressure (${buyRatio}% buys)`);
            } else if (buyRatio < 40) {
                console.log(`   [-] Heavy selling pressure (${buyRatio}% buys)`);
            }
        }
        
        const hasWebsite = results.sentiment.websites.length > 0;
        const hasSocials = results.sentiment.socials.length > 0;
        if (hasWebsite && hasSocials) {
            console.log('   [+] Has website and social media presence');
        } else if (!hasWebsite && !hasSocials) {
            console.log('   [-] No website or social links found');
        }
    }
    
    // Recommendations
    console.log('\n   RECOMMENDATIONS:');
    
    if (riskScore >= 75) {
        console.log('   ╔═══════════════════════════════════════════════════════╗');
        console.log('   ║  [X] EXTREME RISK - DO NOT INVEST                     ║');
        console.log('   ╚═══════════════════════════════════════════════════════╝');
        console.log('   [X] Multiple critical red flags detected');
        console.log('   [X] High probability of scam or rug pull');
        console.log('   [X] You WILL likely lose your money');
    } else if (riskScore >= 50) {
        console.log('   ╔═══════════════════════════════════════════════════════╗');
        console.log('   ║  [!] HIGH RISK - Significant concerns                 ║');
        console.log('   ╚═══════════════════════════════════════════════════════╝');
        console.log('   [!] Only invest what you can afford to lose completely');
        console.log('   [!] Consider this a gamble, not an investment');
        console.log('   [!] Monitor closely and exit if conditions worsen');
    } else if (riskScore >= 25) {
        console.log('   ╔═══════════════════════════════════════════════════════╗');
        console.log('   ║  [-] MEDIUM RISK - Proceed with caution               ║');
        console.log('   ╚═══════════════════════════════════════════════════════╝');
        console.log('   [-] Some concerns found - do additional research');
        console.log('   [-] Start with a small position to test');
        console.log('   [-] Set stop-losses and take-profit targets');
        console.log('   [-] Watch for whale movements');
    } else {
        console.log('   ╔═══════════════════════════════════════════════════════╗');
        console.log('   ║  [+] RELATIVELY LOW RISK - Basic checks passed        ║');
        console.log('   ╚═══════════════════════════════════════════════════════╝');
        console.log('   [+] No major red flags detected');
        console.log('   [+] Token appears to have reasonable security measures');
        console.log('   [+] Always DYOR (Do Your Own Research)');
        console.log('   [+] Past safety does not guarantee future safety');
    }
    
    console.log('\n   DISCLAIMER:');
    console.log('   This tool provides technical analysis only. It cannot detect:');
    console.log('   - Social engineering scams or fake teams');
    console.log('   - Future changes to contract parameters');
    console.log('   - Market manipulation or coordinated dumps');
    console.log('   Always invest responsibly and never more than you can afford to lose.');
    
    console.log('\n' + '='.repeat(60));
    console.log('   Scan completed at: ' + new Date().toISOString());
    console.log('='.repeat(60) + '\n');
    
    return {
        tokenAddress,
        chain: chainKey,
        chainName: chain.name,
        results,
        overallRisk,
        riskScore
    };
}

// ================================================================
// CLI
// ================================================================

const args = process.argv.slice(2);
const tokenAddress = args[0];
const chainArg = args[1] || DEFAULT_CHAIN;

if (!tokenAddress) {
    console.log('\nUsage: node rug-checker.js <TOKEN_ADDRESS> [CHAIN]');
    console.log('');
    console.log('Examples:');
    console.log('  node rug-checker.js 0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE eth');
    console.log('  node rug-checker.js 0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82 bsc');
    console.log('  node rug-checker.js 0x532f27101965dd16442e59d40670faf5ebb142e4 base');
    console.log('');
    console.log('Supported chains:');
    getSupportedChains().forEach(c => {
        console.log(`  ${c.key.padEnd(12)} - ${c.name}`);
    });
    console.log('');
} else {
    rugCheck(tokenAddress, chainArg);
}

// ================================================================
// SILENT SCAN (Returns data without console output - for bot/API use)
// ================================================================

async function silentScan(tokenAddress, chainKey = DEFAULT_CHAIN) {
    const chain = getChainConfig(chainKey);
    
    const results = {
        tokenInfo: await checkTokenInfo(tokenAddress, chainKey),
        contractScan: await checkContractFunctions(tokenAddress, chainKey),
        liquidity: null,
        holders: await checkHolders(tokenAddress, chainKey),
        honeypot: await checkHoneypot(tokenAddress, chainKey),
        sentiment: await checkSocialSentiment(tokenAddress, chainKey)
    };
    
    results.liquidity = await checkLiquidity(tokenAddress, results.tokenInfo, chainKey);
    
    // Calculate risk score
    let riskScore = 0;
    
    if (results.tokenInfo?.success) {
        if (results.tokenInfo.ownerStatus === 'active') riskScore += 15;
        if (results.tokenInfo.contractAge !== null) {
            if (results.tokenInfo.contractAge < 7) riskScore += 10;
            else if (results.tokenInfo.contractAge < 30) riskScore += 5;
        }
    }
    
    if (results.contractScan?.success) {
        riskScore += results.contractScan.findings.critical.length * 10;
        riskScore += results.contractScan.findings.high.length * 5;
        riskScore += results.contractScan.findings.medium.length * 2;
    } else {
        riskScore += 15;
    }
    
    if (results.liquidity?.success) {
        if (results.liquidity.liquidityUSD < 1000) riskScore += 15;
        else if (results.liquidity.liquidityUSD < 10000) riskScore += 10;
        else if (results.liquidity.liquidityUSD < 50000) riskScore += 5;
        
        if (results.liquidity.safePercent < 20) riskScore += 10;
        else if (results.liquidity.safePercent < 50) riskScore += 7;
        else if (results.liquidity.safePercent < 80) riskScore += 3;
    } else {
        riskScore += 20;
    }
    
    if (results.holders?.success) {
        if (results.holders.top1Percent > 30) riskScore += 15;
        else if (results.holders.top1Percent > 20) riskScore += 10;
        else if (results.holders.top1Percent > 10) riskScore += 5;
        
        if (results.holders.top10Percent > 70) riskScore += 10;
        else if (results.holders.top10Percent > 50) riskScore += 5;
    }
    
    if (results.honeypot?.success) {
        if (results.honeypot.isHoneypot) riskScore += 50;
        if (results.honeypot.cannotBuy) riskScore += 20;
        if (results.honeypot.cannotSellAll) riskScore += 20;
        if (results.honeypot.ownerCanChangeBalance) riskScore += 15;
        if (results.honeypot.hiddenOwner) riskScore += 10;
        if (results.honeypot.canTakeBackOwnership) riskScore += 10;
        
        const sellTax = results.honeypot.sellTax || 0;
        if (sellTax > 50) riskScore += 25;
        else if (sellTax > 20) riskScore += 10;
        else if (sellTax > 10) riskScore += 5;
    }
    
    riskScore = Math.min(riskScore, 100);
    
    let riskLevel;
    if (riskScore >= 75) riskLevel = 'CRITICAL';
    else if (riskScore >= 50) riskLevel = 'HIGH';
    else if (riskScore >= 25) riskLevel = 'MEDIUM';
    else riskLevel = 'LOW';
    
    return {
        tokenAddress,
        chain: chainKey,
        chainName: chain.name,
        results,
        riskScore,
        riskLevel,
        timestamp: new Date().toISOString()
    };
}

module.exports = { 
    rugCheck,
    silentScan,
    checkTokenInfo,
    checkContractFunctions,
    checkLiquidity,
    checkHolders,
    checkHoneypot,
    checkSocialSentiment,
    getNativeTokenPrice,
    formatSmallNumber,
    getChain,
    getSupportedChains,
    DEFAULT_CHAIN
};

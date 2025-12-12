
// ================================================================
// SOCIAL & SENTIMENT ANALYSIS
// ================================================================
// Fetches social media links, trading sentiment, and community data
// Uses DexScreener API (free, no key required)
// ================================================================

const https = require('https');

// DexScreener API - Free, no key required
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex';

// ================================================================
// HELPER FUNCTIONS
// ================================================================

function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        };
        
        https.get(url, options, (response) => {
            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (error) {
                    reject(new Error('Failed to parse response'));
                }
            });
        }).on('error', reject);
    });
}

function formatNumber(num) {
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    return num.toFixed(2);
}

function formatPrice(num) {
    if (num === 0) return '0';
    if (num >= 1) return num.toFixed(4);
    // For very small numbers
    const str = num.toFixed(18);
    const match = str.match(/0\.(0*)([1-9]\d*)/);
    if (match) {
        const zeros = match[1].length;
        const digits = match[2].slice(0, 4);
        return `0.${'0'.repeat(zeros)}${digits}`;
    }
    return num.toString();
}

function getSentimentEmoji(change) {
    if (change > 20) return 'VERY BULLISH';
    if (change > 5) return 'BULLISH';
    if (change > -5) return 'NEUTRAL';
    if (change > -20) return 'BEARISH';
    return 'VERY BEARISH';
}

// ================================================================
// MAIN FUNCTION
// ================================================================

async function analyzeSocialSentiment(tokenAddress, chain = 'ethereum') {
    const url = `${DEXSCREENER_API}/tokens/${tokenAddress}`;
    
    console.log('========================================');
    console.log('SOCIAL & SENTIMENT ANALYSIS');
    console.log('========================================');
    console.log(`Token: ${tokenAddress}`);
    console.log('');
    console.log('Fetching data from DexScreener...');
    
    try {
        const response = await fetchJSON(url);
        
        if (!response || !response.pairs || response.pairs.length === 0) {
            console.log('');
            console.log('Error: Token not found on DexScreener');
            console.log('This could mean:');
            console.log('  - Token has no liquidity pools');
            console.log('  - Token is too new');
            console.log('  - Invalid token address');
            return {
                success: false,
                error: 'Token not found on DexScreener',
                risk: 'UNKNOWN'
            };
        }
        
        // Get the main pair (highest liquidity)
        const pairs = response.pairs.sort((a, b) => 
            (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
        );
        const mainPair = pairs[0];
        const tokenInfo = mainPair.baseToken.address.toLowerCase() === tokenAddress.toLowerCase() 
            ? mainPair.baseToken 
            : mainPair.quoteToken;
        
        // Extract data
        const result = {
            success: true,
            
            // Token Info
            tokenName: tokenInfo.name || 'Unknown',
            tokenSymbol: tokenInfo.symbol || 'Unknown',
            tokenAddress: tokenAddress,
            
            // Price Data
            priceUsd: parseFloat(mainPair.priceUsd) || 0,
            priceNative: parseFloat(mainPair.priceNative) || 0,
            
            // Price Changes (Sentiment Indicators)
            priceChange5m: mainPair.priceChange?.m5 || 0,
            priceChange1h: mainPair.priceChange?.h1 || 0,
            priceChange6h: mainPair.priceChange?.h6 || 0,
            priceChange24h: mainPair.priceChange?.h24 || 0,
            
            // Volume (Activity Indicator)
            volume5m: mainPair.volume?.m5 || 0,
            volume1h: mainPair.volume?.h1 || 0,
            volume6h: mainPair.volume?.h6 || 0,
            volume24h: mainPair.volume?.h24 || 0,
            
            // Transactions (Activity)
            txns5m: mainPair.txns?.m5 || { buys: 0, sells: 0 },
            txns1h: mainPair.txns?.h1 || { buys: 0, sells: 0 },
            txns6h: mainPair.txns?.h6 || { buys: 0, sells: 0 },
            txns24h: mainPair.txns?.h24 || { buys: 0, sells: 0 },
            
            // Market Data
            marketCap: mainPair.marketCap || mainPair.fdv || 0,
            fdv: mainPair.fdv || 0,
            liquidity: mainPair.liquidity?.usd || 0,
            
            // Pair Info
            pairAddress: mainPair.pairAddress,
            dexId: mainPair.dexId,
            chainId: mainPair.chainId,
            
            // Social Links (from info if available)
            socials: mainPair.info?.socials || [],
            websites: mainPair.info?.websites || [],
            imageUrl: mainPair.info?.imageUrl || null,
            
            // All pairs for this token
            totalPairs: pairs.length,
            
            // URLs
            dexScreenerUrl: `https://dexscreener.com/${mainPair.chainId}/${mainPair.pairAddress}`,
            
            // Raw pairs data for additional analysis
            allPairs: pairs.slice(0, 5).map(p => ({
                dex: p.dexId,
                pairAddress: p.pairAddress,
                liquidity: p.liquidity?.usd || 0,
                volume24h: p.volume?.h24 || 0
            }))
        };
        
        // Calculate sentiment score based on price action and volume
        let sentimentScore = 50; // Start neutral
        
        // Price momentum (max +/- 30 points)
        if (result.priceChange24h > 0) sentimentScore += Math.min(result.priceChange24h / 2, 15);
        else sentimentScore += Math.max(result.priceChange24h / 2, -15);
        
        if (result.priceChange1h > 0) sentimentScore += Math.min(result.priceChange1h / 2, 10);
        else sentimentScore += Math.max(result.priceChange1h / 2, -10);
        
        // Buy/Sell ratio (max +/- 20 points)
        const totalBuys24h = result.txns24h.buys || 0;
        const totalSells24h = result.txns24h.sells || 0;
        const totalTxns24h = totalBuys24h + totalSells24h;
        
        if (totalTxns24h > 0) {
            const buyRatio = totalBuys24h / totalTxns24h;
            sentimentScore += (buyRatio - 0.5) * 40; // -20 to +20
        }
        
        // Volume trend (activity indicator)
        const volumeActivity = result.volume24h > 10000 ? 'HIGH' : 
                              result.volume24h > 1000 ? 'MEDIUM' : 'LOW';
        
        // Cap sentiment score
        sentimentScore = Math.max(0, Math.min(100, sentimentScore));
        
        // Determine sentiment level
        let sentimentLevel;
        if (sentimentScore >= 70) sentimentLevel = 'VERY BULLISH';
        else if (sentimentScore >= 55) sentimentLevel = 'BULLISH';
        else if (sentimentScore >= 45) sentimentLevel = 'NEUTRAL';
        else if (sentimentScore >= 30) sentimentLevel = 'BEARISH';
        else sentimentLevel = 'VERY BEARISH';
        
        result.sentimentScore = Math.round(sentimentScore);
        result.sentimentLevel = sentimentLevel;
        result.volumeActivity = volumeActivity;
        result.buyRatio24h = totalTxns24h > 0 ? (totalBuys24h / totalTxns24h * 100).toFixed(1) : 'N/A';
        
        // Print report
        console.log('');
        console.log('----------------------------------------');
        console.log('TOKEN INFO');
        console.log('----------------------------------------');
        console.log(`Name:    ${result.tokenName}`);
        console.log(`Symbol:  ${result.tokenSymbol}`);
        console.log(`Address: ${result.tokenAddress}`);
        
        console.log('');
        console.log('----------------------------------------');
        console.log('MARKET DATA');
        console.log('----------------------------------------');
        console.log(`Price:       $${formatPrice(result.priceUsd)}`);
        console.log(`Market Cap:  $${formatNumber(result.marketCap)}`);
        console.log(`FDV:         $${formatNumber(result.fdv)}`);
        console.log(`Liquidity:   $${formatNumber(result.liquidity)}`);
        console.log(`DEX:         ${result.dexId}`);
        console.log(`Total Pairs: ${result.totalPairs}`);
        
        console.log('');
        console.log('----------------------------------------');
        console.log('PRICE ACTION (Sentiment Indicators)');
        console.log('----------------------------------------');
        const formatChange = (val) => (val >= 0 ? '+' : '') + val.toFixed(2) + '%';
        console.log(`5 min:   ${formatChange(result.priceChange5m)} ${getSentimentEmoji(result.priceChange5m)}`);
        console.log(`1 hour:  ${formatChange(result.priceChange1h)} ${getSentimentEmoji(result.priceChange1h)}`);
        console.log(`6 hours: ${formatChange(result.priceChange6h)} ${getSentimentEmoji(result.priceChange6h)}`);
        console.log(`24 hours:${formatChange(result.priceChange24h)} ${getSentimentEmoji(result.priceChange24h)}`);
        
        console.log('');
        console.log('----------------------------------------');
        console.log('TRADING ACTIVITY');
        console.log('----------------------------------------');
        console.log(`Volume 24h:  $${formatNumber(result.volume24h)}`);
        console.log(`Volume 1h:   $${formatNumber(result.volume1h)}`);
        console.log(`Activity:    ${result.volumeActivity}`);
        console.log('');
        console.log('Transactions 24h:');
        console.log(`  Buys:      ${result.txns24h.buys}`);
        console.log(`  Sells:     ${result.txns24h.sells}`);
        console.log(`  Buy Ratio: ${result.buyRatio24h}%`);
        console.log('');
        console.log('Transactions 1h:');
        console.log(`  Buys:      ${result.txns1h.buys}`);
        console.log(`  Sells:     ${result.txns1h.sells}`);
        
        console.log('');
        console.log('----------------------------------------');
        console.log('SOCIAL MEDIA & LINKS');
        console.log('----------------------------------------');
        
        if (result.websites.length > 0 || result.socials.length > 0) {
            if (result.websites.length > 0) {
                console.log('');
                console.log('Websites:');
                result.websites.forEach(w => {
                    console.log(`  [WEB] ${w.url}`);
                });
            }
            
            if (result.socials.length > 0) {
                console.log('');
                console.log('Social Media:');
                result.socials.forEach(s => {
                    const platform = s.type?.toUpperCase() || 'LINK';
                    console.log(`  [${platform}] ${s.url}`);
                });
            }
        } else {
            console.log('No social links found on DexScreener');
            console.log('');
            console.log('Try searching manually:');
            console.log(`  Twitter:  https://twitter.com/search?q=$${result.tokenSymbol}`);
            console.log(`  Telegram: https://t.me/s/${result.tokenSymbol.toLowerCase()}`);
        }
        
        console.log('');
        console.log('Quick Links:');
        console.log(`  DexScreener: ${result.dexScreenerUrl}`);
        console.log(`  Etherscan:   https://etherscan.io/token/${tokenAddress}`);
        console.log(`  DEXTools:    https://www.dextools.io/app/ether/pair-explorer/${result.pairAddress}`);
        
        console.log('');
        console.log('----------------------------------------');
        console.log('OVERALL SENTIMENT');
        console.log('----------------------------------------');
        console.log(`Score:     ${result.sentimentScore}/100`);
        console.log(`Sentiment: ${result.sentimentLevel}`);
        
        // Visual bar
        const filled = Math.floor(result.sentimentScore / 5);
        const empty = 20 - filled;
        console.log(`           [${'#'.repeat(filled)}${'-'.repeat(empty)}]`);
        
        if (result.sentimentScore >= 70) {
            console.log('');
            console.log('[+] Strong buying pressure detected');
        } else if (result.sentimentScore <= 30) {
            console.log('');
            console.log('[-] Heavy selling pressure detected');
        }
        
        console.log('');
        console.log('========================================');
        
        return result;
        
    } catch (error) {
        console.log(`Error: ${error.message}`);
        return {
            success: false,
            error: error.message,
            risk: 'UNKNOWN'
        };
    }
}

// ================================================================
// CLI
// ================================================================

const tokenAddress = process.argv[2];

if (!tokenAddress) {
    console.log('');
    console.log('Usage: node 9-social-sentiment.js <TOKEN_ADDRESS>');
    console.log('');
    console.log('Examples:');
    console.log('  node 9-social-sentiment.js 0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE');
    console.log('');
    console.log('This module provides:');
    console.log('  - Social media links (Twitter, Telegram, Discord, Website)');
    console.log('  - Price action and momentum');
    console.log('  - Trading volume and activity');
    console.log('  - Buy/Sell ratio');
    console.log('  - Overall market sentiment');
    console.log('  - Quick links to explorers and charts');
    console.log('');
} else {
    analyzeSocialSentiment(tokenAddress);
}

module.exports = { analyzeSocialSentiment };


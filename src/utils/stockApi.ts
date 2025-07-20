// Using Finnhub API for stock prices (free tier available)
const FINNHUB_API_KEY = 'demo'; // In production, use environment variable

export async function fetchStockPrice(ticker: string): Promise<number> {
  try {
    const response = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${ticker.toUpperCase()}&token=${FINNHUB_API_KEY}`
    );
    
    if (!response.ok) {
      throw new Error('Failed to fetch stock price');
    }
    
    const data = await response.json();
    
    if (data.c === 0 || data.c === null) {
      throw new Error('Invalid ticker symbol or market closed');
    }
    
    return data.c; // Current price
  } catch (error) {
    console.error(`Error fetching price for ${ticker}:`, error);
    throw error;
  }
}

export async function fetchMultipleStockPrices(tickers: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  
  try {
    const promises = tickers.map(async (ticker) => {
      try {
        const price = await fetchStockPrice(ticker);
        prices[ticker] = price;
      } catch (error) {
        console.error(`Failed to fetch price for ${ticker}:`, error);
        prices[ticker] = 0;
      }
    });
    
    await Promise.all(promises);
    return prices;
  } catch (error) {
    console.error('Error fetching multiple stock prices:', error);
    return prices;
  }
}
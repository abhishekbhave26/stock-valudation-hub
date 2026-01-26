interface StockPrice {
  symbol: string;
  price: number;
  timestamp: number;
  source: string;
}

interface CachedPrice {
  price: number;
  timestamp: number;
  source: string;
}

class StockPriceService {
  private cache: Map<string, CachedPrice> = new Map();
  private readonly CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  private readonly API_KEY = import.meta.env.VITE_FINNHUB_API_KEY;
  private readonly BASE_URL = 'https://finnhub.io/api/v1';
  
  // Rate limiting - Finnhub allows 60 calls/minute
  private lastRequestTime = 0;
  private readonly MIN_REQUEST_INTERVAL = 1000; // 1 second between requests (60 per minute)

  constructor() {
    // Load cache from localStorage on initialization
    this.loadCacheFromStorage();
  }

  private loadCacheFromStorage() {
    try {
      const stored = localStorage.getItem('stockPriceCache');
      if (stored) {
        const data = JSON.parse(stored);
        this.cache = new Map(Object.entries(data));
      }
    } catch (error) {
      console.warn('Failed to load stock price cache from localStorage:', error);
    }
  }

  private saveCacheToStorage() {
    try {
      const cacheObj = Object.fromEntries(this.cache);
      localStorage.setItem('stockPriceCache', JSON.stringify(cacheObj));
    } catch (error) {
      console.warn('Failed to save stock price cache to localStorage:', error);
    }
  }

  private isCacheValid(cachedPrice: CachedPrice): boolean {
    const now = Date.now();
    return (now - cachedPrice.timestamp) < this.CACHE_DURATION;
  }

  private async rateLimitedFetch(url: string): Promise<Response> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL) {
      const waitTime = this.MIN_REQUEST_INTERVAL - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
    return fetch(url);
  }

  async getStockPrice(symbol: string): Promise<StockPrice | null> {
    const normalizedSymbol = symbol.toUpperCase();
    // Check cache first
    const cached = this.cache.get(normalizedSymbol);
    if (cached && this.isCacheValid(cached)) {
      return {
        symbol: normalizedSymbol,
        price: cached.price,
        timestamp: cached.timestamp,
        source: cached.source
      };
    }

    // If no API key, return null
    if (!this.API_KEY) {
      console.error('No Finnhub API key provided. Add VITE_FINNHUB_API_KEY to your .env file');
      return null;
    }
    
    try {
      // Fetch from Finnhub API
      const url = `${this.BASE_URL}/quote?symbol=${normalizedSymbol}&token=${this.API_KEY}`;
      const response = await this.rateLimitedFetch(url);
      
      if (!response.ok) {
        console.error('API response not ok:', response.status, response.statusText);
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      // Check for API errors
      if (data.error) {
        console.error('API returned error:', data.error);
        throw new Error(data.error);
      }
      
      // Finnhub returns current price in 'c' field
      if (!data.c || data.c === 0) {
        console.error('Invalid price data:', data);
        throw new Error('Invalid response format or symbol not found');
      }
      
      const price = parseFloat(data.c);
      const timestamp = Date.now();
      // Cache the result
      const cachedPrice: CachedPrice = {
        price,
        timestamp,
        source: 'Finnhub'
      };
      
      this.cache.set(normalizedSymbol, cachedPrice);
      this.saveCacheToStorage();
      
      return {
        symbol: normalizedSymbol,
        price,
        timestamp,
        source: 'Finnhub'
      };
      
    } catch (error) {
      console.error(`Failed to fetch price for ${normalizedSymbol}:`, error);
      
      // If we have expired cache data, return it as fallback
      if (cached) {
        console.warn(`Using expired cache data for ${normalizedSymbol}`);
        return {
          symbol: normalizedSymbol,
          price: cached.price,
          timestamp: cached.timestamp,
          source: `${cached.source} (cached)`
        };
      }
      
      return null;
    }
  }

  async getMultipleStockPrices(symbols: string[]): Promise<Map<string, StockPrice>> {
    const results = new Map<string, StockPrice>();
    const uniqueSymbols = [...new Set(symbols.map(s => s.toUpperCase()))];
    
    // Create batches to respect rate limits (30 concurrent requests max)
    const BATCH_SIZE = 30;
    const batches = [];
    
    for (let i = 0; i < uniqueSymbols.length; i += BATCH_SIZE) {
      batches.push(uniqueSymbols.slice(i, i + BATCH_SIZE));
    }
    
    // Process batches sequentially, but symbols within each batch in parallel
    for (const batch of batches) {
      const batchPromises = batch.map(async (symbol) => {
        try {
          const price = await this.getStockPrice(symbol);
          if (price) {
            results.set(symbol, price);
          }
          return { symbol, success: true };
        } catch (error) {
          console.error(`Failed to fetch price for ${symbol}:`, error);
          return { symbol, success: false };
        }
      });
      
      // Wait for all requests in this batch to complete
      const batchResults = await Promise.allSettled(batchPromises);
      const successCount = batchResults.filter(r => r.status === 'fulfilled').length;
      // Small delay between batches to be respectful to the API
      if (batches.indexOf(batch) < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return results;
  }

  clearCache() {
    this.cache.clear();
    localStorage.removeItem('stockPriceCache');
  }

  getCacheInfo(): { symbol: string; price: number; age: string; source: string }[] {
    const now = Date.now();
    return Array.from(this.cache.entries()).map(([symbol, cached]) => ({
      symbol,
      price: cached.price,
      age: `${Math.round((now - cached.timestamp) / (1000 * 60 * 60))} hours ago`,
      source: cached.source
    }));
  }
}

export const stockPriceService = new StockPriceService();
export type { StockPrice };

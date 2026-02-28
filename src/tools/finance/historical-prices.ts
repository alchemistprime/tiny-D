import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { callFmpApi } from './fmp.js';
import { formatToolResult } from '../types.js';

const HistoricalStockPricesInputSchema = z.object({
  ticker: z
    .string()
    .describe("The stock ticker symbol to fetch historical prices for. For example, 'AAPL' for Apple."),
  start_date: z.string().describe('Start date in YYYY-MM-DD format. Required.'),
  end_date: z.string().describe('End date in YYYY-MM-DD format. Required.'),
});

function extractPrices(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.data)) {
      return record.data;
    }
    if (Array.isArray(record.historical)) {
      return record.historical;
    }
  }

  return [];
}

export const getHistoricalStockPrices = new DynamicStructuredTool({
  name: 'get_historical_stock_prices',
  description:
    'Retrieves daily end-of-day OHLCV stock prices over a specified date range. Uses Financial Modeling Prep (FMP).',
  schema: HistoricalStockPricesInputSchema,
  func: async (input) => {
    const ticker = input.ticker.trim().toUpperCase();
    const params = {
      symbol: ticker,
      from: input.start_date,
      to: input.end_date,
    };

    const endDate = new Date(input.end_date + 'T00:00:00Z');
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const { data, url } = await callFmpApi('/historical-price-eod/full', params, {
      cacheable: endDate < today,
    });

    const prices = extractPrices(data);
    return formatToolResult(prices, [url]);
  },
});

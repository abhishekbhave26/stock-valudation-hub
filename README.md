# Stock Valuation Hub

Stock Valuation Hub is a React + TypeScript web app for performing discounted cash flow (DCF) analysis, tracking a watchlist of valuation targets, and monitoring a personal stock portfolio. It combines a DCF calculator, watchlist management, and portfolio analytics with Supabase-backed authentication and data storage.

## Features

- **DCF valuation workflow** with input validation, warnings, and detailed valuation results.
- **Stock watchlist** that stores valuation inputs/results, supports editing, and keeps price data refreshed.
- **Portfolio tracker** with holdings, cost basis, performance metrics, and refreshable current prices.
- **Authentication & user profiles** powered by Supabase.
- **Live pricing** through the Finnhub API with client-side caching to limit rate usage.

## Tech Stack

- **Frontend:** React, TypeScript, Vite, Tailwind CSS
- **Data & Auth:** Supabase
- **Charts:** Recharts
- **Icons:** Lucide
- **Market Data:** Finnhub API

## Getting Started

### 1) Install dependencies

```bash
npm install
```

### 2) Configure environment variables

Create a `.env` file in the project root with:

```bash
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_FINNHUB_API_KEY=your_finnhub_api_key
```

> Note: Without valid Supabase credentials, authentication, watchlist, and portfolio features will be limited.

### 3) Run the app

```bash
npm run dev
```

Then open the URL Vite prints in your terminal (usually `http://localhost:5173`).

## Project Structure

```
src/
  components/   # UI building blocks (DCF calculator, watchlist, portfolio, auth)
  hooks/        # Auth hooks
  lib/          # Supabase client
  services/     # Stock price service (Finnhub)
  utils/        # DCF math + formatting helpers
```

## Available Scripts

- `npm run dev` — Start the Vite development server
- `npm run build` — Build the production bundle
- `npm run preview` — Preview the production build locally
- `npm run lint` — Run ESLint

## Database Notes

The app expects Supabase tables for `saved_stocks` and `portfolio_stocks`. You can review the SQL migrations in `supabase/migrations/` to create or update the schema as needed.

## License

This project is provided as-is for educational and personal finance workflows.

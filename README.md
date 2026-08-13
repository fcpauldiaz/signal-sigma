# Signal Sigma to Tradier Automation

Automated order placement system that syncs portfolio positions from Signal Sigma to Tradier broker.

## Overview

This project:
1. Authenticates with Signal Sigma API using OAuth refresh tokens
2. Fetches portfolio data from Signal Sigma
3. Calculates order differences based on `amount` vs `targetAmount` for each ticker
4. Places market orders with Tradier broker to align positions
5. Triggers portfolio rebalancing on Signal Sigma frontend (via web scraping)
6. Supports weekly automated rebalancing via scheduler

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

3. Install Playwright browsers (required for web scraping):
```bash
npx playwright install chromium
```

4. Fill in your credentials in `.env`:
- `SIGNAL_SIGMA_REFRESH_TOKEN`: Your Signal Sigma refresh token
- `SIGNAL_SIGMA_PORTFOLIO_ID`: The ID of the portfolio to process (found in the portfolio response)
- `TRADIER_ACCESS_TOKEN`: Your Tradier API access token
- `TRADIER_ACCOUNT_ID`: Your Tradier account ID
- `REBALANCE_SCHEDULE`: Cron expression for rebalancing (default: `0 14 * * *` for 9 AM EST / 2 PM UTC daily)
- `ORDER_SCHEDULE`: Cron expression for order placement (default: `0 15 * * *` for 10 AM EST / 3 PM UTC daily)
- `ENABLE_SCHEDULER`: Set to `true` to enable automated scheduler (default: `false`)

**Note**: Default schedules are set for EST timezone:
- 9 AM EST = 14:00 UTC (during standard time) or 13:00 UTC (during daylight saving time)
- 10 AM EST = 15:00 UTC (during standard time) or 14:00 UTC (during daylight saving time)

## Usage

### Development
```bash
npm run dev
```

### Production
```bash
npm run build
npm start
```

### Manual Rebalancing
Trigger rebalancing manually (includes order placement):
```bash
npm run rebalance
```

### Rebalancing Only
Trigger rebalancing without placing orders:
```bash
npm run rebalance-only
```

### Order Placement Only
Place orders based on current portfolio state:
```bash
npm run place-orders
```

### Automated Scheduler
Run the scheduler for automated daily rebalancing and order placement:
```bash
npm run scheduler
```

The scheduler runs continuously and executes:
- **Rebalancing** according to the `REBALANCE_SCHEDULE` cron expression (default: 9 AM EST)
- **Order Placement** according to the `ORDER_SCHEDULE` cron expression (default: 10 AM EST)

## How It Works

1. **Authentication**: Refreshes Signal Sigma access token using the refresh token endpoint
2. **Portfolio Fetching**: Retrieves all portfolios from Signal Sigma and filters by the portfolio ID specified in `SIGNAL_SIGMA_PORTFOLIO_ID`
3. **Order Calculation**: For each ticker, compares `amount` (current shares) with `targetAmount` (desired shares)
   - If `targetAmount > amount`: Calculates a BUY order
   - If `targetAmount < amount`: Calculates a SELL order
4. **Order Placement**: Places market orders with Tradier for each calculated difference

## Project Structure

```
src/
  ├── index.ts                 # Main orchestration script
  ├── rebalance.ts             # Manual rebalancing + order placement
  ├── rebalanceOnly.ts         # Rebalancing only (no orders)
  ├── placeOrders.ts           # Order placement only
  ├── scheduler.ts             # Scheduler entry point
  ├── types.ts                 # TypeScript type definitions
  ├── services/
  │   ├── signalSigmaAuth.ts   # Signal Sigma authentication
  │   ├── signalSigmaApi.ts     # Signal Sigma API client
  │   ├── signalSigmaScraper.ts # Web scraper for rebalancing
  │   ├── scheduler.ts          # Unified cron scheduler service
  │   ├── tradierApi.ts         # Tradier API client
  │   └── orderCalculator.ts   # Order difference calculation logic
  └── utils/
      └── orderPlacer.ts        # Shared order placement utility
ui/                            # Vite React desk
mobile/                        # Expo (React Native) desk for phone
```

## Mobile (Expo)

Personal phone app with the same Overview, Positions, Orders, and Performance views, plus paper/live, unlock, and trading actions. It talks to the deployed desk API (`https://signal-sigma.coolify.chapilabs.com` by default).

1. Install [Expo Go](https://expo.dev/go) on your phone
2. From the repo:

```bash
cd mobile
pnpm install
pnpm start
```

3. Scan the QR code in Expo Go and log in with `ADMIN_PASSWORD`

Override the API URL with `EXPO_PUBLIC_API_URL` in `mobile/.env` if you are pointing at a local or staging server.

## Environment Variables

- `SIGNAL_SIGMA_REFRESH_TOKEN`: OAuth refresh token for Signal Sigma API
- `SIGNAL_SIGMA_PORTFOLIO_ID`: The ID of the portfolio to process (only this portfolio will be processed)
- `TRADIER_ACCESS_TOKEN`: Bearer token for Tradier API
- `TRADIER_ACCOUNT_ID`: Your Tradier brokerage account ID
- `REBALANCE_SCHEDULE`: Cron expression for rebalancing (default: `0 14 * * *` for 9 AM EST daily)
- `ORDER_SCHEDULE`: Cron expression for order placement (default: `0 15 * * *` for 10 AM EST daily)
- `ENABLE_SCHEDULER`: Set to `true` to enable automated scheduler

## Rebalancing Feature

The rebalancing feature uses Playwright to automate the Signal Sigma frontend rebalancing process. It:

1. Injects the bearer token to authenticate without login
2. Navigates to the portfolio page
3. Executes a 5-step button sequence:
   - Click "rebalance portfolio" button
   - Click "continue" button
   - Click "next" button
   - Click "set as target" button
   - Click "done" button

The rebalancing can be triggered manually via `npm run rebalance` or automatically via the scheduler.

After rebalancing completes, the system automatically:
1. Waits for the backend to update portfolio data (3 seconds)
2. Fetches updated portfolios from Signal Sigma
3. Calculates order differences
4. Places orders with Tradier broker

## Docker Deployment

### Building the Docker Image

```bash
docker build -t signal-sigma-tradier .
```

### Running with Docker

#### Main Script (Order Placement)
```bash
docker run --rm \
  -e SIGNAL_SIGMA_REFRESH_TOKEN=your_token \
  -e SIGNAL_SIGMA_PORTFOLIO_ID=your_portfolio_id \
  -e TRADIER_ACCESS_TOKEN=your_tradier_token \
  -e TRADIER_ACCOUNT_ID=your_account_id \
  signal-sigma-tradier
```

#### Manual Rebalancing
```bash
docker run --rm \
  -e SIGNAL_SIGMA_REFRESH_TOKEN=your_token \
  -e SIGNAL_SIGMA_PORTFOLIO_ID=your_portfolio_id \
  -e TRADIER_ACCESS_TOKEN=your_tradier_token \
  -e TRADIER_ACCOUNT_ID=your_account_id \
  signal-sigma-tradier node dist/rebalance.js
```

#### Scheduler (Automated Daily Rebalancing and Order Placement)
```bash
docker run -d --name signal-sigma-scheduler \
  -e SIGNAL_SIGMA_REFRESH_TOKEN=your_token \
  -e SIGNAL_SIGMA_PORTFOLIO_ID=your_portfolio_id \
  -e TRADIER_ACCESS_TOKEN=your_tradier_token \
  -e TRADIER_ACCOUNT_ID=your_account_id \
  -e REBALANCE_SCHEDULE="0 14 * * *" \
  -e ORDER_SCHEDULE="0 15 * * *" \
  -e ENABLE_SCHEDULER=true \
  signal-sigma-tradier node dist/scheduler.js
```

### Using Docker Compose

Create a `docker-compose.yml`:

```yaml
version: '3.8'

services:
  scheduler:
    build: .
    container_name: signal-sigma-scheduler
    environment:
      - SIGNAL_SIGMA_REFRESH_TOKEN=${SIGNAL_SIGMA_REFRESH_TOKEN}
      - SIGNAL_SIGMA_PORTFOLIO_ID=${SIGNAL_SIGMA_PORTFOLIO_ID}
      - TRADIER_ACCESS_TOKEN=${TRADIER_ACCESS_TOKEN}
      - TRADIER_ACCOUNT_ID=${TRADIER_ACCOUNT_ID}
      - REBALANCE_SCHEDULE=${REBALANCE_SCHEDULE:-0 14 * * *}
      - ORDER_SCHEDULE=${ORDER_SCHEDULE:-0 15 * * *}
      - ENABLE_SCHEDULER=true
    command: node dist/scheduler.js
    restart: unless-stopped
```

Run with:
```bash
docker-compose up -d
```

### Environment Variables for Docker

All environment variables must be provided when running the Docker container:
- `SIGNAL_SIGMA_REFRESH_TOKEN` (required)
- `SIGNAL_SIGMA_PORTFOLIO_ID` (required)
- `TRADIER_ACCESS_TOKEN` (required)
- `TRADIER_ACCOUNT_ID` (required)
- `REBALANCE_SCHEDULE` (optional, default: `0 14 * * *` for 9 AM EST)
- `ORDER_SCHEDULE` (optional, default: `0 15 * * *` for 10 AM EST)
- `ENABLE_SCHEDULER` (optional, default: `false`)

## Notes

- Orders are placed as market orders with day duration
- The system automatically retries authentication if a 401 error occurs
- Each order includes a unique tag for tracking purposes
- The rebalancing scraper runs in headless mode by default
- The scheduler requires the process to run continuously to maintain the schedule


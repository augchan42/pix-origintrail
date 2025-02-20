# PixOriginTrail Bot

A Telegram bot that provides market divination insights by leveraging OriginTrail's Decentralized Knowledge Graph (DKG).

## Features

- `/scan` - Get market insights and predictions
- I-Ching divinations from 8bitoracle.ai API
- Integrates with OriginTrail DKG for knowledge-graph persistence
- Provides sentiment analysis and market trend predictions with Pix Street Samurai storytelling

## Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Create a `.env` file with your credentials:
   ```
   TELEGRAM_BOT_TOKEN=your_bot_token_here
   DKG_ENDPOINT=your_dkg_endpoint
   ```
4. Run the bot:
   - Development: `npm run dev`
   - Production: `npm run build && npm start`

## Commands

- `/start` - Start the bot
- `/help` - Show help information
- `/scan` - Get market divination insights

## How it Works

The bot connects to OriginTrail's DKG to analyze market data and provide insights. When you use the `/scan` command, it:

1. Queries the irai.co for relevant market and sentiment
2. Analyzes market sentiment and trends
3. Generates a prediction based on the analyzed data
4. Returns a human-readable market insight
5. Persists to DKG knowledge graph
6. More analysis from Origin Trail DKG will be avaiable in the future

## License

MIT License
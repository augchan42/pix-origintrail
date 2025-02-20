# PixOriginTrail Bot

A Telegram bot that provides market divination insights by leveraging OriginTrail's Decentralized Knowledge Graph (DKG) and 8-Bit Oracle's Divination API.

## Features

- `/scan` - Get market insights and predictions
- I-Ching divinations from 8bitoracle.ai API
- Integrates with OriginTrail DKG for knowledge-graph persistence
- Provides sentiment analysis and market trend predictions with Pix Street Samurai storytelling (sentiment and market news from irai.co)

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

The bot persists readings to OriginTrail's DKG for future analysis. When you use the `/scan` command, it:

1. Queries irai.co for relevant market and sentiment
2. Calls the 8bitoracle.ai divination API for I-Ching Hexagrams.  On the backend it, it is a faithful simulation of the traditional yarrow stalk process.
3. Returns market insights combined with the hexagram reading in Neuromancer street samurai format
4. Persists to DKG knowledge graph
5. Additional analysis and insights from Origin Trail DKG will be available in the future

## License

MIT License
# news-intelligence

AI-powered daily news radar with situation clustering logic.

## Overview
This system identifies "Evolving Situations" by clustering news articles based on semantic similarity and chronological progression, rather than just grouping by keywords or headlines.

## Structure
- `index.js`: Main entry point.
- `modules/`: Core logic for radar and topic management.
- `data/`: Local storage for raw articles, identified topics, and sources.
- `scripts/`: Utility scripts.

## Logic
The system uses Gemini to analyze clusters of articles to determine if they constitute a new or ongoing "situation."

---
*Managed by OpenClaw (小艾)*

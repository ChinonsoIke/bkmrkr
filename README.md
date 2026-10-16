# bkmrkr

React + AWS Lambda app that sorts your X (Twitter) bookmarks into categories using Claude.
I built this because my X bookmarks were all over the place and I needed a way to sort them.

[Live app](https://dt7iydeybgdus.cloudfront.net)

## How it works

1. Sign in with X
2. Your bookmarks are fetched from X's API
3. Claude reads them and proposes categories based on what each tweet is about
4. Results are displayed sorted by category
5. Categories are cached, so future sorts only categorize new bookmarks

## Architecture

### Frontend
- **Framework:** React + TypeScript + Vite
- **Hosting:** S3 + CloudFront (HTTPS)
- **Authentication:** X OAuth2 with PKCE
- **Polling:** Long-running sorts are polled every 3 seconds until ready

### Backend
- **API Lambda** (`handler`): Handles sign-in, refresh tokens, and GET `/bookmarks`
  - Returns `202 Accepted` with job status while sorting
  - Checks cache before enqueueing
  - Stores job state in Redis
  
- **Worker Lambda** (`worker`): Processes sort jobs from SQS
  - Fetches bookmarks from X (up to 800)
  - Queries DynamoDB for already-categorized tweets
  - Only sends new tweets to Claude
  - Stores results in Redis + DynamoDB
  - Retries transient failures up to 3 times
  - Max 5 concurrent jobs (configurable)

- **Database:**
  - **Redis** (Upstash): Job state, result cache (24h TTL), user ID cache (1h TTL)
  - **DynamoDB:** Tweet categorizations (90-day TTL)
  - **SQS:** Job queue with 3-attempt retry to DLQ

### Claude Integration
- **Model:** `claude-haiku-4-5-20251001` (configurable via `MODEL` env var)
- **Features:** Structured output (JSON schema), cost optimization
- **Batching:** Large bookmark lists split into 50-tweet batches, max 8 in parallel

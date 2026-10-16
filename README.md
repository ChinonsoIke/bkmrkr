# bkmrkr

Sort your X (Twitter) bookmarks into categories using Claude.

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
- **Category reuse:** Existing categories passed as `allowed` list to keep new bookmarks consistent

## Deployment

### Prerequisites
- AWS account (Lambda, SQS, DynamoDB, S3, CloudFront)
- Upstash Redis instance
- X OAuth2 app credentials
- Claude API key

### Environment Setup

**Lambda environment variables:**
- `ANTHROPIC_API_KEY`: Your Claude API key
- `CACHE_KEY_SECRET`: Random 32-byte hex string for hashing user IDs
- `CLIENT_ID`, `CLIENT_SECRET`: X OAuth credentials
- `REDIRECT_URL`: Callback URL after X sign-in (e.g., `https://yourdomain.com/auth/callback`)
- `TOKEN_URL`, `X_API_URL`: X API endpoints
- `REDIS_URL`: Upstash Redis connection string (rediss://...)
- `ALLOWED_ORIGIN`: CloudFront domain or your frontend's domain
- `SORT_QUEUE_URL`: SQS queue URL (set up after deployment)
- `MODEL`: Claude model ID (optional, defaults to Haiku 4.5)

### Deploy
```bash
# Frontend
npm run build
aws s3 sync dist s3://bkmrkr --delete
aws cloudfront create-invalidation --distribution-id <ID> --paths "/index.html"

# Backend
cd ../lambda/us-east-1/bkmrkr
npm install
zip -r /tmp/bkmrkr.zip index.mjs package.json node_modules
aws lambda update-function-code --function-name bkmrkr --zip-file fileb:///tmp/bkmrkr.zip
aws lambda update-function-code --function-name bkmrkr-sort-worker --zip-file fileb:///tmp/bkmrkr.zip
```

## Limits & Known Issues

- **X API:** Limited by X's rate limits. Free tier allows ~300 bookmarks fetches/month.
- **Claude rate limits:** Worker is throttled to 5 concurrent jobs to stay under Claude's token limits. Under heavy load, jobs queue and users wait.
- **No API authentication:** The Lambda Function URL is public. Anyone with a valid X token can trigger sorts (costing you Claude credits). Recommend adding WAF rate limiting.
- **Third-party cookies:** Refresh tokens are stored in browser local storage. Safari may block them if frontend and API are on different sites.
- **Cold starts:** First request to Lambda is slow (~2s). Subsequent requests within ~5 minutes are faster.

## Monitoring

Check worker Lambda logs:
```bash
aws logs tail /aws/lambda/bkmrkr-sort-worker --follow
```

Check job queue depth:
```bash
aws sqs get-queue-attributes --queue-url <URL> --attribute-names ApproximateNumberOfMessages
```

## Scaling to Production

To handle thousands of users reliably:

1. **Rate limiting:** Add per-user rate limits in Redis (e.g., 1 sort per 5 min)
2. **API authentication:** Put CloudFront + AWS WAF in front of the Lambda, restrict by origin
3. **Monitoring:** CloudWatch alarms for Lambda errors, rate limit 429s, queue age
4. **Cost tracking:** Track Claude token usage per user
5. **Load testing:** Test with your expected peak load before launch

## Development

```bash
# Frontend
npm install
npm run dev    # http://localhost:3000
npm run build
npm run lint

# Backend (local testing with mocked X and Claude)
cd ../lambda/us-east-1/bkmrkr
npm install
# Edit and test index.mjs, see comments for mock test patterns
```

## License

MIT

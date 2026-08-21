import {
  handleTelemetryOptions,
  handleTelemetryPost,
} from '../../../../functions/api/telemetry'

export const runtime = 'edge'

function telemetryEnv() {
  return {
    DATA_TOKEN: process.env.DATA_TOKEN || '',
    DATA_REPO: process.env.DATA_REPO || '',
    HF_DATASET_BRANCH: process.env.HF_DATASET_BRANCH,
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleTelemetryPost(request, telemetryEnv(), 'vercel')
}

export async function OPTIONS(request: Request): Promise<Response> {
  return handleTelemetryOptions(request)
}

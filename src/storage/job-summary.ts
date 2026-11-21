import type { SavedJob } from "../api/jobs";

export function jobSummary(job: SavedJob) {
  return {
    id: job.id, runpodId: job.runpodId, endpoint: job.endpoint,
    created: job.created, status: job.status, error: job.error,
    title: job.input?.prompt?.slice(0, 120) || "Generation",
    count: job.results?.length || 0,
  };
}
export type JobSummary = ReturnType<typeof jobSummary>;

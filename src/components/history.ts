import { $, node, button } from "../lib/dom";
import { getJob, jobSummaries, remove } from "../storage/db";
import { DEFAULTS } from "../api/contract";
import { TERMINAL } from "../api/runpod";
import type { SavedJob } from "../api/jobs";
interface HistoryContext {
  dialog: (title: string) => HTMLElement;
  endpoint: () => string;
  resume: (record: SavedJob) => Promise<void>;
  reuse: (record: SavedJob) => Promise<void>;
  view: (record: SavedJob) => void;
  removed: (id: string) => void;
}

export function bindHistory(context: HistoryContext) {
  $("#history-open").addEventListener("click", async () => {
    const endpoint = context.endpoint();
    const body = context.dialog("Job history");
    const attach = node("div", "resume-manual");
    attach.innerHTML =
      '<label class="field">Resume a RunPod job ID<input id="manual-job-id" placeholder="Job ID for the connected endpoint"></label>';
    attach.append(
      button("Resume polling", async () => {
        const runpodId = $<HTMLInputElement>("#manual-job-id").value.trim();
        if (!/^[A-Za-z0-9_-]+$/.test(runpodId))
          throw new Error("Enter a valid job ID.");
        const record: SavedJob = {
          id: `${endpoint}:${runpodId}`,
          runpodId,
          endpoint,
          created: Date.now(),
          status: "IN_QUEUE",
          input: { ...DEFAULTS },
        };
        $<HTMLDialogElement>("#content-dialog").close();
        await context.resume(record);
      }),
    );
    body.append(attach);
    try {
      const records = await jobSummaries();
      if (!body.isConnected || !$("#content-dialog").hasAttribute("open")) return;
      const jobList = node("div", "job-history-list");
      const paging = node("div", "button-row");
      const pageSize = 30;
      let offset = 0;
      if (!records.length)
        body.append(node("p", "subtle", "No jobs saved in this browser."));
      const renderPage = () => {
        jobList.replaceChildren();
        for (const record of records.slice(offset, offset + pageSize)) {
          const item = node("article", "history-item");
          item.append(
            node("strong", "", record.status),
            node("span", "mono", record.runpodId),
            node(
              "small",
              "subtle",
              `${record.endpoint} · ${new Date(record.created).toLocaleString()}`,
            ),
          );
          if (record.error) item.append(node("p", "notice", record.error));
          if (record.count)
            item.append(
              button("View results", async () => {
                const job = await getJob(record.id);
                if (!job?.results?.length) throw new Error("Saved images are unavailable.");
                context.view(job);
                $<HTMLDialogElement>("#content-dialog").close();
              }),
            );
          else if (
            !TERMINAL.has(record.status) &&
            !["WORKER_ERROR", "EXPIRED"].includes(record.status)
          )
            item.append(
              button("Resume", async () => {
                const job = await getJob(record.id);
                if (!job) throw new Error("Saved request is unavailable.");
                $<HTMLDialogElement>("#content-dialog").close();
                await context.resume(job);
              }),
            );
          item.append(
            button(
              "Reuse request",
              async () => {
                const job = await getJob(record.id);
                if (!job) throw new Error("Saved request is unavailable.");
                await context.reuse(job);
                $<HTMLDialogElement>("#content-dialog").close();
              },
              "text-button",
            ),
            button(
              "Delete locally",
              async () => {
                await remove("jobs", record.id);
                context.removed(record.id);
                records.splice(records.findIndex(row => row.id === record.id), 1);
                if (offset >= records.length && offset) offset -= pageSize;
                renderPage();
              },
              "text-button",
            ),
          );
          jobList.append(item);
        }
        previous.disabled = offset === 0;
        next.disabled = offset + pageSize >= records.length;
        pageLabel.textContent = records.length ? `${offset + 1}–${Math.min(offset + pageSize, records.length)} of ${records.length}` : "";
      };
      const previous = button("Newer jobs", () => { offset -= pageSize; renderPage(); });
      const next = button("Older jobs", () => { offset += pageSize; renderPage(); });
      const pageLabel = node("span", "subtle");
      paging.append(previous, pageLabel, next);
      paging.hidden = records.length <= pageSize;
      body.append(jobList, paging);
      renderPage();
    } catch {
      body.append(node("p", "notice", "Browser job history is unavailable."));
    }
  });
}

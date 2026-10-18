import { $, node, button } from "../lib/dom";
import { list, remove } from "../storage/db";
import { DEFAULTS } from "../api/contract";
import { TERMINAL } from "../api/runpod";
import type { SavedJob } from "../api/jobs";
interface HistoryContext {
  dialog: (title: string) => HTMLElement;
  endpoint: () => string;
  requireConnection: () => unknown;
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
        context.requireConnection();
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
      const records = await list<SavedJob>("jobs");
      if (!records.length)
        body.append(node("p", "subtle", "No jobs saved in this browser."));
      for (const record of records) {
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
        if (record.results?.length)
          item.append(
            button("View results", () => {
              context.view(record);
              $<HTMLDialogElement>("#content-dialog").close();
            }),
          );
        else if (
          !TERMINAL.has(record.status) &&
          !["WORKER_ERROR", "EXPIRED"].includes(record.status)
        )
          item.append(
            button("Resume", () => {
              $<HTMLDialogElement>("#content-dialog").close();
              void context.resume(record);
            }),
          );
        item.append(
          button(
            "Reuse request",
            async () => {
              await context.reuse(record);
              $<HTMLDialogElement>("#content-dialog").close();
            },
            "text-button",
          ),
          button(
            "Delete locally",
            async () => {
              await remove("jobs", record.id);
              context.removed(record.id);
              item.remove();
            },
            "text-button",
          ),
        );
        body.append(item);
      }
    } catch {
      body.append(node("p", "notice", "Browser job history is unavailable."));
    }
  });
}

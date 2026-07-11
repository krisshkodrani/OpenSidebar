import { useState, useEffect } from "react";
import { JOBS as jobs, getJobById, type Job } from "../data/jobs";

// Persist viewed jobs on the tab so research-grounding stays accurate even if a
// full /job-board navigation remounts the App (which resets component state).
const VIEWED_JOBS_KEY = "__jobBoardViewedJobs";

const locationIcon = (type: string) => {
  if (type === "remote") return "🌐";
  if (type === "hybrid") return "🏢";
  return "📍";
};

function readSelectedJobFromUrl(): Job | null {
  return (
    getJobById(new URLSearchParams(window.location.search).get("job")) ?? null
  );
}

export default function JobBoard() {
  const [selectedJob, setSelectedJob] = useState<Job | null>(() =>
    readSelectedJobFromUrl(),
  );
  const [viewedJobs, setViewedJobs] = useState<Set<string>>(() => {
    const seed = new Set<string>((window as any)[VIEWED_JOBS_KEY] ?? []);
    const fromUrl = readSelectedJobFromUrl();
    if (fromUrl) seed.add(fromUrl.id);
    return seed;
  });
  const view: "listings" | "detail" = selectedJob ? "detail" : "listings";

  // Keep the detail view URL-backed: clicking a listing puts ?job=<id> in the
  // address bar (legible navigation feedback + the job id becomes discoverable),
  // and browser back/forward and deep links resolve to the right posting.
  useEffect(() => {
    const sync = () => {
      const job = readSelectedJobFromUrl();
      setSelectedJob(job);
      if (job) setViewedJobs((prev) => new Set([...prev, job.id]));
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  useEffect(() => {
    (window as any)[VIEWED_JOBS_KEY] = Array.from(viewedJobs);
    (window as any).__jobBoardState = {
      viewedJobs: Array.from(viewedJobs),
      currentView: view,
      selectedJobId: selectedJob?.id ?? null,
      totalJobs: jobs.length,
    };
  }, [view, selectedJob, viewedJobs]);

  const openJob = (job: Job) => {
    window.history.pushState({}, "", `/job-board?job=${job.id}`);
    setSelectedJob(job);
    setViewedJobs((prev) => new Set([...prev, job.id]));
  };

  const backToListings = () => {
    window.history.pushState({}, "", "/job-board");
    setSelectedJob(null);
  };

  return (
    <div className="fixture-static">
      <div className="header" style={{ background: "linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)" }}>
        <h1 style={{ color: "#fff" }}>TechJobs Board</h1>
        <p style={{ color: "#dbeafe", marginTop: 4, fontSize: 14 }}>
          {jobs.length} open positions — Find your next role in tech
        </p>
      </div>

      <div style={{ padding: "0 24px", maxWidth: 960, margin: "0 auto" }}>
        {view === "listings" && (
          <div>
            <p style={{ margin: "20px 0 16px", fontSize: 13, color: "#64748b" }}>
              Showing {jobs.length} jobs. Click &ldquo;View Details&rdquo; on any listing to see the full description.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {jobs.map((job) => (
                <div
                  key={job.id}
                  style={{
                    background: "#fff",
                    border: "1px solid #e2e8f0",
                    borderRadius: 10,
                    padding: "16px 20px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 16,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 600, fontSize: 15, color: "#1e293b" }}>{job.title}</span>
                      <span className="badge">{job.company}</span>
                      {viewedJobs.has(job.id) && (
                        <span style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>viewed</span>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: 13, color: "#64748b" }}>
                      <span>{locationIcon(job.locationType)} {job.location}</span>
                      <span>{job.salaryRange}</span>
                      <span>Posted {job.postedDaysAgo}d ago</span>
                    </div>
                    <p style={{ margin: "8px 0 0", fontSize: 13, color: "#475569", lineHeight: 1.5 }}>
                      {job.excerpt}
                    </p>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    aria-label={`View details for ${job.title} at ${job.company}`}
                    onClick={() => openJob(job)}
                    style={{ whiteSpace: "nowrap", flexShrink: 0 }}
                  >
                    View Details
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {view === "detail" && selectedJob && (
          <div style={{ paddingTop: 20, paddingBottom: 40 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <button
                className="btn btn-ghost"
                onClick={backToListings}
              >
                ← Back to Listings
              </button>
              <a
                className="btn btn-primary"
                href={`/ashby-job-application?job=${selectedJob.id}`}
                target="_blank"
                rel="noopener"
                aria-label={`Apply now for ${selectedJob.title} at ${selectedJob.company}`}
                style={{ whiteSpace: "nowrap" }}
              >
                Apply Now
              </a>
            </div>

            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 24 }}>
              <h3 style={{ margin: "0 0 4px", fontSize: 20, color: "#1e293b" }}>{selectedJob.title}</h3>
              <div style={{ display: "flex", gap: 16, fontSize: 13, color: "#64748b", marginBottom: 20 }}>
                <span style={{ fontWeight: 600, color: "#334155" }}>{selectedJob.company}</span>
                <span>{locationIcon(selectedJob.locationType)} {selectedJob.location}</span>
                <span>{selectedJob.salaryRange}</span>
              </div>

              <div style={{ marginBottom: 20 }}>
                <h4 style={{ fontSize: 14, fontWeight: 600, color: "#1e293b", marginBottom: 8 }}>About the Role</h4>
                <p style={{ fontSize: 14, lineHeight: 1.7, color: "#334155" }}>{selectedJob.about}</p>
              </div>

              <div style={{ marginBottom: 20 }}>
                <h4 style={{ fontSize: 14, fontWeight: 600, color: "#1e293b", marginBottom: 8 }}>Requirements</h4>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.8, color: "#334155" }}>
                  {selectedJob.requirements.map((req, i) => (
                    <li key={i}>{req}</li>
                  ))}
                </ul>
              </div>

              <div style={{ marginBottom: 20 }}>
                <h4 style={{ fontSize: 14, fontWeight: 600, color: "#1e293b", marginBottom: 8 }}>Responsibilities</h4>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.8, color: "#334155" }}>
                  {selectedJob.responsibilities.map((resp, i) => (
                    <li key={i}>{resp}</li>
                  ))}
                </ul>
              </div>

              <div>
                <h4 style={{ fontSize: 14, fontWeight: 600, color: "#1e293b", marginBottom: 8 }}>Benefits</h4>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.8, color: "#334155" }}>
                  {selectedJob.benefits.map((ben, i) => (
                    <li key={i}>{ben}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

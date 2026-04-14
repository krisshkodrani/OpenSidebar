import { useState, useEffect } from "react";

interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  locationType: string;
  salaryRange: string;
  excerpt: string;
  about: string;
  requirements: string[];
  responsibilities: string[];
  benefits: string[];
  postedDaysAgo: number;
}

const jobs: Job[] = [
  {
    id: "sr-fe-1",
    title: "Senior Frontend Engineer",
    company: "Nextera Tech",
    location: "Remote",
    locationType: "remote",
    salaryRange: "$130K – $155K",
    excerpt: "Build customer-facing features with React and TypeScript for our cloud analytics platform.",
    about: "Nextera Tech builds real-time analytics dashboards used by over 2,000 enterprise customers. Our frontend team owns the entire UI layer, from component library to production monitoring. We ship weekly and care deeply about performance and accessibility.",
    requirements: [
      "5+ years of professional frontend development experience",
      "Deep proficiency with React and TypeScript",
      "Experience consuming GraphQL APIs (Apollo Client or urql)",
      "Familiarity with state management solutions (Redux, Zustand, or Jotai)",
      "Track record of writing tested, maintainable code (Jest, React Testing Library)",
    ],
    responsibilities: [
      "Design and implement new dashboard features end-to-end",
      "Mentor junior and mid-level engineers through code review and pairing",
      "Collaborate with product design on interaction patterns and accessibility",
      "Contribute to and maintain the shared component library",
    ],
    benefits: [
      "Fully remote — work from anywhere in the US or Canada",
      "Base salary $130K–$155K plus equity refreshers",
      "Health, dental, vision, and 401(k) match up to 4%",
    ],
    postedDaysAgo: 2,
  },
  {
    id: "fe-lead-2",
    title: "Frontend Tech Lead",
    company: "CloudScale Inc",
    location: "Remote (US)",
    locationType: "remote",
    salaryRange: "$140K – $165K",
    excerpt: "Lead a team of 5 frontend engineers building our next-generation infrastructure console.",
    about: "CloudScale provides serverless infrastructure to mid-market SaaS companies. Our console is a complex React application that handles real-time metrics, deployment workflows, and billing. We're looking for a tech lead who can drive architecture decisions while staying hands-on.",
    requirements: [
      "6+ years of frontend engineering experience, with at least 2 years in a lead or senior role",
      "Expert-level React and TypeScript — you've built and maintained large-scale SPAs",
      "Hands-on experience with GraphQL, including schema design and client-side caching",
      "Proven ability to lead a team of 3–5 engineers: code reviews, sprint planning, mentorship",
      "Familiarity with CI/CD pipelines and frontend build tooling (Vite, Webpack, Turborepo)",
    ],
    responsibilities: [
      "Own frontend architecture decisions for the infrastructure console",
      "Drive code quality through PR reviews, linting standards, and testing strategy",
      "Coordinate with product management and backend teams on feature planning",
      "Manage sprint planning and technical roadmap for the frontend squad",
    ],
    benefits: [
      "Remote (US-based) with optional quarterly on-sites in Denver",
      "Base salary $140K–$165K plus stock options",
      "Annual conference stipend ($2,500) and unlimited PTO",
    ],
    postedDaysAgo: 5,
  },
  {
    id: "fullstack-3",
    title: "Full Stack Engineer (React/Node)",
    company: "DataPulse",
    location: "Remote",
    locationType: "remote",
    salaryRange: "$125K – $150K",
    excerpt: "Build end-to-end features across our React frontend and Node.js API layer.",
    about: "DataPulse is a Series B data observability startup. Our product helps engineering teams detect data quality issues before they reach production dashboards. The stack is React + TypeScript on the frontend and Node.js + Express + PostgreSQL on the backend, connected via GraphQL.",
    requirements: [
      "4+ years of professional experience with React and TypeScript",
      "Strong backend skills with Node.js and Express",
      "Experience with PostgreSQL or a similar relational database",
      "Working knowledge of GraphQL — you've built or consumed GraphQL APIs",
      "Comfortable with Docker and basic cloud infrastructure (AWS or GCP)",
    ],
    responsibilities: [
      "Build full-stack features from database schema to UI component",
      "Maintain and extend the GraphQL API layer",
      "Optimize database queries and API response times",
      "Participate in the on-call rotation (1 week every 6 weeks)",
    ],
    benefits: [
      "Fully remote with flexible hours — async-first culture",
      "Base salary $125K–$150K plus equity",
      "Home office stipend ($1,500) and annual learning budget ($1,000)",
    ],
    postedDaysAgo: 1,
  },
  {
    id: "sr-ui-4",
    title: "Senior UI Engineer",
    company: "DesignFlow",
    location: "Remote",
    locationType: "remote",
    salaryRange: "$120K – $145K",
    excerpt: "Own the design system and component library for our collaborative design tool.",
    about: "DesignFlow is a browser-based design tool competing with Figma in the product prototyping space. Our UI is built entirely in React with TypeScript, and performance is critical — we render thousands of vector objects in real time. You'll own the design system that powers both the editor and the marketing site.",
    requirements: [
      "5+ years building production UIs with React and TypeScript",
      "Deep understanding of CSS architecture, design tokens, and component APIs",
      "Experience building or maintaining a design system at scale",
      "Familiarity with canvas/WebGL rendering is a plus but not required",
      "Strong eye for detail and collaboration skills with product designers",
    ],
    responsibilities: [
      "Maintain and evolve the shared design system and component library",
      "Implement complex UI patterns: drag-and-drop, virtualized lists, keyboard shortcuts",
      "Collaborate with the rendering team on editor UI performance",
      "Write documentation and migration guides for design system consumers",
    ],
    benefits: [
      "Fully remote — distributed team across US and Europe",
      "Base salary $120K–$145K plus equity",
      "Health and dental coverage, 4 weeks PTO, and flexible schedule",
    ],
    postedDaysAgo: 3,
  },
  {
    id: "fe-mid-5",
    title: "Frontend Developer",
    company: "StartupGrid",
    location: "Hybrid (New York, NY)",
    locationType: "hybrid",
    salaryRange: "$95K – $115K",
    excerpt: "Join our small team building a marketplace for indie SaaS products using React.",
    about: "StartupGrid is an early-stage marketplace connecting indie SaaS founders with enterprise buyers. We're a team of 8, and you'll be the second frontend hire. The product is built in React with Tailwind CSS. We move fast and ship daily.",
    requirements: [
      "2–4 years of frontend development experience with React",
      "Familiarity with Tailwind CSS or similar utility-first frameworks",
      "Basic experience with REST APIs and data fetching patterns",
      "Strong communication skills — you'll work directly with the founder",
      "Must be able to work from our NYC office 3 days per week",
    ],
    responsibilities: [
      "Build new marketplace features: search, filtering, seller profiles",
      "Improve page load performance and Core Web Vitals scores",
      "Set up frontend testing infrastructure (currently zero test coverage)",
      "Help define the frontend architecture as the team grows",
    ],
    benefits: [
      "Hybrid — 3 days in-office in Flatiron, NYC",
      "Base salary $95K–$115K plus 0.5% equity",
      "Health insurance and unlimited PTO",
    ],
    postedDaysAgo: 7,
  },
  {
    id: "react-native-6",
    title: "Senior React Native Developer",
    company: "MobileFirst Labs",
    location: "Remote",
    locationType: "remote",
    salaryRange: "$130K – $155K",
    excerpt: "Build cross-platform mobile apps for our health and fitness platform.",
    about: "MobileFirst Labs builds mobile apps for the health and fitness industry. Our flagship product is a workout tracking app with 500K monthly active users. The app is built in React Native with TypeScript. We're looking for someone who can lead the mobile experience end-to-end.",
    requirements: [
      "5+ years of mobile development experience, with at least 3 years in React Native",
      "Strong TypeScript skills and experience with React Native navigation libraries",
      "Experience with native module bridging (iOS/Swift and Android/Kotlin)",
      "Familiarity with app store submission processes and mobile CI/CD",
      "Experience with offline-first data synchronization patterns",
    ],
    responsibilities: [
      "Lead development of new mobile features across iOS and Android",
      "Optimize app performance: startup time, memory usage, animation frame rates",
      "Integrate with health platform APIs (Apple HealthKit, Google Fit)",
      "Maintain the CI/CD pipeline for app builds and store submissions",
    ],
    benefits: [
      "Fully remote with async-first culture",
      "Base salary $130K–$155K plus equity",
      "Health insurance, gym membership stipend, and 4 weeks PTO",
    ],
    postedDaysAgo: 4,
  },
  {
    id: "angular-7",
    title: "Senior Angular Engineer",
    company: "FinEdge Systems",
    location: "Remote",
    locationType: "remote",
    salaryRange: "$125K – $150K",
    excerpt: "Develop trading dashboards and financial tools using Angular and RxJS.",
    about: "FinEdge Systems provides trading technology for institutional investors. Our frontend is a large Angular 17 application with complex real-time data streams. We process millions of market events per second and need engineers who can build responsive UIs on top of high-throughput WebSocket feeds.",
    requirements: [
      "5+ years of frontend development, with at least 3 years in Angular (v12+)",
      "Expert-level RxJS and reactive programming patterns",
      "Experience with WebSocket connections and real-time data visualization",
      "TypeScript proficiency and familiarity with NgRx or similar state management",
      "Understanding of financial markets or trading systems is a strong plus",
    ],
    responsibilities: [
      "Build and maintain trading dashboard components with real-time market data",
      "Optimize rendering performance for high-frequency data updates",
      "Collaborate with quantitative analysts to design intuitive data visualizations",
      "Write comprehensive unit and integration tests using Jasmine and Karma",
    ],
    benefits: [
      "Fully remote with optional office in Chicago",
      "Base salary $125K–$150K plus performance bonus (10–20%)",
      "Health/dental/vision, 401(k) with 6% match",
    ],
    postedDaysAgo: 6,
  },
  {
    id: "devops-8",
    title: "Senior DevOps Engineer",
    company: "InfraCore",
    location: "On-site (Austin, TX)",
    locationType: "onsite",
    salaryRange: "$135K – $160K",
    excerpt: "Design and maintain cloud infrastructure for a high-traffic e-commerce platform.",
    about: "InfraCore manages cloud infrastructure for some of the largest e-commerce brands in the US. Our team handles Kubernetes clusters serving 50M+ requests per day. You'll own the deployment pipeline, monitoring stack, and incident response processes.",
    requirements: [
      "5+ years of DevOps or SRE experience in a production environment",
      "Expert-level Kubernetes (EKS/GKE) and Terraform/Pulumi",
      "Strong Linux systems administration and networking fundamentals",
      "Experience with observability tools: Prometheus, Grafana, Datadog, or PagerDuty",
      "Scripting proficiency in Python or Bash",
    ],
    responsibilities: [
      "Design and maintain Kubernetes infrastructure across multiple AWS regions",
      "Build and improve CI/CD pipelines using GitHub Actions and ArgoCD",
      "Lead incident response and conduct post-mortems for production outages",
      "Mentor junior DevOps engineers and document infrastructure runbooks",
    ],
    benefits: [
      "On-site in Austin, TX — relocation assistance available",
      "Base salary $135K–$160K plus on-call compensation",
      "Health insurance, 401(k) match, and free lunch on-site",
    ],
    postedDaysAgo: 8,
  },
  {
    id: "data-eng-9",
    title: "Data Engineer",
    company: "QuantaMetrics",
    location: "On-site (Chicago, IL)",
    locationType: "onsite",
    salaryRange: "$120K – $150K",
    excerpt: "Build and optimize data pipelines processing terabytes of analytics events daily.",
    about: "QuantaMetrics provides analytics infrastructure for media companies. We ingest billions of events per day and our data engineering team builds the pipelines that transform raw events into actionable metrics. The stack is Python, Apache Spark, Kafka, and Snowflake.",
    requirements: [
      "4+ years of data engineering experience with large-scale pipelines",
      "Proficiency in Python and SQL — you write production-grade ETL code",
      "Hands-on experience with Apache Spark (PySpark) and Kafka",
      "Familiarity with cloud data warehouses (Snowflake, BigQuery, or Redshift)",
      "Understanding of data modeling, schema evolution, and data quality testing",
    ],
    responsibilities: [
      "Design and maintain ETL pipelines processing 2TB+ of events daily",
      "Optimize Spark jobs for cost and performance on AWS EMR",
      "Build data quality monitoring and alerting dashboards",
      "Collaborate with data scientists on feature engineering pipelines",
    ],
    benefits: [
      "On-site in downtown Chicago with flexible hours",
      "Base salary $120K–$150K plus annual bonus",
      "Health/dental/vision, commuter benefits, and catered lunches",
    ],
    postedDaysAgo: 10,
  },
  {
    id: "pm-10",
    title: "Product Manager, Developer Tools",
    company: "BuildRight",
    location: "Hybrid (Seattle, WA)",
    locationType: "hybrid",
    salaryRange: "$130K – $160K",
    excerpt: "Define the product vision and roadmap for our developer productivity suite.",
    about: "BuildRight makes developer productivity tools used by over 10,000 engineering teams. As a Product Manager, you'll own the roadmap for our CLI and IDE extension products. This is a strategic role that requires strong technical intuition and the ability to translate developer pain points into product features.",
    requirements: [
      "3+ years of product management experience, ideally in developer tools or infrastructure",
      "Strong technical background — you can read code and discuss API design with engineers",
      "Experience with data-driven decision making: A/B tests, funnel analysis, user research",
      "Excellent written and verbal communication — you'll present to leadership monthly",
      "Familiarity with agile/scrum methodologies and tools like Jira or Linear",
    ],
    responsibilities: [
      "Define and prioritize the product roadmap based on user research and market analysis",
      "Write detailed product specs and collaborate with engineering on trade-offs",
      "Run beta programs and gather structured feedback from developer communities",
      "Track key metrics: adoption rate, activation, retention, and NPS",
    ],
    benefits: [
      "Hybrid — 2 days in-office in Seattle, WA",
      "Base salary $130K–$160K plus bonus (15%)",
      "Health insurance, equity, and annual learning stipend ($3,000)",
    ],
    postedDaysAgo: 3,
  },
];

const locationIcon = (type: string) => {
  if (type === "remote") return "🌐";
  if (type === "hybrid") return "🏢";
  return "📍";
};

export default function JobBoard() {
  const [view, setView] = useState<"listings" | "detail">("listings");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [viewedJobs, setViewedJobs] = useState<Set<string>>(new Set());

  useEffect(() => {
    (window as any).__jobBoardState = {
      viewedJobs: Array.from(viewedJobs),
      currentView: view,
      selectedJobId: selectedJob?.id ?? null,
      totalJobs: jobs.length,
    };
  }, [view, selectedJob, viewedJobs]);

  const openJob = (job: Job) => {
    setSelectedJob(job);
    setViewedJobs((prev) => new Set([...prev, job.id]));
    setView("detail");
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
            <button
              className="btn btn-ghost"
              style={{ marginBottom: 16 }}
              onClick={() => setView("listings")}
            >
              ← Back to Listings
            </button>

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

import { useEffect, useRef, useState } from "react";

type ExperienceEntry = {
  company: string;
  title: string;
  startDate: string;
  endDate: string;
  summary: string;
};

type ExperienceEvent = {
  type: "section_added" | "field_updated" | "submitted";
  index?: number;
  field?: keyof ExperienceEntry;
  value?: string;
  at: string;
};

const emptyExperience = (): ExperienceEntry => ({
  company: "",
  title: "",
  startDate: "",
  endDate: "",
  summary: "",
});

const experienceFields: Array<{
  key: keyof ExperienceEntry;
  label: string;
  placeholder: string;
  autoComplete: string;
}> = [
  {
    key: "company",
    label: "Company",
    placeholder: "Company name",
    autoComplete: "organization",
  },
  {
    key: "title",
    label: "Job title",
    placeholder: "Role title",
    autoComplete: "organization-title",
  },
  {
    key: "startDate",
    label: "Start date",
    placeholder: "YYYY-MM",
    autoComplete: "off",
  },
  {
    key: "endDate",
    label: "End date",
    placeholder: "YYYY-MM or Present",
    autoComplete: "off",
  },
  {
    key: "summary",
    label: "Role summary",
    placeholder: "Briefly describe the work and impact",
    autoComplete: "off",
  },
];

const completeFieldCount = (entry: ExperienceEntry) =>
  experienceFields.filter(({ key }) => entry[key].trim()).length;

export default function ExperienceApplication() {
  const [experiences, setExperiences] = useState<ExperienceEntry[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const eventsRef = useRef<ExperienceEvent[]>([]);

  const recordEvent = (event: Omit<ExperienceEvent, "at">) => {
    eventsRef.current = [
      ...eventsRef.current,
      { ...event, at: new Date().toISOString() },
    ];
  };

  useEffect(() => {
    const completedSections = experiences.filter(
      (entry) => completeFieldCount(entry) === experienceFields.length,
    ).length;
    const emptyFields = experiences.flatMap((entry, index) =>
      experienceFields
        .filter(({ key }) => !entry[key].trim())
        .map(({ key }) => `Experience ${index + 1} ${key}`),
    );
    (window as any).experienceApplicationDraft = {
      experiences,
      sectionCount: experiences.length,
      completedSections,
      emptyFields,
      submitted,
      events: eventsRef.current,
    };
  }, [experiences, submitted]);

  const updateExperience = (
    index: number,
    field: keyof ExperienceEntry,
    value: string,
  ) => {
    recordEvent({ type: "field_updated", index, field, value });
    setExperiences((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [field]: value } : entry,
      ),
    );
  };

  const addExperience = () => {
    if (experiences.length >= 3) return;
    recordEvent({ type: "section_added", index: experiences.length });
    setExperiences((current) => [...current, emptyExperience()]);
  };

  const canSubmit =
    experiences.length === 3 &&
    experiences.every(
      (entry) =>
        entry.company.trim() &&
        entry.title.trim() &&
        entry.startDate.trim() &&
        entry.endDate.trim() &&
        entry.summary.trim(),
    );

  const submit = () => {
    recordEvent({ type: "submitted" });
    const result = {
      experiences,
      submitted: true,
      events: eventsRef.current,
    };
    (window as any).experienceApplicationResult = result;
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <main className="fixture-static experience-app">
        <div className="experience-shell">
          <div className="experience-panel">
            <h1>Experience application received</h1>
            <p>Thanks. We received {experiences.length} experience entries.</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="fixture-static experience-app">
      <div className="experience-shell">
        <section className="experience-panel" aria-labelledby="experience-title">
          <div className="experience-header">
            <p className="experience-eyebrow">Candidate application</p>
            <h1 id="experience-title">Work experience</h1>
            <p className="lede">
              Add each role from your employment history before submitting the
              application.
            </p>
          </div>

          <div className="experience-progress" aria-label="Experience progress">
            <span>{experiences.length} of 3 experience sections added</span>
            <span>
              {
                experiences.filter(
                  (entry) => completeFieldCount(entry) === experienceFields.length,
                ).length
              }{" "}
              complete
            </span>
          </div>

          <form
            aria-label="Work experience form"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit) submit();
            }}
          >
            {experiences.length === 0 && (
              <div className="experience-empty" role="status">
                No experience sections have been added yet.
              </div>
            )}

            <div className="experience-list">
              {experiences.map((entry, index) => {
                const sectionNumber = index + 1;
                return (
                  <fieldset
                    key={index}
                    className="experience-section"
                    aria-labelledby={`experience-${sectionNumber}-heading`}
                  >
                    <legend id={`experience-${sectionNumber}-heading`}>
                      Experience {sectionNumber}
                    </legend>
                    <div className="experience-section-status">
                      {completeFieldCount(entry)} of {experienceFields.length}{" "}
                      fields complete
                    </div>

                    <div className="experience-field-grid">
                      {experienceFields.map(
                        ({ key, label, placeholder, autoComplete }) => {
                          const fieldId = `experience-${sectionNumber}-${key}`;
                          const accessibleLabel = `Experience ${sectionNumber} ${label.toLowerCase()}`;
                          return (
                            <div
                              className={`field ${
                                key === "summary" ? "experience-field-wide" : ""
                              }`}
                              key={key}
                            >
                              <label htmlFor={fieldId}>{label}</label>
                              <input
                                id={fieldId}
                                name={`experiences[${index}].${key}`}
                                aria-label={accessibleLabel}
                                autoComplete={autoComplete}
                                value={entry[key]}
                                onChange={(event) =>
                                  updateExperience(index, key, event.target.value)
                                }
                                placeholder={placeholder}
                              />
                            </div>
                          );
                        },
                      )}
                    </div>
                  </fieldset>
                );
              })}
            </div>

            <div className="experience-actions">
              <button
                className="btn btn-ghost"
                type="button"
                disabled={experiences.length >= 3}
                onClick={addExperience}
              >
                Add experience
              </button>

              <button className="btn btn-primary" type="submit" disabled={!canSubmit}>
                Submit application
              </button>
            </div>
          </form>
        </section>

        <aside className="experience-sidebar" aria-label="Application status">
          <h2>Application status</h2>
          <dl>
            <div>
              <dt>Required entries</dt>
              <dd>3</dd>
            </div>
            <div>
              <dt>Added entries</dt>
              <dd>{experiences.length}</dd>
            </div>
            <div>
              <dt>Submission</dt>
              <dd>{submitted ? "Submitted" : "Not submitted"}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </main>
  );
}

import { useEffect, useState, type ChangeEvent } from "react";

type AshbyDraft = {
  name: string;
  email: string;
  linkedIn: string;
  phone: string;
  currentLocation: string;
  euWorkPermit: string;
  salaryExpectation: string;
  earliestStartDate: string;
  whyLangfuse: string;
  resumeName: string;
};

const emptyDraft: AshbyDraft = {
  name: "",
  email: "",
  linkedIn: "",
  phone: "",
  currentLocation: "",
  euWorkPermit: "",
  salaryExpectation: "",
  earliestStartDate: "",
  whyLangfuse: "",
  resumeName: "",
};

export default function AshbyJobApplication() {
  const [draft, setDraft] = useState<AshbyDraft>(emptyDraft);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    (window as any).ashbyApplicationDraft = {
      ...draft,
      submitted,
      completeRequestedFields: [
        draft.name,
        draft.email,
        draft.currentLocation,
        draft.euWorkPermit,
        draft.salaryExpectation,
        draft.earliestStartDate,
        draft.whyLangfuse,
      ].filter((value) => value.trim()).length,
    };
  }, [draft, submitted]);

  const updateField =
    (field: keyof AshbyDraft) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDraft((current) => ({ ...current, [field]: event.target.value }));
    };

  const setWorkPermit = (value: string) => {
    setDraft((current) => ({ ...current, euWorkPermit: value }));
  };

  const submit = () => {
    const result = { ...draft, submitted: true };
    (window as any).ashbyApplicationResult = result;
    setSubmitted(true);
  };

  const canSubmit =
    draft.name.trim() &&
    draft.email.includes("@") &&
    draft.currentLocation.trim() &&
    draft.euWorkPermit &&
    draft.salaryExpectation.trim() &&
    draft.earliestStartDate.trim() &&
    draft.whyLangfuse.trim();

  if (submitted) {
    return (
      <main className="fixture-static">
        <div className="container">
          <div className="card">
            <p className="lede">Powered by Ashby</p>
            <h1>Application received</h1>
            <p>Thanks, {draft.name}. Your application was submitted.</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="fixture-static" data-platform="ashby">
      <div className="container">
        <div className="card">
          <p className="lede">Powered by Ashby</p>
          <h1>Senior Product Engineer @ Langfuse</h1>
          <p>
            Complete the application below. Required fields are marked with an
            asterisk.
          </p>

          <form
            aria-label="Ashby application form"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit) submit();
            }}
          >
            <div className="field">
              <label htmlFor="ashby-name">Name *</label>
              <input
                id="ashby-name"
                value={draft.name}
                onChange={updateField("name")}
                autoComplete="name"
              />
            </div>

            <div className="field">
              <label htmlFor="ashby-email">Email *</label>
              <input
                id="ashby-email"
                type="email"
                value={draft.email}
                onChange={updateField("email")}
                autoComplete="email"
              />
            </div>

            <div className="field">
              <label htmlFor="ashby-linkedin">LinkedIn URL</label>
              <input
                id="ashby-linkedin"
                value={draft.linkedIn}
                onChange={updateField("linkedIn")}
                autoComplete="url"
              />
            </div>

            <div className="field">
              <label htmlFor="ashby-phone">Phone</label>
              <input
                id="ashby-phone"
                type="tel"
                value={draft.phone}
                onChange={updateField("phone")}
                autoComplete="tel"
              />
            </div>

            <div className="field">
              <label htmlFor="ashby-resume">Resume/CV</label>
              <input
                id="ashby-resume"
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    resumeName: event.target.files?.[0]?.name ?? "",
                  }))
                }
              />
              {draft.resumeName && <p>Selected file: {draft.resumeName}</p>}
            </div>

            <div className="field">
              <label htmlFor="ashby-location">Current Location *</label>
              <input
                id="ashby-location"
                value={draft.currentLocation}
                onChange={updateField("currentLocation")}
                autoComplete="address-level2"
              />
            </div>

            <fieldset className="field">
              <legend>EU Work Permit *</legend>
              <label htmlFor="ashby-work-permit-yes">
                <input
                  id="ashby-work-permit-yes"
                  name="ashby-work-permit"
                  type="radio"
                  value="Yes"
                  checked={draft.euWorkPermit === "Yes"}
                  onChange={() => setWorkPermit("Yes")}
                />
                Yes
              </label>
              <label htmlFor="ashby-work-permit-no">
                <input
                  id="ashby-work-permit-no"
                  name="ashby-work-permit"
                  type="radio"
                  value="No"
                  checked={draft.euWorkPermit === "No"}
                  onChange={() => setWorkPermit("No")}
                />
                No
              </label>
            </fieldset>

            <div className="field">
              <label htmlFor="ashby-salary">Salary Expectation *</label>
              <input
                id="ashby-salary"
                value={draft.salaryExpectation}
                onChange={updateField("salaryExpectation")}
              />
            </div>

            <div className="field">
              <label htmlFor="ashby-start-date">Earliest Start Date *</label>
              <input
                id="ashby-start-date"
                value={draft.earliestStartDate}
                onChange={updateField("earliestStartDate")}
                placeholder="YYYY-MM-DD"
              />
            </div>

            <div className="field">
              <label htmlFor="ashby-why-langfuse">
                Why Do You Care About Langfuse? *
              </label>
              <textarea
                id="ashby-why-langfuse"
                rows={7}
                value={draft.whyLangfuse}
                onChange={updateField("whyLangfuse")}
              />
            </div>

            <button className="btn btn-primary" type="submit" disabled={!canSubmit}>
              Submit Application
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

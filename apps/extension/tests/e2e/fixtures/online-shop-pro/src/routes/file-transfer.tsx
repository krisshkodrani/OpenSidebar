import { useEffect, useMemo, useState, type ChangeEvent } from "react";

const SAMPLE_FILE = "vendor-catalog-sample.csv";

type UploadState = {
  filename: string;
  size: number;
  text: string;
};

export default function FileTransfer() {
  const [upload, setUpload] = useState<UploadState | null>(null);
  const sampleUrl = useMemo(() => {
    if (typeof window === "undefined") {
      return `/downloads/${SAMPLE_FILE}`;
    }
    return new URL(`/downloads/${SAMPLE_FILE}`, window.location.href).href;
  }, []);

  useEffect(() => {
    (window as any).fileTransferSampleUrl = sampleUrl;
    (window as any).fileTransferUpload = null;
  }, [sampleUrl]);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    const state = {
      filename: file.name,
      size: file.size,
      text: await file.text(),
    };
    setUpload(state);
    (window as any).fileTransferUpload = state;
  }

  return (
    <div className="fixture-static" style={{ minHeight: "100vh" }}>
      <div className="header">
        <h1>Vendor File Transfer</h1>
        <p>Use the sample vendor catalog for the import field.</p>
      </div>

      <div className="container" style={{ maxWidth: 860, margin: "32px auto", padding: "0 24px" }}>
        <article className="card" style={{ lineHeight: 1.6 }}>
          <h2>Import Package</h2>
          <p>
            The sample vendor catalog is available at{" "}
            <a href={sampleUrl} download={SAMPLE_FILE}>
              {SAMPLE_FILE}
            </a>
            .
          </p>
          <p>
            File URL: <code>{sampleUrl}</code>
          </p>

          <div style={{ marginTop: 24 }}>
            <label htmlFor="vendor-import">
              Vendor import file
            </label>
            <input
              id="vendor-import"
              name="vendor-import"
              type="file"
              accept=".csv,text/csv"
              onChange={handleUpload}
              style={{ display: "block", marginTop: 8 }}
            />
          </div>

          {upload ? (
            <div
              data-testid="upload-result"
              style={{
                marginTop: 24,
                padding: 16,
                border: "1px solid #a7d7b8",
                borderRadius: 8,
                background: "#f3fbf5",
              }}
            >
              Uploaded <strong>{upload.filename}</strong> ({upload.size} bytes).
              The catalog includes Acme Analytics.
            </div>
          ) : null}
        </article>
      </div>
    </div>
  );
}

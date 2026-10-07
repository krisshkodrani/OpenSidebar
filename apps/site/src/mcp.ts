import "./styles.css";
import "./mcp.css";

for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-copy]",
)) {
  button.addEventListener("click", async () => {
    const source = document.getElementById(button.dataset.copy ?? "");
    const status = document.getElementById("copy-status");
    if (!source || !status) return;
    try {
      await navigator.clipboard.writeText(source.textContent ?? "");
      status.textContent = `${button.textContent?.replace(/^Copy /, "") ?? "Text"} copied.`;
    } catch {
      status.textContent =
        "Could not copy. Select the visible text and copy it manually.";
    }
  });
}

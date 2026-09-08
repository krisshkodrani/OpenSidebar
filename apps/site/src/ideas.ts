import "./styles.css";
import "./ideas.css";

const progress = document.getElementById("reading-progress");
const article = document.getElementById("article");

function updateReadingProgress(): void {
  if (!progress || !article) return;

  const articleTop = article.offsetTop;
  const articleHeight = article.offsetHeight;
  const viewportHeight = window.innerHeight;
  const distance = articleHeight - viewportHeight;
  const travelled = window.scrollY - articleTop + viewportHeight * 0.22;
  const ratio =
    distance <= 0 ? 1 : Math.min(1, Math.max(0, travelled / distance));

  progress.style.transform = `scaleX(${ratio})`;
}

let progressFrame = 0;
function scheduleProgressUpdate(): void {
  if (progressFrame) return;
  progressFrame = window.requestAnimationFrame(() => {
    progressFrame = 0;
    updateReadingProgress();
  });
}

window.addEventListener("scroll", scheduleProgressUpdate, { passive: true });
window.addEventListener("resize", scheduleProgressUpdate);
updateReadingProgress();

const year = document.getElementById("year");
if (year) year.textContent = String(new Date().getFullYear());

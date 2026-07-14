import "./styles.css";

const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

/**
 * Click-to-play video players. Markup contract (see index.html):
 *   <figure class="player" data-src="/media/v1/foo.mp4">
 *     <img class="poster" src="…" alt="" />
 *     <button class="play">▶</button>
 *   </figure>
 * The <video> element is created and its source attached only on first play,
 * so nothing below the fold downloads until the visitor asks for it.
 */
function wirePlayers(): void {
  const players = document.querySelectorAll<HTMLElement>(".player[data-src]");
  players.forEach((player) => {
    const button = player.querySelector<HTMLButtonElement>(".play");
    if (!button) return;
    let video: HTMLVideoElement | null = null;

    const start = () => {
      if (!video) {
        video = document.createElement("video");
        video.src = player.dataset.src ?? "";
        video.setAttribute("playsinline", "");
        video.controls = true;
        video.preload = "auto";
        const label = player.getAttribute("aria-label");
        if (label) video.setAttribute("aria-label", label);
        const poster = player.querySelector(".poster");
        player.insertBefore(video, poster ?? null);
      }
      player.dataset.playing = "true";
      void video.play().catch(() => {
        /* autoplay/user-gesture edge — controls remain available */
      });
    };

    button.addEventListener("click", start);
  });
}

/** Fade sections in as they enter the viewport (skipped under reduced motion). */
function wireReveal(): void {
  const targets = document.querySelectorAll<HTMLElement>(".reveal");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    targets.forEach((t) => t.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          obs.unobserve(entry.target);
        }
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
  );
  targets.forEach((t) => io.observe(t));
}

/** Stamp the current year into the footer. */
function wireYear(): void {
  const el = document.getElementById("year");
  if (el) el.textContent = String(new Date().getFullYear());
}

wirePlayers();
wireReveal();
wireYear();

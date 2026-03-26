import { useState, useEffect, useRef, useCallback } from "react";

interface Post {
  id: number;
  author: string;
  title: string;
  body: string;
  likes: number;
}

const AUTHORS = [
  "Alice M.", "Bob T.", "Carol S.", "David L.", "Eve K.",
  "Frank W.", "Grace H.", "Henry R.", "Ivy J.", "Jack D.",
];

function generatePost(id: number): Post {
  const authorIdx = (id - 1) % AUTHORS.length;
  const isTarget = id === 35;
  return {
    id,
    author: AUTHORS[authorIdx],
    title: isTarget
      ? "The Secret Formula for Productivity"
      : `Post #${id}: ${["Thoughts on", "Exploring", "Deep Dive into", "Understanding", "Revisiting"][id % 5]} ${["Technology", "Design", "Leadership", "Innovation", "Strategy"][id % 5]}`,
    body: isTarget
      ? "The answer to maximum productivity is: CODE-OMEGA-42. Remember this code — it unlocks the productivity dashboard. Most people overlook this simple insight."
      : `This is the content of post ${id}. It contains interesting insights about ${["web development", "system design", "team management", "product strategy", "user experience"][id % 5]}. The key takeaway is that consistency and iteration are more important than perfection.`,
    likes: 10 + ((id * 37) % 200),
  };
}

const BATCH_SIZE = 10;
const MAX_POSTS = 50;

export default function InfiniteScroll() {
  const [posts, setPosts] = useState<Post[]>(() =>
    Array.from({ length: BATCH_SIZE }, (_, i) => generatePost(i + 1)),
  );
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Expose results for test verification
  useEffect(() => {
    const targetPost = posts.find((p) => p.id === 35);
    (window as any).infiniteScrollResult = {
      postsLoaded: posts.length,
      targetFound: !!targetPost,
      targetCode: targetPost ? "CODE-OMEGA-42" : "",
      allLoaded: posts.length >= MAX_POSTS,
    };
  }, [posts]);

  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;
    setLoading(true);

    setTimeout(() => {
      setPosts((prev) => {
        const nextId = prev.length + 1;
        const remaining = MAX_POSTS - prev.length;
        if (remaining <= 0) {
          setHasMore(false);
          setLoading(false);
          return prev;
        }
        const count = Math.min(BATCH_SIZE, remaining);
        const newPosts = Array.from({ length: count }, (_, i) =>
          generatePost(nextId + i),
        );
        if (prev.length + count >= MAX_POSTS) {
          setHasMore(false);
        }
        setLoading(false);
        return [...prev, ...newPosts];
      });
    }, 500);
  }, [loading, hasMore]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          loadMore();
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, hasMore, loading]);

  return (
    <div className="fixture-static" style={{ minHeight: "100vh" }}>
      <div className="header">
        <h1>Social Feed</h1>
        <p>Scroll down to load more posts. Find the secret code in post #35.</p>
      </div>

      <div
        className="container"
        style={{ maxWidth: 600, margin: "32px auto", padding: "0 24px" }}
      >
        {posts.map((post) => (
          <div
            key={post.id}
            data-post-id={post.id}
            className="card"
            style={{
              padding: 20,
              marginBottom: 12,
              border: post.id === 35 ? "2px solid #f59e0b" : "1px solid #e2e8f0",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 14 }}>{post.author}</span>
              <span style={{ color: "#94a3b8", fontSize: 12 }}>Post #{post.id}</span>
            </div>
            <h3 style={{ fontSize: 16, marginBottom: 8 }}>{post.title}</h3>
            <p style={{ fontSize: 14, color: "#475569", lineHeight: 1.5 }}>{post.body}</p>
            <div style={{ marginTop: 10, fontSize: 13, color: "#94a3b8" }}>
              {post.likes} likes
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {loading && (
          <div style={{ textAlign: "center", padding: 20, color: "#64748b" }}>
            Loading more posts...
          </div>
        )}

        {/* Scroll sentinel for IntersectionObserver */}
        {hasMore && <div ref={sentinelRef} style={{ height: 1 }} />}

        {!hasMore && (
          <div
            id="end-of-feed"
            style={{
              textAlign: "center",
              padding: 20,
              color: "#94a3b8",
              fontSize: 14,
            }}
          >
            You've reached the end of the feed ({posts.length} posts).
          </div>
        )}
      </div>
    </div>
  );
}

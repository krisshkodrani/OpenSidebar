import { useState, useEffect } from "react";

interface FaqItem {
  question: string;
  answer: string;
  hiddenCode?: string; // code hidden inside display:none span
}

const FAQ_ITEMS: FaqItem[] = [
  {
    question: "What is your return policy?",
    answer:
      "We accept returns within 30 days of purchase. Items must be in original condition with tags attached. Shipping costs for returns are the responsibility of the customer unless the item arrived damaged.",
  },
  {
    question: "How long does shipping take?",
    answer:
      "Standard shipping takes 5-7 business days. Express shipping takes 2-3 business days. International orders may take up to 14 business days depending on destination and customs clearance.",
  },
  {
    question: "Do you ship internationally?",
    answer:
      "Yes, we ship to over 50 countries worldwide. International shipping rates and delivery times vary by destination. Additional customs fees may apply and are the responsibility of the recipient.",
  },
  {
    question: "How can I track my order?",
    answer:
      "Once your order ships, you'll receive a tracking number via email. You can use this number on our website or the carrier's site to track your package in real time.",
  },
  {
    question: "Do you offer promo codes?",
    answer:
      "Yes! We regularly offer promotional discounts to our customers. Check our newsletter or social media for the latest deals. Current active code:",
    hiddenCode: "SAVE20",
  },
  {
    question: "What payment methods do you accept?",
    answer:
      "We accept Visa, Mastercard, American Express, Discover, PayPal, Apple Pay, and Google Pay. All transactions are secured with 256-bit SSL encryption.",
  },
  {
    question: "Can I modify my order after placing it?",
    answer:
      "Orders can be modified within 1 hour of placement. After that, our warehouse begins processing and changes cannot be guaranteed. Contact support immediately if you need to make changes. See Section 8 for contact info.",
  },
  {
    question: "How do I contact customer support?",
    answer:
      "You can reach us via email at support@store.com, by phone at 1-800-555-0199 (Mon-Fri 9am-6pm EST), or through our live chat on the website. Average response time is under 2 hours.",
  },
];

export default function FaqAccordion() {
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const [hiddenCodeFound, setHiddenCodeFound] = useState(false);

  const toggleSection = (index: number) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // Expose results for test verification
  useEffect(() => {
    (window as any).faqResult = {
      expandedSections: Array.from(expandedSections),
      hiddenCodeFound,
      codeValue: hiddenCodeFound ? "SAVE20" : "",
    };
  });

  return (
    <div className="fixture-static" style={{ minHeight: "100vh" }}>
      <div className="header">
        <h1>Frequently Asked Questions</h1>
        <p>Click on a question to expand or collapse its answer.</p>
      </div>

      <div
        className="container"
        style={{ maxWidth: 700, margin: "32px auto", padding: "0 24px" }}
      >
        {FAQ_ITEMS.map((item, index) => (
          <div
            key={index}
            className="card"
            data-faq-index={index}
            style={{
              marginBottom: 8,
              padding: 0,
              overflow: "hidden",
              border: expandedSections.has(index)
                ? "1px solid #bfdbfe"
                : "1px solid #e2e8f0",
            }}
          >
            {/* Question header — always visible, clickable */}
            <button
              onClick={() => toggleSection(index)}
              style={{
                width: "100%",
                textAlign: "left",
                background: expandedSections.has(index) ? "#eff6ff" : "#fff",
                border: "none",
                padding: "16px 20px",
                cursor: "pointer",
                fontSize: 15,
                fontWeight: 600,
                color: "#1e293b",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>
                {index + 1}. {item.question}
              </span>
              <span
                style={{
                  fontSize: 18,
                  color: "#94a3b8",
                  transform: expandedSections.has(index) ? "rotate(180deg)" : "none",
                  transition: "transform 0.2s",
                }}
              >
                V
              </span>
            </button>

            {/* Answer body — visible when expanded */}
            {expandedSections.has(index) && (
              <div
                data-faq-answer={index}
                style={{
                  padding: "0 20px 16px",
                  fontSize: 14,
                  color: "#475569",
                  lineHeight: 1.6,
                }}
              >
                <p>{item.answer}</p>

                {/* Hidden promo code — display:none even when accordion is expanded */}
                {item.hiddenCode && (
                  <div style={{ marginTop: 8 }}>
                    <span
                      data-hidden-code="true"
                      style={{
                        display: "none",
                        background: "#dcfce7",
                        padding: "4px 12px",
                        borderRadius: 4,
                        fontWeight: 700,
                        fontFamily: "monospace",
                      }}
                    >
                      {item.hiddenCode}
                    </span>
                    <button
                      onClick={() => {
                        setHiddenCodeFound(true);
                        (window as any).faqResult = {
                          expandedSections: Array.from(expandedSections),
                          hiddenCodeFound: true,
                          codeValue: "SAVE20",
                        };
                      }}
                      style={{
                        marginTop: 8,
                        background: "#f0fdf4",
                        border: "1px solid #bbf7d0",
                        padding: "6px 14px",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontSize: 13,
                        color: "#166534",
                      }}
                    >
                      Reveal Code
                    </button>
                    {hiddenCodeFound && (
                      <p
                        id="revealed-code"
                        style={{
                          marginTop: 8,
                          fontFamily: "monospace",
                          fontWeight: 700,
                          color: "#166534",
                          fontSize: 16,
                        }}
                      >
                        SAVE20
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

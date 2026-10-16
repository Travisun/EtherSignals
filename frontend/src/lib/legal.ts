/**
 * Legal content for EtherSignals. Structured (not i18n-routed; single
 * official language), rendered by src/components/legal/legal-page.tsx.
 *
 * The site is a personal research & educational reference project with no
 * accounts, no payments and no third-party analytics. The documents below
 * are written to be honest about exactly that footprint and to satisfy the
 * core transparency duties of GDPR/CCPA-style regimes (identity, purposes,
 * retention, rights, contact) plus an explicit no-advice disclaimer.
 */

export type LegalSection = {
  h: string;
  p?: string[];
  ul?: string[];
  table?: { head: string[]; rows: string[][] };
};

export type LegalDoc = {
  title: string;
  lastUpdated: string;
  operator: string;
  contact: string;
  sections: LegalSection[];
};

const OPERATOR = "the EtherSignals operator (personal research project)";
const CONTACT = "via the Telegram channel linked in the site footer";
const UPDATED = "2026-10-16";

export const PRIVACY: LegalDoc = {
  title: "Privacy Policy",
  lastUpdated: UPDATED,
  operator: OPERATOR,
  contact: CONTACT,
  sections: [
    {
      h: "1. Who we are",
      p: [
        `${"EtherSignals"} is a personal, non-commercial research and educational project that publishes the output of an automated AI trend model for Ethereum markets. Signals are computed in real time from market data and published here for study and reference. This policy explains what data the site processes, why, for how long, and the rights you have. The data controller is ${OPERATOR}. You can reach the operator ${CONTACT}.`,
      ],
    },
    {
      h: "2. Data we process",
      ul: [
        "Signal data: AI model outputs about market conditions (symbol, timeframe, trend regime, model score, key price levels). This is published data about markets, not about you.",
        "IP addresses: processed transiently to enforce the request rate limit (4 requests per minute per IP) and recorded in a bounded security audit log when the webhook ingest endpoint is called.",
        "Push subscriptions: if you opt in to desktop notifications, we store the browser-generated push endpoint and cryptographic keys (p256dh/auth). No name, email or account is involved, because the site has no registration.",
        "Local storage: your cookie-consent choice, theme preference and the dismissal state of the Telegram invite dialog are stored on your device only. They are never transmitted to us.",
        "Usage analytics (optional): if you accept analytics in the consent banner, the site records privacy-friendly usage metrics (pages viewed, button and link clicks, feed interactions) through a self-hosted Umami instance. Umami is cookieless: it sets no cookies or advertising identifiers and does not build cross-site profiles. Declining keeps analytics off entirely.",
        "Technical logs: the hosting layer may keep standard server logs (IP, user agent, timestamp) for security and abuse prevention.",
      ],
    },
    {
      h: "3. What we do NOT do",
      ul: [
        "No accounts, no sign-up, no passwords.",
        "No advertising, no ad-tech, no cross-site tracking. The only analytics are optional, consent-gated, self-hosted and cookieless (Umami), and the data is never shared or sold.",
        "No selling or sharing of personal data with data brokers.",
        "No profiling or automated decision-making about individuals.",
      ],
    },
    {
      h: "4. Purposes and legal bases (GDPR)",
      table: {
        head: ["Processing", "Purpose", "Legal basis"],
        rows: [
          ["IP-based rate limiting", "Protect service availability and prevent abuse", "Legitimate interests (Art. 6(1)(f) GDPR)"],
          ["Webhook security audit log", "Detect and investigate unauthorized ingest attempts", "Legitimate interests (Art. 6(1)(f) GDPR)"],
          ["Push subscription storage", "Deliver signal notifications you requested", "Consent (Art. 6(1)(a) GDPR), withdrawable anytime"],
          ["Optional usage analytics (self-hosted Umami, cookieless)", "Understand which pages and features visitors use", "Consent (Art. 6(1)(a) GDPR), withdrawable via the consent banner"],
          ["Local storage (preferences)", "Remember consent, theme and UI state", "Consent via the consent banner; strictly necessary where used for security"],
        ],
      },
    },
    {
      h: "5. Retention",
      ul: [
        "Rate-limit counters: in-memory, expire within 60 seconds to 1 hour.",
        "Ingest audit log: rolling 30-day window, then deleted.",
        "Push subscriptions: kept until you unsubscribe, your browser removes the subscription, or delivery failures mark the endpoint dead (HTTP 404/410), whichever comes first.",
        "Server logs: retained per the hosting provider's default rotation.",
      ],
    },
    {
      h: "6. Your rights",
      p: [
        "Depending on your jurisdiction (e.g. EU/EEA under GDPR, California under CCPA/CPRA, other regions with similar statutes), you may have rights of access, deletion, correction, portability, and the right to object to or restrict processing, as well as the right not to be discriminated against for exercising these rights.",
        "Because the site stores no identity data about you, most requests reduce to one action: clear the site's local storage in your browser, which erases consent state and preferences. Push subscriptions can be removed by disabling notifications in your browser or contacting the operator with the subscription endpoint you want deleted. Requests can be made " + CONTACT + ".",
        "California residents: we do not 'sell' or 'share' personal information as defined by the CCPA/CPRA.",
      ],
    },
    {
      h: "7. Cookies",
      table: {
        head: ["Name", "Type", "Purpose", "Duration"],
        rows: [
          ["ethersignals.consent", "Cookie + localStorage", "Stores your cookie-consent decision (all / essential)", "180 days"],
          ["ethersignals.tg-drawer", "localStorage", "Remembers when you dismissed the Telegram invite", "3 days"],
          ["theme", "localStorage", "Remembers light/dark theme preference", "Until cleared"],
        ],
      },
      p: [
        "No consent is required for strictly necessary storage. Optional push notifications are only activated after you press the alerts button and grant browser permission. The self-hosted Umami analytics set no cookies at all and run only while analytics consent is active.",
      ],
    },
    {
      h: "8. International transfers",
      p: [
        "The site and its database may be hosted in any jurisdiction the operator chooses. Where personal data (limited to IPs and push endpoints as described above) is processed, standard hosting-layer safeguards apply. Given the minimal, non-identifying nature of the data, no additional transfer mechanisms are relied upon.",
      ],
    },
    {
      h: "9. Children",
      p: ["The site is not directed at children under 16 and no age data is collected."],
    },
    {
      h: "10. Changes",
      p: [
        "This policy may be updated to reflect material changes. The 'last updated' date above changes only when the substance changes.",
      ],
    },
  ],
};

export const TERMS: LegalDoc = {
  title: "Terms of Service",
  lastUpdated: UPDATED,
  operator: OPERATOR,
  contact: CONTACT,
  sections: [
    {
      h: "1. Acceptance",
      p: [
        "By accessing EtherSignals (the 'Site') you agree to these Terms. If you do not agree, do not use the Site. The Site is a personal research and educational reference project provided free of charge, without registration.",
      ],
    },
    {
      h: "2. Nature of the service",
      ul: [
        "The Site displays machine-generated market signals received from the operator's research server.",
        "Signals may be delayed, incorrect, incomplete, or entirely wrong. They are published as a technical demonstration and research artifact.",
        "Nothing on the Site is a recommendation, solicitation, or offer to buy or sell any asset. See the Disclaimer page.",
      ],
    },
    {
      h: "3. Acceptable use",
      ul: [
        "Do not exceed the published rate limits (4 API requests per minute per IP) or attempt to circumvent them.",
        "Do not attempt to gain unauthorized access to the Site, its ingest endpoint, or its infrastructure.",
        "Do not scrape the Site at volumes that degrade service for others; contact the operator for bulk research access.",
        "Do not misrepresent EtherSignals signals as your own paid service or as financial advice.",
      ],
    },
    {
      h: "4. API access",
      p: [
        "The public feed endpoint (GET /api/signals) is provided as-is for personal, non-commercial research use, subject to rate limiting and availability. The operator may change, suspend, or discontinue any part of the service at any time without notice.",
      ],
    },
    {
      h: "5. Intellectual property",
      p: [
        "The Site's code, design, and branding are the property of the operator. Signal data itself is factual market information and may be freely studied and cited for research with attribution.",
      ],
    },
    {
      h: "6. Disclaimers and limitation of liability",
      p: [
        "THE SITE IS PROVIDED 'AS IS' AND 'AS AVAILABLE' WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED. TO THE FULLEST EXTENT PERMITTED BY LAW, THE OPERATOR DISCLAIMS ALL LIABILITY FOR ANY DIRECT, INDIRECT, INCIDENTAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF, OR RELIANCE ON, THE SITE, INCLUDING ANY TRADING LOSSES. NOTHING HERE LIMITS LIABILITY WHERE SUCH LIMITATION IS PROHIBITED BY LAW.",
      ],
    },
    {
      h: "7. Termination",
      p: [
        "Access may be blocked (e.g. by IP rate-limiting) for abuse. These terms terminate automatically if the operator takes the Site offline.",
      ],
    },
    {
      h: "8. Governing law & contact",
      p: [
        `These Terms are governed by the laws of the operator's place of residence, without prejudice to mandatory consumer protections in your country of residence. Questions: ${CONTACT}.`,
      ],
    },
  ],
};

export const DISCLAIMER: LegalDoc = {
  title: "Disclaimer",
  lastUpdated: UPDATED,
  operator: OPERATOR,
  contact: CONTACT,
  sections: [
    {
      h: "1. Research & educational project only",
      p: [
        "EtherSignals is a personal research and educational reference project. It exists to demonstrate an end-to-end AI signal pipeline (webhook ingest, PostgreSQL storage, public feed) and to publish the model's output for study. It is not a trading service, a broker, an exchange, an investment adviser, or a financial product.",
      ],
    },
    {
      h: "2. Not financial advice",
      ul: [
        "No content on this Site constitutes financial, investment, legal, or tax advice.",
        "No signal, trend regime, score, or price level is a recommendation to buy, sell, or hold any asset.",
        "The AI model has no proven edge, may be systematically wrong, and does not account for your circumstances. Its scores and probabilities are statistical estimates, not guarantees.",
      ],
    },
    {
      h: "3. Risk warning",
      p: [
        "Trading cryptocurrencies and derivatives carries a high risk of losing all of your capital. Leverage amplifies both gains and losses and can lead to the loss of more than your initial deposit on some venues. Past performance of any signal, strategy, or backtest, whether real or simulated, is not indicative of future results. Never trade with money you cannot afford to lose, and seek advice from a licensed professional where appropriate.",
      ],
    },
    {
      h: "4. No liability",
      p: [
        "You use the Site and any information on it entirely at your own risk. To the maximum extent permitted by law, the operator accepts no responsibility or liability for any loss or damage, including trading losses, lost profits, or data loss, arising from use of, or reliance on, the Site or its signals, even if advised of the possibility of such damages.",
      ],
    },
    {
      h: "5. Use at your own discretion",
      p: [
        "You are solely responsible for your own investment decisions and for complying with the laws and regulations of your jurisdiction, which may restrict or prohibit access to crypto-asset information services. If you act on anything published here, you do so on your own judgment and at your own risk.",
      ],
    },
    {
      h: "6. Accuracy & availability",
      p: [
        "Signals are relayed as received, without independent verification. The feed may be interrupted, rate-limited, or discontinued at any time without notice.",
      ],
    },
  ],
};

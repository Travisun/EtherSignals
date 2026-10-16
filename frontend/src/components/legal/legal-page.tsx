import type { Metadata } from "next";
import type { LegalDoc } from "@/lib/legal";

export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <article className="legal mx-auto max-w-3xl pb-8">
      <header className="mb-6 border-b border-border pb-4">
        <h1 className="text-2xl font-bold tracking-tight">{doc.title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Last updated {doc.lastUpdated} · Operator: {doc.operator} · Contact: {doc.contact}
        </p>
      </header>

      {doc.sections.map((section) => (
        <section key={section.h}>
          <h2>{section.h}</h2>
          {section.p?.map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
          {section.ul ? (
            <ul>
              {section.ul.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : null}
          {section.table ? (
            <table>
              <thead>
                <tr>
                  {section.table.head.map((cell) => (
                    <th key={cell}>{cell}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {section.table.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      ))}
    </article>
  );
}

export function legalMetadata(doc: LegalDoc): Metadata {
  return {
    title: doc.title,
    description: `${doc.title} of EtherSignals, a personal research and educational reference project.`,
    robots: { index: true, follow: true },
  };
}

import { LegalPage, legalMetadata } from "@/components/legal/legal-page";
import { TERMS } from "@/lib/legal";

export const metadata = legalMetadata(TERMS);

export default function TermsPage() {
  return <LegalPage doc={TERMS} />;
}

import { LegalPage, legalMetadata } from "@/components/legal/legal-page";
import { DISCLAIMER } from "@/lib/legal";

export const metadata = legalMetadata(DISCLAIMER);

export default function DisclaimerPage() {
  return <LegalPage doc={DISCLAIMER} />;
}

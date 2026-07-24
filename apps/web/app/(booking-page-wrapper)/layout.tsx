import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import PageWrapper from "@components/PageWrapperAppDir";

export default async function BookingPageWrapperLayout({ children }: { children: React.ReactNode }) {
  // COSMABL fork: public booking pages are disabled — clients book only through
  // COSMABL's payment-gated wizard. Practitioners (SSO session) still reach these
  // pages for the in-app reschedule flow. Cookie presence is a UX gate only; hard
  // enforcement is the session check in /api/book/* and the v2-API secret gate.
  const c = await cookies();
  const hasSession = c.has("next-auth.session-token") || c.has("__Secure-next-auth.session-token");
  if (!hasSession) redirect(process.env.COSMABL_BOOKING_URL || "https://cosmabl.com/book-now");

  const h = await headers();
  const nonce = h.get("x-csp-nonce") ?? undefined;

  return (
    <>
      <PageWrapper isBookingPage={true} requiresLicense={false} nonce={nonce}>
        {children}
      </PageWrapper>
    </>
  );
}

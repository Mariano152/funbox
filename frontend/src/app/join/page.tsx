import { Suspense } from "react";
import { JoinPage } from "@/features/join/JoinPage";

export default function Page() {
  return (
    <Suspense
      fallback={
        <main className="phone-shell">
          <section className="phone-card success-card">
            <p>Preparando la entrada…</p>
          </section>
        </main>
      }
    >
      <JoinPage />
    </Suspense>
  );
}

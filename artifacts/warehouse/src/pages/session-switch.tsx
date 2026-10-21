import { useEffect, useRef, useState } from "react";
import { useClerk } from "@clerk/react";
import { useSignIn } from "@clerk/react/legacy";
import { Loader2 } from "lucide-react";
import { takeSessionSwitchTicket } from "@/lib/session-switch";

export default function SessionSwitchPage() {
  const { session } = useClerk();
  const { isLoaded, signIn, setActive } = useSignIn();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !signIn || !setActive || started.current) return;
    started.current = true;

    const ticket = takeSessionSwitchTicket();
    if (!ticket) {
      window.location.replace(`${import.meta.env.BASE_URL}sign-in`);
      return;
    }

    void (async () => {
      try {
        if (session) await session.end();
        const attempt = await signIn.create({
          strategy: "ticket",
          ticket,
        });
        if (attempt.status !== "complete" || !attempt.createdSessionId) {
          throw new Error("Clerk не создал новую сессию");
        }
        await setActive({ session: attempt.createdSessionId });
        const appRoot = new URL(window.location.href);
        appRoot.pathname = appRoot.pathname.replace(/\/session-switch\/?$/, "/");
        appRoot.search = "";
        appRoot.hash = "";
        window.location.replace(appRoot);
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Не удалось переключить учётную запись",
        );
      }
    })();
  }, [isLoaded, session, setActive, signIn]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md text-center">
        {error ? (
          <>
            <h1 className="text-lg font-semibold">Не удалось переключить учётную запись</h1>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <a
              href={`${import.meta.env.BASE_URL}sign-in`}
              className="mt-4 inline-block text-sm font-medium underline underline-offset-4"
            >
              Перейти ко входу
            </a>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto h-6 w-6 animate-spin" />
            <p className="mt-3 text-sm text-muted-foreground">
              Переключаем учётную запись…
            </p>
          </>
        )}
      </div>
    </main>
  );
}
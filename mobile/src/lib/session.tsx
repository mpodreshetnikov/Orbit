import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { currentInstance } from "@/lib/instance";
import { supabase } from "@/lib/supabase";

type SessionState = {
  /** `null` once we know nobody is signed in; `undefined` while the stored session is being read. */
  session: Session | null | undefined;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionState>({
  session: undefined,
  signOut: async () => {},
});

/**
 * Holds the signed-in session for the whole app.
 *
 * The distinction that matters is between "not signed in" and "we do not know yet": a cold start
 * reads the stored session from disk, and routing on `null` before that read returns would flash the
 * sign-in screen at somebody who is already signed in. `undefined` is that third state, and the
 * router waits for it.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    // No server chosen yet: nobody can be signed in, and there is no client to ask.
    if (!currentInstance()) {
      setSession(null);
      return;
    }
    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session);
      }
    });

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      session,
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [session],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { loadInstance, saveInstance, type Instance } from "@/lib/instance";
import { queryClient } from "@/lib/queries";
import { leaveInstance } from "@/lib/supabase";

type InstanceState = {
  /** `undefined` while the phone's choice is being read; `null` when there is none yet. */
  instance: Instance | null | undefined;
  /** Talk to another server from now on: signs out of the one in use and forgets what it showed. */
  switchTo: (next: Instance) => Promise<void>;
};

const InstanceContext = createContext<InstanceState>({
  instance: undefined,
  switchTo: async () => {},
});

/**
 * Which Orbit server the app talks to, chosen on this phone (`T-261017-5or`).
 *
 * Changing it is a deliberate act from the server screen and nothing else: the instance cannot move
 * the app elsewhere. The old session is signed out and the cache cleared before the new address is
 * stored, and the session provider below is keyed by the address, so nothing from one server is ever
 * shown as another's.
 */
export function InstanceProvider({ children }: { children: React.ReactNode }) {
  const [instance, setInstance] = useState<Instance | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void loadInstance().then((loaded) => {
      if (active) setInstance(loaded);
    });
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<InstanceState>(
    () => ({
      instance,
      switchTo: async (next) => {
        // The old server may be the one that cannot be reached: this signs out regardless.
        await leaveInstance();
        queryClient.clear();
        await saveInstance(next);
        setInstance(next);
      },
    }),
    [instance],
  );

  return <InstanceContext.Provider value={value}>{children}</InstanceContext.Provider>;
}

export function useInstance(): InstanceState {
  return useContext(InstanceContext);
}

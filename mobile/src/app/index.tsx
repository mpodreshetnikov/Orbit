import { Redirect } from "expo-router";
import { Placeholder } from "@/components/ui";
import { useInstance } from "@/lib/instance-context";
import { useSession } from "@/lib/session";

/**
 * Where a cold start lands.
 *
 * While the stored session is still being read the answer is "not yet" rather than "signed out", so
 * this holds a spinner instead of redirecting. Routing on the unknown state is what makes an app
 * flash its login screen at somebody who is already signed in.
 */
export default function Index() {
  const { instance } = useInstance();
  const { session } = useSession();

  if (instance === undefined) {
    return <Placeholder busy />;
  }
  // A first start of a build that names no server asks which one before anything else.
  if (instance === null) {
    return <Redirect href="/server" />;
  }
  if (session === undefined) {
    return <Placeholder busy />;
  }

  return <Redirect href={session ? "/today" : "/sign-in"} />;
}

import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

// Import messages statically
import en from "@/messages/en.json";
import ru from "@/messages/ru.json";

const messages = {
  en,
  ru,
} as const;

type Locale = keyof typeof messages;

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get("app.lang");
  const locale = (localeCookie?.value as Locale) || "en";

  return {
    locale,
    messages: messages[locale] || messages.en,
  };
});

"use client";

import React, { useEffect, useState } from "react";
import { ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SCROLL_THRESHOLD = 300;

export function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > SCROLL_THRESHOLD);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      onClick={scrollToTop}
      aria-label="Scroll to top"
      className={cn(
        "fixed z-50 size-11 rounded-full shadow-lg transition-all duration-200",
        "bottom-[calc(4.5rem+var(--safe-area-inset-bottom)+0.5rem)] right-6 md:bottom-8 md:right-8",
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0",
      )}
    >
      <ChevronUp className="size-5" />
    </Button>
  );
}

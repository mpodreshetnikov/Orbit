import { useState, type ReactNode } from "react";

export function ControlledDialog({
  children,
}: {
  children: (props: { open: boolean; onOpenChange: (open: boolean) => void }) => ReactNode;
}) {
  const [open, onOpenChange] = useState(true);
  return children({ open, onOpenChange });
}

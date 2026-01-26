"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type { Person } from "@/types";

async function fetchPersons(): Promise<Person[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("persons")
    .select("*")
    .order("kind", { ascending: true }) // humans first (h < p)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data as Person[];
}

export function usePersons() {
  return useQuery({
    queryKey: ["persons"],
    queryFn: fetchPersons,
  });
}

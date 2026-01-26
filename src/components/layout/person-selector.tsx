"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, User, PawPrint, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePersons, useCurrentUser } from "@/hooks";
import { useUIStore } from "@/stores/ui-store";
import type { Person } from "@/types";

function PersonIcon({ kind }: { kind: Person["kind"] }) {
  if (kind === "pet") {
    return <PawPrint className="h-4 w-4" />;
  }
  return <User className="h-4 w-4" />;
}

export function PersonSelector() {
  const t = useTranslations();
  const { data: persons, isLoading: personsLoading } = usePersons();
  const { data: currentUser } = useCurrentUser();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);
  const setSelectedPersonId = useUIStore((state) => state.setSelectedPersonId);

  // Find the user's own person (linked via auth_user_id)
  const myPerson = persons?.find((p) => p.auth_user_id === currentUser?.id);

  // Check if the currently selected person exists in the persons list
  const selectedPersonExists = persons?.some((p) => p.id === selectedPersonId);

  // Auto-select user's own person if:
  // 1. No person is selected, OR
  // 2. Selected person doesn't exist (e.g., from previous session/different user)
  useEffect(() => {
    if (myPerson && (!selectedPersonId || !selectedPersonExists)) {
      setSelectedPersonId(myPerson.id);
    }
  }, [selectedPersonId, selectedPersonExists, myPerson, setSelectedPersonId]);

  const selectedPerson = persons?.find((p) => p.id === selectedPersonId);

  // Group persons: user's own person first, then other humans, then pets
  const otherHumans = persons?.filter(
    (p) => p.kind === "human" && p.auth_user_id !== currentUser?.id
  ) ?? [];
  const pets = persons?.filter((p) => p.kind === "pet") ?? [];

  if (personsLoading) {
    return (
      <Button variant="ghost" size="sm" className="gap-1" disabled>
        <Users className="h-4 w-4" />
        <span className="hidden sm:inline">{t("common.loading")}</span>
      </Button>
    );
  }

  // If user only has their own person, just show their name (no dropdown needed)
  if (myPerson && otherHumans.length === 0 && pets.length === 0) {
    return (
      <Button variant="ghost" size="sm" className="gap-1 cursor-default" disabled>
        <User className="h-4 w-4" />
        <span className="hidden sm:inline max-w-[120px] truncate">
          {myPerson.name}
        </span>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1">
          {selectedPerson ? (
            <>
              <PersonIcon kind={selectedPerson.kind} />
              <span className="hidden sm:inline max-w-[120px] truncate">
                {selectedPerson.name}
                {selectedPerson.auth_user_id === currentUser?.id && (
                  <span className="text-muted-foreground ml-1">
                    ({t("person.you")})
                  </span>
                )}
              </span>
            </>
          ) : (
            <>
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">{t("person.select")}</span>
            </>
          )}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {persons && persons.length === 0 ? (
          <DropdownMenuItem disabled>
            {t("person.noPersons")}
          </DropdownMenuItem>
        ) : (
          <>
            {/* User's own person first */}
            {myPerson && (
              <>
                <DropdownMenuItem
                  onClick={() => setSelectedPersonId(myPerson.id)}
                  className={myPerson.id === selectedPersonId ? "bg-accent" : ""}
                >
                  <User className="mr-2 h-4 w-4" />
                  <span className="flex-1">{myPerson.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {t("person.you")}
                  </span>
                </DropdownMenuItem>
                {(otherHumans.length > 0 || pets.length > 0) && (
                  <DropdownMenuSeparator />
                )}
              </>
            )}

            {/* Other humans section */}
            {otherHumans.length > 0 && (
              <>
                <DropdownMenuLabel>{t("person.humans")}</DropdownMenuLabel>
                {otherHumans.map((person) => (
                  <DropdownMenuItem
                    key={person.id}
                    onClick={() => setSelectedPersonId(person.id)}
                    className={
                      person.id === selectedPersonId ? "bg-accent" : ""
                    }
                  >
                    <User className="mr-2 h-4 w-4" />
                    {person.name}
                  </DropdownMenuItem>
                ))}
              </>
            )}

            {/* Separator if both sections exist */}
            {otherHumans.length > 0 && pets.length > 0 && (
              <DropdownMenuSeparator />
            )}

            {/* Pets section */}
            {pets.length > 0 && (
              <>
                <DropdownMenuLabel>{t("person.pets")}</DropdownMenuLabel>
                {pets.map((person) => (
                  <DropdownMenuItem
                    key={person.id}
                    onClick={() => setSelectedPersonId(person.id)}
                    className={
                      person.id === selectedPersonId ? "bg-accent" : ""
                    }
                  >
                    <PawPrint className="mr-2 h-4 w-4" />
                    <span className="flex-1">{person.name}</span>
                    {person.species && (
                      <span className="text-xs text-muted-foreground">
                        {person.species}
                      </span>
                    )}
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

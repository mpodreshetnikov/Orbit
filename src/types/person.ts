export type PersonKind = "human" | "pet";

export interface Person {
  id: string;
  name: string;
  kind: PersonKind;
  species: string | null;
  birthday: string | null;
  notes: string | null;
  auth_user_id: string | null; // Links person to their user account (their "own" person)
  created_at: string;
  updated_at: string;
}

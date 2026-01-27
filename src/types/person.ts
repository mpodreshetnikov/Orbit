export type PersonKind = "human" | "pet";

export type PersonSex = "male" | "female" | "other";

export interface Person {
  id: string;
  name: string;
  kind: PersonKind;
  species: string | null; // For pets (e.g., "dog", "cat")
  breed: string | null; // For pets (e.g., "Labrador", "Persian")
  sex: PersonSex | null; // For humans
  birthday: string | null;
  notes: string | null;
  auth_user_id: string | null; // Links person to their user account (their "own" person)
  created_at: string;
  updated_at: string;
}

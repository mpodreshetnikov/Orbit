import { describe, expect, it } from "@jest/globals";
import { AlertCircle, Ban, CheckCircle, Clock, Package, Pill, X } from "lucide-react-native";
import { statusIcon, unitIcon } from "@/components/medication-icons";
import type { MedicationUnit } from "@orbit-types/medication";

describe("unitIcon", () => {
  it("draws the web app's icon for a unit, and a package for anything unknown", () => {
    expect(unitIcon("pill")).toBe(Pill);
    expect(unitIcon("bucket" as MedicationUnit)).toBe(Package);
  });
});

describe("statusIcon", () => {
  it("marks each state as the web dashboard does", () => {
    expect(statusIcon("taken")).toEqual({ icon: CheckCircle, tone: "success" });
    expect(statusIcon("skipped")).toEqual({ icon: X, tone: "mutedForeground" });
    expect(statusIcon("missed")).toEqual({ icon: AlertCircle, tone: "warning" });
    expect(statusIcon("cancelled")).toEqual({ icon: Ban, tone: "mutedForeground" });
    expect(statusIcon("scheduled")).toEqual({ icon: Clock, tone: "mutedForeground" });
  });
});

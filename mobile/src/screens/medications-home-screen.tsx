import { useState } from "react";
import { Segmented } from "@/components/form";
import { t } from "@/lib/i18n";
import DosesScreen from "./doses-screen";
import MedicationsScreen from "./medications-screen";

type View = "doses" | "courses";

/**
 * "Лекарства": the day's doses and the courses behind them, one tab with a segmented switch between
 * the two. Doses come first: they are what the tab is opened for most days.
 */
export default function MedicationsHomeScreen() {
  const [view, setView] = useState<View>("doses");
  const top = (
    <Segmented<View>
      options={[
        ["doses", t("medications.viewDoses")],
        ["courses", t("medications.viewCourses")],
      ]}
      value={view}
      onChange={setView}
    />
  );
  return view === "doses" ? <DosesScreen top={top} /> : <MedicationsScreen top={top} />;
}

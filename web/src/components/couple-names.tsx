import type { Locale, WeddingParents } from "@/lib/types";

import styles from "./wedding-experience.module.css";

export function splitCoupleNames(names: string, locale: Locale) {
  const separator = locale === "hi" ? /\s+(?:एवं|और)\s+|\s*&\s*/u : /\s*&\s*|\s+and\s+/iu;
  const match = separator.exec(names);
  if (!match) return null;
  const groom = names.slice(0, match.index).trim();
  const bride = names.slice(match.index + match[0].length).trim();
  return groom && bride ? { groom, bride, separator: match[0].trim() } : null;
}

export function CoupleNames({ names, locale, parents }: {
  names: string;
  locale: Locale;
  parents?: WeddingParents;
}) {
  const couple = splitCoupleNames(names, locale);
  if (!couple) return <>{names}</>;

  return <>
    <span className={styles["couple-person"]}>
      <span className={styles["couple-person-name"]}>{couple.groom}</span>{" "}
      {parents?.groom && <small className={styles["couple-parents"]}>
        <span className={styles["couple-parent-relation"]}>{locale === "hi" ? "सुपुत्र" : "Son of"}</span>{" "}
        <span>{parents.groom[locale]}</span>
      </small>}
    </span>
    {" "}<em>{couple.separator}</em>{" "}
    <span className={styles["couple-person"]}>
      <span className={styles["couple-person-name"]}>{couple.bride}</span>{" "}
      {parents?.bride && <small className={styles["couple-parents"]}>
        <span className={styles["couple-parent-relation"]}>{locale === "hi" ? "सुपुत्री" : "Daughter of"}</span>{" "}
        <span>{parents.bride[locale]}</span>
      </small>}
    </span>
  </>;
}

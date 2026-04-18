/** Common ISO 4217 codes for package pricing (extend as needed). */
export const PACKAGE_CURRENCIES = [
  { code: "USD", label: "USD — US dollar" },
  { code: "SAR", label: "SAR — ريال سعودي" },
  { code: "AED", label: "AED — درهم إماراتي" },
  { code: "IQD", label: "IQD — دينار عراقي" },
  { code: "EGP", label: "EGP — جنيه مصري" },
  { code: "EUR", label: "EUR — يورو" },
  { code: "GBP", label: "GBP — جنيه إسترليني" },
  { code: "TRY", label: "TRY — ليرة تركية" },
  { code: "JOD", label: "JOD — دينار أردني" },
  { code: "LBP", label: "LBP — ليرة لبنانية" },
] as const;

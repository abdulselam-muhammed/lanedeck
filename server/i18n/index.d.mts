export type Lang = "ar" | "en";
export type Vars = Record<string, string | number>;
export const DICT: Record<Lang, Record<string, string>>;
export const dirOf: (lang: string) => "rtl" | "ltr";
export const fill: (s: string, vars?: Vars) => string;
export function t(lang: Lang | string, key: string, vars?: Vars): string;

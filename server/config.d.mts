export interface PublicProject { id: string; name: string; repo: string | null; defaultBranch: string; me: string | null; reviewers: { login: string; name?: string; role?: string }[]; boardFiles: string[]; profile: string | null; languages?: ("en" | "ar")[] | null }
export interface PublicConfig {
  /** The first project (the default). The client replaces it with the project in the URL (ConfigProvider). */
  project: PublicProject;
  /** Every configured project, each with its profile data (glossary, texts) and whether it has a glossary. */
  projects: (PublicProject & { profileData: Record<string, any> | null; hasGlossary: boolean })[];
  github: { org: string | null };
  machine: { wslDistro: string | null; ciContainer: string | null; localLabel: string };
  ui: { lang: "ar" | "en"; dir: "rtl" | "ltr"; title: string; brand: string | null; runnerPrefix: string | null };
  agents: { windowHours: 24 | 48 | 168 };
  profile: Record<string, any> | null;
}
export function publicConfig(): PublicConfig;
export interface ProjectCfg { id: string; name: string; repo: string | null; defaultBranch: string; [k: string]: any }
export function project(): ProjectCfg;
export function projectById(id: string): ProjectCfg | undefined;

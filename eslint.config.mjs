import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  { ignores: ["_backup/**", ".next/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // The browser's own dialogs ignore the theme and the page direction: use useConfirm() / useNotice() (src/components/ui/dialog).
    rules: {
      "no-restricted-globals": ["error",
        { name: "confirm", message: "Use useConfirm() from @/components/ui/dialog/DialogProvider." },
        { name: "alert", message: "Use useNotice() from @/components/ui/dialog/DialogProvider." },
        { name: "prompt", message: "Build an in-app dialog; the browser prompt is not allowed." },
      ],
      "no-restricted-properties": ["error",
        ...["confirm", "alert", "prompt"].flatMap((property) => ["window", "globalThis", "self"].map((object) => ({ object, property, message: "Use the in-app dialogs (src/components/ui/dialog)." }))),
      ],
    },
  },
];

export default eslintConfig;

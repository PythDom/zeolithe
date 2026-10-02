/**
 * Roboto Mono (OFL) for chord sheets and code in PDFs: a monospaced font keeps
 * chords above the right syllables. Loaded with pdfmake on first export.
 */
import bold from "@fontsource/roboto-mono/files/roboto-mono-latin-700-normal.woff?inline";
import boldItalic from "@fontsource/roboto-mono/files/roboto-mono-latin-700-italic.woff?inline";
import italic from "@fontsource/roboto-mono/files/roboto-mono-latin-400-italic.woff?inline";
import regular from "@fontsource/roboto-mono/files/roboto-mono-latin-400-normal.woff?inline";

const base64 = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(",") + 1);

export const monoVfs: Record<string, string> = {
  "RobotoMono-Regular.woff": base64(regular),
  "RobotoMono-Bold.woff": base64(bold),
  "RobotoMono-Italic.woff": base64(italic),
  "RobotoMono-BoldItalic.woff": base64(boldItalic),
};

export const monoFonts = {
  RobotoMono: {
    normal: "RobotoMono-Regular.woff",
    bold: "RobotoMono-Bold.woff",
    italics: "RobotoMono-Italic.woff",
    bolditalics: "RobotoMono-BoldItalic.woff",
  },
};

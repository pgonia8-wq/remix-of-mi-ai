import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy } from "lucide-react";
import { Button } from "./ui/button";
import { toast } from "sonner";
// Parsing long Markdown is expensive: plugins/components are module constants and the component is memoized,
// so typing in the composer or streaming a new answer never re-parses earlier messages.
const PLUGINS = [remarkGfm];
const COMPONENTS: Components = {
    a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    table: ({ children }) => <div className="max-w-full overflow-x-auto"><table>{children}</table></div>,
    pre: ({ children }) => <div className="relative"><Button size="icon" variant="ghost" aria-label="Copiar código" title="Copiar código" className="absolute right-2 top-2 h-7 w-7" onClick={(e) => { const code = e.currentTarget.parentElement?.querySelector("pre")?.textContent; if (code) navigator.clipboard.writeText(code).then(() => toast.success("Código copiado")).catch(() => toast.error("No se pudo copiar.")); }}><Copy className="h-3.5 w-3.5" /></Button><pre>{children}</pre></div>,
};
export const ChatMarkdown = memo(function ChatMarkdown({ text }: { text: string }) {
  return <div className="chat-markdown text-[15px] sm:text-base"><ReactMarkdown remarkPlugins={PLUGINS} components={COMPONENTS}>{text}</ReactMarkdown></div>;
});
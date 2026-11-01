import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy } from "lucide-react";
import { Button } from "./ui/button";
import { toast } from "sonner";
export function ChatMarkdown({ text }: { text: string }) {
  return <div className="chat-markdown text-[15px] sm:text-base"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    table: ({ children }) => <div className="max-w-full overflow-x-auto"><table>{children}</table></div>,
    pre: ({ children }) => <div className="relative"><Button size="icon" variant="ghost" aria-label="Copiar código" title="Copiar código" className="absolute right-2 top-2 h-7 w-7" onClick={(e) => { const code = e.currentTarget.parentElement?.querySelector("pre")?.textContent; if (code) navigator.clipboard.writeText(code).then(() => toast.success("Código copiado")).catch(() => toast.error("No se pudo copiar.")); }}><Copy className="h-3.5 w-3.5" /></Button><pre>{children}</pre></div>,
  }}>{text}</ReactMarkdown></div>;
}
import { BRAND } from "@/lib/brand";

/** Who answers, linked and recessed: a plain word, no logo. */
export function ClaudeLink({ className = "" }: { className?: string }) {
  return (
    <a
      href={BRAND.claudeUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Claude, by Anthropic"
      data-tip="Answers by Claude, from Anthropic"
      className={`flex h-9 shrink-0 items-center rounded-sm font-serif text-[17px] leading-none text-ink opacity-75 transition-opacity duration-200 hover:opacity-100 ${className}`}
    >
      Claude
    </a>
  );
}
